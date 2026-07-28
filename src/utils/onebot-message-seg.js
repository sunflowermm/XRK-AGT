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
