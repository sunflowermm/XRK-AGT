import { MCPToolAdapter } from './mcp-tool-adapter.js';

/**
 * OpenAI-like Chat Completions 参数归一化工具
 * - 统一处理常见生成参数与扩展字段透传
 * - 统一注入 MCP tools（保持向后兼容：不改变既有默认行为）
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
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, k) && overrides[k] !== undefined) return overrides[k];
    if (config && Object.prototype.hasOwnProperty.call(config, k) && config[k] !== undefined) return config[k];
  }
  return undefined;
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

  // OpenAI Chat Completions 标准字段：max_tokens（部分供应商也支持 max_completion_tokens，但这里不强行写入）
  if (maxTokens !== undefined) body.max_tokens = maxTokens;

  applyOptionalFields(body, overrides, config, [
    { to: 'top_p', from: ['topP', 'top_p'] },
    { to: 'presence_penalty', from: ['presencePenalty', 'presence_penalty'] },
    { to: 'frequency_penalty', from: ['frequencyPenalty', 'frequency_penalty'] },

    // 常见扩展字段（不同供应商可能部分忽略，但透传能增强兼容性）
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

  // 额外自定义参数透传：config.extraBody + overrides.extraBody
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

  // 外部显式传 tools（允许覆盖/禁用）
  if (Object.prototype.hasOwnProperty.call(overrides, 'tools')) {
    if (overrides.tools) body.tools = overrides.tools;
    if (overrides.tool_choice !== undefined) body.tool_choice = overrides.tool_choice;
    if (overrides.parallel_tool_calls !== undefined) body.parallel_tool_calls = overrides.parallel_tool_calls;
    return body;
  }

  if (!enableTools) return body;

  const tools = MCPToolAdapter.convertMCPToolsToOpenAI();
  if (!tools.length) return body;

  body.tools = tools;
  // tool_choice 允许字符串或对象（如指定 function/name）
  body.tool_choice = overrides.tool_choice ?? config.toolChoice ?? 'auto';
  const parallel = pick(overrides, config, ['parallelToolCalls', 'parallel_tool_calls']);
  if (parallel !== undefined) body.parallel_tool_calls = parallel;

  return body;
}

