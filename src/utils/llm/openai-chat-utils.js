import { MCPToolAdapter } from './mcp-tool-adapter.js';

/**
 * OpenAI-like Chat Completions 参数归一化工具
 */

/**
 * 从 overrides/config 中选择同义字段（优先 overrides）
 * @param {Object} overrides
 * @param {Object} config
 * @param {Array<string>} keys
 * @returns {*}
 */
function pick(overrides, config, keys) {
  for (const k of keys) {
    if (overrides?.[k] !== undefined) return overrides[k];
    if (config?.[k] !== undefined) return config[k];
  }
  return;
}

/**
 * 将“可选字段”按白名单透传到 body（若值为 undefined 则忽略）
 * @param {Object} body
 * @param {Object} overrides
 * @param {Object} config
 * @param {Array<{to:string, from:string[]}>} mapping
 */
function applyOptionalFields(body, overrides, config, mapping) {
  for (const item of mapping) {
    const v = pick(overrides, config, item.from);
    if (v !== undefined) body[item.to] = v;
  }
}

/**
 * 构建 OpenAI-like Chat Completions 请求体（通用字段）
 * @param {Array} messages
 * @param {Object} config
 * @param {Object} overrides
 * @param {string|undefined} defaultModel
 * @returns {Object}
 */
export function buildOpenAIChatCompletionsBody(messages, config = {}, overrides = {}, defaultModel = 'gpt-4o-mini') {
  const temperature = pick(overrides, config, ['temperature']);
  const maxTokens = pick(overrides, config, ['maxTokens', 'max_tokens', 'max_completion_tokens', 'maxCompletionTokens']);

  const body = {
    model: pick(overrides, config, ['model', 'chatModel']) || defaultModel,
    messages,
    temperature: temperature ?? 0.7,
    stream: pick(overrides, config, ['stream']) ?? false
  };

  if (maxTokens !== undefined) body.max_tokens = maxTokens;

  applyOptionalFields(body, overrides, config, [
    { to: 'top_p', from: ['topP', 'top_p'] },
    { to: 'presence_penalty', from: ['presencePenalty', 'presence_penalty'] },
    { to: 'frequency_penalty', from: ['frequencyPenalty', 'frequency_penalty'] },
    { to: 'stop', from: ['stop'] },
    { to: 'response_format', from: ['response_format', 'responseFormat'] },
    { to: 'stream_options', from: ['stream_options', 'streamOptions'] },
    { to: 'seed', from: ['seed'] },
    { to: 'user', from: ['user'] },
    { to: 'n', from: ['n'] },
    { to: 'logit_bias', from: ['logit_bias', 'logitBias'] },
    { to: 'logprobs', from: ['logprobs'] },
    { to: 'top_logprobs', from: ['top_logprobs', 'topLogprobs'] }
  ]);

  const extraBody = pick(overrides, config, ['extraBody']);
  if (config.extraBody && typeof config.extraBody === 'object') Object.assign(body, config.extraBody);
  if (extraBody && typeof extraBody === 'object') Object.assign(body, extraBody);

  return body;
}

/**
 * 在 OpenAI-like body 上注入 tools/tool_choice/parallel_tool_calls（支持 overrides 覆盖）
 * @param {Object} body
 * @param {Object} config
 * @param {Object} overrides
 * @returns {Object} 同一个 body 引用
 */
export function applyOpenAITools(body, config = {}, overrides = {}) {
  const enableTools = config.enableTools !== false && MCPToolAdapter.hasTools();

  if (Object.hasOwn(overrides, 'tools')) {
    if (overrides.tools) body.tools = overrides.tools;
    if (overrides.tool_choice !== undefined) body.tool_choice = overrides.tool_choice;
    if (overrides.parallel_tool_calls !== undefined) body.parallel_tool_calls = overrides.parallel_tool_calls;
    return body;
  }

  if (!enableTools) return body;

  // 工具作用域策略：
  // - 若 overrides.streams 显式指定，优先使用（多工作流白名单）
  // - 否则若有 workflow/config.workflow，则仅注入该工作流的工具
  // - 若均未指定，则默认注入除 chat 之外的所有工作流工具
  const workflow =
    overrides.workflow ||
    config.workflow ||
    config.streamName || // 兼容可能存在的别名
    null;

  const streams = Array.isArray(overrides.streams) ? overrides.streams : null;

  const tools = MCPToolAdapter.convertMCPToolsToOpenAI({
    workflow,
    streams,
    // 全局黑名单：不显式注入 chat 工作流工具（chat 只通过按 stream 过滤时使用）
    excludeStreams: ['chat']
  });
  if (!tools.length) return body;

  body.tools = tools;
  body.tool_choice = overrides.tool_choice ?? config.toolChoice ?? 'auto';
  const parallel = pick(overrides, config, ['parallelToolCalls', 'parallel_tool_calls']);
  if (parallel !== undefined) body.parallel_tool_calls = parallel;

  return body;
}

