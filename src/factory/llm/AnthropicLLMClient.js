import fetch from 'node-fetch';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';

/**
 * Anthropic 官方 LLM 客户端（Messages API）
 *
 * 默认：
 * - baseUrl: https://api.anthropic.com/v1
 * - path: /messages
 * - 认证：x-api-key
 *
 * 说明：
 * - 这里按“外部调用 model=provider”的约定，仅在内部配置中使用 model/chatModel 指定真实模型
 * - 图片仍通过 VisionFactory 转成文本描述拼接到 user 内容（保持工作流消息结构不变）
 * - Anthropic 工具调用协议不同，本实现默认不注入 MCP tools（建议 enableTools=false）
 */
export default class AnthropicLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout || 360000;
  }

  normalizeEndpoint(config) {
    const base = (config.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    const path = (config.path || '/messages').replace(/^\/?/, '/');
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
      headers['x-api-key'] = String(this.config.apiKey).trim();
    }

    // Anthropic 要求提供版本头
    headers['anthropic-version'] = String(this.config.anthropicVersion || '2023-06-01');

    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  async transformMessages(messages) {
    return await transformMessagesWithVision(messages, this.config, { defaultVisionProvider: 'gptgod' });
  }

  /**
   * OpenAI-like messages -> Anthropic messages
   * - system: 单独提取为 system 字符串
   * - user/assistant: messages[{role, content}]
   */
  buildBody(messages, overrides = {}) {
    const systemTexts = [];
    const anthMessages = [];

    for (const m of messages || []) {
      const role = (m.role || '').toLowerCase();
      const text = (typeof m.content === 'string' ? m.content : (m.content?.text || m.content?.content || '')).toString();
      if (!text) continue;

      if (role === 'system') {
        systemTexts.push(text);
        continue;
      }
      anthMessages.push({
        role: role === 'assistant' ? 'assistant' : 'user',
        content: text
      });
    }

    const temperature = overrides.temperature ?? this.config.temperature ?? 0.7;
    const maxTokens = overrides.maxTokens ?? overrides.max_tokens ?? this.config.maxTokens ?? this.config.max_tokens ?? 2048;

    const body = {
      model: overrides.model || overrides.chatModel || this.config.model || this.config.chatModel || 'claude-3-5-sonnet-latest',
      max_tokens: maxTokens,
      temperature,
      messages: anthMessages
    };

    if (systemTexts.length > 0) {
      body.system = systemTexts.join('\n');
    }

    if (this.config.extraBody && typeof this.config.extraBody === 'object') {
      Object.assign(body, this.config.extraBody);
    }
    if (overrides.extraBody && typeof overrides.extraBody === 'object') {
      Object.assign(body, overrides.extraBody);
    }

    return body;
  }

  extractText(json) {
    // Anthropic: content: [{type:'text', text:'...'}]
    const parts = json?.content;
    if (!Array.isArray(parts)) return '';
    return parts.map(p => (p?.type === 'text' ? (p.text || '') : '')).join('');
  }

  async chat(messages, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    const resp = await fetch(
      this.endpoint,
      buildFetchOptionsWithProxy(this.config, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
        body: JSON.stringify(this.buildBody(transformedMessages, overrides)),
        signal: AbortSignal.timeout(this.timeout)
      })
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Anthropic 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    const data = await resp.json();
    return this.extractText(data);
  }

  async chatStream(messages, onDelta, overrides = {}) {
    // Anthropic 支持 SSE：stream=true
    const transformedMessages = await this.transformMessages(messages);
    const body = this.buildBody(transformedMessages, overrides);
    body.stream = true;

    const resp = await fetch(
      this.endpoint,
      buildFetchOptionsWithProxy(this.config, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout)
      })
    );

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Anthropic 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE：以空行分隔事件
      let sep;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean);
        const dataLine = lines.find(l => l.startsWith('data:'));
        if (!dataLine) continue;

        const payload = dataLine.slice(5).trim();
        if (!payload) continue;

        try {
          const json = JSON.parse(payload);
          // 常见：type=content_block_delta / message_delta
          const deltaText = json?.delta?.text || json?.content_block?.text || '';
          if (deltaText && typeof onDelta === 'function') onDelta(deltaText);
        } catch {
          // ignore
        }
      }
    }
  }
}

