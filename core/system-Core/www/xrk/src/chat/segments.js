/**
 * 聊天 segments 规范化与媒体 URL（对齐原 appendSegments）
 */
import { getServerUrl } from '@/api/client';

export function resolveMediaUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const u = url.trim();
  if (!u) return '';
  if (/^(https?:|data:|blob:|\/\/)/i.test(u)) return u;
  const base = getServerUrl().replace(/\/$/, '');
  return u.startsWith('/') ? `${base}${u}` : `${base}/${u}`;
}

/** 从任意 WS/HTTP 载荷提取 segments */
export function extractSegments(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.segments) && data.segments.length) {
    return data.segments.map(normalizeSeg).filter(Boolean);
  }
  if (Array.isArray(data.message) && data.message.length) {
    return data.message.map(normalizeSeg).filter(Boolean);
  }
  if (data.type === 'image' && data.url) return [{ type: 'image', url: data.url }];
  if (typeof data.content === 'string' && data.content.trim()) {
    return [{ type: 'text', text: data.content }];
  }
  if (typeof data.text === 'string' && data.text.trim()) {
    return [{ type: 'text', text: data.text }];
  }
  if (typeof data.message === 'string' && data.message.trim()) {
    return [{ type: 'text', text: data.message }];
  }
  return [];
}

export function normalizeSeg(seg) {
  if (seg == null) return null;
  if (typeof seg === 'string') {
    const t = seg.trim();
    return t ? { type: 'text', text: seg } : null;
  }
  if (typeof seg !== 'object') return null;
  const type = String(seg.type || 'text').toLowerCase();
  if (type === 'text' || type === 'markdown' || type === 'raw') {
    const text = seg.text ?? seg.content ?? seg.data?.text ?? '';
    return String(text).length
      ? { type: type === 'markdown' ? 'markdown' : type === 'raw' ? 'raw' : 'text', text: String(text) }
      : null;
  }
  if (type === 'tools') {
    const tools = Array.isArray(seg.tools) ? seg.tools : [];
    return tools.length ? { type: 'tools', tools } : null;
  }
  if (type === 'image') {
    const url = seg.url || seg.file || seg.data?.url || seg.data?.file || seg.data?.path;
    return url ? { type: 'image', url: String(url), name: seg.name || '' } : null;
  }
  if (type === 'video') {
    const url = seg.url || seg.file || seg.data?.url;
    return url ? { type: 'video', url: String(url), name: seg.name || '' } : null;
  }
  if (type === 'record' || type === 'audio') {
    const url = seg.url || seg.file || seg.data?.file || seg.data?.url;
    return url ? { type: 'record', url: String(url), name: seg.name || '' } : null;
  }
  if (type === 'file') {
    const url = seg.url || seg.file || seg.data?.url || seg.data?.file;
    return url ? { type: 'file', url: String(url), name: seg.name || '文件' } : null;
  }
  if (type === 'at') {
    return {
      type: 'at',
      qq: String(seg.qq ?? seg.user_id ?? ''),
      name: String(seg.name ?? ''),
    };
  }
  if (type === 'reply') {
    return {
      type: 'reply',
      id: seg.id ?? seg.message_id ?? '',
      text: String(seg.text || seg.content || ''),
    };
  }
  if (type === 'poke') {
    const qq = seg.qq ?? seg.user_id ?? '';
    return { type: 'poke', qq: String(qq), text: qq ? `戳了戳 ${qq}` : '戳一戳' };
  }
  const fallback = seg.text || seg.content;
  return fallback ? { type: 'text', text: String(fallback) } : null;
}

export function segmentsToPlainText(segments) {
  if (!Array.isArray(segments)) return '';
  return segments
    .map((s) => {
      if (!s) return '';
      if (s.type === 'text' || s.type === 'markdown' || s.type === 'raw') return s.text || '';
      if (s.type === 'reply') return s.text ? `「引用」${s.text}` : '';
      if (s.type === 'at') return s.name ? `@${s.name}` : s.qq ? `@${s.qq}` : '@';
      if (s.type === 'image') return '[图片]';
      if (s.type === 'video') return '[视频]';
      if (s.type === 'record') return '[语音]';
      if (s.type === 'file') return `[文件] ${s.name || ''}`.trim();
      if (s.type === 'poke') return s.text || '[戳一戳]';
      if (s.type === 'tools') return '[工具调用]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function isAckOnlyText(text) {
  const t = String(text || '').trim().toLowerCase();
  return !t || t === 'event triggered' || t === 'ok' || t === 'success' || t === 'true';
}

/** 从 forward/reply 载荷提取记录卡消息行 */
export function extractForwardLines(data) {
  const messages = data?.messages;
  if (!Array.isArray(messages) || !messages.length) return [];
  return messages
    .map((msg) => {
      if (typeof msg === 'string') return msg;
      if (msg?.type === 'node' && Array.isArray(msg.data?.content)) {
        return msg.data.content
          .filter((c) => c?.type === 'text')
          .map((c) => c.data?.text || c.text || '')
          .join('');
      }
      if (Array.isArray(msg?.message)) {
        return msg.message
          .map((c) => (c?.type === 'text' ? c.text || c.data?.text || '' : ''))
          .join('');
      }
      return msg?.text || msg?.content || '';
    })
    .filter((t) => String(t || '').trim());
}
