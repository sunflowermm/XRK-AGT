import { MCPToolAdapter } from '../../utils/llm/mcp-tool-adapter.js';
import { buildOpenAIChatCompletionsBody, applyOpenAITools } from '../../utils/llm/openai-chat-utils.js';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';
import { ensureMessagesImagesDataUrl } from '../../utils/llm/image-utils.js';
import BotUtil from '../../utils/botutil.js';
import { iterateSSE } from '../../utils/llm/sse-utils.js';

/**
 * OpenAI 兼容第三方 LLM 客户端（Chat Completions 协议）
 *
 * - 专注 Chat Completions（与 OpenAI Responses 客户端分离）
 * - 统一非流式/流式工具调用主循环，减少事件链分叉
 */
export default class OpenAICompatibleLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout ?? 360000;
  }

  normalizeEndpoint(config) {
    const base = (config.baseUrl ?? '').replace(/\/+$/, '');
    // 约定：baseUrl 默认已经带上版本前缀（如 /v1），path 只写资源路径（如 /chat/completions）
    const path = (config.path || '/chat/completions').replace(/^\/?/, '/');
    if (!base) throw new Error('openai_compat: 未配置 baseUrl（第三方 OpenAI 兼容接口地址）');
    return `${base}${path}`;
  }

  get timeout() {
    return this._timeout ?? 360000;
  }

  buildHeaders(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };

    if (this.config.apiKey) {
      const mode = String(this.config.authMode || 'bearer').toLowerCase();
      const apiKey = String(this.config.apiKey).trim();
      if (mode === 'api-key') {
        headers['api-key'] = apiKey;
      } else if (mode === 'header') {
        const name = String(this.config.authHeaderName ?? '').trim();
        if (!name) throw new Error('openai_compat: authMode=header 时必须提供 authHeaderName');
        headers[name] = apiKey;
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }
    }

    if (this.config.headers) Object.assign(headers, this.config.headers);
    return headers;
  }

  async transformMessages(messages) {
    return await transformMessagesWithVision(messages, this.config, { mode: 'openai' });
  }

  buildBody(messages, overrides = {}) {
    const defaultModel = this.config.model || this.config.chatModel;
    const body = buildOpenAIChatCompletionsBody(messages, this.config, overrides, defaultModel);
    applyOpenAITools(body, this.config, overrides);
    return body;
  }

  async _prepareMessages(messages) {
    const transformed = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformed, { timeoutMs: this.timeout });
    return transformed;
  }

  _normalizeToolCall(toolCall, index) {
    const normalized = {
      id: toolCall?.id,
      type: toolCall?.type || 'function',
      function: {
        name: toolCall?.function?.name || '',
        arguments: toolCall?.function?.arguments || ''
      }
    };
    if (!normalized.id || typeof normalized.id !== 'string') {
      normalized.id = `call_${index}_${(normalized.function.name || 'tool').replace(/\W/g, '_')}`;
    }
    return normalized;
  }

  _buildMcpToolsPayload(toolCalls, toolResults) {
    return toolCalls.map((tc, idx) => ({
      name: tc.function?.name || `工具${idx + 1}`,
      arguments: tc.function?.arguments || {},
      result: toolResults[idx]?.content ?? ''
    }));
  }

  _buildRequestOptions(messages, overrides = {}, stream = false) {
    const body = this.buildBody(messages, { ...overrides, stream });
    const bodyStr = JSON.stringify(body);

    const model = body?.model ?? '';
    const toolsCount = Array.isArray(body?.tools) ? body.tools.length : 0;
    const hasTools = toolsCount > 0;
    const maxTokens = body?.max_completion_tokens ?? body?.max_tokens;

    BotUtil.makeLog(
      'debug',
      `[OpenAICompatibleLLMClient] 构建请求: stream=${stream}, endpoint=${this.endpoint}, model=${model || '<empty>'}, tools=${hasTools ? toolsCount : 0}, temperature=${body?.temperature}, top_p=${body?.top_p}, max_tokens=${maxTokens ?? ''}, bodyLength=${bodyStr.length}`,
      'LLMFactory'
    );

    return buildFetchOptionsWithProxy(this.config, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: bodyStr,
      signal: AbortSignal.timeout(this.timeout)
    });
  }

  async _fetchRound(messages, overrides = {}, stream = false) {
    const resp = await fetch(this.endpoint, this._buildRequestOptions(messages, overrides, stream));
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const tag = stream ? '流式请求失败' : '请求失败';
      throw new Error(`openai_compat ${tag}: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }
    if (stream && !resp.body) {
      BotUtil.makeLog(
        'warn',
        '[OpenAICompatibleLLMClient] 流式请求失败：resp.ok 但 body 为空',
        'LLMFactory'
      );
      throw new Error('openai_compat 流式请求失败: 响应 body 为空');
    }

    if (stream) {
      const contentType = (resp.headers?.get?.('content-type') || '').toLowerCase();
      // 某些上游在 HTTP 200 时仍返回 JSON 错误体（如 {"status":"435","msg":"Model not support"}），
      // 这会导致 SSE 解析拿不到任何 data 事件，表现为“空流”。这里显式检测并抛出可读错误。
      if (contentType && !contentType.includes('text/event-stream')) {
        const text = await resp.text().catch(() => '');
        BotUtil.makeLog(
          'warn',
          `[OpenAICompatibleLLMClient] 期望SSE但收到非SSE响应: content-type=${contentType}, bodyPreview="${String(text)
            .slice(0, 300)
            .replace(/\s+/g, ' ')}"`,
          'LLMFactory'
        );
        throw new Error(
          `openai_compat 流式响应不是SSE: content-type=${contentType}${text ? ` | body=${text}` : ''}`
        );
      }
    }

    BotUtil.makeLog(
      'info',
      `[OpenAICompatibleLLMClient] _fetchRound 成功: stream=${stream}, status=${resp.status}, url=${resp.url || this.endpoint}`,
      'LLMFactory'
    );
    return resp;
  }

  async _executeToolCalls(toolCalls, overrides = {}, onDelta) {
    if (!Array.isArray(toolCalls) || !toolCalls.length) return [];

    const normalizedToolCalls = toolCalls.map((tc, idx) => this._normalizeToolCall(tc, idx));
    const streams = Array.isArray(overrides.streams) ? overrides.streams : null;
    const toolResults = await MCPToolAdapter.handleToolCalls(normalizedToolCalls, { streams });

    if (typeof onDelta === 'function') {
      onDelta('', { mcp_tools: this._buildMcpToolsPayload(normalizedToolCalls, toolResults) });
    }

    return toolResults;
  }

  async _consumeSSEWithToolCalls(resp, onDelta) {
    const toolCallsMap = new Map();
    const result = { content: '', toolCalls: [] };
    let sseEventCount = 0;
    let sseDataChars = 0;
    let deltaContentChars = 0;

    for await (const { data } of iterateSSE(resp)) {
      sseEventCount += 1;
      sseDataChars += data?.length || 0;

      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta;

        if (typeof delta?.content === 'string' && delta.content.length > 0) {
          result.content += delta.content;
          deltaContentChars += delta.content.length;
          if (typeof onDelta === 'function') onDelta(delta.content);
        }

        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            if (index === undefined || index === null) continue;

            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, {
                id: '',
                type: 'function',
                function: { name: '', arguments: '' }
              });
            }

            const item = toolCallsMap.get(index);
            if (tc.id) item.id = tc.id;
            if (tc.function?.name) item.function.name = tc.function.name;
            if (tc.function?.arguments) item.function.arguments += tc.function.arguments;
          }
        }
      } catch (e) {
        BotUtil.makeLog('warn', `[OpenAICompatibleLLMClient] SSE JSON解析失败: ${e.message}`, 'LLMFactory');
      }
    }

    if (toolCallsMap.size > 0) {
      const sortedIndices = Array.from(toolCallsMap.keys()).sort((a, b) => a - b);
      result.toolCalls = sortedIndices.map((idx, i) => this._normalizeToolCall(toolCallsMap.get(idx), i));
      BotUtil.makeLog('info', `[OpenAICompatibleLLMClient] 收集到${result.toolCalls.length}个工具调用`, 'LLMFactory');
    }

    BotUtil.makeLog(
      'info',
      `[OpenAICompatibleLLMClient] SSE 消费完成: events=${sseEventCount}, sseDataChars=${sseDataChars}, deltaContentChars=${deltaContentChars}`,
      'LLMFactory'
    );

    return result;
  }

  _collectToolNames(toolCalls = [], toolNameSet = new Set()) {
    for (const tc of toolCalls) {
      const name = tc?.function?.name;
      if (name) toolNameSet.add(name);
    }
  }

  async _runWithToolRounds(initialMessages, overrides = {}, handlers = {}) {
    const maxToolRounds = this.config.maxToolRounds || 7;
    const state = {
      messages: [...initialMessages],
      toolNameSet: new Set()
    };

    for (let round = 0; round < maxToolRounds; round++) {
      const roundResult = await handlers.requestRound(state.messages, overrides, state);
      const content = roundResult?.content || '';
      const toolCalls = Array.isArray(roundResult?.toolCalls) ? roundResult.toolCalls : [];

      if (!toolCalls.length) {
        return { content, executedToolNames: Array.from(state.toolNameSet) };
      }

      this._collectToolNames(toolCalls, state.toolNameSet);
      state.messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });

      const toolResults = await this._executeToolCalls(toolCalls, overrides, handlers.onDelta);
      state.messages.push(...toolResults);
    }

    BotUtil.makeLog('warn', `[OpenAICompatibleLLMClient] 达到最大工具调用轮数: ${maxToolRounds}`, 'LLMFactory');
    return {
      content: state.messages[state.messages.length - 1]?.content || '',
      executedToolNames: Array.from(state.toolNameSet)
    };
  }

  async chat(messages, overrides = {}) {
    const transformedMessages = await this._prepareMessages(messages);

    const result = await this._runWithToolRounds(transformedMessages, overrides, {
      requestRound: async (currentMessages, ov) => {
        const resp = await this._fetchRound(currentMessages, ov, false);
        const json = await resp.json();
        const message = json?.choices?.[0]?.message;
        return {
          content: message?.content || '',
          toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : []
        };
      }
    });

    return result.executedToolNames.length > 0
      ? { content: result.content, executedToolNames: result.executedToolNames }
      : result.content;
  }

  async chatStream(messages, onDelta, overrides = {}) {
    const transformedMessages = await this._prepareMessages(messages);

    BotUtil.makeLog(
      'info',
      `[OpenAICompatibleLLMClient] chatStream 开始: messages=${transformedMessages.length}`,
      'LLMFactory'
    );

    const result = await this._runWithToolRounds(transformedMessages, overrides, {
      onDelta,
      requestRound: async (currentMessages, ov) => {
        const resp = await this._fetchRound(currentMessages, ov, true);
        return await this._consumeSSEWithToolCalls(resp, onDelta);
      }
    });

    BotUtil.makeLog(
      'info',
      `[OpenAICompatibleLLMClient] chatStream 结束`,
      'LLMFactory'
    );

    return result;
  }
}
