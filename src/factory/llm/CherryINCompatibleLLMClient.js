import { MCPToolAdapter } from '../../utils/llm/mcp-tool-adapter.js';
import { buildOpenAIChatCompletionsBody, applyOpenAITools } from '../../utils/llm/openai-chat-utils.js';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';
import { ensureMessagesImagesDataUrl } from '../../utils/llm/image-utils.js';
import BotUtil from '../../utils/botutil.js';
import { iterateSSE } from '../../utils/llm/sse-utils.js';

/**
 * CherryIN 兼容工厂客户端（独立实现，不继承）
 * - 读取 cherryin_compat_llm.providers 配置
 * - 协议：OpenAI Chat Completions 兼容
 */
export default class CherryINCompatibleLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout ?? 360000;
  }

  normalizeEndpoint(config) {
    const base = (config.baseUrl ?? '').replace(/\/+$/, '');
    const path = (config.path || '/v1/chat/completions').replace(/^\/?/, '/');
    if (!base) throw new Error('cherryin_compat: 未配置 baseUrl');
    return `${base}${path}`;
  }

  get timeout() {
    return this._timeout ?? 360000;
  }

  buildHeaders(extra = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...extra
    };

    if (this.config.apiKey) {
      const mode = String(this.config.authMode || 'bearer').toLowerCase();
      const apiKey = String(this.config.apiKey).trim();
      if (mode === 'api-key') {
        headers['api-key'] = apiKey;
      } else if (mode === 'header') {
        const name = String(this.config.authHeaderName ?? '').trim();
        if (!name) throw new Error('cherryin_compat: authMode=header 时必须提供 authHeaderName');
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
    const body = buildOpenAIChatCompletionsBody(messages, this.config, overrides, 'gpt-4o-mini');
    applyOpenAITools(body, this.config, overrides);
    return body;
  }

  _buildRequestOptions(messages, overrides = {}, stream = false) {
    return buildFetchOptionsWithProxy(this.config, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: JSON.stringify(this.buildBody(messages, { ...overrides, stream })),
      signal: AbortSignal.timeout(this.timeout)
    });
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

  async _executeToolCalls(toolCalls, overrides = {}, onDelta) {
    if (!Array.isArray(toolCalls) || !toolCalls.length) return [];

    const normalizedToolCalls = toolCalls.map((tc, idx) => this._normalizeToolCall(tc, idx));
    const streams = Array.isArray(overrides.streams) ? overrides.streams : null;
    const toolResults = await MCPToolAdapter.handleToolCalls(normalizedToolCalls, { streams });

    if (typeof onDelta === 'function') {
      const mcpTools = this._buildMcpToolsPayload(normalizedToolCalls, toolResults);
      onDelta('', { mcp_tools: mcpTools });
    }

    return toolResults;
  }

  async _fetchChatJson(messages, overrides = {}) {
    const resp = await fetch(this.endpoint, this._buildRequestOptions(messages, overrides, false));
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`cherryin_compat 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }
    return await resp.json();
  }

  async _fetchChatStream(messages, overrides = {}) {
    const resp = await fetch(this.endpoint, this._buildRequestOptions(messages, overrides, true));
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`cherryin_compat 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }
    return resp;
  }

  async _consumeSSEWithToolCalls(resp, onDelta) {
    const toolCallsMap = new Map();
    const result = { content: '', toolCalls: [], finishReason: null };

    for await (const { data } of iterateSSE(resp)) {
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta;
        const finishReason = json?.choices?.[0]?.finish_reason;

        if (finishReason) result.finishReason = finishReason;

        if (typeof delta?.content === 'string' && delta.content.length > 0) {
          result.content += delta.content;
          if (typeof onDelta === 'function') onDelta(delta.content);
        }

        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            if (index === undefined || index === null) continue;

            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, { id: '', type: 'function', function: { name: '', arguments: '' } });
            }

            const item = toolCallsMap.get(index);
            if (tc.id) item.id = tc.id;
            if (tc.function?.name) item.function.name = tc.function.name;
            if (tc.function?.arguments) item.function.arguments += tc.function.arguments;
          }
        }
      } catch (e) {
        BotUtil.makeLog('warn', `[CherryINCompatibleLLMClient] SSE JSON解析失败: ${e.message}`, 'LLMFactory');
      }
    }

    if (toolCallsMap.size > 0) {
      const sorted = Array.from(toolCallsMap.keys()).sort((a, b) => a - b);
      result.toolCalls = sorted.map((i, idx) => this._normalizeToolCall(toolCallsMap.get(i), idx));
    }

    return result;
  }

  async _runWithToolRounds(initialMessages, overrides = {}, handlers = {}) {
    const maxToolRounds = this.config.maxToolRounds || 7;
    const state = { messages: [...initialMessages], executedToolNames: [] };

    for (let round = 0; round < maxToolRounds; round++) {
      const roundResult = await handlers.requestRound(state.messages, overrides, state);
      const toolCalls = Array.isArray(roundResult?.toolCalls) ? roundResult.toolCalls : [];

      if (!toolCalls.length) {
        return { content: roundResult?.content || '', executedToolNames: state.executedToolNames };
      }

      for (const tc of toolCalls) {
        const name = tc.function?.name;
        if (name && !state.executedToolNames.includes(name)) state.executedToolNames.push(name);
      }

      state.messages.push({ role: 'assistant', content: roundResult?.content || null, tool_calls: toolCalls });
      const toolResults = await this._executeToolCalls(toolCalls, overrides, handlers.onDelta);
      state.messages.push(...toolResults);
    }

    BotUtil.makeLog('warn', `[CherryINCompatibleLLMClient] 达到最大工具调用轮数: ${maxToolRounds}`, 'LLMFactory');
    return { content: state.messages[state.messages.length - 1]?.content || '', executedToolNames: state.executedToolNames };
  }

  async chat(messages, overrides = {}) {
    const transformed = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformed, { timeoutMs: this.timeout });

    const result = await this._runWithToolRounds(transformed, overrides, {
      requestRound: async (currentMessages, ov) => {
        const json = await this._fetchChatJson(currentMessages, ov);
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
    const transformed = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformed, { timeoutMs: this.timeout });

    await this._runWithToolRounds(transformed, overrides, {
      onDelta,
      requestRound: async (currentMessages, ov) => {
        const resp = await this._fetchChatStream(currentMessages, ov);
        return await this._consumeSSEWithToolCalls(resp, onDelta);
      }
    });
  }
}
