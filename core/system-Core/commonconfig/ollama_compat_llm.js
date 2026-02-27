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
              key: {
                type: 'string',
                label: '运营商标识（provider/model）',
                description: '用于 aistream.llm.Provider 或前端下拉中引用的唯一 key，例如 ollama-local、ollama-remote',
                default: '',
                component: 'Input'
              },
              label: {
                type: 'string',
                label: '展示名称',
                description: '给用户看的名称，例如「本机 Ollama」或「Ollama 代理」',
                default: '',
                component: 'Input'
              },
              protocol: {
                type: 'string',
                label: '协议类型',
                description: '固定为 ollama，表示调用原生 /api/chat 接口',
                enum: ['ollama'],
                default: 'ollama',
                component: 'Select'
              },
              baseUrl: {
                type: 'string',
                label: 'API 基础地址',
                description: 'Ollama 服务地址，默认本机 http://127.0.0.1:11434',
                default: 'http://127.0.0.1:11434',
                component: 'Input'
              },
              path: {
                type: 'string',
                label: '接口路径',
                description: 'Ollama 原生聊天接口路径，默认为 /api/chat',
                default: '/api/chat',
                component: 'Input'
              },
              apiKey: {
                type: 'string',
                label: 'API Key（可选）',
                description: '仅当你在前置代理中启用了认证时需要设置；原生本机 Ollama 一般留空',
                default: '',
                component: 'InputPassword'
              },
              authMode: {
                type: 'string',
                label: '认证方式',
                description: 'bearer=Authorization: Bearer；api-key=api-key 头；header=自定义头名',
                enum: ['bearer', 'api-key', 'header'],
                default: 'bearer',
                component: 'Select'
              },
              authHeaderName: {
                type: 'string',
                label: '自定义认证头名',
                description: '当 authMode=header 时使用该头名携带 API Key，例如 X-Api-Key',
                default: '',
                component: 'Input'
              },
              model: {
                type: 'string',
                label: '模型（model）',
                description: 'Ollama 模型名称，例如 qwen2.5:latest、llama3.1:8b 等',
                default: 'qwen2.5:latest',
                component: 'Input'
              },
              temperature: {
                type: 'number',
                label: '温度（temperature）',
                description: '采样温度，0 越保守、2 越随机，推荐 0.5-1.0',
                min: 0,
                max: 2,
                default: 0.7,
                component: 'InputNumber'
              },
              maxTokens: {
                type: 'number',
                label: '最大输出（max_tokens）',
                description: '单次回答允许使用的最大输出 tokens 数，过大可能影响性能',
                min: 1,
                default: 4096,
                component: 'InputNumber'
              },
              timeout: {
                type: 'number',
                label: '超时时间 (ms)',
                description: '单次调用允许的最大时长，推荐 ≥60000',
                min: 1000,
                default: 360000,
                component: 'InputNumber'
              },
              enableTools: {
                type: 'boolean',
                label: '启用工具调用（MCP）',
                description: '开启后会尝试将 MCP 工具映射为 Ollama 的 tools 字段（需模型支持）',
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
                label: '启用流式输出',
                description: '开启后使用 Ollama 的流式响应，将增量内容透传到前端',
                default: true,
                component: 'Switch'
              },
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
