import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';
import { partitionAndExecuteToolCalls } from '../../utils/llm/tool-partition-utils.js';
import { buildOpenAIChatCompletionsBody, applyOpenAITools } from '../../utils/llm/openai-chat-utils.js';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { ensureMessagesImagesDataUrl } from '../../utils/llm/image-utils.js';
import BotUtil from '../../utils/botutil.js';
import { iterateSSE } from '../../utils/llm/sse-utils.js';

/**
 * OpenAI 官方 LLM 客户端（Chat Completions）
 *
 * - 默认：
 *   - baseUrl: https://api.openai.com/v1
 *   - path: /chat/completions
 *   - 认证：Authorization: Bearer ${apiKey}
 * - 支持多模态：messages[].content 可以是 text + image_url（含 base64 data URL）
 * - tool calling：使用 OpenAI tools/tool_calls 协议 + MCPToolAdapter 多轮执行
 */
export default class OpenAILLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout ?? 360000;
  }

  normalizeEndpoint(config) {
    const base = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const path = (config.path || '/chat/completions').replace(/^\/?/, '/');
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
      headers.Authorization = `Bearer ${String(this.config.apiKey).trim()}`;
    }

    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  async transformMessages(messages) {
    // OpenAI 官方多模态，使用 openai 模式，允许 base64 封装为 data URL
    return await transformMessagesWithVision(messages, this.config, { mode: 'openai' });
  }

  buildBody(messages, overrides = {}) {
    const defaultModel = this.config.model || this.config.chatModel;
    const body = buildOpenAIChatCompletionsBody(messages, this.config, overrides, defaultModel);
    applyOpenAITools(body, this.config, overrides);
    return body;
  }

  async chat(messages, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformedMessages, { timeoutMs: this.timeout });
    const enableMcpTools = overrides?.mcpToolMode !== 'passthrough';
    const maxToolRounds = this.config.maxToolRounds || 7;
    const currentMessages = [...transformedMessages];
    const executedToolNames = [];

    for (let round = 0; round < maxToolRounds; round++) {
      const resp = await fetch(
        this.endpoint,
        buildFetchOptionsWithProxy(this.config, {
          method: 'POST',
          headers: this.buildHeaders(overrides.headers),
          body: JSON.stringify(this.buildBody(currentMessages, { ...overrides })),
          signal: AbortSignal.timeout(this.timeout)
        })
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`OpenAI LLM 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
      }

      const result = await resp.json();
      const message = result?.choices?.[0]?.message;
      if (!message) break;

      if (message.tool_calls?.length > 0 && enableMcpTools) {
        for (const tc of message.tool_calls) {
          const name = tc.function?.name;
          if (name && !executedToolNames.includes(name)) executedToolNames.push(name);
        }
        currentMessages.push(message);
        const toolResults = await partitionAndExecuteToolCalls(message.tool_calls, overrides);
        if (toolResults === null) return executedToolNames.length ? { content: '', executedToolNames } : '';
        currentMessages.push(...toolResults);
        continue;
      }
      if (message.tool_calls?.length > 0 && !enableMcpTools) break;

      const content = message.content || '';
      return executedToolNames.length > 0 ? { content, executedToolNames } : content;
    }

    const lastContent = currentMessages[currentMessages.length - 1]?.content || '';
    return executedToolNames.length > 0 ? { content: lastContent, executedToolNames } : lastContent;
  }

  async chatStream(messages, onDelta, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformedMessages, { timeoutMs: this.timeout });
    
    const maxToolRounds = this.config.maxToolRounds || 7;
    let currentMessages = [...transformedMessages];
    let round = 0;
    let resp = null;
    
    while (round < maxToolRounds) {
      resp = await fetch(
      this.endpoint,
      buildFetchOptionsWithProxy(this.config, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
          body: JSON.stringify(this.buildBody(currentMessages, { ...overrides, stream: true })),
        signal: AbortSignal.timeout(this.timeout)
      })
    );

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`OpenAI LLM 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }
      
      const toolCallsCollector = {
        toolCalls: [],
        content: '',
        finishReason: null
      };
      
      const enableMcp = overrides?.mcpToolMode !== 'passthrough';
      await this._consumeSSEWithToolCalls(resp, onDelta, toolCallsCollector, overrides);
      
      if (toolCallsCollector.toolCalls.length > 0 && toolCallsCollector.finishReason === 'tool_calls' && enableMcp) {
        BotUtil.makeLog('info', `[OpenAILLMClient] 检测到工具调用，执行工具: ${toolCallsCollector.toolCalls.length}个`, 'LLMFactory');
        
        currentMessages.push({
          role: 'assistant',
          content: toolCallsCollector.content || null,
          tool_calls: toolCallsCollector.toolCalls
        });
        
        const buildPayload = (mid, res) => mid.map((tc, i) => ({
          name: tc.function?.name || `工具${i + 1}`,
          arguments: tc.function?.arguments || {},
          result: res[i]?.content ?? ''
        }));
        const toolResults = await partitionAndExecuteToolCalls(toolCallsCollector.toolCalls, overrides, {
          buildMcpPayload: buildPayload,
          onDelta
        });
        if (toolResults === null) break;
        currentMessages.push(...toolResults);
        
        round++;
        if (round >= maxToolRounds) {
          BotUtil.makeLog('warn', `[OpenAILLMClient] 达到最大工具调用轮数: ${maxToolRounds}`, 'LLMFactory');
          break;
        }
        continue;
      }
      
      if (toolCallsCollector.content || !toolCallsCollector.toolCalls.length || !enableMcp) break;
      
      round++;
    }
  }
  
  async _consumeSSEWithToolCalls(resp, onDelta, collector, options = {}) {
    const toolCallsMap = new Map();
    for await (const { data } of iterateSSE(resp)) {
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta;
        const finishReason = json?.choices?.[0]?.finish_reason;

        if (finishReason) {
          collector.finishReason = finishReason;
        }

        if (delta?.content && typeof delta.content === 'string' && delta.content.length > 0) {
          collector.content += delta.content;
          if (typeof onDelta === 'function') onDelta(delta.content);
        }

        if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
          const mode = options?.mcpToolMode || 'execute';
          if ((mode === 'passthrough' || mode === 'hybrid') && typeof onDelta === 'function' && delta.tool_calls.length > 0) {
            onDelta('', { tool_calls: delta.tool_calls });
          }
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

            const toolCall = toolCallsMap.get(index);
            if (tc.id) toolCall.id = tc.id;
            if (tc.function?.name) toolCall.function.name = tc.function.name;
            if (tc.function?.arguments) {
              toolCall.function.arguments += tc.function.arguments;
            }
          }
        }
      } catch {
        // ignore
      }
    }

    if (toolCallsMap.size > 0) {
      const sortedIndices = Array.from(toolCallsMap.keys()).sort((a, b) => a - b);
      collector.toolCalls = sortedIndices.map(index => toolCallsMap.get(index));
    }
  }
}

