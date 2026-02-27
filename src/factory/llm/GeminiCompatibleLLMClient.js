import fetch from 'node-fetch';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';
import { fetchAsBase64 } from '../../utils/llm/image-utils.js';
import { iterateSSE } from '../../utils/llm/sse-utils.js';

/**
 * Gemini 兼容工厂客户端（独立实现，不继承）
 * - 读取 gemini_compat_llm.providers 配置
 * - 协议：Google Generative Language API
 */
export default class GeminiCompatibleLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout ?? 360000;
  }

  normalizeEndpoint(config) {
    const base = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    const model = encodeURIComponent(config.model || config.chatModel || '');
    const path = (config.path || (model ? `/v1beta/models/${model}:generateContent` : '')).replace(/^\/?/, '/');
    if (!config.apiKey) throw new Error('gemini_compat: 未配置 apiKey');
    if (!path) throw new Error('gemini_compat: 未配置 model/chatModel 或 path');
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
    if (this.config.headers) Object.assign(headers, this.config.headers);
    return headers;
  }

  withKey(url) {
    const u = new URL(url);
    u.searchParams.set('key', String(this.config.apiKey).trim());
    return u.toString();
  }

  async transformMessages(messages) {
    return await transformMessagesWithVision(messages, this.config, { mode: 'openai' });
  }

  async _toInlineData(url) {
    const raw = String(url ?? '').trim();
    if (!raw) return null;
    const info = await fetchAsBase64(raw, { timeoutMs: this.timeout });
    if (!info?.base64) return null;
    return { inlineData: { mimeType: info.mimeType || 'image/png', data: info.base64 } };
  }

  async buildGeminiPayload(messages, overrides = {}) {
    const systemTexts = [];
    const contents = [];

    for (const m of messages ?? []) {
      const role = (m.role ?? '').toLowerCase();
      if (role === 'system') {
        const text = (typeof m.content === 'string' ? m.content : (m.content?.text ?? m.content?.content ?? '')).toString();
        if (text) systemTexts.push(text);
        continue;
      }

      const parts = [];
      if (typeof m.content === 'string') {
        if (m.content) parts.push({ text: String(m.content) });
      } else if (Array.isArray(m.content)) {
        for (const p of m.content) {
          if (p?.type === 'text' && p.text) parts.push({ text: String(p.text) });
          if (p?.type === 'image_url' && p.image_url?.url) {
            const inlinePart = await this._toInlineData(p.image_url.url);
            if (inlinePart) parts.push(inlinePart);
            else parts.push({ text: `[图片:${String(p.image_url.url)}]` });
          }
        }
      } else if (m.content && typeof m.content === 'object') {
        const text = (m.content.text ?? m.content.content ?? '').toString();
        if (text) parts.push({ text });
      }

      if (!parts.length) continue;
      contents.push({ role: role === 'assistant' ? 'model' : 'user', parts });
    }

    const maxOutputTokens =
      overrides.maxOutputTokens ?? overrides.max_output_tokens ?? overrides.maxTokens ?? overrides.max_tokens ??
      this.config.maxOutputTokens ?? this.config.max_output_tokens ?? this.config.maxTokens ?? this.config.max_tokens ?? 2048;

    const payload = {
      contents,
      generationConfig: {
        temperature: overrides.temperature ?? this.config.temperature ?? 0.7,
        maxOutputTokens,
        ...(((overrides.topP ?? overrides.top_p ?? this.config.topP ?? this.config.top_p) !== undefined)
          ? { topP: (overrides.topP ?? overrides.top_p ?? this.config.topP ?? this.config.top_p) }
          : {}),
        ...(((overrides.topK ?? overrides.top_k ?? this.config.topK ?? this.config.top_k) !== undefined)
          ? { topK: (overrides.topK ?? overrides.top_k ?? this.config.topK ?? this.config.top_k) }
          : {})
      }
    };

    if (systemTexts.length > 0) payload.systemInstruction = { parts: [{ text: systemTexts.join('\n') }] };
    if (this.config.extraBody && typeof this.config.extraBody === 'object') Object.assign(payload, this.config.extraBody);
    if (overrides.extraBody && typeof overrides.extraBody === 'object') Object.assign(payload, overrides.extraBody);

    return payload;
  }

  extractTextFromResponse(json) {
    const parts = json?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map((p) => p?.text ?? '').join('');
  }

  async chat(messages, overrides = {}) {
    const transformed = await this.transformMessages(messages);
    const resp = await fetch(
      this.withKey(this.endpoint),
      buildFetchOptionsWithProxy(this.config, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
        body: JSON.stringify(await this.buildGeminiPayload(transformed, overrides)),
        signal: AbortSignal.timeout(this.timeout)
      })
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`gemini_compat 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    return this.extractTextFromResponse(await resp.json());
  }

  async chatStream(messages, onDelta, overrides = {}) {
    const transformed = await this.transformMessages(messages);
    const baseUrl = this.endpoint.replace(/:generateContent$/, ':streamGenerateContent');
    const url = new URL(this.withKey(baseUrl));
    url.searchParams.set('alt', 'sse');

    const resp = await fetch(
      url.toString(),
      buildFetchOptionsWithProxy(this.config, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
        body: JSON.stringify(await this.buildGeminiPayload(transformed, overrides)),
        signal: AbortSignal.timeout(this.timeout)
      })
    );

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`gemini_compat 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    let emitted = '';
    for await (const { data } of iterateSSE(resp)) {
      if (!data) continue;
      try {
        const json = JSON.parse(data);
        const full = this.extractTextFromResponse(json);
        if (full && full.startsWith(emitted)) {
          const delta = full.slice(emitted.length);
          if (delta && typeof onDelta === 'function') onDelta(delta);
          emitted = full;
        }
      } catch {}
    }
  }
}
