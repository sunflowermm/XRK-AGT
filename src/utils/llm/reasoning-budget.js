/**
 * Reasoning effort → budget_tokens（对齐 cline REASONING_EFFORT_RATIOS）。
 * 供 Anthropic thinking.budget_tokens / 部分网关透传。
 */

export const REASONING_EFFORT_RATIOS = Object.freeze({
  max: 1,
  xhigh: 0.95,
  high: 0.8,
  medium: 0.5,
  low: 0.2,
  minimal: 0.1,
  none: 0
});

/**
 * @param {unknown} effort
 * @returns {keyof typeof REASONING_EFFORT_RATIOS|undefined}
 */
export function normalizeReasoningEffort(effort) {
  if (effort == null || effort === '') return undefined;
  const v = String(effort).trim().toLowerCase();
  if (v in REASONING_EFFORT_RATIOS) return /** @type {any} */ (v);
  return undefined;
}

/**
 * @param {{ effort?: unknown, maxBudget: number, scaleTokens?: number, minimumBudget?: number }} opts
 * @returns {number|undefined}
 */
export function resolveReasoningBudgetTokens(opts = {}) {
  const effort = normalizeReasoningEffort(opts.effort);
  if (effort === undefined) return undefined;
  const ratio = REASONING_EFFORT_RATIOS[effort];
  if (ratio <= 0) return 0;

  const maxBudget = Math.floor(Number(opts.maxBudget) || 0);
  const minimumBudget = Math.max(1, Math.floor(Number(opts.minimumBudget) || 1024));
  if (maxBudget < minimumBudget) return undefined;

  const scale = Math.floor(Number(opts.scaleTokens) || maxBudget);
  return Math.min(Math.max(Math.floor(scale * ratio), minimumBudget), maxBudget);
}

/**
 * Anthropic Messages：根据 thinkingType / reasoningEffort 注入 thinking 块。
 * @param {object} body
 * @param {object} config
 * @param {object} overrides
 */
export function applyAnthropicThinking(body, config = {}, overrides = {}) {
  const thinkingType = overrides.thinkingType
    ?? overrides.thinking_type
    ?? config.thinkingType
    ?? config.thinking_type;
  const effort = overrides.reasoningEffort
    ?? overrides.reasoning_effort
    ?? config.reasoningEffort
    ?? config.reasoning_effort;

  const type = thinkingType != null && thinkingType !== ''
    ? String(thinkingType).trim().toLowerCase()
    : (effort && normalizeReasoningEffort(effort) && normalizeReasoningEffort(effort) !== 'none'
      ? 'enabled'
      : null);

  if (!type || type === 'disabled') {
    if (type === 'disabled') body.thinking = { type: 'disabled' };
    return body;
  }

  if (type !== 'enabled' && type !== 'auto') return body;

  const maxTokens = Number(body.max_tokens ?? overrides.maxTokens ?? config.maxTokens ?? 8192) || 8192;
  // Anthropic：budget_tokens 须小于 max_tokens
  const maxBudget = Math.max(1024, maxTokens - 1);
  const budget = resolveReasoningBudgetTokens({
    effort: effort || 'medium',
    maxBudget,
    scaleTokens: maxBudget,
    minimumBudget: 1024
  });

  if (budget == null || budget <= 0) {
    body.thinking = { type: 'disabled' };
    return body;
  }

  body.thinking = { type: 'enabled', budget_tokens: budget };
  // extended thinking 时常与 temperature 互斥，未显式要求时去掉
  if (overrides.temperature === undefined && config.temperature === undefined) {
    delete body.temperature;
  }
  return body;
}
