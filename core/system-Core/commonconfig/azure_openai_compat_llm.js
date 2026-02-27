import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

export default class AzureOpenAICompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'azure_openai_compat_llm',
      displayName: 'Azure OpenAI 协议兼容 LLM 工厂',
      description: 'Azure OpenAI Chat Completions 协议运营商集合配置',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) throw new Error('AzureOpenAICompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/azure_openai_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: {
            type: 'array',
            label: 'Azure OpenAI 协议运营商列表',
            component: 'ArrayForm',
            itemType: 'object',
            fields: {
              key: {
                type: 'string',
                label: '运营商标识（provider/model）',
                description: '用于 aistream.llm.Provider 或前端下拉中引用的唯一 key，例如 azure-gpt4、azure-internal',
                default: '',
                component: 'Input'
              },
              label: {
                type: 'string',
                label: '展示名称',
                description: '给用户看的名称，例如「Azure GPT-4o（东亚）」',
                default: '',
                component: 'Input'
              },
              protocol: {
                type: 'string',
                label: '协议类型',
                description: '固定为 azure-openai，表示使用 Azure Chat Completions 协议',
                enum: ['azure-openai'],
                default: 'azure-openai',
                component: 'Select'
              },
              baseUrl: {
                type: 'string',
                label: 'API 基础地址',
                description: 'Azure Endpoint，例如 https://xxx.openai.azure.com',
                default: '',
                component: 'Input'
              },
              path: {
                type: 'string',
                label: '接口路径（可选）',
                description: '留空则使用 /openai/deployments/{deployment}/chat/completions',
                default: '',
                component: 'Input'
              },
              deployment: {
                type: 'string',
                label: '部署名（deployment）',
                description: 'Azure OpenAI 部署名，必填，例如 gpt-4o-mini',
                default: '',
                component: 'Input'
              },
              apiVersion: {
                type: 'string',
                label: 'API Version',
                description: '例如 2024-10-21，需与当前环境支持的版本一致',
                default: '2024-10-21',
                component: 'Input'
              },
              apiKey: {
                type: 'string',
                label: 'API Key',
                description: 'Azure OpenAI 资源的访问密钥',
                default: '',
                component: 'InputPassword'
              },
              model: {
                type: 'string',
                label: '模型别名（可选）',
                description: '可选的人类可读别名，用于 UI 展示或调试日志',
                default: '',
                component: 'Input'
              },
              temperature: {
                type: 'number',
                label: '温度',
                description: '采样温度，0 越保守、2 越随机，推荐 0.5-1.0',
                min: 0,
                max: 2,
                default: 0.7,
                component: 'InputNumber'
              },
              maxTokens: {
                type: 'number',
                label: '最大输出（max_tokens）',
                description: '单次回答允许使用的最大输出 tokens 数，过大可能被拒绝',
                min: 1,
                default: 4096,
                component: 'InputNumber'
              },
              topP: {
                type: 'number',
                label: 'Top P',
                description: '核采样参数，越接近 1 结果越多样，一般与 temperature 二选一调整',
                min: 0,
                max: 1,
                default: 1,
                component: 'InputNumber'
              },
              timeout: {
                type: 'number',
                label: '超时(ms)',
                description: '单次调用允许的最大时长，建议不低于 60000',
                min: 1000,
                default: 360000,
                component: 'InputNumber'
              },
              enableTools: {
                type: 'boolean',
                label: '启用工具调用',
                description: '开启后会自动把 MCP 工具注入，依赖 Azure 对 tools 的支持',
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
                description: '开启后使用 stream=true SSE 流式返回',
                default: true,
                component: 'Switch'
              },
              headers: { 
                type: 'object', 
                label: '额外请求头',
                description: '可选：为 Azure OpenAI 接口追加 HTTP 头',
                example: { 'X-Client-Request-Id': 'xrk-azure-compat' },
                component: 'SubForm', 
                fields: {} 
              },
              extraBody: { 
                type: 'object', 
                label: '额外请求体字段',
                description: '可选：原样合并到请求体顶层',
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
