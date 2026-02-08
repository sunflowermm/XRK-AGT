import fetch from 'node-fetch';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';

/**
 * Gemini 官方 LLM 客户端（Google Generative Language API）
 *
 * 默认：
 * - baseUrl: https://generativelanguage.googleapis.com
 * - path: /v1beta/models/{model}:generateContent
 * - 认证：通过 query 参数 key=API_KEY（apiKey）
 *
 * 注意：
 * - 这里实现的是“纯聊天 + 可选流式(SSE)输出”的最小闭环
 * - 图片直接通过多模态 content（text + image_url/base64）传给 Gemini，由上游 `transformMessagesWithVision` 做统一结构转换
 * - MCP tool calling：Gemini 的 function calling 协议与 OpenAI 不同；本实现默认不注入 MCP tools（建议在配置中 enableTools=false）
 */
export default class GeminiLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout ?? 360000;
    this._inlineDataCache = new Map();
  }

  normalizeEndpoint(config) {
    const base = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    const model = encodeURIComponent(config.model || config.chatModel || 'gemini-1.5-flash');
    const path = (config.path || `/v1beta/models/${model}:generateContent`).replace(/^\/?/, '/');
    if (!config.apiKey) {
      throw new Error('gemini: 未配置 apiKey');
    }
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
    // 统一为 OpenAI 风格的多模态 content（text + image_url），再转成 Gemini parts
    return await transformMessagesWithVision(messages, this.config, { mode: 'openai' });
  }

  /**
   * OpenAI-like messages -> Gemini contents
   * - role: user/assistant/system
   * - Gemini: contents[{role:'user'|'model', parts:[{text}]}]
   */
  getServerPublicUrl() {
    try {
      const base = globalThis.Bot?.url;
      return base ? String(base).replace(/\/+$/, '') : '';
    } catch {
      return '';
    }
  }

  normalizeToAbsoluteUrl(url) {
    const u = String(url ?? '').trim();
    if (!u) return '';
    if (u.startsWith('data:')) return u;
    if (/^https?:\/\//i.test(u)) return u;

    const base = this.getServerPublicUrl();
    if (base && u.startsWith('/')) return `${base}${u}`;
    return u;
  }

  _parseDataUrl(dataUrl) {
    const raw = String(dataUrl ?? '').trim();
    const m = raw.match(/^data:([^;]+);base64,(.*)$/i);
    if (!m) return null;
    return { mimeType: m[1], data: m[2] };
  }

  async _toInlineData(url) {
    const raw = String(url ?? '').trim();
    if (!raw) return null;

    // data URL 直接解析
    if (raw.startsWith('data:')) {
      const parsed = this._parseDataUrl(raw);
      if (!parsed?.data) return null;
      return { inlineData: { mimeType: parsed.mimeType || 'image/png', data: parsed.data } };
    }

    const abs = this.normalizeToAbsoluteUrl(raw);
    const now = Date.now();
    const cached = this._inlineDataCache.get(abs);
    if (cached && (now - cached.ts) < 5 * 60 * 1000) {
      return cached.part;
    }

    // Gemini 官方多模态最稳的方式是 inlineData(base64)，这里对 URL 做一次下载转码（失败则回退占位文本）
    const resp = await fetch(abs, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) return null;

    const mimeType = resp.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await resp.arrayBuffer());
    const part = { inlineData: { mimeType, data: buf.toString('base64') } };
    this._inlineDataCache.set(abs, { ts: now, part });
    return part;
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
        const text = m.content.toString();
        if (text) parts.push({ text });
      } else if (Array.isArray(m.content)) {
        // OpenAI 多模态 content 数组：[{type:'text',text},{type:'image_url',image_url:{url}}]
        for (const p of m.content) {
          if (p?.type === 'text' && p.text) {
            parts.push({ text: String(p.text) });
          } else if (p?.type === 'image_url' && p.image_url?.url) {
            const inlinePart = await this._toInlineData(p.image_url.url);
            if (inlinePart) {
              parts.push(inlinePart);
            } else {
              // 下载/解析失败：回退为可读占位（避免整条消息丢失）
              parts.push({ text: `[图片:${String(p.image_url.url)}]` });
            }
          }
        }
      } else if (m.content && typeof m.content === 'object') {
        // 兼容少数场景：{text, content}
        const text = (m.content.text ?? m.content.content ?? '').toString();
        if (text) parts.push({ text });
      }

      if (parts.length === 0) continue;
      contents.push({
        role: role === 'assistant' ? 'model' : 'user',
        parts
      });
    }

    const payload = {
      contents,
      generationConfig: {
        temperature: overrides.temperature ?? this.config.temperature ?? 0.7,
        maxOutputTokens: (overrides.maxTokens ?? overrides.max_tokens) ?? (this.config.maxTokens ?? this.config.max_tokens) ?? 2048,
        ...(((overrides.topP ?? this.config.topP) !== undefined) ? { topP: (overrides.topP ?? this.config.topP) } : {}),
        ...(((overrides.topK ?? this.config.topK) !== undefined && (overrides.topK ?? this.config.topK)) ? { topK: (overrides.topK ?? this.config.topK) } : {})
      }
    };

    if (systemTexts.length > 0) {
      payload.systemInstruction = { parts: [{ text: systemTexts.join('\n') }] };
    }

    if (this.config.extraBody && typeof this.config.extraBody === 'object') {
      Object.assign(payload, this.config.extraBody);
    }
    if (overrides.extraBody && typeof overrides.extraBody === 'object') {
      Object.assign(payload, overrides.extraBody);
    }

    return payload;
  }

  extractTextFromResponse(json) {
    // generateContent: candidates[0].content.parts[].text
    const parts = json?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map(p => p?.text ?? '').join('');
  }

  async chat(messages, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    const resp = await fetch(
      this.withKey(this.endpoint),
      buildFetchOptionsWithProxy(this.config, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
        body: JSON.stringify(await this.buildGeminiPayload(transformedMessages, overrides)),
        signal: AbortSignal.timeout(this.timeout)
      })
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Gemini 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    const data = await resp.json();
    return this.extractTextFromResponse(data);
  }

  async chatStream(messages, onDelta, overrides = {}) {
    // Gemini SSE: :streamGenerateContent?alt=sse
    const transformedMessages = await this.transformMessages(messages);
    const baseUrl = this.endpoint.replace(/:generateContent$/, ':streamGenerateContent');
    const url = new URL(this.withKey(baseUrl));
    url.searchParams.set('alt', 'sse');

    const resp = await fetch(
      url.toString(),
      buildFetchOptionsWithProxy(this.config, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
        body: JSON.stringify(await this.buildGeminiPayload(transformedMessages, overrides)),
        signal: AbortSignal.timeout(this.timeout)
      })
    );

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Gemini 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let emitted = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);

        if (!line?.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;

        try {
          const json = JSON.parse(payload);
          const full = this.extractTextFromResponse(json);
          if (full && full.startsWith(emitted)) {
            const delta = full.slice(emitted.length);
            if (delta && typeof onDelta === 'function') onDelta(delta);
            emitted = full;
          }
        } catch {
          // ignore
        }
      }
    }
  }
}

