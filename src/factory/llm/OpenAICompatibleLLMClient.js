import fetch from 'node-fetch';
import { MCPToolAdapter } from '../../utils/llm/mcp-tool-adapter.js';
import { buildOpenAIChatCompletionsBody, applyOpenAITools } from '../../utils/llm/openai-chat-utils.js';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';

/**
 * OpenAI 兼容第三方 LLM 客户端（OpenAI-like / OpenAI-Compatible）
 *
 * 目标：
 * - 用一个 provider 接入各种第三方“OpenAI 协议”接口（自定义 baseUrl/path/headers/认证/额外参数）
 * - 统一多模态消息结构：通过 `transformMessagesWithVision` 构造 text + image_url（含 base64 data URL）
 * - 支持 MCP tool calling（OpenAI tools/tool_calls 协议）
 *
 * 常用配置：
 * - baseUrl: 第三方 API base（例如 https://xxx.com/v1）
 * - path: 默认 /chat/completions
 * - apiKey: 密钥
 * - authMode:
 *   - bearer（默认）：Authorization: Bearer ${apiKey}
 *   - api-key：api-key: ${apiKey}
 *   - header：使用 authHeaderName 指定头名
 * - authHeaderName: authMode=header 时使用（例如 X-Api-Key）
 * - extraBody: 额外请求体字段（原样透传到下游）
 */
export default class OpenAICompatibleLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout || 360000;
  }

  normalizeEndpoint(config) {
    const base = (config.baseUrl || '').replace(/\/+$/, '');
    const path = (config.path || '/chat/completions').replace(/^\/?/, '/');
    if (!base) {
      throw new Error('openai_compat: 未配置 baseUrl（第三方 OpenAI 兼容接口地址）');
    }
    return `${base}${path}`;
  }

  get timeout() {
    return this._timeout || 360000;
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
        const name = String(this.config.authHeaderName || '').trim();
        if (!name) {
          throw new Error('openai_compat: authMode=header 时必须提供 authHeaderName');
        }
        headers[name] = apiKey;
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }
    }

    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  async transformMessages(messages) {
    // OpenAI 兼容第三方：假定支持 Chat Completions 多模态协议
    return await transformMessagesWithVision(messages, this.config, { mode: 'openai' });
  }

  buildBody(messages, overrides = {}) {
    const body = buildOpenAIChatCompletionsBody(messages, this.config, overrides, 'gpt-4o-mini');
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
        throw new Error(`openai_compat 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
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
      throw new Error(`openai_compat 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }
    await this._consumeSSE(resp, onDelta);
  }
}

