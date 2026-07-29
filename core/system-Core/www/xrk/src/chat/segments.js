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

function mediaUrlFrom(seg) {
  return seg.url || seg.file || seg.data?.url || seg.data?.file || seg.data?.path || '';
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
  if (type === 'image' || type === 'mface') {
    const url = mediaUrlFrom(seg);
    return url ? { type: 'image', url: String(url), name: seg.name || seg.summary || '' } : null;
  }
  if (type === 'video') {
    const url = mediaUrlFrom(seg);
    return url ? { type: 'video', url: String(url), name: seg.name || '' } : null;
  }
  if (type === 'record' || type === 'audio') {
    const url = mediaUrlFrom(seg);
    return url ? { type: 'record', url: String(url), name: seg.name || '' } : null;
  }
  if (type === 'file') {
    const url = mediaUrlFrom(seg);
    return url
      ? { type: 'file', url: String(url), name: seg.name || seg.file_name || '文件' }
      : { type: 'file', url: '', name: seg.name || seg.file_name || '文件' };
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
  if (type === 'forward' || type === 'node') {
    const id = seg.id ?? seg.message_id ?? seg.data?.id ?? '';
    const inner = seg.content || seg.message || seg.data?.content || seg.data?.message;
    const lines = Array.isArray(inner)
      ? inner.map((c) => normalizeSeg(c)).filter(Boolean)
      : [];
    return {
      type: 'forward',
      id: id != null ? String(id) : '',
      segments: lines,
      text: lines.length ? segmentsToPlainText(lines) : '[转发]',
    };
  }
  if (type === 'face') {
    return { type: 'text', text: '[表情]' };
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
      if (s.type === 'forward') return s.text || '[转发]';
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

function snippetFromContentParts(parts) {
  if (!Array.isArray(parts)) return '';
  const bits = [];
  for (const c of parts) {
    if (!c) continue;
    const t = String(c.type || '').toLowerCase();
    if (t === 'text') bits.push(c.data?.text || c.text || '');
    else if (t === 'image' || t === 'mface') bits.push('[图片]');
    else if (t === 'video') bits.push('[视频]');
    else if (t === 'record' || t === 'audio') bits.push('[语音]');
    else if (t === 'file') bits.push(`[文件] ${c.name || c.data?.name || ''}`.trim());
    else if (t === 'forward' || t === 'node') bits.push('[转发]');
  }
  return bits.filter(Boolean).join(' ');
}

/** 从 forward/reply 载荷提取记录卡消息行（含媒体摘要） */
export function extractForwardLines(data) {
  const messages = data?.messages;
  if (!Array.isArray(messages) || !messages.length) return [];
  return messages
    .map((msg) => {
      if (typeof msg === 'string') return msg;
      if (msg?.type === 'node' && Array.isArray(msg.data?.content)) {
        return snippetFromContentParts(msg.data.content);
      }
      if (Array.isArray(msg?.message)) {
        return snippetFromContentParts(msg.message);
      }
      if (Array.isArray(msg?.content)) {
        return snippetFromContentParts(msg.content);
      }
      return msg?.text || msg?.content || '';
    })
    .filter((t) => String(t || '').trim());
}
