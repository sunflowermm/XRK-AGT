/**
 * OneBot 消息段：事件/群历史多为扁平 { type, text|qq|id }；
 * get_msg 仍可能是 { type, data:{...} }。统一压平后再读字段。
 */

/** @param {object|null|undefined} seg */
export function flattenMessageSeg(seg) {
  if (!seg || typeof seg !== 'object') return seg;
  const data = seg.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return seg;
  const { data: _d, ...rest } = seg;
  return { ...data, ...rest };
}

/** @param {unknown} message */
export function flattenMessageSegs(message) {
  if (!Array.isArray(message)) return [];
  return message.map((s) => flattenMessageSeg(s)).filter(Boolean);
}

export function segText(seg) {
  const s = flattenMessageSeg(seg);
  return s?.text != null ? String(s.text) : '';
}

export function segQq(seg) {
  const s = flattenMessageSeg(seg);
  const qq = s?.qq ?? s?.user_id;
  return qq != null && String(qq).trim() !== '' ? String(qq) : '';
}

export function segReplyId(seg) {
  const s = flattenMessageSeg(seg);
  const id = s?.id;
  return id != null && String(id).trim() !== '' ? String(id).trim() : '';
}

export function segFileName(seg) {
  const s = flattenMessageSeg(seg);
  return s?.name || s?.file_name || '未知';
}

/**
 * 统一取媒体引用（file / url / file_id）
 * @param {object|null|undefined} seg
 * @returns {{ file: string, url: string, fileId: string, name: string }}
 */
export function segMediaRef(seg) {
  const s = flattenMessageSeg(seg) || {};
  return {
    file: String(s.file ?? s.path ?? '').trim(),
    url: String(s.url ?? '').trim(),
    fileId: String(s.file_id ?? s.fid ?? s.id ?? '').trim(),
    name: String(s.name || s.file_name || '').trim(),
  };
}

/**
 * 收集 forward 段所有可用的 message_id（兼容 OneBot / NapCat）
 * @param {unknown} seg
 * @param {string|number|null|undefined} contextMessageId
 * @returns {string[]}
 */
export function collectForwardIds(seg, contextMessageId) {
  const ids = [];
  if (contextMessageId != null && contextMessageId !== '') ids.push(String(contextMessageId));
  if (seg == null) return [...new Set(ids)];
  if (typeof seg !== 'object') {
    ids.push(String(seg));
    return [...new Set(ids)];
  }
  for (const k of ['message_id', 'id']) {
    if (seg[k] != null && seg[k] !== '') ids.push(String(seg[k]));
  }
  if (seg.data && typeof seg.data === 'object') {
    for (const k of ['message_id', 'id']) {
      if (seg.data[k] != null && seg.data[k] !== '') ids.push(String(seg.data[k]));
    }
  }
  return [...new Set(ids)];
}
