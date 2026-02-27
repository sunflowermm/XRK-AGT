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
              key: { type: 'string', label: '运营商标识（provider/model）', default: '', component: 'Input' },
              label: { type: 'string', label: '展示名称', default: '', component: 'Input' },
              protocol: { type: 'string', label: '协议类型', enum: ['azure-openai'], default: 'azure-openai', component: 'Select' },
              baseUrl: { type: 'string', label: 'API 基础地址', default: '', component: 'Input' },
              path: { type: 'string', label: '接口路径（可选）', default: '', component: 'Input' },
              deployment: { type: 'string', label: '部署名（deployment）', default: '', component: 'Input' },
              apiVersion: { type: 'string', label: 'API Version', default: '2024-10-21', component: 'Input' },
              apiKey: { type: 'string', label: 'API Key', default: '', component: 'InputPassword' },
              model: { type: 'string', label: '模型别名（可选）', default: '', component: 'Input' },
              temperature: { type: 'number', label: '温度', min: 0, max: 2, default: 0.7, component: 'InputNumber' },
              maxTokens: { type: 'number', label: '最大输出（max_tokens）', min: 1, default: 4096, component: 'InputNumber' },
              topP: { type: 'number', label: 'Top P', min: 0, max: 1, default: 1, component: 'InputNumber' },
              timeout: { type: 'number', label: '超时(ms)', min: 1000, default: 360000, component: 'InputNumber' },
              enableTools: { type: 'boolean', label: '启用工具调用', default: true, component: 'Switch' },
              maxToolRounds: { type: 'number', label: '最大工具轮次', min: 1, max: 20, default: 7, component: 'InputNumber' },
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
