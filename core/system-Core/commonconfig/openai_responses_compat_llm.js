import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * OpenAI Responses 协议兼容 LLM 工厂配置（多运营商）
 * 配置文件：data/server_bots/{port}/openai_responses_compat_llm.yaml
 */
export default class OpenAIResponsesCompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'openai_responses_compat_llm',
      displayName: 'OpenAI Responses 协议兼容 LLM 工厂',
      description: 'OpenAI Responses 协议运营商集合配置，支持多运营商与 MCP 工具调用',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) throw new Error('OpenAIResponsesCompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/openai_responses_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: {
            type: 'array',
            label: 'Responses 协议运营商列表',
            component: 'ArrayForm',
            itemType: 'object',
            fields: {
              key: { type: 'string', label: '运营商标识（provider/model）', default: '', component: 'Input' },
              label: { type: 'string', label: '展示名称', default: '', component: 'Input' },
              protocol: {
                type: 'string',
                label: '协议类型（protocol / 工厂类型）',
                description: '固定为 openai-response',
                enum: ['openai-response'],
                default: 'openai-response',
                component: 'Select'
              },
              baseUrl: {
                type: 'string',
                label: 'API 基础地址',
                description: '例如：https://api.openai.com/v1（官方）或任意 Responses 兼容代理地址（建议包含 /v1）',
                default: '',
                component: 'Input'
              },
              path: {
                type: 'string',
                label: '接口路径',
                description: '官方默认 /responses（基础地址已包含 /v1）',
                default: '/responses',
                component: 'Input'
              },
              apiKey: { type: 'string', label: 'API Key', default: '', component: 'InputPassword' },
              authMode: {
                type: 'string',
                label: '认证方式',
                enum: ['bearer', 'api-key', 'header'],
                default: 'bearer',
                component: 'Select'
              },
              authHeaderName: { type: 'string', label: '自定义认证头名', default: '', component: 'Input' },
              model: { type: 'string', label: '模型（model）', default: '', component: 'Input' },
              instructions: { type: 'string', label: 'instructions', default: '', component: 'Input' },
              temperature: { type: 'number', label: 'temperature', min: 0, max: 2, default: 0.7, component: 'InputNumber' },
              maxOutputTokens: { type: 'number', label: 'max_output_tokens', min: 1, default: 4096, component: 'InputNumber' },
              topP: { type: 'number', label: 'top_p', min: 0, max: 1, default: 1.0, component: 'InputNumber' },
              serviceTier: { type: 'string', label: 'service_tier', enum: ['auto', 'default', 'flex', 'scale', 'priority'], default: 'auto', component: 'Select' },
              promptCacheKey: { type: 'string', label: 'prompt_cache_key', default: '', component: 'Input' },
              promptCacheRetention: { type: 'string', label: 'prompt_cache_retention', enum: ['in-memory', '24h'], default: 'in-memory', component: 'Select' },
              safetyIdentifier: { type: 'string', label: 'safety_identifier', default: '', component: 'Input' },
              maxToolCalls: { type: 'number', label: 'max_tool_calls', min: 1, default: 20, component: 'InputNumber' },
              timeout: { type: 'number', label: '超时时间(ms)', min: 1000, default: 360000, component: 'InputNumber' },
              enableTools: { type: 'boolean', label: '启用工具调用（MCP）', default: true, component: 'Switch' },
              toolChoice: { type: 'string', label: 'tool_choice', default: 'auto', component: 'Input' },
              parallelToolCalls: { type: 'boolean', label: 'parallel_tool_calls', default: true, component: 'Switch' },
              maxToolRounds: { type: 'number', label: '最大工具轮次', min: 1, max: 20, default: 7, component: 'InputNumber' },
              headers: { 
                type: 'object', 
                label: '额外请求头',
                description: '可选：为 Responses 请求追加 HTTP 头',
                example: { 'X-Trace-Id': 'resp-123' },
                component: 'SubForm', 
                fields: {} 
              },
              extraBody: { 
                type: 'object', 
                label: '额外请求体字段',
                description: '可选：原样合并到 Responses 请求体顶层',
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
