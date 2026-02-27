import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * OpenAI Responses 协议兼容 LLM 工厂配置（多运营商）
 * 配置文件：data/server_bots/{port}/openai_responses_compat_llm.yaml
 */
export default class OpenAIResponsesCompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'openai_responses_compat_llm',
      displayName: 'OpenAI Responses 协议兼容 LLM 工厂',
      description: 'OpenAI Responses 协议运营商集合配置，支持多运营商与 MCP 工具调用',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) throw new Error('OpenAIResponsesCompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/openai_responses_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: {
            type: 'array',
            label: 'Responses 协议运营商列表',
            component: 'ArrayForm',
            itemType: 'object',
            fields: {
              key: {
                type: 'string',
                label: '运营商标识（provider/model）',
                description: '用于 aistream.llm.Provider 或前端下拉中引用的唯一 key，例如 responses-cn、my-resp-gateway',
                default: '',
                component: 'Input'
              },
              label: {
                type: 'string',
                label: '展示名称',
                description: '给用户看的名称，例如「OpenAI Responses」或「自建 Responses 网关」',
                default: '',
                component: 'Input'
              },
              protocol: {
                type: 'string',
                label: '协议类型（protocol / 工厂类型）',
                description: '固定为 openai-response，表示使用 Responses 协议而非 Chat Completions',
                enum: ['openai-response'],
                default: 'openai-response',
                component: 'Select'
              },
              baseUrl: {
                type: 'string',
                label: 'API 基础地址',
                description: '例如：https://api.openai.com/v1（官方）或任意 Responses 兼容代理地址（建议包含 /v1）',
                default: '',
                component: 'Input'
              },
              path: {
                type: 'string',
                label: '接口路径',
                description: '官方默认 /responses（基础地址已包含 /v1）',
                default: '/responses',
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
                label: '模型（model）',
                description: '下游实际模型标识，例如 gpt-4.1、o3-mini 等',
                default: '',
                component: 'Input'
              },
              instructions: {
                type: 'string',
                label: 'instructions',
                description: 'Responses 协议专用的系统级说明（相当于 system prompt），可留空由上层控制',
                default: '',
                component: 'Input'
              },
              temperature: {
                type: 'number',
                label: 'temperature',
                description: '采样温度，0 越保守、2 越随机，推荐 0.5-1.0',
                min: 0,
                max: 2,
                default: 0.7,
                component: 'InputNumber'
              },
              maxOutputTokens: {
                type: 'number',
                label: 'max_output_tokens',
                description: '单次回答允许使用的最大输出 tokens 数，过大可能被运营商拒绝',
                min: 1,
                default: 4096,
                component: 'InputNumber'
              },
              topP: {
                type: 'number',
                label: 'top_p',
                description: '核采样参数，越接近 1 结果越多样，一般与 temperature 二选一调整',
                min: 0,
                max: 1,
                default: 1.0,
                component: 'InputNumber'
              },
              serviceTier: {
                type: 'string',
                label: 'service_tier',
                description: '部分官方模型支持的服务等级，auto 通常即可，详见各家文档',
                enum: ['auto', 'default', 'flex', 'scale', 'priority'],
                default: 'auto',
                component: 'Select'
              },
              promptCacheKey: {
                type: 'string',
                label: 'prompt_cache_key',
                description: '用于复用厂商侧 Prompt 缓存的 key，相同 key 的调用可能命中缓存',
                default: '',
                component: 'Input'
              },
              promptCacheRetention: {
                type: 'string',
                label: 'prompt_cache_retention',
                description: 'Prompt 缓存保存策略，in-memory 为进程内缓存，24h 为厂商侧 24 小时缓存',
                enum: ['in-memory', '24h'],
                default: 'in-memory',
                component: 'Select'
              },
              safetyIdentifier: {
                type: 'string',
                label: 'safety_identifier',
                description: '安全策略标识（如厂商预配置的安全档位 ID），留空则使用默认策略',
                default: '',
                component: 'Input'
              },
              maxToolCalls: {
                type: 'number',
                label: 'max_tool_calls',
                description: 'Responses 协议允许的最大 tool_calls 数量，用于约束服务端工具执行',
                min: 1,
                default: 20,
                component: 'InputNumber'
              },
              timeout: {
                type: 'number',
                label: '超时时间(ms)',
                description: '单次调用允许的最大时长，建议不低于 60000',
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
                description: '工具调用模式：auto/none/required，含义遵循 Responses 协议',
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
              headers: { 
                type: 'object', 
                label: '额外请求头',
                description: '可选：为 Responses 请求追加 HTTP 头（如追踪 ID、来源标识等）',
                example: { 'X-Trace-Id': 'resp-123' },
                component: 'SubForm', 
                fields: {} 
              },
              extraBody: { 
                type: 'object', 
                label: '额外请求体字段',
                description: '可选：原样合并到 Responses 请求体顶层，例如 user/metadata 等字段',
                example: { user: 'demo-user' },
                component: 'SubForm', 
                fields: {} 
              },
              proxy: {
                type: 'object',
                label: '代理配置',
                description: '仅影响本机到 Responses 网关的 HTTP 请求，不修改系统全局代理；支持 http/https/socks5 标准代理地址',
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
