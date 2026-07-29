/**
 * 段 → 纯文本摘要（插件 / AI 历史 / 前端共用语义）
 */

const MEDIA_LABEL = {
  image: '[图片]',
  mface: '[图片]',
  video: '[视频]',
  record: '[语音]',
  audio: '[语音]',
  face: '[表情]',
  forward: '[转发]',
  node: '[转发]',
};

/**
 * @param {object|null|undefined} seg 扁平或带 data 的段
 * @returns {string}
 */
export function segmentToPlainSnippet(seg) {
  if (!seg || typeof seg !== 'object') return '';
  const type = String(seg.type || '').toLowerCase();
  if (type === 'text' || type === 'markdown' || type === 'raw') {
    return String(seg.text ?? seg.content ?? seg.data?.text ?? '');
  }
  if (MEDIA_LABEL[type]) {
    if (type === 'file') {
      const name = seg.name || seg.file_name || seg.data?.name || '';
      return name ? `[文件:${name}]` : '[文件]';
    }
    return MEDIA_LABEL[type];
  }
  if (type === 'at') {
    const qq = seg.qq ?? seg.user_id ?? seg.data?.qq;
    return qq ? `@${qq}` : '@';
  }
  if (type === 'reply') {
    const id = seg.id ?? seg.message_id ?? seg.data?.id;
    return id ? `[回复:${id}]` : '';
  }
  return '';
}

/**
 * @param {unknown} segments
 * @returns {string}
 */
export function segmentsToPlainText(segments) {
  if (!Array.isArray(segments)) return '';
  return segments
    .map((s) => segmentToPlainSnippet(s))
    .filter(Boolean)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
