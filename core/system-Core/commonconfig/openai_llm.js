import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * OpenAI 官方 LLM 工厂配置管理（文本）
 * 配置文件：data/server_bots/{port}/openai_llm.yaml
 *
 * 字段命名策略：
 * - 配置侧优先使用更“官方”的 model/max_tokens/top_p 等语义
 * - 为兼容项目现有字段，运行时允许使用 maxTokens/topP/chatModel 等别名（由 LLMClient 侧做兼容）
 */
export default class OpenAILLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'openai_llm',
      displayName: 'OpenAI LLM 工厂配置（官方）',
      description: 'OpenAI Chat Completions 配置（文本），支持 MCP 工具调用',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) {
          throw new Error('OpenAILLMConfig: 未提供端口，无法解析路径');
        }
        return `data/server_bots/${port}/openai_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          baseUrl: {
            type: 'string',
            label: 'API 基础地址',
            description: 'OpenAI API 基础地址（默认 https://api.openai.com/v1）',
            default: 'https://api.openai.com/v1',
            component: 'Input'
          },
          apiKey: {
            type: 'string',
            label: 'API Key',
            description: 'OpenAI API Key',
            default: '',
            component: 'InputPassword'
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
            description: 'OpenAI Chat Completions 的 model 字段，例如 gpt-4o-mini',
            default: 'gpt-4o-mini',
            component: 'Input'
          },
          temperature: {
            type: 'number',
            label: '温度（temperature）',
            description: '0-2，越大越随机',
            min: 0,
            max: 2,
            default: 0.7,
            component: 'InputNumber'
          },
          maxTokens: {
            type: 'number',
            label: '最大输出（max_tokens）',
            description: '最大输出 tokens（内部会映射到 max_tokens）',
            min: 1,
            default: 2048,
            component: 'InputNumber'
          },
          topP: {
            type: 'number',
            label: 'Top P（top_p）',
            description: '0-1，核采样参数（内部会映射到 top_p）',
            min: 0,
            max: 1,
            default: 1.0,
            component: 'InputNumber'
          },
          presencePenalty: {
            type: 'number',
            label: 'Presence Penalty（presence_penalty）',
            description: '-2 到 2',
            min: -2,
            max: 2,
            default: 0,
            component: 'InputNumber'
          },
          frequencyPenalty: {
            type: 'number',
            label: 'Frequency Penalty（frequency_penalty）',
            description: '-2 到 2',
            min: -2,
            max: 2,
            default: 0,
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
            description: 'auto/none/required（不同模型支持情况可能不同）',
            default: 'auto',
            component: 'Input'
          },
          parallelToolCalls: {
            type: 'boolean',
            label: '并行工具调用（parallel_tool_calls）',
            description: '是否允许并行 tool calls（若服务端不支持会被忽略）',
            default: true,
            component: 'Switch'
          },
          maxToolRounds: {
            type: 'number',
            label: '最大工具轮次',
            description: '多轮 tool calling 的最大轮次',
            min: 1,
            max: 20,
            default: 5,
            component: 'InputNumber'
          },
          enableStream: {
            type: 'boolean',
            label: '启用流式输出',
            description: '是否启用流式输出（默认启用）',
            default: true,
            component: 'Switch'
          },
          headers: {
            type: 'object',
            label: '额外请求头',
            description: '会合并到请求 headers（高级用法）',
            component: 'SubForm',
            fields: {}
          },
          extraBody: {
            type: 'object',
            label: '额外请求体字段',
            description: '会合并到请求 body 顶层（高级用法）',
            component: 'SubForm',
            fields: {}
          },
          proxy: {
            type: 'object',
            label: '代理配置',
            description: '仅影响本机到 OpenAI 的 HTTP 请求，不修改系统全局代理；支持 http/https/socks5 标准代理地址',
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

