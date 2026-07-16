/**
 * 各 LLM 工厂共用的 providers[] 条目字段（与官方 API + 客户端实现对齐）。
 * YAML 默认仅 providers: []；可编辑项由 commonconfig schema 提供。
 */

const PROXY_FIELDS = {
  type: 'object',
  label: '代理配置',
  description: '仅影响本端点的 HTTP 请求',
  component: 'SubForm',
  fields: {
    enabled: { type: 'boolean', label: '启用代理', default: false, component: 'Switch' },
    url: { type: 'string', label: '代理地址', default: '', component: 'Input' }
  }
};

const HEADERS_FIELD = {
  type: 'object',
  label: '额外请求头',
  description: '合并到 HTTP 请求头；简单键值用「键值」模式，复杂结构用 JSON',
  component: 'SubForm',
  layout: 'full',
  fields: {}
};
const EXTRA_BODY_FIELD = {
  type: 'object',
  label: '额外请求体字段',
  description: '原样合并到请求体顶层（高级用法）',
  component: 'SubForm',
  layout: 'full',
  fields: {}
};

const RUNTIME_FIELDS = ['timeout', 'enableStream', 'headers', 'extraBody', 'proxy'];
const IDENTITY_FIELDS = ['key', 'label'];
const ENDPOINT_FIELDS = ['baseUrl', 'path', 'apiKey'];
const AUTH_FIELDS = ['authMode', 'authHeaderName'];
const MODEL_FIELD = ['model'];
const OPENAI_SAMPLING = ['temperature', 'maxTokens', 'tokenField', 'topP', 'presencePenalty', 'frequencyPenalty', 'stop'];
const OPENAI_OFFICIAL_EXTRA = ['serviceTier', 'promptCacheKey', 'promptCacheRetention', 'safetyIdentifier', 'reasoningEffort'];
const TOOL_FIELDS = ['enableTools', 'toolChoice', 'parallelToolCalls', 'maxToolRounds'];
/** 兼容网关专用：剥离 tool 历史，避免部分 OpenAI-like 代理 400 */
const COMPAT_GATEWAY = ['stripToolTraces'];

/** OpenAI Chat Completions 兼容工厂：官方 Chat 字段全集 + 认证 + 网关开关 */
const OPENAI_CHAT_COMPAT = [
  ...IDENTITY_FIELDS,
  'protocol',
  ...ENDPOINT_FIELDS,
  ...AUTH_FIELDS,
  ...MODEL_FIELD,
  ...OPENAI_SAMPLING,
  ...OPENAI_OFFICIAL_EXTRA,
  ...TOOL_FIELDS,
  ...COMPAT_GATEWAY,
  ...RUNTIME_FIELDS
];

function protocolField(enumValues, defaultValue) {
  return {
    type: 'string',
    label: '协议类型',
    enum: enumValues,
    default: defaultValue,
    component: 'Select'
  };
}

