import fetch from 'node-fetch';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';
import { fetchAsBase64 } from '../../utils/llm/image-utils.js';
import { iterateSSE } from '../../utils/llm/sse-utils.js';

/**
 * Anthropic 兼容工厂客户端（独立实现，不继承）
 * - 读取 anthropic_compat_llm.providers 配置
 * - 协议：Anthropic Messages API
 */
export default class AnthropicCompatibleLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout ?? 360000;
  }

  normalizeEndpoint(config) {
    const base = (config.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    const path = (config.path || '/messages').replace(/^\/?/, '/');
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

    if (this.config.apiKey) headers['x-api-key'] = String(this.config.apiKey).trim();
    headers['anthropic-version'] = String(this.config.anthropicVersion || '2023-06-01');
    if (this.config.headers) Object.assign(headers, this.config.headers);

    return headers;
  }

  async transformMessages(messages) {
    return await transformMessagesWithVision(messages, this.config, { mode: 'openai' });
  }

  async _toAnthropicImageBlock(url) {
    const raw = String(url ?? '').trim();
    if (!raw) return null;

    const info = await fetchAsBase64(raw, { timeoutMs: this.timeout });
    if (!info?.base64) return null;

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: info.mimeType || 'image/png',
        data: info.base64
      }
    };
  }

  buildBody(messages, overrides = {}) {
    const systemTexts = [];
    const anthMessages = [];

    for (const m of messages ?? []) {
      const role = (m.role ?? '').toLowerCase();
      if (role === 'system') {
        const text = (typeof m.content === 'string' ? m.content : (m.content?.text ?? m.content?.content ?? '')).toString();
        if (text) systemTexts.push(text);
        continue;
      }

      const blocks = [];
      if (typeof m.content === 'string') {
        if (m.content) blocks.push({ type: 'text', text: String(m.content) });
      } else if (Array.isArray(m.content)) {
        for (const p of m.content) {
          if (p?.type === 'text' && p.text) blocks.push({ type: 'text', text: String(p.text) });
          if (p?.type === 'image_url' && p.image_url?.url) blocks.push({ type: '__image_url__', url: String(p.image_url.url) });
        }
      } else if (m.content && typeof m.content === 'object') {
        const text = (m.content.text ?? m.content.content ?? '').toString();
        if (text) blocks.push({ type: 'text', text });
      }

      if (!blocks.length) continue;
      anthMessages.push({ role: role === 'assistant' ? 'assistant' : 'user', content: blocks });
    }

    const body = {
      model: overrides.model || overrides.chatModel || this.config.model || this.config.chatModel,
      max_tokens: (overrides.maxTokens ?? overrides.max_tokens) ?? (this.config.maxTokens ?? this.config.max_tokens) ?? 2048,
      temperature: overrides.temperature ?? this.config.temperature ?? 0.7,
      messages: anthMessages
    };

    if (systemTexts.length > 0) body.system = systemTexts.join('\n');
    if (this.config.extraBody && typeof this.config.extraBody === 'object') Object.assign(body, this.config.extraBody);
    if (overrides.extraBody && typeof overrides.extraBody === 'object') Object.assign(body, overrides.extraBody);

    return body;
  }

  extractText(json) {
    const parts = json?.content;
    if (!Array.isArray(parts)) return '';
    return parts.map((p) => (p?.type === 'text' ? (p.text ?? '') : '')).join('');
  }

  async _normalizeImageBlocks(body) {
    for (const msg of body.messages ?? []) {
      if (!Array.isArray(msg.content)) continue;
      const blocks = [];

      for (const b of msg.content) {
        if (b?.type === '__image_url__' && b.url) {
          const imgBlock = await this._toAnthropicImageBlock(b.url);
          if (imgBlock) blocks.push(imgBlock);
          else blocks.push({ type: 'text', text: `[图片:${String(b.url)}]` });
        } else if (b?.type === 'text') {
          blocks.push({ type: 'text', text: String(b.text ?? '') });
        }
      }

      msg.content = blocks.filter((x) => x && (x.type === 'text' ? String(x.text || '').trim() : true));
    }
  }

  async chat(messages, overrides = {}) {
    const transformed = await this.transformMessages(messages);
    const body = this.buildBody(transformed, overrides);
    await this._normalizeImageBlocks(body);

    const resp = await fetch(
      this.endpoint,
      buildFetchOptionsWithProxy(this.config, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout)
      })
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`anthropic_compat 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    return this.extractText(await resp.json());
  }

  async chatStream(messages, onDelta, overrides = {}) {
    const transformed = await this.transformMessages(messages);
    const body = this.buildBody(transformed, overrides);
    await this._normalizeImageBlocks(body);
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
      throw new Error(`anthropic_compat 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    for await (const { data } of iterateSSE(resp, { stopOnDone: false })) {
      if (!data) continue;
      try {
        const json = JSON.parse(data);
        let deltaText = '';
        if (json?.type === 'content_block_delta') {
          deltaText = json?.delta?.text ?? '';
        } else if (json?.type === 'content_block_start' && json?.content_block?.type === 'text') {
          deltaText = json?.content_block?.text ?? '';
        }
        if (deltaText && typeof onDelta === 'function') onDelta(deltaText);
      } catch {}
    }
  }
}
