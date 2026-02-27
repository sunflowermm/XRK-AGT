import { MCPToolAdapter } from './mcp-tool-adapter.js';

/**
 * OpenAI-like Chat Completions 参数归一化工具
 */

function pick(overrides, config, keys) {
  for (const k of keys) {
    if (overrides?.[k] !== undefined) return overrides[k];
    if (config?.[k] !== undefined) return config[k];
  }
  return;
}

function applyOptionalFields(body, overrides, config, mapping) {
  for (const item of mapping) {
    const v = pick(overrides, config, item.from);
    if (v !== undefined) body[item.to] = v;
  }
}

export function buildOpenAIChatCompletionsBody(messages, config = {}, overrides = {}, defaultModel) {
  const temperature = pick(overrides, config, ['temperature']);
  const maxCompletionTokens = pick(overrides, config, ['maxCompletionTokens', 'max_completion_tokens', 'maxTokens', 'max_tokens']);

  const body = {
    model: pick(overrides, config, ['model', 'chatModel']) || defaultModel,
    messages,
    temperature: temperature ?? 0.7,
    stream: pick(overrides, config, ['stream']) ?? false
  };

  if (maxCompletionTokens !== undefined) {
    body.max_completion_tokens = maxCompletionTokens;
    body.max_tokens = maxCompletionTokens; // 兼容旧网关
  }

  applyOptionalFields(body, overrides, config, [
    { to: 'top_p', from: ['topP', 'top_p'] },
    { to: 'presence_penalty', from: ['presencePenalty', 'presence_penalty'] },
    { to: 'frequency_penalty', from: ['frequencyPenalty', 'frequency_penalty'] },
    { to: 'stop', from: ['stop'] },
    { to: 'response_format', from: ['response_format', 'responseFormat'] },
    { to: 'stream_options', from: ['stream_options', 'streamOptions'] },
    { to: 'seed', from: ['seed'] },
    { to: 'n', from: ['n'] },
    { to: 'logit_bias', from: ['logit_bias', 'logitBias'] },
    { to: 'logprobs', from: ['logprobs'] },
    { to: 'top_logprobs', from: ['top_logprobs', 'topLogprobs'] },
    { to: 'service_tier', from: ['service_tier', 'serviceTier'] },
    { to: 'prompt_cache_key', from: ['prompt_cache_key', 'promptCacheKey'] },
    { to: 'prompt_cache_retention', from: ['prompt_cache_retention', 'promptCacheRetention'] },
    { to: 'safety_identifier', from: ['safety_identifier', 'safetyIdentifier'] },
    { to: 'reasoning_effort', from: ['reasoning_effort', 'reasoningEffort'] },
    { to: 'store', from: ['store'] },
    { to: 'verbosity', from: ['verbosity'] },
    { to: 'modalities', from: ['modalities'] },
    { to: 'prediction', from: ['prediction'] },
    { to: 'web_search_options', from: ['web_search_options', 'webSearchOptions'] },
    { to: 'audio', from: ['audio'] }
  ]);

  const userAlias = pick(overrides, config, ['prompt_cache_key', 'promptCacheKey', 'user']);
  if (userAlias !== undefined && body.prompt_cache_key === undefined) {
    body.prompt_cache_key = userAlias;
  }

  const extraBody = pick(overrides, config, ['extraBody']);
  if (config.extraBody && typeof config.extraBody === 'object') Object.assign(body, config.extraBody);
  if (extraBody && typeof extraBody === 'object') Object.assign(body, extraBody);

  return body;
}

export function applyOpenAITools(body, config = {}, overrides = {}) {
  const enableTools = config.enableTools !== false && MCPToolAdapter.hasTools();

  if (Object.hasOwn(overrides, 'tools')) {
    if (overrides.tools) body.tools = overrides.tools;
    if (overrides.tool_choice !== undefined) body.tool_choice = overrides.tool_choice;
    if (overrides.parallel_tool_calls !== undefined) body.parallel_tool_calls = overrides.parallel_tool_calls;
    return body;
  }

  if (!enableTools) return body;

  const workflow = overrides.workflow || config.workflow || config.streamName || null;
  const streams = Array.isArray(overrides.streams) ? overrides.streams : null;

  const tools = MCPToolAdapter.convertMCPToolsToOpenAI({
    workflow,
    streams,
    excludeStreams: ['chat']
  });
  if (!tools.length) return body;

  body.tools = tools;
  body.tool_choice = overrides.tool_choice ?? config.toolChoice ?? 'auto';
  const parallel = pick(overrides, config, ['parallelToolCalls', 'parallel_tool_calls']);
  if (parallel !== undefined) body.parallel_tool_calls = parallel;

  return body;
}