/** 所有 provider 条目的字段池（按官方 API 命名，客户端在 openai-chat-utils / 各 Client 中消费） */
function baseProviderEntryFields(options = {}) {
  const { fixedProtocol = null, extraFields = {} } = options;

  return {
    key: {
      type: 'string',
      label: '端点标识（provider key）',
      description: 'ai-workflow.llm.Provider 与 v3 model 引用的唯一 key',
      default: '',
      component: 'Input'
    },
    label: {
      type: 'string',
      label: '展示名称',
      description: '控制台与日志中的可读名称，不影响 API 调用',
      default: '',
      component: 'Input'
    },
    ...(fixedProtocol ? {} : {
      protocol: {
        type: 'string',
        label: '协议类型',
        description: '留空时由工厂默认协议推断',
        default: '',
        component: 'Input'
      }
    }),
    baseUrl: {
      type: 'string',
      label: 'API 基础地址',
      description: '不含 path，如 https://api.openai.com/v1',
      default: '',
      component: 'Input'
    },
    path: {
      type: 'string',
      label: '接口路径',
      description: '相对 baseUrl，如 /chat/completions；留空用客户端默认',
      default: '',
      component: 'Input'
    },
    apiKey: {
      type: 'string',
      label: 'API Key',
      description: '写入 Authorization 或自定义头；密码框不回显已保存值',
      default: '',
      component: 'InputPassword'
    },
    authMode: {
      type: 'string',
      label: '认证方式',
      description: 'bearer=Authorization Bearer；api-key=部分网关专用头',
      enum: ['bearer', 'api-key', 'header'],
      default: 'bearer',
      component: 'Select'
    },
    authHeaderName: {
      type: 'string',
      label: '自定义认证头名',
      description: 'authMode=header 时使用',
      default: '',
      component: 'Input'
    },
    model: {
      type: 'string',
      label: '模型名（model）',
      description: '下游真实模型 / deployment 标识（Azure 另填 deployment）',
      default: '',
      component: 'Input'
    },
    deployment: {
      type: 'string',
      label: 'Deployment（Azure 部署名）',
      description: 'Azure OpenAI 部署 ID，非模型名',
      default: '',
      component: 'Input'
    },
    apiVersion: {
      type: 'string',
      label: 'api-version（Azure）',
      description: 'Azure 资源 API 版本查询参数',
      default: '2024-10-21',
      component: 'Input'
    },
    anthropicVersion: {
      type: 'string',
      label: 'anthropic-version',
      description: 'Messages API 版本头；2026 官方仍使用 2023-06-01',
      default: '2023-06-01',
      component: 'Input',
      layout: 'half'
    },
    region: {
      type: 'string',
      label: '区域（region）',
      description: '火山引擎：留空 baseUrl 时自动拼 https://ark.{region}.volces.com/api/v3',
      default: '',
      component: 'Input'
    },
    instructions: {
      type: 'string',
      label: 'instructions',
      description: 'OpenAI Responses 协议系统说明',
      default: '',
      component: 'Input'
    },
    temperature: {
      type: 'number',
      label: 'temperature',
      description: 'OpenAI/兼容网关 0–2；Anthropic Opus 4.7+ 非默认值会 400；Gemini 3 建议留空用默认',
      min: 0,
      max: 2,
      component: 'InputNumber'
    },
    maxTokens: {
      type: 'number',
      label: 'max_tokens / maxTokens',
      description: 'Anthropic 必填 max_tokens；OpenAI/o 系列经 tokenField 映射 max_completion_tokens；MiMo 默认 max_completion_tokens',
      min: 1,
      component: 'InputNumber'
    },
    maxOutputTokens: {
      type: 'number',
      label: 'max_output_tokens',
      description: 'OpenAI Responses 协议输出上限',
      min: 1,
      component: 'InputNumber'
    },
    tokenField: {
      type: 'string',
      label: 'Token 字段名',
      enum: ['max_tokens', 'max_completion_tokens', 'both'],
      component: 'Select'
    },
    topP: {
      type: 'number',
      label: 'top_p',
      description: 'Anthropic/Gemini 3 非默认可能报错；Ollama 映射 options.top_p',
      min: 0,
      max: 1,
      component: 'InputNumber'
    },
    topK: {
      type: 'number',
      label: 'top_k / topK',
      description: 'Anthropic（旧模型）/ Gemini generationConfig.topK',
      min: 0,
      component: 'InputNumber'
    },
    presencePenalty: { type: 'number', label: 'presence_penalty', min: -2, max: 2, component: 'InputNumber' },
    frequencyPenalty: { type: 'number', label: 'frequency_penalty', min: -2, max: 2, component: 'InputNumber' },
    thinkingType: {
      type: 'string',
      label: 'thinking.type',
      description: '火山豆包：enabled/disabled/auto；MiMo 官方仅 enabled/disabled',
      enum: ['disabled', 'enabled', 'auto'],
      component: 'Select'
    },
    stripToolTraces: {
      type: 'boolean',
      label: 'stripToolTraces',
      description: '兼容网关不接受 tool/tool_calls 历史时开启，剥离后重发',
      default: false,
      component: 'Switch'
    },
    responseFormat: {
      type: 'string',
      label: 'response_format.type',
      enum: ['text', 'json_object'],
      component: 'Select'
    },
    stop: {
      type: 'array',
      label: 'stop / stop_sequences',
      description: 'OpenAI: stop；Anthropic: stop_sequences',
      itemType: 'string',
      component: 'Tags'
    },
    serviceTier: {
      type: 'string',
      label: 'service_tier',
      description: 'OpenAI Chat：auto/default/flex/scale/priority',
      enum: ['auto', 'default', 'flex', 'scale', 'priority'],
      component: 'Select',
      layout: 'half'
    },
    anthropicServiceTier: {
      type: 'string',
      label: 'service_tier',
      description: 'Anthropic Messages：auto / standard_only（与 OpenAI 同名参数不同）',
      enum: ['auto', 'standard_only'],
      component: 'Select',
      layout: 'half'
    },
    promptCacheKey: { type: 'string', label: 'prompt_cache_key', component: 'Input' },
    promptCacheRetention: {
      type: 'string',
      label: 'prompt_cache_retention',
      enum: ['in-memory', '24h'],
      component: 'Select'
    },
    safetyIdentifier: { type: 'string', label: 'safety_identifier', component: 'Input' },
    reasoningEffort: {
      type: 'string',
      label: 'reasoning_effort',
      enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      component: 'Select'
    },
    maxToolCalls: {
      type: 'number',
      label: 'max_tool_calls',
      description: 'OpenAI Responses 协议',
      min: 1,
      component: 'InputNumber'
    },
    timeout: { type: 'number', label: '超时(ms)', min: 1000, default: 360000, component: 'InputNumber' },
    enableTools: { type: 'boolean', label: '启用 MCP 工具', default: true, component: 'Switch' },
    toolChoice: { type: 'string', label: 'tool_choice', default: 'auto', component: 'Input' },
    parallelToolCalls: { type: 'boolean', label: 'parallel_tool_calls', default: true, component: 'Switch' },
    maxToolRounds: { type: 'number', label: '最大工具轮次', min: 1, max: 20, default: 7, component: 'InputNumber' },
    enableStream: { type: 'boolean', label: '启用流式', default: true, component: 'Switch' },
    headers: HEADERS_FIELD,
    extraBody: EXTRA_BODY_FIELD,
    proxy: PROXY_FIELDS,
    ...extraFields
  };
}

