import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * Cherryin 协议兼容 LLM 工厂配置（多运营商）
 * 配置文件：data/server_bots/{port}/cherryin_compat_llm.yaml
 */
export default class CherryINCompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'cherryin_compat_llm',
      displayName: 'CherryIN 协议兼容 LLM 工厂',
      description: 'CherryIN / OpenAI-like 兼容运营商集合配置',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) throw new Error('CherryINCompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/cherryin_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: {
            type: 'array',
            label: 'CherryIN 兼容运营商列表',
            component: 'ArrayForm',
            itemType: 'object',
            fields: {
              key: {
                type: 'string',
                label: '运营商标识（provider/model）',
                description: '用于 aistream.llm.Provider 或前端下拉中引用的唯一 key，例如 cherryin-main',
                default: '',
                component: 'Input'
              },
              label: {
                type: 'string',
                label: '展示名称',
                description: '给用户看的名称，例如「CherryIN 网关」',
                default: '',
                component: 'Input'
              },
              protocol: {
                type: 'string',
                label: '协议类型',
                description: '固定为 cherryin，表示使用 CherryIN / OpenAI-like 兼容协议',
                enum: ['cherryin'],
                default: 'cherryin',
                component: 'Select'
              },
              baseUrl: {
                type: 'string',
                label: 'API 基础地址',
                description: 'CherryIN / 兼容网关基础地址，通常以 /v1 结尾',
                default: '',
                component: 'Input'
              },
              path: {
                type: 'string',
                label: '接口路径',
                description: '默认 /chat/completions（基础地址建议包含 /v1）',
                default: '/chat/completions',
                component: 'Input'
              },
              apiKey: {
                type: 'string',
                label: 'API Key',
                description: 'CherryIN 或兼容网关颁发的密钥',
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
                description: '下游实际模型标识，由 CherryIN 控制台决定',
                default: '',
                component: 'Input'
              },
              temperature: {
                type: 'number',
                label: '温度（temperature）',
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
                label: '超时时间 (ms)',
                description: '单次调用允许的最大时长，建议不低于 60000',
                min: 1000,
                default: 360000,
                component: 'InputNumber'
              },
              enableTools: {
                type: 'boolean',
                label: '启用工具调用（MCP）',
                description: '开启后会自动把 MCP 工具注入给该运营商支持的模型，无需手动写 tools',
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
                description: '开启后使用 SSE 流式返回',
                default: true,
                component: 'Switch'
              },
              headers: { 
                type: 'object', 
                label: '额外请求头',
                description: '可选：为 CherryIN 接口追加 HTTP 头',
                example: { 'X-Channel': 'xrk-cherry' },
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
