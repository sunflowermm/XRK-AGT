import BotUtil from '#utils/botutil.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import LLMFactory from '#factory/llm/LLMFactory.js';
import { pickFirstDefined, pickTrimmed, pickNonEmptyUrl, shallowMergePlain } from '#utils/coerce-pick.js';

/**
 * 工作流运行时 LLM 配置分层合并（非 request body 组装）。
 *
 * 职责边界：
 * - 此处只做 apiConfig → stream.config → providers[] → aistream.llm 的字段合并
 * - 各厂商官方/兼容协议的 body、SSE、鉴权由 factory/*LLMClient 按官方文档实现
 * - 业务工作流通过 AIStream.patchLLMConfig() 追加场景字段，勿在此写厂商 body 逻辑
 */

function defaultProvider() {
  return LLMFactory.resolveProvider({}) ?? LLMFactory.listProviders()[0] ?? null;
}

function assignDefined(target, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) target[key] = value;
  }
}

/**
 * @param {object} stream - AIStream 实例
 * @param {object} [apiConfig={}]
 */
export function resolveStreamLLMConfig(stream, apiConfig = {}) {
  const ai = getAistreamConfigOptional();
  const llm = ai.llm || {};
  const pick = pickFirstDefined;

  const providerRaw = (apiConfig.provider || stream.config?.provider || llm.Provider || llm.provider || '').toLowerCase();
  const provider = providerRaw || defaultProvider();
  if (providerRaw && !LLMFactory.hasProvider(providerRaw)) {
    BotUtil.makeLog('warn', `[AIStream] 不支持的 LLM 提供商: ${providerRaw}`, 'AIStream');
  }

  const providerConfig = LLMFactory.getProviderConfig(provider) || {};
  const cfg = stream.config || {};

  const apiKey = pickTrimmed(
    apiConfig.apiKey,
    apiConfig.api_key,
    cfg.apiKey,
    cfg.api_key,
    providerConfig.apiKey,
    providerConfig.api_key
  ) || undefined;
  const baseUrl = pickNonEmptyUrl(
    apiConfig.baseUrl,
    apiConfig.base_url,
    cfg.baseUrl,
    cfg.base_url,
    providerConfig.baseUrl,
    providerConfig.base_url
  );

  const headers = shallowMergePlain(providerConfig.headers, cfg.headers, apiConfig.headers);
  const extraBody = shallowMergePlain(providerConfig.extraBody, cfg.extraBody, apiConfig.extraBody);
  const proxy = shallowMergePlain(providerConfig.proxy, cfg.proxy, apiConfig.proxy);

  // 先 spread 保留 providers[] 中的厂商扩展字段（thinkingType、region、deployment 等）
  const merged = {
    ...providerConfig,
    ...cfg,
    ...apiConfig
  };

  assignDefined(merged, {
    apiKey,
    baseUrl,
    provider,
    timeout: pick(
      apiConfig.timeout,
      apiConfig.timeoutMs,
      cfg.timeout,
      providerConfig.timeout,
      llm.timeout,
      ai.global?.maxTimeout
    ),
    model: pick(
      apiConfig.model,
      apiConfig.chatModel,
      cfg.model,
      cfg.chatModel,
      providerConfig.model,
      providerConfig.chatModel
    ),
    maxTokens: pick(
      apiConfig.maxTokens,
      apiConfig.max_tokens,
      apiConfig.max_completion_tokens,
      apiConfig.maxCompletionTokens,
      cfg.maxTokens,
      cfg.max_tokens,
      providerConfig.maxTokens,
      providerConfig.max_tokens,
      llm.maxTokens,
      llm.max_tokens
    ),
    topP: pick(
      apiConfig.topP,
      apiConfig.top_p,
      cfg.topP,
      cfg.top_p,
      providerConfig.topP,
      providerConfig.top_p,
      llm.topP,
      llm.top_p
    ),
    presencePenalty: pick(
      apiConfig.presencePenalty,
      apiConfig.presence_penalty,
      cfg.presencePenalty,
      cfg.presence_penalty,
      providerConfig.presencePenalty,
      providerConfig.presence_penalty,
      llm.presencePenalty,
      llm.presence_penalty
    ),
    frequencyPenalty: pick(
      apiConfig.frequencyPenalty,
      apiConfig.frequency_penalty,
      cfg.frequencyPenalty,
      cfg.frequency_penalty,
      providerConfig.frequencyPenalty,
      providerConfig.frequency_penalty,
      llm.frequencyPenalty,
      llm.frequency_penalty
    ),
    temperature: pick(
      apiConfig.temperature,
      cfg.temperature,
      providerConfig.temperature,
      llm.temperature
    ),
    enableTools: pick(
      apiConfig.enableTools,
      apiConfig.enable_tools,
      cfg.enableTools,
      cfg.enable_tools,
      providerConfig.enableTools,
      providerConfig.enable_tools,
      llm.enableTools,
      llm.enable_tools,
      true
    ),
    enableStream: pick(
      apiConfig.enableStream,
      apiConfig.enable_stream,
      cfg.enableStream,
      cfg.enable_stream,
      providerConfig.enableStream,
      providerConfig.enable_stream,
      llm.enableStream,
      llm.enable_stream
    ),
    tool_choice: pick(
      apiConfig.tool_choice,
      apiConfig.toolChoice,
      cfg.tool_choice,
      cfg.toolChoice,
      providerConfig.tool_choice,
      providerConfig.toolChoice,
      llm.tool_choice,
      llm.toolChoice
    ),
    toolChoice: pick(
      apiConfig.tool_choice,
      apiConfig.toolChoice,
      cfg.tool_choice,
      cfg.toolChoice,
      providerConfig.tool_choice,
      providerConfig.toolChoice,
      llm.tool_choice,
      llm.toolChoice
    ),
    parallel_tool_calls: pick(
      apiConfig.parallel_tool_calls,
      apiConfig.parallelToolCalls,
      cfg.parallel_tool_calls,
      cfg.parallelToolCalls,
      providerConfig.parallel_tool_calls,
      providerConfig.parallelToolCalls,
      llm.parallel_tool_calls,
      llm.parallelToolCalls
    ),
    parallelToolCalls: pick(
      apiConfig.parallel_tool_calls,
      apiConfig.parallelToolCalls,
      cfg.parallel_tool_calls,
      cfg.parallelToolCalls,
      providerConfig.parallel_tool_calls,
      providerConfig.parallelToolCalls,
      llm.parallel_tool_calls,
      llm.parallelToolCalls
    ),
    maxToolRounds: pick(
      apiConfig.maxToolRounds,
      cfg.maxToolRounds,
      providerConfig.maxToolRounds,
      llm.maxToolRounds
    ),
    mcpToolMode: pick(
      apiConfig.mcpToolMode,
      cfg.mcpToolMode,
      providerConfig.mcpToolMode,
      llm.mcpToolMode
    ),
    promptCache: pick(
      apiConfig.promptCache,
      cfg.promptCache,
      llm.promptCache
    )
  });

  if (Object.keys(headers).length) merged.headers = headers;
  if (Object.keys(extraBody).length) merged.extraBody = extraBody;
  if (Object.keys(proxy).length) merged.proxy = proxy;

  const { _clientClass, factoryType, ...out } = merged;
  return out;
}
