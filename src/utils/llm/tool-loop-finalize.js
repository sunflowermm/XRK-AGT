/**
 * 工具环预算用尽后的收尾（对齐 OpenCode / Cline / goose：强制一轮无工具终答，
 * 避免把最后一条 tool 消息当成助手回复）。
 */

export const TOOL_BUDGET_EXHAUSTED_PROMPT =
  '【系统】工具调用轮次已用尽。请仅根据已有工具结果，用自然语言给出最终答复；禁止再发起任何 tool_calls。';

/** @param {Array<Object>} messages */
export function appendToolBudgetExhaustedNudge(messages) {
  const list = Array.isArray(messages) ? messages.slice() : [];
  list.push({ role: 'user', content: TOOL_BUDGET_EXHAUSTED_PROMPT });
  return list;
}

/** @param {Object} [overrides] */
export function toolBudgetFinalizeOverrides(overrides = {}) {
  return { ...overrides, tool_choice: 'none' };
}
