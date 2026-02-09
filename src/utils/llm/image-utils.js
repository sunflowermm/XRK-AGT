import fetch from 'node-fetch';

/**
 * 图片 / 多模态辅助工具：
 * - 统一将相对路径 / 内部 URL 转成可 fetch 的绝对 URL
 * - 统一下载图片并转为 base64
 * - 可选：在 OpenAI 风格 messages 上，把 image_url.url 统一转为 data URL
 */

const DATA_URL_CACHE = new Map();

export function getServerPublicUrl() {
  try {
    const base = globalThis.Bot?.url;
    return base ? String(base).replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

export function normalizeToAbsoluteUrl(url) {
  const u = String(url ?? '').trim();
  if (!u) return '';
  if (u.startsWith('data:')) return u;
  if (/^https?:\/\//i.test(u)) return u;

  const base = getServerPublicUrl();
  if (base && u.startsWith('/')) return `${base}${u}`;
  return u;
}

export function parseDataUrl(dataUrl) {
  const raw = String(dataUrl ?? '').trim();
  const m = raw.match(/^data:([^;]+);base64,(.*)$/i);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}

/**
 * 下载图片并返回 { mimeType, base64 }
 * - 支持 data URL：直接解析
 * - 支持相对路径：通过 Bot.url 转成绝对 URL 后下载
 */
export async function fetchAsBase64(url, { timeoutMs = 30000 } = {}) {
  const raw = String(url ?? '').trim();
  if (!raw) return null;

  // 已经是 data URL
  if (raw.startsWith('data:')) {
    const parsed = parseDataUrl(raw);
    return parsed && parsed.base64 ? parsed : null;
  }

  const abs = normalizeToAbsoluteUrl(raw);
  if (!/^https?:\/\//i.test(abs)) {
    return null;
  }

  const now = Date.now();
  const cached = DATA_URL_CACHE.get(abs);
  if (cached && (now - cached.ts) < 5 * 60 * 1000) {
    return { mimeType: cached.mimeType, base64: cached.base64 };
  }

  const resp = await fetch(abs, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) return null;

  const mimeType = resp.headers.get('content-type') || 'image/png';
  const buf = Buffer.from(await resp.arrayBuffer());
  const base64 = buf.toString('base64');

  DATA_URL_CACHE.set(abs, { ts: now, mimeType, base64 });
  return { mimeType, base64 };
}

/**
 * 在 OpenAI 风格 messages 上，把 user 消息中的 image_url.url 统一转成 data URL
 * @param {Array} messages - OpenAI Chat Completions 风格的 messages
 */
export async function ensureMessagesImagesDataUrl(messages, { timeoutMs = 30000 } = {}) {
  if (!Array.isArray(messages)) return;

  for (const msg of messages) {
    if (!msg || msg.role !== 'user') continue;
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if (!part || part.type !== 'image_url' || !part.image_url?.url) continue;

      const info = await fetchAsBase64(part.image_url.url, { timeoutMs });
      if (!info || !info.base64) continue;

      part.image_url.url = `data:${info.mimeType};base64,${info.base64}`;
    }
  }
}

