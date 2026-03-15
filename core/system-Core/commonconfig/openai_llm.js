import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * OpenAI 官方 Chat Completions 配置
 * 配置文件：data/server_bots/{port}/openai_llm.yaml
 */
export default class OpenAILLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'openai_llm',
      displayName: 'OpenAI LLM 工厂配置（官方）',
      description: 'OpenAI Chat Completions 配置，支持 MCP 工具调用',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) throw new Error('OpenAILLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/openai_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          baseUrl: {
            type: 'string',
            label: 'API 基础地址',
            description: 'OpenAI API 基础地址（官方建议 https://api.openai.com）',
            default: 'https://api.openai.com/v1',
            component: 'Input'
          },
          apiKey: {
            type: 'string',
            label: 'API Key',
            description: 'OpenAI 官方或兼容网关颁发的密钥，必填，否则无法调用接口',
            default: '',
            component: 'InputPassword'
          },
          path: {
            type: 'string',
            label: '接口路径',
            description: 'Chat Completions 路径，官方默认 /chat/completions（基础地址已包含 /v1）',
            default: '/chat/completions',
            component: 'Input'
          },
          model: {
            type: 'string',
            label: '模型（model）',
            description: '模型标识，如 gpt-4o-mini、gpt-4o 等',
            default: 'gpt-4o-mini',
            component: 'Input'
          },
          temperature: {
            type: 'number',
            label: 'temperature',
            min: 0,
            max: 2,
            component: 'InputNumber'
          },
          maxTokens: {
            type: 'number',
            label: '最大 Tokens（max_tokens / max_completion_tokens）',
            min: 1,
            component: 'InputNumber'
          },
          topP: {
            type: 'number',
            label: 'top_p',
            min: 0,
            max: 1,
            component: 'InputNumber'
          },
          presencePenalty: {
            type: 'number',
            label: 'presence_penalty',
            min: -2,
            max: 2,
            component: 'InputNumber'
          },
          frequencyPenalty: {
            type: 'number',
            label: 'frequency_penalty',
            min: -2,
            max: 2,
            component: 'InputNumber'
          },
          serviceTier: {
            type: 'string',
            label: 'service_tier',
            description: 'OpenAI 服务档位（仅部分端点支持）',
            enum: ['auto', 'default', 'flex', 'scale', 'priority'],
            default: 'auto',
            component: 'Select'
          },
          promptCacheKey: {
            type: 'string',
            label: 'prompt_cache_key',
            description: '提示缓存键，用于复用缓存（仅部分模型支持）',
            component: 'Input'
          },
          promptCacheRetention: {
            type: 'string',
            label: 'prompt_cache_retention',
            description: '提示缓存保留策略',
            enum: ['in-memory', '24h'],
            default: 'in-memory',
            component: 'Select'
          },
          safetyIdentifier: {
            type: 'string',
            label: 'safety_identifier',
            description: '安全/审核标识（仅部分端点支持）',
            component: 'Input'
          },
          reasoningEffort: {
            type: 'string',
            label: 'reasoning_effort',
            description: '推理强度（o1 等推理模型可用）',
            enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
            default: 'medium',
            component: 'Select'
          },
          timeout: {
            type: 'number',
            label: '超时时间(ms)',
            description: 'API 请求超时时间（毫秒）',
            min: 1000,
            default: 360000,
            component: 'InputNumber'
          },
          enableTools: {
            type: 'boolean',
            label: '启用工具调用（MCP）',
            description: '开启后自动将 MCP 工具映射为 OpenAI tools 字段',
            default: true,
            component: 'Switch'
          },
          toolChoice: {
            type: 'string',
            label: 'tool_choice',
            description: '工具调用策略：auto / none / 或指定 tool 名',
            default: 'auto',
            component: 'Input'
          },
          parallelToolCalls: {
            type: 'boolean',
            label: 'parallel_tool_calls',
            description: '是否允许模型并行发起多次 tool call',
            default: true,
            component: 'Switch'
          },
          maxToolRounds: {
            type: 'number',
            label: '最大工具轮次',
            description: '多轮 tool calling 的最大轮次',
            min: 1,
            max: 20,
            default: 7,
            component: 'InputNumber'
          },
          enableStream: {
            type: 'boolean',
            label: '启用流式输出',
            description: '开启后使用 SSE 流式返回内容',
            default: true,
            component: 'Switch'
          },
          headers: {
            type: 'object',
            label: '额外请求头',
            description: '可选：为每次请求追加 HTTP 头',
            example: {
              'X-Trace-Id': 'req-123',
              'X-Forwarded-For': '127.0.0.1'
            },
            component: 'SubForm',
            fields: {}
          },
          extraBody: {
            type: 'object',
            label: '额外请求体字段',
            description: '可选：原样合并到请求体顶层（与 OpenAI API 字段一致时才生效）',
            example: {
              user: 'demo-user',
              metadata: { scene: 'dashboard' }
            },
            component: 'SubForm',
            fields: {}
          },
          proxy: {
            type: 'object',
            label: '代理配置',
            description: '仅影响本机到 OpenAI 的 HTTP 请求；支持 http/https/socks5',
            component: 'SubForm',
            fields: {
              enabled: {
                type: 'boolean',
                label: '启用代理',
                default: false,
                component: 'Switch'
              },
              url: {
                type: 'string',
                label: '代理地址',
                description: '例如 http://127.0.0.1:7890 或 http://user:pass@host:port',
                default: '',
                component: 'Input'
              }
            }
          }
        }
      }
    });
  }
}
