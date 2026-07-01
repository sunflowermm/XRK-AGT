import LLMFactory from '#factory/llm/LLMFactory.js';
import { estimateTokensRough } from '#utils/token-estimate.js';
import { normalizeStringArray } from '#utils/string-array-utils.js';
import { pickFirstKey } from '#utils/coerce-pick.js';

export function pickFirst(obj, keys) {
  return pickFirstKey(obj, keys);
}

export function parseOptionalJson(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

export function toNum(v) {
  if (v == null || v === '') return;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function toBool(v) {
  if (v == null || v === '') return;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return;
}

export const trimLower = (v) => (v || '').toString().trim().toLowerCase();

export function getDefaultProvider() {
  return LLMFactory.resolveProvider({}) ?? '';
}

export function resolveProviderFromRequest(body = {}) {
  return LLMFactory.resolveProvider({
    model: trimLower(pickFirst(body, ['model'])),
    provider: trimLower(pickFirst(body, ['provider', 'llm', 'profile'])),
    llm: trimLower(pickFirst(body, ['llm'])),
    profile: trimLower(pickFirst(body, ['profile'])),
    defaultProvider: getDefaultProvider()
  });
}

export function extractMessageText(messages) {
  return messages.map((m) => {
    const content = m.content;
    return typeof content === 'string' ? content : (content?.text || '');
  }).join('');
}

export const estimateTokens = estimateTokensRough;

export function resolveWorkflowStreams(body = {}) {
  const workflowConfig = pickFirst(body, ['workflow']);
  if (!workflowConfig || typeof workflowConfig !== 'object') return null;
  const streams = [];
  if (Array.isArray(workflowConfig.workflows)) streams.push(...workflowConfig.workflows);
  if (Array.isArray(workflowConfig.streams)) streams.push(...workflowConfig.streams);
  if (typeof workflowConfig.workflow === 'string') streams.push(workflowConfig.workflow);
  const normalized = normalizeStringArray(streams);
  return normalized.length > 0 ? normalized : null;
}

export function buildOverridesFromBody(body = {}) {
  const overrides = {};
  const addNum = (key, ...aliases) => {
    const v = toNum(pickFirst(body, [key, ...aliases]));
    if (v !== undefined) {
      overrides[key] = v;
      if (aliases.length) overrides[aliases[0]] = v;
    }
  };
  const addVal = (key, ...aliases) => {
    const v = pickFirst(body, [key, ...aliases]);
    if (v !== undefined) {
      overrides[key] = v;
      if (aliases.length) overrides[aliases[0]] = v;
    }
  };
  const addBool = (key, ...aliases) => {
    const v = toBool(pickFirst(body, [key, ...aliases]));
    if (v !== undefined) {
      overrides[key] = v;
      if (aliases.length) overrides[aliases[0]] = v;
    }
  };

  addNum('temperature');
  addNum('max_tokens', 'maxTokens', 'max_completion_tokens', 'maxCompletionTokens');
  addNum('top_p', 'topP');
  addNum('presence_penalty', 'presencePenalty');
  addNum('frequency_penalty', 'frequencyPenalty');
  addVal('tool_choice', 'toolChoice');
  addBool('parallel_tool_calls', 'parallelToolCalls');
  addVal('tools');
  addVal('stop');
  addVal('response_format', 'responseFormat');
  addVal('stream_options', 'streamOptions');
  addNum('seed');
  addVal('user');
  addNum('n');
  addVal('logit_bias', 'logitBias');
  addBool('logprobs');
  addNum('top_logprobs', 'topLogprobs');

  const extraBody = parseOptionalJson(pickFirst(body, ['extraBody']));
  if (extraBody && typeof extraBody === 'object') overrides.extraBody = extraBody;
  return overrides;
}
