import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * Azure OpenAI 官方 LLM 工厂配置管理（文本）
 * 配置文件：data/server_bots/{port}/azure_openai_llm.yaml
 */
export default class AzureOpenAILLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'azure_openai_llm',
      displayName: 'Azure OpenAI LLM 工厂配置（官方）',
      description: 'Azure OpenAI Chat Completions 配置（deployment + api-version）',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) throw new Error('AzureOpenAILLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/azure_openai_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          baseUrl: {
            type: 'string',
            label: 'Azure Endpoint（baseUrl）',
            description: '例如 https://xxxx.openai.azure.com',
            default: '',
            component: 'Input'
          },
          apiKey: {
            type: 'string',
            label: 'API Key',
            description: 'Azure OpenAI 资源访问密钥（必填），在 Azure 门户的「密钥和终结点」页面可以查看',
            default: '',
            component: 'InputPassword'
          },
          deployment: {
            type: 'string',
            label: 'Deployment（部署名）',
            description: 'Azure OpenAI 部署名（必填）',
            default: '',
            component: 'Input'
          },
          apiVersion: {
            type: 'string',
            label: 'api-version',
            description: 'Azure OpenAI API 版本号，需要与当前环境支持的版本保持一致',
            default: '2024-10-21',
            component: 'Input'
          },
          path: {
            type: 'string',
            label: '接口路径（可选）',
            description: '留空则使用 /openai/deployments/{deployment}/chat/completions',
            default: '',
            component: 'Input'
          },
          temperature: {
            type: 'number',
            label: '温度',
            description: '采样温度，0 越保守、2 越随机，推荐 0.5-1.0',
            min: 0,
            max: 2,
            component: 'InputNumber'
          },
          maxTokens: {
            type: 'number',
            label: '最大 Tokens（max_tokens）',
            description: '单次回答允许使用的最大输出 tokens 数，过大可能被 Azure 拒绝',
            min: 1,
            component: 'InputNumber'
          },
          topP: {
            type: 'number',
            label: 'Top P（top_p）',
            description: '核采样参数，越接近 1 结果越多样，一般与 temperature 二选一调整',
            min: 0,
            max: 1,
            component: 'InputNumber'
          },
          presencePenalty: {
            type: 'number',
            label: 'Presence Penalty',
            description: '存在惩罚（-2~2），>0 时鼓励模型少重复说过的内容',
            min: -2,
            max: 2,
            component: 'InputNumber'
          },
          frequencyPenalty: {
            type: 'number',
            label: 'Frequency Penalty',
            description: '频率惩罚（-2~2），>0 时减少口头禅和高频词复读',
            min: -2,
            max: 2,
            component: 'InputNumber'
          },
          enableTools: {
            type: 'boolean',
            label: '启用工具调用（MCP）',
            description: '开启后会自动把 MCP 工具映射为 Azure tools 字段，需确保部署的模型支持 tool_calls',
            default: true,
            component: 'Switch'
          },
          toolChoice: {
            type: 'string',
            label: '工具选择模式（tool_choice）',
            description: '工具调用模式：auto/none/required 等，含义遵循 Azure Chat Completions 协议',
            default: 'auto',
            component: 'Input'
          },
          parallelToolCalls: {
            type: 'boolean',
            label: '并行工具调用（parallel_tool_calls）',
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
          timeout: {
            type: 'number',
            label: '超时时间(ms)',
            description: '单次调用允许的最大时长，建议不低于 60000，过低可能导致长回复被中断',
            min: 1000,
            default: 360000,
            component: 'InputNumber'
          },
          enableStream: {
            type: 'boolean',
            label: '启用流式输出',
            description: '开启后将使用 stream=true SSE 流式输出增量内容',
            default: true,
            component: 'Switch'
          },
          headers: {
            type: 'object',
            label: '额外请求头',
            description: '可选：为每次请求追加 HTTP 头（通常无需设置）',
            example: {
              'X-Client-Request-Id': 'azure-demo-001'
            },
            component: 'SubForm',
            fields: {}
          },
          extraBody: {
            type: 'object',
            label: '额外请求体字段',
            description: '可选：原样合并到请求体顶层，需符合 Azure OpenAI 官方字段',
            example: {
              user: 'demo-user'
            },
            component: 'SubForm',
            fields: {}
          },
          proxy: {
            type: 'object',
            label: '代理配置',
            description: '仅影响本机到 Azure OpenAI 的 HTTP 请求，不修改系统全局代理；支持 http/https/socks5 标准代理地址',
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

