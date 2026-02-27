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
              key: { type: 'string', label: '运营商标识（provider/model）', default: '', component: 'Input' },
              label: { type: 'string', label: '展示名称', default: '', component: 'Input' },
              protocol: { type: 'string', label: '协议类型', enum: ['anthropic'], default: 'anthropic', component: 'Select' },
              baseUrl: { type: 'string', label: 'API 基础地址', default: 'https://api.anthropic.com/v1', component: 'Input' },
              path: { type: 'string', label: '接口路径', default: '/messages', component: 'Input' },
              apiKey: { type: 'string', label: 'API Key', default: '', component: 'InputPassword' },
              anthropicVersion: { type: 'string', label: 'Anthropic Version', default: '2023-06-01', component: 'Input' },
              model: { type: 'string', label: '模型名', default: 'claude-3-5-sonnet-latest', component: 'Input' },
              temperature: { type: 'number', label: '温度', min: 0, max: 2, default: 0.7, component: 'InputNumber' },
              maxTokens: { type: 'number', label: '最大输出（max_tokens）', min: 1, default: 2048, component: 'InputNumber' },
              timeout: { type: 'number', label: '超时(ms)', min: 1000, default: 360000, component: 'InputNumber' },
              enableStream: { type: 'boolean', label: '启用流式', default: true, component: 'Switch' },
              headers: { type: 'object', label: '额外请求头', component: 'SubForm', fields: {} },
              extraBody: { type: 'object', label: '额外请求体字段', component: 'SubForm', fields: {} },
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
