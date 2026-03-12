import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

export default class AnthropicCompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'anthropic_compat_llm',
      displayName: 'Anthropic 协议兼容 LLM 工厂',
      description: 'Anthropic Messages 协议运营商集合配置',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) throw new Error('AnthropicCompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/anthropic_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: {
            type: 'array',
            label: 'Anthropic 协议运营商列表',
            component: 'ArrayForm',
            itemType: 'object',
            fields: {
              key: {
                type: 'string',
                label: '运营商标识（provider/model）',
                description: '用于 aistream.llm.Provider 或前端下拉中引用的唯一 key，例如 anthropic-official、anthropic-proxy',
                default: '',
                component: 'Input'
              },
              label: {
                type: 'string',
                label: '展示名称',
                description: '给用户看的名称，例如「Claude 官方」或「公司内部 Claude 网关」',
                default: '',
                component: 'Input'
              },
              protocol: {
                type: 'string',
                label: '协议类型',
                description: '固定为 anthropic，表示使用 Messages 协议而非 OpenAI Chat',
                enum: ['anthropic'],
                default: 'anthropic',
                component: 'Select'
              },
              baseUrl: {
                type: 'string',
                label: 'API 基础地址',
                description: 'Anthropic Messages API 基础地址，官方为 https://api.anthropic.com/v1',
                default: 'https://api.anthropic.com/v1',
                component: 'Input'
              },
              path: {
                type: 'string',
                label: '接口路径',
                description: 'Messages 路径，官方默认 /messages',
                default: '/messages',
                component: 'Input'
              },
              apiKey: {
                type: 'string',
                label: 'API Key',
                description: 'Claude API Key 或兼容网关密钥',
                default: '',
                component: 'InputPassword'
              },
              anthropicVersion: {
                type: 'string',
                label: 'Anthropic Version',
                description: '请求头 anthropic-version 的值，需与官方文档支持的版本匹配',
                default: '2023-06-01',
                component: 'Input'
              },
              model: {
                type: 'string',
                label: '模型名',
                description: 'Claude 模型名称，例如 claude-3-5-sonnet-latest',
                default: 'claude-3-5-sonnet-latest',
                component: 'Input'
              },
              temperature: {
                type: 'number',
                label: '温度',
                description: '采样温度，0 越保守、2 越随机；留空则不下发，由下游默认',
                min: 0,
                max: 2,
                component: 'InputNumber'
              },
              maxTokens: {
                type: 'number',
                label: '最大输出（max_tokens）',
                description: '单次回答允许使用的最大输出 tokens 数；留空则不下发，由下游根据模型上限处理',
                min: 1,
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
              enableStream: {
                type: 'boolean',
                label: '启用流式',
                description: '开启后使用 SSE 流式返回 Claude 增量输出',
                default: true,
                component: 'Switch'
              },
              headers: { 
                type: 'object', 
                label: '额外请求头',
                description: '可选：为 Anthropic Messages 接口追加 HTTP 头',
                example: { 'X-Trace-Id': 'anth-compat-001' },
                component: 'SubForm', 
                fields: {} 
              },
              extraBody: { 
                type: 'object', 
                label: '额外请求体字段',
                description: '可选：原样合并到 Messages 请求体顶层',
                example: { metadata: { project: 'demo' } },
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
