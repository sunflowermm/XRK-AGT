import { MCPToolAdapter } from '../../utils/llm/mcp-tool-adapter.js';
import { buildOpenAIChatCompletionsBody, applyOpenAITools } from '../../utils/llm/openai-chat-utils.js';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';
import { ensureMessagesImagesDataUrl } from '../../utils/llm/image-utils.js';

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

  async _consumeSSE(resp, onDelta) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE：以空行分隔事件（兼容多行 data:）
      let sep;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const dataLines = chunk
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).trim());

        if (!dataLines.length) continue;
        const payload = dataLines.join('\n');
        if (payload === '[DONE]') return;

        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta;
          if (delta?.content && typeof onDelta === 'function') {
            onDelta(delta.content);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  async chat(messages, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformedMessages, { timeoutMs: this.timeout });
    const maxToolRounds = this.config.maxToolRounds || 5;
    const currentMessages = [...transformedMessages];

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
        currentMessages.push(message);
        currentMessages.push(...await MCPToolAdapter.handleToolCalls(message.tool_calls));
        continue;
      }

      return message.content || '';
    }

    return currentMessages[currentMessages.length - 1]?.content || '';
  }

  async chatStream(messages, onDelta, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformedMessages, { timeoutMs: this.timeout });
    const resp = await fetch(
      this.endpoint,
      buildFetchOptionsWithProxy(this.config, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
        body: JSON.stringify(this.buildBody(transformedMessages, { ...overrides, stream: true })),
        signal: AbortSignal.timeout(this.timeout)
      })
    );

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Azure OpenAI 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }
    await this._consumeSSE(resp, onDelta);
  }
}

