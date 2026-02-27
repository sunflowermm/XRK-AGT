import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

export default class GeminiCompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'gemini_compat_llm',
      displayName: 'Gemini 协议兼容 LLM 工厂',
      description: 'Gemini generateContent/streamGenerateContent 协议运营商集合配置',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) throw new Error('GeminiCompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/gemini_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: {
            type: 'array',
            label: 'Gemini 协议运营商列表',
            component: 'ArrayForm',
            itemType: 'object',
            fields: {
              key: { type: 'string', label: '运营商标识（provider/model）', default: '', component: 'Input' },
              label: { type: 'string', label: '展示名称', default: '', component: 'Input' },
              protocol: { type: 'string', label: '协议类型', enum: ['gemini'], default: 'gemini', component: 'Select' },
              baseUrl: { type: 'string', label: 'API 基础地址', default: 'https://generativelanguage.googleapis.com', component: 'Input' },
              path: { type: 'string', label: '接口路径', default: '/v1beta/models/gemini-1.5-flash:generateContent', component: 'Input' },
              apiKey: { type: 'string', label: 'API Key', default: '', component: 'InputPassword' },
              model: { type: 'string', label: '模型名', default: 'gemini-1.5-flash', component: 'Input' },
              temperature: { type: 'number', label: '温度', min: 0, max: 2, default: 0.7, component: 'InputNumber' },
              maxTokens: { type: 'number', label: '最大输出（maxOutputTokens）', min: 1, default: 2048, component: 'InputNumber' },
              topP: { type: 'number', label: 'Top P', min: 0, max: 1, default: 1, component: 'InputNumber' },
              topK: { type: 'number', label: 'Top K', min: 1, default: 40, component: 'InputNumber' },
              timeout: { type: 'number', label: '超时(ms)', min: 1000, default: 360000, component: 'InputNumber' },
              enableStream: { type: 'boolean', label: '启用流式', default: true, component: 'Switch' },
              headers: { 
                type: 'object', 
                label: '额外请求头',
                description: '可选：为 Gemini 接口追加 HTTP 头',
                example: { 'X-Referer': 'xrk-agt-console' },
                component: 'SubForm', 
                fields: {} 
              },
              extraBody: { 
                type: 'object', 
                label: '额外请求体字段',
                description: '可选：原样合并到 generateContent 请求体顶层',
                example: { systemInstruction: { parts: [{ text: '你是一个严谨的助手。' }], role: 'user' } },
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
