/** 粗略估算（OpenAI 兼容 API 用量统计：约 4 字符 / token） */
export function estimateTokensRough(text) {
  return Math.ceil(String(text || '').length / 4);
}

/** 中英混合启发式（工作流上下文压缩） */
export function estimateTokensMixed(text) {
  if (!text || typeof text !== 'string') return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return Math.ceil(chineseChars * 1.5 + englishWords * 1.3 + text.length * 0.3);
}
