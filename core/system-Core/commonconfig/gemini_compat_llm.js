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
              key: {
                type: 'string',
                label: '运营商标识（provider/model）',
                description: '用于 aistream.llm.Provider 或前端下拉中引用的唯一 key，例如 gemini-official、gemini-proxy',
                default: '',
                component: 'Input'
              },
              label: {
                type: 'string',
                label: '展示名称',
                description: '给用户看的名称，例如「Gemini 官方」或「Gemini 代理」',
                default: '',
                component: 'Input'
              },
              protocol: {
                type: 'string',
                label: '协议类型',
                description: '固定为 gemini，表示使用 generateContent/streamGenerateContent 协议',
                enum: ['gemini'],
                default: 'gemini',
                component: 'Select'
              },
              baseUrl: {
                type: 'string',
                label: 'API 基础地址',
                description: 'Generative Language API 基础地址，官方为 https://generativelanguage.googleapis.com',
                default: 'https://generativelanguage.googleapis.com',
                component: 'Input'
              },
              path: {
                type: 'string',
                label: '接口路径',
                description: '完整的生成接口路径，例如 /v1beta/models/gemini-1.5-flash:generateContent',
                default: '/v1beta/models/gemini-1.5-flash:generateContent',
                component: 'Input'
              },
              apiKey: {
                type: 'string',
                label: 'API Key',
                description: 'Google Generative Language API Key 或兼容网关密钥',
                default: '',
                component: 'InputPassword'
              },
              model: {
                type: 'string',
                label: '模型名',
                description: 'Gemini 模型名称，例如 gemini-1.5-flash、gemini-2.0-flash-exp',
                default: 'gemini-1.5-flash',
                component: 'Input'
              },
              temperature: {
                type: 'number',
                label: '温度',
                description: 'generationConfig.temperature：0 越保守、2 越随机；留空则不下发，由下游默认',
                min: 0,
                max: 2,
                component: 'InputNumber'
              },
              maxTokens: {
                type: 'number',
                label: '最大输出（maxOutputTokens）',
                description: 'generationConfig.maxOutputTokens，单次回答的最大 token 数；留空则不下发，由下游根据模型上限处理',
                min: 1,
                component: 'InputNumber'
              },
              topP: {
                type: 'number',
                label: 'Top P',
                description: 'generationConfig.topP，核采样参数；留空则不下发',
                min: 0,
                max: 1,
                component: 'InputNumber'
              },
              topK: {
                type: 'number',
                label: 'Top K',
                description: 'generationConfig.topK，高级采样参数；0 为使用默认',
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
                description: '开启后将使用 streamGenerateContent 流式接口（若支持）',
                default: true,
                component: 'Switch'
              },
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