export function buildLlmProvidersField(options = {}) {
  const {
    itemLabel = '模型端点',
    listLabel = '模型端点列表',
    listDescription = '每个条目一个 provider key；同一 baseUrl 可配置多个不同 model',
    fixedProtocol = null,
    include = null,
    extraFields = {}
  } = options;

  const allFields = baseProviderEntryFields({ fixedProtocol, extraFields });
  const fields = include
    ? Object.fromEntries(include.filter((k) => k in allFields).map((k) => [k, allFields[k]]))
    : allFields;

  return {
    type: 'array',
    label: listLabel,
    description: listDescription,
    component: 'ArrayForm',
    itemType: 'object',
    itemLabel,
    fields
  };
}

const OPENAI_CHAT_BUILTIN = [
  ...IDENTITY_FIELDS,
  ...ENDPOINT_FIELDS,
  ...MODEL_FIELD,
  ...OPENAI_SAMPLING,
  ...OPENAI_OFFICIAL_EXTRA,
  ...TOOL_FIELDS,
  ...RUNTIME_FIELDS
];

/** 各工厂 provider 字段预设（对照各厂商最新 API 文档审计，2026-06） */
export const LLM_PROVIDER_PRESETS = {
  openai: {
    itemLabel: 'OpenAI 端点',
    fixedProtocol: 'openai',
    include: OPENAI_CHAT_BUILTIN
  },
  openai_compat: {
    itemLabel: 'OpenAI Chat 端点',
    include: OPENAI_CHAT_COMPAT,
    extraFields: { protocol: protocolField(['openai'], 'openai') }
  },
  openai_responses_compat: {
    itemLabel: 'Responses 端点',
    include: [
      ...IDENTITY_FIELDS,
      'protocol',
      ...ENDPOINT_FIELDS,
      ...AUTH_FIELDS,
      ...MODEL_FIELD,
      'instructions',
      'temperature',
      'maxOutputTokens',
      'topP',
      ...OPENAI_OFFICIAL_EXTRA,
      'maxToolCalls',
      ...TOOL_FIELDS,
      ...RUNTIME_FIELDS
    ],
    extraFields: { protocol: protocolField(['openai-response'], 'openai-response') }
  },
  anthropic: {
    itemLabel: 'Anthropic 端点',
    fixedProtocol: 'anthropic',
    include: [
      ...IDENTITY_FIELDS,
      ...ENDPOINT_FIELDS,
      ...MODEL_FIELD,
      'anthropicVersion',
      'maxTokens',
      'anthropicServiceTier',
      'temperature',
      'topP',
      'topK',
      'stop',
      ...RUNTIME_FIELDS
    ],
    extraFields: {
      path: {
        type: 'string',
        label: '接口路径',
        default: '/messages',
        component: 'Input',
        layout: 'half'
      },
      baseUrl: {
        type: 'string',
        label: 'API 基础地址',
        default: 'https://api.anthropic.com/v1',
        component: 'Input',
        layout: 'full'
      }
    }
  },
  anthropic_compat: {
    itemLabel: 'Anthropic 端点',
    include: [
      ...IDENTITY_FIELDS,
      'protocol',
      ...ENDPOINT_FIELDS,
      ...AUTH_FIELDS,
      ...MODEL_FIELD,
      'anthropicVersion',
      'maxTokens',
      'anthropicServiceTier',
      'temperature',
      'topP',
      'topK',
      'stop',
      ...TOOL_FIELDS,
      ...RUNTIME_FIELDS
    ],
    extraFields: {
      protocol: protocolField(['anthropic'], 'anthropic'),
      authMode: {
        type: 'string',
        label: '认证方式',
        description: '兼容网关多为 bearer；Anthropic 官方为 x-api-key',
        enum: ['bearer', 'x-api-key', 'header'],
        default: 'bearer',
        component: 'Select',
        layout: 'half'
      },
      path: {
        type: 'string',
        label: '接口路径',
        description: '相对 baseUrl，默认 /messages；若 base 已含 /v1 则拼为 …/v1/messages',
        default: '/messages',
        component: 'Input',
        layout: 'half'
      },
      baseUrl: {
        type: 'string',
        label: 'API 基础地址',
        description: '不含 path，如 https://api.gptgod.online 或 https://api.anthropic.com/v1',
        default: '',
        component: 'Input',
        layout: 'full'
      }
    }
  },
  gemini: {
    itemLabel: 'Gemini 端点',
    fixedProtocol: 'gemini',
    include: [
      ...IDENTITY_FIELDS,
      ...ENDPOINT_FIELDS,
      ...MODEL_FIELD,
      'temperature',
      'topP',
      'topK',
      'maxTokens',
      ...RUNTIME_FIELDS
    ]
  },
  gemini_compat: {
    itemLabel: 'Gemini 端点',
    include: [
      ...IDENTITY_FIELDS,
      'protocol',
      ...ENDPOINT_FIELDS,
      ...MODEL_FIELD,
      'temperature',
      'topP',
      'topK',
      'maxTokens',
      ...RUNTIME_FIELDS
    ],
    extraFields: { protocol: protocolField(['gemini'], 'gemini') }
  },
  azure_openai: {
    itemLabel: 'Azure OpenAI 端点',
    fixedProtocol: 'azure_openai',
    include: [
      ...IDENTITY_FIELDS,
      ...ENDPOINT_FIELDS,
      'deployment',
      'apiVersion',
      'temperature',
      'maxTokens',
      'topP',
      'presencePenalty',
      'frequencyPenalty',
      ...TOOL_FIELDS,
      ...RUNTIME_FIELDS
    ]
  },
  azure_openai_compat: {
    itemLabel: 'Azure OpenAI 端点',
    include: [
      ...IDENTITY_FIELDS,
      'protocol',
      ...ENDPOINT_FIELDS,
      ...AUTH_FIELDS,
      'deployment',
      'apiVersion',
      'path',
      'temperature',
      'maxTokens',
      'tokenField',
      'topP',
      'presencePenalty',
      'frequencyPenalty',
      ...TOOL_FIELDS,
      ...COMPAT_GATEWAY,
      ...RUNTIME_FIELDS
    ],
    extraFields: { protocol: protocolField(['azure-openai'], 'azure-openai') }
  },
  volcengine: {
    itemLabel: '火山引擎端点',
    fixedProtocol: 'volcengine',
    include: [
      ...IDENTITY_FIELDS,
      ...ENDPOINT_FIELDS,
      'region',
      ...MODEL_FIELD,
      ...OPENAI_SAMPLING,
      'tokenField',
      'thinkingType',
      'reasoningEffort',
      ...TOOL_FIELDS,
      ...RUNTIME_FIELDS
    ]
  },
  deepseek: {
    itemLabel: 'DeepSeek 端点',
    fixedProtocol: 'deepseek',
    extraFields: {
      baseUrl: {
        type: 'string',
        label: 'API 基础地址',
        description: '不含 path，官方默认 https://api.deepseek.com',
        default: 'https://api.deepseek.com',
        component: 'Input',
        layout: 'full'
      },
      path: {
        type: 'string',
        label: '接口路径',
        default: '/chat/completions',
        component: 'Input',
        layout: 'half'
      },
      model: {
        type: 'string',
        label: '模型名（model）',
        description: 'deepseek-v4-flash（快）/ deepseek-v4-pro；旧版 deepseek-chat、deepseek-reasoner 已弃用',
        enum: ['deepseek-v4-flash', 'deepseek-v4-pro'],
        default: 'deepseek-v4-flash',
        component: 'Select'
      },
      thinkingType: {
        type: 'string',
        label: 'thinking.type',
        description: '思考模式：enabled（默认）/ disabled；enabled 时 temperature 等采样参数不生效',
        enum: ['enabled', 'disabled'],
        default: 'enabled',
        component: 'Select'
      },
      reasoningEffort: {
        type: 'string',
        label: 'reasoning_effort',
        description: '思考强度：high（默认）/ max；low、medium 在 API 侧映射为 high',
        enum: ['high', 'max'],
        default: 'high',
        component: 'Select'
      },
      userId: {
        type: 'string',
        label: 'user_id',
        description: '可选；用于缓存命中与请求调度优化',
        default: '',
        component: 'Input'
      },
      tokenField: {
        type: 'string',
        label: 'Token 字段名',
        description: 'DeepSeek 官方使用 max_tokens',
        enum: ['max_tokens'],
        default: 'max_tokens',
        component: 'Select'
      }
    },
    include: [
      ...IDENTITY_FIELDS,
      ...ENDPOINT_FIELDS,
      'model',
      'thinkingType',
      'reasoningEffort',
      'maxTokens',
      'tokenField',
      'temperature',
      'topP',
      'presencePenalty',
      'frequencyPenalty',
      'stop',
      'responseFormat',
      'userId',
      ...TOOL_FIELDS,
      ...RUNTIME_FIELDS
    ]
  },
  xiaomimimo: {
    itemLabel: 'MiMo 端点',
    fixedProtocol: 'xiaomimimo',
    extraFields: {
      authMode: {
        type: 'string',
        label: '认证方式',
        enum: ['api-key', 'bearer'],
        default: 'api-key',
        component: 'Select'
      },
      thinkingType: {
        type: 'string',
        label: 'thinking.type',
        description: 'MiMo 官方：enabled / disabled（无 auto）',
        enum: ['disabled', 'enabled'],
        component: 'Select'
      },
      tokenField: {
        type: 'string',
        label: 'Token 字段名',
        description: 'MiMo 官方使用 max_completion_tokens',
        enum: ['max_completion_tokens'],
        default: 'max_completion_tokens',
        component: 'Select'
      }
    },
    include: [
      ...IDENTITY_FIELDS,
      ...ENDPOINT_FIELDS,
      'authMode',
      ...MODEL_FIELD,
      'temperature',
      'maxTokens',
      'tokenField',
      'topP',
      'frequencyPenalty',
      'presencePenalty',
      'stop',
      'thinkingType',
      'responseFormat',
      ...TOOL_FIELDS,
      ...RUNTIME_FIELDS
    ]
  },
  ollama_compat: {
    itemLabel: 'Ollama 端点',
    include: [
      ...IDENTITY_FIELDS,
      'protocol',
      ...ENDPOINT_FIELDS,
      ...AUTH_FIELDS,
      ...MODEL_FIELD,
      'temperature',
      'maxTokens',
      'topP',
      'stop',
      'presencePenalty',
      'frequencyPenalty',
      ...RUNTIME_FIELDS
    ],
    extraFields: { protocol: protocolField(['ollama'], 'ollama') }
  },
  newapi_compat: {
    itemLabel: 'New API 端点',
    include: OPENAI_CHAT_COMPAT,
    extraFields: { protocol: protocolField(['new-api', 'openai'], 'new-api') }
  },
  cherryin_compat: {
    itemLabel: 'CherryIN 端点',
    include: OPENAI_CHAT_COMPAT,
    extraFields: { protocol: protocolField(['cherryin', 'openai'], 'cherryin') }
  }
};

export function buildLlmProvidersFromPreset(presetKey, overrides = {}) {
  const preset = LLM_PROVIDER_PRESETS[presetKey];
  if (!preset) throw new Error(`未知 LLM provider 预设: ${presetKey}`);
  return buildLlmProvidersField({ ...preset, ...overrides });
}
