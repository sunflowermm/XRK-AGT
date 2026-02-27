import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

export default class OllamaCompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'ollama_compat_llm',
      displayName: 'Ollama 协议兼容 LLM 工厂',
      description: 'Ollama 原生 Chat API (/api/chat) 运营商集合配置',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) throw new Error('OllamaCompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/ollama_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: {
            type: 'array',
            label: 'Ollama 兼容运营商列表',
            component: 'ArrayForm',
            itemType: 'object',
            fields: {
              key: { type: 'string', label: '运营商标识（provider/model）', default: '', component: 'Input' },
              label: { type: 'string', label: '展示名称', default: '', component: 'Input' },
              protocol: { type: 'string', label: '协议类型', enum: ['ollama'], default: 'ollama', component: 'Select' },
              baseUrl: { type: 'string', label: 'API 基础地址', default: 'http://127.0.0.1:11434', component: 'Input' },
              path: { type: 'string', label: '接口路径', default: '/api/chat', component: 'Input' },
              apiKey: { type: 'string', label: 'API Key（可选）', default: '', component: 'InputPassword' },
              authMode: { type: 'string', label: '认证方式', enum: ['bearer', 'api-key', 'header'], default: 'bearer', component: 'Select' },
              authHeaderName: { type: 'string', label: '自定义认证头名', default: '', component: 'Input' },
              model: { type: 'string', label: '模型（model）', default: 'qwen2.5:latest', component: 'Input' },
              temperature: { type: 'number', label: '温度（temperature）', min: 0, max: 2, default: 0.7, component: 'InputNumber' },
              maxTokens: { type: 'number', label: '最大输出（max_tokens）', min: 1, default: 4096, component: 'InputNumber' },
              timeout: { type: 'number', label: '超时时间 (ms)', min: 1000, default: 360000, component: 'InputNumber' },
              enableTools: { type: 'boolean', label: '启用工具调用（MCP）', default: true, component: 'Switch' },
              maxToolRounds: { type: 'number', label: '最大工具轮次', min: 1, max: 20, default: 7, component: 'InputNumber' },
              enableStream: { type: 'boolean', label: '启用流式输出', default: true, component: 'Switch' },
              headers: { 
                type: 'object', 
                label: '额外请求头', 
                description: '可选：为下游 Ollama 接口追加 HTTP 头',
                example: { 'X-Client-Id': 'xrk-ollama' },
                component: 'SubForm', 
                fields: {} 
              },
              extraBody: { 
                type: 'object', 
                label: '额外请求体字段', 
                description: '可选：原样合并到 Ollama /api/chat 请求体',
                example: { options: { temperature: 0.3 } },
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
