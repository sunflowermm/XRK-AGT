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
            min: 0,
            max: 2,
            default: 0.7,
            component: 'InputNumber'
          },
          maxTokens: {
            type: 'number',
            label: '最大 Tokens（max_tokens）',
            min: 1,
            default: 2048,
            component: 'InputNumber'
          },
          topP: {
            type: 'number',
            label: 'Top P（top_p）',
            min: 0,
            max: 1,
            default: 1,
            component: 'InputNumber'
          },
          presencePenalty: {
            type: 'number',
            label: 'Presence Penalty',
            min: -2,
            max: 2,
            default: 0,
            component: 'InputNumber'
          },
          frequencyPenalty: {
            type: 'number',
            label: 'Frequency Penalty',
            min: -2,
            max: 2,
            default: 0,
            component: 'InputNumber'
          },
          enableTools: {
            type: 'boolean',
            label: '启用工具调用（MCP）',
            default: true,
            component: 'Switch'
          },
          toolChoice: {
            type: 'string',
            label: '工具选择模式（tool_choice）',
            default: 'auto',
            component: 'Input'
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

