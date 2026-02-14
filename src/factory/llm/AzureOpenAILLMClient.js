import { MCPToolAdapter } from '../../utils/llm/mcp-tool-adapter.js';
import { buildOpenAIChatCompletionsBody, applyOpenAITools } from '../../utils/llm/openai-chat-utils.js';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';
import { ensureMessagesImagesDataUrl } from '../../utils/llm/image-utils.js';
import BotUtil from '../../utils/botutil.js';
import { iterateSSE } from '../../utils/llm/sse-utils.js';

/**
 * Azure OpenAI 官方 LLM 客户端（Chat Completions）
 *
 * Azure 的关键差异：
 * - endpoint 形如：https://{resource}.openai.azure.com
 * - 路径包含 deployment：/openai/deployments/{deployment}/chat/completions
 * - 必须带 api-version query：?api-version=2024-xx-xx
 * - 认证默认用 header: api-key
 *
 * 说明：
 * - 对外调用 model=provider 的约定下，deployment（真实模型）在 yaml 中配置
 * - tool calling 使用 OpenAI tools/tool_calls 协议 + MCPToolAdapter 多轮执行
 */
export default class AzureOpenAILLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout ?? 360000;
  }

  normalizeEndpoint(config) {
    const base = (config.baseUrl ?? '').replace(/\/+$/, '');
    if (!base) throw new Error('azure_openai: 未配置 baseUrl（Azure endpoint）');

    const deployment = encodeURIComponent(config.deployment ?? config.model ?? config.chatModel ?? '');
    if (!deployment) throw new Error('azure_openai: 未配置 deployment（Azure 部署名）');

    const path = (config.path || `/openai/deployments/${deployment}/chat/completions`).replace(/^\/?/, '/');
    const apiVersion = (config.apiVersion || '2024-10-21').toString().trim();
    const url = new URL(`${base}${path}`);
    url.searchParams.set('api-version', apiVersion);
    return url.toString();
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
      headers['api-key'] = String(this.config.apiKey).trim();
    }

    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  async transformMessages(messages) {
    // Azure OpenAI 与 OpenAI Chat Completions 多模态协议兼容
    return await transformMessagesWithVision(messages, this.config, { mode: 'openai' });
  }

  buildBody(messages, overrides = {}) {
    // Azure endpoint/deployment 在 URL 中处理，这里复用 OpenAI-like body 生成逻辑即可
    const body = buildOpenAIChatCompletionsBody(messages, this.config, overrides, undefined);
    // Azure 某些版本会忽略 model，但保留可增强兼容性；若为空则删除，避免下游严格校验
    if (body.model === undefined) delete body.model;

    applyOpenAITools(body, this.config, overrides);
    return body;
  }

  async chat(messages, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformedMessages, { timeoutMs: this.timeout });
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
        throw new Error(`Azure OpenAI 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
      }

      const result = await resp.json();
      const message = result?.choices?.[0]?.message;
      if (!message) break;

      if (message.tool_calls?.length > 0) {
        for (const tc of message.tool_calls) {
          const name = tc.function?.name;
          if (name && !executedToolNames.includes(name)) executedToolNames.push(name);
        }
        currentMessages.push(message);
        const streams = Array.isArray(overrides.streams) ? overrides.streams : null;
        currentMessages.push(...await MCPToolAdapter.handleToolCalls(message.tool_calls, { streams }));
        continue;
      }

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
        throw new Error(`Azure OpenAI 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
      }
      
      const toolCallsCollector = {
        toolCalls: [],
        content: '',
        finishReason: null
      };
      
      await this._consumeSSEWithToolCalls(resp, onDelta, toolCallsCollector);
      
      if (toolCallsCollector.toolCalls.length > 0 && toolCallsCollector.finishReason === 'tool_calls') {
        BotUtil.makeLog('info', `[AzureOpenAILLMClient] 检测到工具调用，执行工具: ${toolCallsCollector.toolCalls.length}个`, 'LLMFactory');
        
        currentMessages.push({
          role: 'assistant',
          content: toolCallsCollector.content || null,
          tool_calls: toolCallsCollector.toolCalls
        });
        
        const streams = Array.isArray(overrides.streams) ? overrides.streams : null;
        const toolResults = await MCPToolAdapter.handleToolCalls(toolCallsCollector.toolCalls, { streams });
        currentMessages.push(...toolResults);
        const mcpTools = toolCallsCollector.toolCalls.map((tc, idx) => ({
          name: tc.function?.name || `工具${idx + 1}`,
          arguments: tc.function?.arguments || {},
          result: toolResults[idx]?.content ?? ''
        }));
        if (typeof onDelta === 'function') onDelta('', { mcp_tools: mcpTools });
        round++;
        if (round >= maxToolRounds) {
          BotUtil.makeLog('warn', `[AzureOpenAILLMClient] 达到最大工具调用轮数: ${maxToolRounds}`, 'LLMFactory');
          break;
        }
        continue;
      }
      if (toolCallsCollector.content || !toolCallsCollector.toolCalls.length) {
        break;
      }
      
      round++;
    }
  }
  
  async _consumeSSEWithToolCalls(resp, onDelta, collector) {
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

