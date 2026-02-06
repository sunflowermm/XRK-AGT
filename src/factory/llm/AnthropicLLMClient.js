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
 * - 图片由上游统一转换为纯文本占位描述（不再通过独立的识图工厂），保证消息结构简单稳定
 * - Anthropic 工具调用协议不同，本实现默认不注入 MCP tools（建议 enableTools=false）
 */
export default class AnthropicLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout || 360000;
    this._imageCache = new Map();
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
    // 统一为 OpenAI 风格多模态 content（text + image_url），再转换为 Anthropic 的 content blocks
    return await transformMessagesWithVision(messages, this.config, { mode: 'openai' });
  }

  getServerPublicUrl() {
    try {
      const base = globalThis.Bot?.url;
      return base ? String(base).replace(/\/+$/, '') : '';
    } catch {
      return '';
    }
  }

  normalizeToAbsoluteUrl(url) {
    const u = String(url || '').trim();
    if (!u) return '';
    if (u.startsWith('data:')) return u;
    if (/^https?:\/\//i.test(u)) return u;

    const base = this.getServerPublicUrl();
    if (base && u.startsWith('/')) return `${base}${u}`;
    return u;
  }

  _parseDataUrl(dataUrl) {
    const raw = String(dataUrl || '').trim();
    const m = raw.match(/^data:([^;]+);base64,(.*)$/i);
    if (!m) return null;
    return { media_type: m[1], data: m[2] };
  }

  async _toAnthropicImageBlock(url) {
    const raw = String(url || '').trim();
    if (!raw) return null;

    if (raw.startsWith('data:')) {
      const parsed = this._parseDataUrl(raw);
      if (!parsed?.data) return null;
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: parsed.media_type || 'image/png',
          data: parsed.data
        }
      };
    }

    const abs = this.normalizeToAbsoluteUrl(raw);
    const now = Date.now();
    const cached = this._imageCache.get(abs);
    if (cached && (now - cached.ts) < 5 * 60 * 1000) {
      return cached.block;
    }

    const resp = await fetch(abs, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) return null;

    const media_type = resp.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await resp.arrayBuffer());
    const block = {
      type: 'image',
      source: {
        type: 'base64',
        media_type,
        data: buf.toString('base64')
      }
    };

    this._imageCache.set(abs, { ts: now, block });
    return block;
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
      if (role === 'system') {
        const text = (typeof m.content === 'string' ? m.content : (m.content?.text || m.content?.content || '')).toString();
        if (text) systemTexts.push(text);
        continue;
      }

      const blocks = [];
      if (typeof m.content === 'string') {
        const text = m.content.toString();
        if (text) blocks.push({ type: 'text', text });
      } else if (Array.isArray(m.content)) {
        for (const p of m.content) {
          if (p?.type === 'text' && p.text) {
            blocks.push({ type: 'text', text: String(p.text) });
          } else if (p?.type === 'image_url' && p.image_url?.url) {
            // 这里保持同步结构，实际转换在 chat/chatStream 前进行（buildBody 是纯构建函数）
            blocks.push({ type: '__image_url__', url: String(p.image_url.url) });
          }
        }
      } else if (m.content && typeof m.content === 'object') {
        const text = (m.content.text || m.content.content || '').toString();
        if (text) blocks.push({ type: 'text', text });
      }

      if (blocks.length === 0) continue;

      anthMessages.push({
        role: role === 'assistant' ? 'assistant' : 'user',
        content: blocks
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

    // 把占位的 image_url block 转成 Anthropic image block（需要 async fetch/base64）
    const body = this.buildBody(transformedMessages, overrides);
    for (const msg of body.messages || []) {
      if (!Array.isArray(msg.content)) continue;
      const newBlocks = [];
      for (const b of msg.content) {
        if (b?.type === '__image_url__' && b.url) {
          const imgBlock = await this._toAnthropicImageBlock(b.url);
          if (imgBlock) newBlocks.push(imgBlock);
          else newBlocks.push({ type: 'text', text: `[图片:${String(b.url)}]` });
        } else if (b?.type === 'text') {
          newBlocks.push({ type: 'text', text: String(b.text || '') });
        }
      }
      msg.content = newBlocks.filter(x => x && (x.type === 'text' ? (x.text || '').toString().trim() : true));
    }

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
      throw new Error(`Anthropic 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    const data = await resp.json();
    return this.extractText(data);
  }

  async chatStream(messages, onDelta, overrides = {}) {
    // Anthropic 支持 SSE：stream=true
    const transformedMessages = await this.transformMessages(messages);
    const body = this.buildBody(transformedMessages, overrides);

    // 把占位的 image_url block 转成 Anthropic image block（需要 async fetch/base64）
    for (const msg of body.messages || []) {
      if (!Array.isArray(msg.content)) continue;
      const newBlocks = [];
      for (const b of msg.content) {
        if (b?.type === '__image_url__' && b.url) {
          const imgBlock = await this._toAnthropicImageBlock(b.url);
          if (imgBlock) newBlocks.push(imgBlock);
          else newBlocks.push({ type: 'text', text: `[图片:${String(b.url)}]` });
        } else if (b?.type === 'text') {
          newBlocks.push({ type: 'text', text: String(b.text || '') });
        }
      }
      msg.content = newBlocks.filter(x => x && (x.type === 'text' ? (x.text || '').toString().trim() : true));
    }
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

