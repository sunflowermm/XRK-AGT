import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * OpenAI 兼容第三方 LLM 工厂配置管理（文本）
 * 配置文件：data/server_bots/{port}/openai_compat_llm.yaml
 *
 * 适用：任何“OpenAI Chat Completions 协议”兼容服务
 * - 可自定义 baseUrl/path/认证方式/额外参数
 * - 支持 MCP 工具调用（OpenAI tools/tool_calls 协议）
 */
export default class OpenAICompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'openai_compat_llm',
      displayName: 'OpenAI 兼容 LLM 工厂配置（第三方）',
      description: '第三方 OpenAI-like Chat Completions 配置（文本），支持 MCP 工具调用',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) {
          throw new Error('OpenAICompatibleLLMConfig: 未提供端口，无法解析路径');
        }
        return `data/server_bots/${port}/openai_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          baseUrl: {
            type: 'string',
            label: 'API 基础地址',
            description: '第三方 API 基础地址（必须），例如 https://api.example.com/v1',
            default: '',
            component: 'Input'
          },
          apiKey: {
            type: 'string',
            label: 'API Key',
            description: '第三方 API Key',
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
            description: 'authMode=header 时生效，例如 X-Api-Key',
            default: '',
            component: 'Input'
          },
          path: {
            type: 'string',
            label: '接口路径',
            description: 'Chat Completions 路径，默认 /chat/completions',
            default: '/chat/completions',
            component: 'Input'
          },
          model: {
            type: 'string',
            label: '模型（model）',
            description: '第三方模型名称（下游要求的 model 字段）',
            default: '',
            component: 'Input'
          },
          temperature: {
            type: 'number',
            label: '温度（temperature）',
            min: 0,
            max: 2,
            default: 0.7,
            component: 'InputNumber'
          },
          maxTokens: {
            type: 'number',
            label: '最大输出（max_tokens）',
            description: '内部会映射到 max_tokens（若下游不支持可能会忽略）',
            min: 1,
            default: 2048,
            component: 'InputNumber'
          },
          topP: {
            type: 'number',
            label: 'Top P（top_p）',
            min: 0,
            max: 1,
            default: 1.0,
            component: 'InputNumber'
          },
          presencePenalty: {
            type: 'number',
            label: 'Presence Penalty（presence_penalty）',
            min: -2,
            max: 2,
            default: 0,
            component: 'InputNumber'
          },
          frequencyPenalty: {
            type: 'number',
            label: 'Frequency Penalty（frequency_penalty）',
            min: -2,
            max: 2,
            default: 0,
            component: 'InputNumber'
          },
          timeout: {
            type: 'number',
            label: '超时时间 (ms)',
            min: 1000,
            default: 360000,
            component: 'InputNumber'
          },
          enableTools: {
            type: 'boolean',
            label: '启用工具调用（MCP）',
            description: '开启后会自动注入 MCP 工具列表（OpenAI tools/tool_calls）',
            default: true,
            component: 'Switch'
          },
          toolChoice: {
            type: 'string',
            label: '工具选择模式（tool_choice）',
            default: 'auto',
            component: 'Input'
          },
          parallelToolCalls: {
            type: 'boolean',
            label: '并行工具调用（parallel_tool_calls）',
            default: true,
            component: 'Switch'
          },
          maxToolRounds: {
            type: 'number',
            label: '最大工具轮次',
            min: 1,
            max: 20,
            default: 5,
            component: 'InputNumber'
          },
          enableStream: {
            type: 'boolean',
            label: '启用流式输出',
            default: true,
            component: 'Switch'
          },
          headers: {
            type: 'object',
            label: '额外请求头',
            component: 'SubForm',
            fields: {}
          },
          extraBody: {
            type: 'object',
            label: '额外请求体字段',
            description: '原样合并到请求 body 顶层（用于第三方扩展字段）',
            component: 'SubForm',
            fields: {}
          },
          proxy: {
            type: 'object',
            label: '代理配置',
            description: '仅影响本机到第三方 OpenAI 兼容接口的 HTTP 请求，不修改系统全局代理；支持 http/https/socks5 标准代理地址',
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
                description: '例如：http://127.0.0.1:7890 或 http://user:pass@host:port',
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

