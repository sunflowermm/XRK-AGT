import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * 火山引擎 LLM 工厂配置管理（文本）
 * 管理火山引擎大语言模型（LLM 文本聊天）相关配置
 * 识图配置已经拆分到 volcengine_vision.yaml / volcengine_vision.js
 * 支持前端编辑，配置文件位于 data/server_bots/{port}/volcengine_llm.yaml
 */
export default class VolcengineLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'volcengine_llm',
      displayName: '火山引擎 LLM 工厂配置（文本）',
      description: '火山引擎豆包大语言模型文本聊天配置',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) {
          throw new Error(`VolcengineLLMConfig: 未提供端口，无法解析路径`);
        }
        return `data/server_bots/${port}/volcengine_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          baseUrl: {
            type: 'string',
            label: 'API 基础地址',
            description: '火山引擎豆包 API 基础地址，通常以 /api/v3 结尾',
            default: 'https://ark.cn-beijing.volces.com/api/v3',
            component: 'Input'
          },
          apiKey: {
            type: 'string',
            label: 'API Key',
            description: '火山引擎 API Key',
            default: '',
            component: 'InputPassword'
          },
          region: {
            type: 'string',
            label: '区域',
            description: '火山引擎服务区域，如 cn-beijing、cn-shanghai',
            default: 'cn-beijing',
            component: 'Input'
          },
          chatModel: {
            type: 'string',
            label: '聊天模型',
            description: '火山引擎聊天模型名称',
            default: 'doubao-pro-4k',
            component: 'Input'
          },
          temperature: {
            type: 'number',
            label: '温度',
            description: '生成文本的随机性，范围 0-2；留空则不下发，由火山引擎使用模型默认值',
            min: 0,
            max: 2,
            component: 'InputNumber'
          },
          maxTokens: {
            type: 'number',
            label: '最大 Tokens',
            description: '生成文本的最大长度；留空则不下发，由火山引擎根据模型上限裁剪',
            min: 1,
            component: 'InputNumber'
          },
          tokenField: {
            type: 'string',
            label: 'Token 字段名',
            description: '上游接口对 token 参数字段的要求；留空则仅在显式传入 max_completion_tokens 时使用该字段',
            enum: ['max_tokens', 'max_completion_tokens', 'both'],
            default: 'max_tokens',
            component: 'Select'
          },
          thinkingType: {
            type: 'string',
            label: '深度思考',
            description: '火山方舟 thinking.type（如 disabled/enabled）',
            enum: ['disabled', 'enabled'],
            default: 'disabled',
            component: 'Select'
          },
          topP: {
            type: 'number',
            label: 'Top P',
            description: '核采样参数，范围 0-1；留空则不下发，由火山引擎使用模型默认值',
            min: 0,
            max: 1,
            component: 'InputNumber'
          },
          presencePenalty: {
            type: 'number',
            label: 'Presence Penalty',
            description: '存在惩罚（-2 到 2），控制模型重复已出现的内容；留空则不下发',
            min: -2,
            max: 2,
            component: 'InputNumber'
          },
          frequencyPenalty: {
            type: 'number',
            label: 'Frequency Penalty',
            description: '频率惩罚（-2 到 2），控制模型重复高频词汇；留空则不下发',
            min: -2,
            max: 2,
            component: 'InputNumber'
          },
          timeout: {
            type: 'number',
            label: '超时时间 (ms)',
            description: 'API 请求超时时间',
            min: 1000,
            default: 360000,
            component: 'InputNumber'
          },
          path: {
            type: 'string',
            label: '接口路径',
            description: 'API 接口路径',
            default: '/chat/completions',
            component: 'Input'
          },
          enableTools: {
            type: 'boolean',
            label: '启用工具调用',
            description: '开启后会自动注入 MCP 工具列表（无需手写 tools）',
            default: true,
            component: 'Switch'
          },
          toolChoice: {
            type: 'string',
            label: '工具选择模式',
            description: 'tool_choice（auto/none/required），豆包支持',
            default: 'auto',
            component: 'Input'
          },
          parallelToolCalls: {
            type: 'boolean',
            label: '并行工具调用',
            description: 'parallel_tool_calls（豆包支持）',
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
            description: '是否启用流式输出（默认启用，所有运营商均支持）',
            default: true,
            component: 'Switch'
          },
          headers: {
            type: 'object',
            label: '额外请求头',
            description: '可选：为每次请求追加 HTTP 头',
            example: {
              'X-Request-From': 'xrk-agt'
            },
            component: 'SubForm',
            fields: {}
          },
          extraBody: {
            type: 'object',
            label: '额外请求体字段',
            description: '可选：原样合并到请求体顶层，需符合豆包 API 字段',
            example: {
              user: 'demo-user',
              metadata: { channel: 'xrk' }
            },
            component: 'SubForm',
            fields: {}
          },
          proxy: {
            type: 'object',
            label: '代理配置',
            description: '仅影响本机到火山引擎的 HTTP 请求，不修改系统全局代理；支持 http/https/socks5 标准代理地址',
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

