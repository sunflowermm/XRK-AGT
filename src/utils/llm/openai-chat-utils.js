import { MCPToolAdapter } from './mcp-tool-adapter.js';
import { getAistreamConfigOptional } from '../aistream-config.js';
import BotUtil from '../botutil.js';

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

/**
 * 提取工具名称
 */
function getToolName(tool) {
  if (!tool) return '';
  if (typeof tool === 'string') return tool;
  if (typeof tool === 'number') return String(tool);
  const name = tool?.function?.name || tool?.name || tool?.id;
  return typeof name === 'string' ? name : (name != null ? String(name) : '');
}

/**
 * 合并工具列表
 * @param {Array} primaryTools - 优先工具列表
 * @param {Array} secondaryTools - 次要工具列表
 * @returns {Array} 合并后的工具列表
 */
function mergeToolLists(primaryTools, secondaryTools) {
  const map = new Map();

  // 先添加优先工具
  for (const tool of primaryTools) {
    const name = getToolName(tool);
    if (name) map.set(name, tool);
  }

  // 再添加次要工具（不覆盖已存在的）
  for (const tool of secondaryTools) {
    const name = getToolName(tool);
    if (name && !map.has(name)) map.set(name, tool);
  }

  return Array.from(map.values());
}

function applyOptionalFields(body, overrides, config, mapping) {
  for (const item of mapping) {
    const v = pick(overrides, config, item.from);
    if (v !== undefined) body[item.to] = v;
  }
}

export function buildOpenAIChatCompletionsBody(messages, config = {}, overrides = {}, defaultModel) {
  const temperature = pick(overrides, config, ['temperature']);
  const maxCompletionTokensExplicit = pick(overrides, config, ['maxCompletionTokens', 'max_completion_tokens']);
  const maxTokensCompat = pick(overrides, config, ['maxTokens', 'max_tokens']);
  const maxCompletionTokens = maxCompletionTokensExplicit ?? maxTokensCompat;
  const tokenField = pick(overrides, config, ['tokenField', 'token_field']);

  const body = {
    model: pick(overrides, config, ['model', 'chatModel']) || defaultModel,
    messages,
    stream: pick(overrides, config, ['stream']) ?? false
  };

  // 仅在调用方或配置显式设置时才下发 temperature，未配置时完全交由上游默认
  if (temperature !== undefined) {
    body.temperature = temperature;
  }

  if (maxCompletionTokens !== undefined) {
    const want = (tokenField || '').toString().trim().toLowerCase();
    const useBoth = want === 'both';
    const useMaxCompletionTokens =
      want === 'max_completion_tokens'
      // 未显式指定 tokenField 时：若调用方显式传了 max_completion_tokens，则优先走该字段
      || (!want && maxCompletionTokensExplicit !== undefined);

    if (useBoth) {
      body.max_completion_tokens = maxCompletionTokens;
      body.max_tokens = maxCompletionTokens;
    } else if (useMaxCompletionTokens) {
      body.max_completion_tokens = maxCompletionTokens;
    } else {
      // 默认仅发送 max_tokens，避免部分上游（如火山引擎）对两个字段互斥报错
      body.max_tokens = maxCompletionTokens;
    }
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
  const hasMcpTools = MCPToolAdapter.hasTools();
  const enableTools = config.enableTools !== false && hasMcpTools;

  // 调用方是否显式传入了 tools 字段（包括 null/[]）
  const hasRequestToolsField = Object.prototype.hasOwnProperty.call(overrides, 'tools');
  const requestTools = hasRequestToolsField ? overrides.tools : undefined;

  // 如果系统完全没有 MCP 工具，则只透传调用方的 tools
  if (!hasMcpTools) {
    if (hasRequestToolsField && requestTools) {
      body.tools = requestTools;
      if (overrides.tool_choice !== undefined) body.tool_choice = overrides.tool_choice;
      if (overrides.parallel_tool_calls !== undefined) body.parallel_tool_calls = overrides.parallel_tool_calls;
    }
    return body;
  }

  if (!enableTools && !hasRequestToolsField) return body;

  // 获取工作流配置
  const workflow = overrides.workflow || config.workflow || config.streamName || null;
  const streams = Array.isArray(overrides.streams) ? overrides.streams : null;

  // 获取 MCP 工具列表
  const mcpTools = enableTools
    ? MCPToolAdapter.convertMCPToolsToOpenAI({ workflow, streams, excludeStreams: ['chat'] })
    : [];

  let finalTools;
  let downstreamToolNames = [];

  if (hasRequestToolsField) {
    const requestToolsArray = Array.isArray(requestTools) ? requestTools : [];

    BotUtil.makeLog(
      'debug',
      `[工具合并] hasRequestToolsField=true, requestToolsArray.length=${requestToolsArray.length}, mcpTools.length=${mcpTools.length}`,
      'openai-chat-utils'
    );

    if (!requestToolsArray.length) {
      // 下游没有传递工具，只使用 MCP 工具
      finalTools = mcpTools;
    } else {
      // 保存下游工具名称，用于工具分区
      downstreamToolNames = requestToolsArray.map(getToolName).filter(Boolean);

      // 读取工具合并策略配置
      const aistreamCfg = getAistreamConfigOptional();
      const toolMergeStrategy = aistreamCfg?.mcp?.toolMergeStrategy || 'preferRequest';

      // 根据策略合并工具
      switch (toolMergeStrategy) {
        case 'preferStream':
          // MCP 工具优先，下游工具填充不冲突项
          finalTools = mergeToolLists(mcpTools, requestToolsArray);
          break;

        case 'preferRequest':
        default:
          // 下游工具优先，MCP 工具填充不冲突项（默认策略）
          finalTools = mergeToolLists(requestToolsArray, mcpTools);
          break;
      }
    }
  } else {
    // 下游没有传递 tools 字段，只使用 MCP 工具
    finalTools = mcpTools;
  }

  if (!finalTools || !finalTools.length) return body;

  // 保存下游工具名称到 overrides，用于工具分区
  // 这样在工具执行时可以正确识别哪些工具应该透传给下游
  if (downstreamToolNames.length > 0) {
    overrides.downstreamToolNames = downstreamToolNames;
    BotUtil.makeLog(
      'debug',
      `[工具合并] 保存下游工具名称: ${downstreamToolNames.slice(0, 10).join(', ')}${downstreamToolNames.length > 10 ? ` ...共${downstreamToolNames.length}个` : ''}`,
      'openai-chat-utils'
    );
  }

  body.tools = finalTools;
  body.tool_choice = overrides.tool_choice ?? config.toolChoice ?? 'auto';
  const parallel = pick(overrides, config, ['parallelToolCalls', 'parallel_tool_calls']);
  if (parallel !== undefined) body.parallel_tool_calls = parallel;

  return body;
}
