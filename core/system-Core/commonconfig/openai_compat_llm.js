import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * OpenAI Chat Completions 协议兼容 LLM 工厂配置（多运营商）
 * 配置文件：data/server_bots/{port}/openai_compat_llm.yaml
 */
export default class OpenAICompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'openai_compat_llm',
      displayName: 'OpenAI Chat 协议兼容 LLM 工厂',
      description: 'OpenAI Chat Completions 兼容运营商集合配置，支持多运营商与 MCP 工具调用',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) throw new Error('OpenAICompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/openai_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: {
            type: 'array',
            label: 'Chat 协议运营商列表',
            component: 'ArrayForm',
            itemType: 'object',
            fields: {
              key: {
                type: 'string',
                label: '运营商标识（provider/model）',
                description: '用于在 aistream.llm.Provider 或前端下拉中引用的唯一 key，例如 volcengine、openai-cn、my-gateway',
                default: '',
                component: 'Input'
              },
              label: {
                type: 'string',
                label: '展示名称',
                description: '给用户看的名称，例如「火山引擎·豆包」或「自建 OpenAI 网关」',
                default: '',
                component: 'Input'
              },
              protocol: {
                type: 'string',
                label: '协议类型',
                description: '固定为 openai（Chat Completions 协议）',
                enum: ['openai'],
                default: 'openai',
                component: 'Select'
              },
              baseUrl: {
                type: 'string',
                label: 'API 基础地址',
                description: '完整的基础地址，通常以 /v1 结尾，例如 https://api.openai.com/v1 或任意兼容网关',
                default: '',
                component: 'Input'
              },
              path: {
                type: 'string',
                label: '接口路径',
                description: '官方默认 /chat/completions（基础地址已包含 /v1）',
                default: '/chat/completions',
                component: 'Input'
              },
              apiKey: {
                type: 'string',
                label: 'API Key',
                description: '下游厂商颁发的密钥，仅在 authMode=bearer/api-key 时生效',
                default: '',
                component: 'InputPassword'
              },
              authMode: {
                type: 'string',
                label: '认证方式',
                description: 'bearer=Authorization: Bearer；api-key=api-key 头；header=自定义头名',
                enum: ['bearer', 'api-key', 'header'],
                default: 'bearer',
                component: 'Select'
              },
              authHeaderName: {
                type: 'string',
                label: '自定义认证头名',
                description: '当 authMode=header 时使用该头名携带 API Key，例如 X-Api-Key',
                default: '',
                component: 'Input'
              },
              model: {
                type: 'string',
                label: '下游模型名（model）',
                description: '下游实际模型标识，例如 gpt-4o、qwen3-vl-plus，具体取决于运营商控制台',
                default: '',
                component: 'Input'
              },
              temperature: {
                type: 'number',
                label: 'temperature',
                description: '采样温度，0 越保守、2 越随机；留空则不下发，由下游默认',
                min: 0,
                max: 2,
                component: 'InputNumber'
              },
              maxCompletionTokens: {
                type: 'number',
                label: 'max_completion_tokens',
                description: '单次回答允许使用的最大输出 tokens 数；留空则不下发，由下游根据模型上限处理',
                min: 1,
                component: 'InputNumber'
              },
              topP: {
                type: 'number',
                label: 'top_p',
                description: '核采样参数，越接近 1 结果越多样，一般与 temperature 二选一调整；留空则不下发',
                min: 0,
                max: 1,
                component: 'InputNumber'
              },
              presencePenalty: {
                type: 'number',
                label: 'presence_penalty',
                description: '提升已出现话题的惩罚系数（-2~2）；留空则不下发',
                min: -2,
                max: 2,
                component: 'InputNumber'
              },
              frequencyPenalty: {
                type: 'number',
                label: 'frequency_penalty',
                description: '提升高频词惩罚系数（-2~2）；留空则不下发',
                min: -2,
                max: 2,
                component: 'InputNumber'
              },
              serviceTier: {
                type: 'string',
                label: 'service_tier',
                description: '部分官方模型支持的服务等级；留空则不下发，由下游默认',
                enum: ['auto', 'default', 'flex', 'scale', 'priority'],
                default: 'auto',
                component: 'Select'
              },
              promptCacheKey: {
                type: 'string',
                label: 'prompt_cache_key',
                description: '用于复用厂商侧 Prompt 缓存的 key，相同 key 的调用可能命中缓存；留空则不下发',
                component: 'Input'
              },
              promptCacheRetention: {
                type: 'string',
                label: 'prompt_cache_retention',
                description: 'Prompt 缓存保存策略，in-memory 为进程内缓存，24h 为厂商侧 24 小时缓存；留空则不下发',
                enum: ['in-memory', '24h'],
                default: 'in-memory',
                component: 'Select'
              },
              safetyIdentifier: {
                type: 'string',
                label: 'safety_identifier',
                description: '安全策略标识（如厂商预配置的安全档位 ID）；留空则使用默认策略',
                component: 'Input'
              },
              reasoningEffort: {
                type: 'string',
                label: 'reasoning_effort',
                description: '推理强度，仅支持推理型模型；越高越慢但思考更充分；留空则不下发',
                enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
                default: 'medium',
                component: 'Select'
              },
              timeout: {
                type: 'number',
                label: '超时时间(ms)',
                description: '单次调用允许的最大时长，建议不低于 60000，过低可能导致长回答被中断',
                min: 1000,
                default: 360000,
                component: 'InputNumber'
              },
              enableTools: {
                type: 'boolean',
                label: '启用工具调用（MCP）',
                description: '开启后会自动把 MCP 工具注入给该运营商支持的模型，无需手动写 tools',
                default: true,
                component: 'Switch'
              },
              toolChoice: {
                type: 'string',
                label: 'tool_choice',
                description: '工具调用模式：auto/none/required，含义遵循 OpenAI Chat Completions 协议',
                default: 'auto',
                component: 'Input'
              },
              parallelToolCalls: {
                type: 'boolean',
                label: 'parallel_tool_calls',
                description: '支持时允许模型一次并行触发多个工具，减少多轮往返延迟',
                default: true,
                component: 'Switch'
              },
              maxToolRounds: {
                type: 'number',
                label: '最大工具轮次',
                description: '单次对话中允许 AI 触发工具的最大轮次，防止工具死循环',
                min: 1,
                max: 20,
                default: 7,
                component: 'InputNumber'
              },
              enableStream: {
                type: 'boolean',
                label: '启用流式',
                description: '开启后使用 SSE 流式返回（前端 /api/ai/stream、/api/v3/chat/completions 可感知）',
                default: true,
                component: 'Switch'
              },
              headers: { 
                type: 'object', 
                label: '额外请求头',
                description: '可选：为下游 Chat 接口追加 HTTP 头',
                example: { 'X-Client-Id': 'xrk-openai-compat' },
                component: 'SubForm', 
                fields: {} 
              },
              extraBody: { 
                type: 'object', 
                label: '额外请求体字段',
                description: '可选：原样合并到 Chat 请求体顶层，如 user/metadata 等',
                example: { user: 'demo-user' },
                component: 'SubForm', 
                fields: {} 
              },
              proxy: {
                type: 'object',
                label: '代理配置',
                component: 'SubForm',
                fields: {
                  enabled: { type: 'boolean', label: '启用代理', default: false, component: 'Switch' },
                  url: { type: 'string', label: '代理地址', default: '', component: 'Input' }
                }
              }
            }
          }
        }
      }
    });
  }
}
