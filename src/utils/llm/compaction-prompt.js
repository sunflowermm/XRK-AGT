/**
 * 上下文压缩摘要 prompt（融合 opencode checkpoint + goose 结构 + agent-zero 脱敏约束）。
 */

export const COMPACTION_SYSTEM = `你是对话压缩助手。根据用户提供的历史片段，输出供后续模型续作的摘要。
要求：
- 保留关键文件名、函数名、决策、未完成事项与证据路径
- 禁止输出密码、API Key、Token、私钥等密钥明文；只需保留「有某密钥 / 存在于某配置」的引用
- 禁止代码围栏；不要编造未出现的事实；约原文 15%～25%
- 优先输出一个 JSON 对象（无其它前后文），字段：
  user_intent, decisions, current_work, pending_tasks, files[{path,summary}], errors_and_fixes, next_step
- 若无法稳定输出 JSON，则改用 Markdown：## Objective / ## Decisions / ## Work State / ## Relevant Files / ## Next Move`;

/**
 * @param {{ previousSummary?: string, headText: string }} parts
 */
export function buildCompactionUserPrompt(parts = {}) {
  const prev = String(parts.previousSummary || '').trim();
  const head = String(parts.headText || '').trim();
  const blocks = [];
  if (prev) {
    blocks.push(`<previous-summary>\n${prev}\n</previous-summary>`);
  }
  blocks.push(`<conversation-to-summarize>\n${head}\n</conversation-to-summarize>`);
  blocks.push('请按系统要求输出摘要（优先 JSON）。');
  return blocks.join('\n\n');
}

/**
 * @param {{ summary: string, recentText: string, backupPath?: string|null }} parts
 */
export function formatCheckpointMessage(parts = {}) {
  const summary = String(parts.summary || '').trim() || '(无摘要)';
  const recent = String(parts.recentText || '').trim();
  const backup = parts.backupPath ? String(parts.backupPath) : '';
  return [
    '<conversation-checkpoint>',
    '<summary>',
    summary,
    '</summary>',
    recent ? `<recent-context>\n${recent}\n</recent-context>` : '',
    backup ? `<backup path="${backup}"/>` : '',
    '</conversation-checkpoint>',
    '以上为压缩后的会话检查点；请基于摘要与近期原文继续任务，不要提及「已压缩/读了摘要」；勿要求重复已完成步骤。'
  ].filter(Boolean).join('\n');
}
