/**
 * 剥离模型 reasoning / think 标签（对齐 aider remove_reasoning_content）。
 * 用于辅模型摘要输出或网关把思考混进 content 的场景。
 *
 * @param {unknown} text
 * @returns {string}
 */
export function stripReasoningContent(text) {
  let s = String(text ?? '');
  if (!s) return '';
  s = s.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '');
  s = s.replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, '');
  s = s.replace(/^\s*reasoning:\s*[\s\S]*?(?=\n\n|\n[A-Z#]|$)/i, '');
  return s.trim();
}
