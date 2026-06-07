import LLMFactory from '#factory/llm/LLMFactory.js';

/**
 * 产品 Agent 接 LLM 工厂的统一门面（不依赖 system-Core / aistream 默认 Provider）
 *
 * - overrides.tools + toolExecutor：产品自有工具，不注入 MCP
 * - overrides.streams：显式 opt-in 时才走 MCP（AGT 本体工作流）
 */
export function listAgentEndpoints(filter = {}) {
  let profiles = LLMFactory.listModelProfiles(filter);
  if (filter.protocols?.length) {
    const set = new Set(filter.protocols.map((p) => String(p).toLowerCase()));
    profiles = profiles.filter((p) => set.has(String(p.protocol || '').toLowerCase()));
  }
  if (filter.capability) {
    profiles = profiles.filter((p) => p.capabilities?.includes(filter.capability));
  }
  if (filter.hasApiKey === true) {
    profiles = profiles.filter((p) => p.hasApiKey);
  }
  return profiles;
}

function buildRunOverrides(sessionOptions, runOverrides = {}) {
  const streams = runOverrides.streams ?? sessionOptions.streams ?? null;
  return {
    tools: runOverrides.tools ?? sessionOptions.tools,
    toolExecutor: runOverrides.toolExecutor ?? sessionOptions.toolExecutor,
    onBeforeRound: runOverrides.onBeforeRound ?? sessionOptions.onBeforeRound,
    onTruncated: runOverrides.onTruncated ?? sessionOptions.onTruncated,
    maxToolRounds: runOverrides.maxToolRounds ?? sessionOptions.maxToolRounds,
    streams,
    mcpToolMode: streams?.length ? runOverrides.mcpToolMode : 'passthrough',
    ...runOverrides
  };
}

export async function createAgentSession(options = {}) {
  const {
    provider,
    tools = [],
    toolExecutor,
    maxToolRounds,
    streams = null,
    onBeforeRound,
    onTruncated,
    clientOverrides = {}
  } = options;

  const key = String(provider || '').trim();
  if (!key) {
    throw new Error('createAgentSession: provider 必填（对应各工厂 providers[].key）');
  }

  const profile = LLMFactory.getProviderConfig(key);
  if (!profile) {
    throw new Error(`createAgentSession: 未知 LLM 端点 "${key}"，请先在 config/*_llm.yaml 的 providers[] 中配置`);
  }

  const client = LLMFactory.createClient({
    provider: key,
    useAistreamDefault: false,
    maxToolRounds,
    ...clientOverrides
  });

  if (toolExecutor && typeof client._runToolLoop !== 'function') {
    throw new Error(
      `端点 "${key}" 不支持产品工具循环，请改用 anthropic_compat_llm.providers[] 中的兼容端点`
    );
  }

  const sessionOptions = {
    provider: key,
    tools,
    toolExecutor,
    maxToolRounds,
    streams,
    onBeforeRound,
    onTruncated
  };

  return {
    provider: key,
    profile,
    client,
    async chat(messages, runOverrides = {}) {
      return client.chat(messages, buildRunOverrides(sessionOptions, runOverrides));
    },
    async chatStream(messages, onDelta, runOverrides = {}) {
      return client.chatStream(messages, onDelta, buildRunOverrides(sessionOptions, runOverrides));
    }
  };
}

/** Anthropic 协议识图（产品 Agent 复用工厂端点，不走独立 apiKey 配置） */
export async function runVisionAnalyze(provider, { mediaType, base64, prompt, maxTokens = 4096 } = {}) {
  const key = String(provider || '').trim();
  if (!key) throw new Error('runVisionAnalyze: provider 必填');

  const profile = LLMFactory.getProviderConfig(key);
  if (!profile) throw new Error(`runVisionAnalyze: 未知端点 "${key}"`);
  if (String(profile.protocol || '').toLowerCase() !== 'anthropic') {
    throw new Error(`识图需要 anthropic 协议端点，当前为 ${profile.protocol}`);
  }
  if (!base64) throw new Error('图片数据为空');

  const client = LLMFactory.createClient({ provider: key, useAistreamDefault: false });
  const messages = [{
    role: 'user',
    content: [
      {
        type: 'image',
        source: { type: 'base64', media_type: mediaType || 'image/png', data: base64 }
      },
      { type: 'text', text: String(prompt || '描述这张图片。').trim() || '描述这张图片。' }
    ]
  }];

  const analyze = typeof client.chatNative === 'function'
    ? client.chatNative.bind(client)
    : client.chat.bind(client);

  const analysis = await analyze(messages, { maxTokens });
  if (!String(analysis || '').trim()) throw new Error('模型未返回识图结果');
  return String(analysis).trim();
}
