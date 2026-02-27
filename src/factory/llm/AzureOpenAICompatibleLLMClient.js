import { MCPToolAdapter } from '../../utils/llm/mcp-tool-adapter.js';
import { buildOpenAIChatCompletionsBody, applyOpenAITools } from '../../utils/llm/openai-chat-utils.js';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';
import { ensureMessagesImagesDataUrl } from '../../utils/llm/image-utils.js';
import BotUtil from '../../utils/botutil.js';
import { iterateSSE } from '../../utils/llm/sse-utils.js';

/**
 * Azure OpenAI 兼容工厂客户端（独立实现，不继承）
 * - 读取 azure_openai_compat_llm.providers 配置
 * - 协议：Azure OpenAI Chat Completions
 */
export default class AzureOpenAICompatibleLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout ?? 360000;
  }

  normalizeEndpoint(config) {
    const base = (config.baseUrl ?? '').replace(/\/+$/, '');
    if (!base) throw new Error('azure_openai_compat: 未配置 baseUrl');

    const explicitPath = String(config.path || '').trim();
    const deployment = encodeURIComponent(config.deployment ?? config.azureDeployment ?? config.model ?? config.chatModel ?? '');

    const path = explicitPath
      ? explicitPath.replace(/^\/?/, '/')
      : (deployment ? `/openai/deployments/${deployment}/chat/completions` : '');

    if (!path) {
      throw new Error('azure_openai_compat: 未配置 path，且未提供 deployment/azureDeployment 供自动拼接');
    }

    const apiVersion = String(config.apiVersion || '').trim();
    const url = new URL(`${base}${path}`);
    if (apiVersion) url.searchParams.set('api-version', apiVersion);
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

    if (this.config.apiKey) headers['api-key'] = String(this.config.apiKey).trim();
    if (this.config.headers) Object.assign(headers, this.config.headers);
    return headers;
  }

  async transformMessages(messages) {
    return await transformMessagesWithVision(messages, this.config, { mode: 'openai' });
  }

  buildBody(messages, overrides = {}) {
    const body = buildOpenAIChatCompletionsBody(messages, this.config, overrides, undefined);
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
        throw new Error(`azure_openai_compat 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
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

    while (round < maxToolRounds) {
      const resp = await fetch(
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
        throw new Error(`azure_openai_compat 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
      }

      const collector = { toolCalls: [], content: '', finishReason: null };
      await this._consumeSSEWithToolCalls(resp, onDelta, collector);

      if (collector.toolCalls.length > 0 && collector.finishReason === 'tool_calls') {
        currentMessages.push({
          role: 'assistant',
          content: collector.content || null,
          tool_calls: collector.toolCalls
        });

        const streams = Array.isArray(overrides.streams) ? overrides.streams : null;
        const toolResults = await MCPToolAdapter.handleToolCalls(collector.toolCalls, { streams });
        currentMessages.push(...toolResults);

        const mcpTools = collector.toolCalls.map((tc, idx) => ({
          name: tc.function?.name || `工具${idx + 1}`,
          arguments: tc.function?.arguments || {},
          result: toolResults[idx]?.content ?? ''
        }));
        if (typeof onDelta === 'function') onDelta('', { mcp_tools: mcpTools });

        round++;
        if (round >= maxToolRounds) {
          BotUtil.makeLog('warn', `[AzureOpenAICompatibleLLMClient] 达到最大工具调用轮数: ${maxToolRounds}`, 'LLMFactory');
          break;
        }
        continue;
      }

      if (collector.content || !collector.toolCalls.length) break;
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

        if (finishReason) collector.finishReason = finishReason;

        if (typeof delta?.content === 'string' && delta.content.length > 0) {
          collector.content += delta.content;
          if (typeof onDelta === 'function') onDelta(delta.content);
        }

        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            if (index === undefined || index === null) continue;

            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, { id: '', type: 'function', function: { name: '', arguments: '' } });
            }

            const toolCall = toolCallsMap.get(index);
            if (tc.id) toolCall.id = tc.id;
            if (tc.function?.name) toolCall.function.name = tc.function.name;
            if (tc.function?.arguments) toolCall.function.arguments += tc.function.arguments;
          }
        }
      } catch {}
    }

    if (toolCallsMap.size > 0) {
      const sortedIndices = Array.from(toolCallsMap.keys()).sort((a, b) => a - b);
      collector.toolCalls = sortedIndices.map((idx) => toolCallsMap.get(idx));
    }
  }
}
