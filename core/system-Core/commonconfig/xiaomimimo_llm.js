import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * 小米 MiMo LLM 工厂配置管理
 * 管理小米 MiMo 大语言模型（仅文本）相关配置
 * 支持前端编辑，配置文件位于 data/server_bots/{port}/xiaomimimo_llm.yaml
 */
export default class XiaomiMiMoLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'xiaomimimo_llm',
      displayName: '小米 MiMo LLM 工厂配置',
      description: '小米 MiMo 大语言模型配置（仅文本，无识图逻辑）',
      filePath: (cfg) => {
        const port = cfg?._port ?? cfg?.server?.server?.port;
        if (!port) {
          throw new Error('XiaomiMiMoLLMConfig: 未提供端口，无法解析路径');
        }
        return `data/server_bots/${port}/xiaomimimo_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          baseUrl: {
            type: 'string',
            label: 'API 基础地址',
            description: '小米 MiMo OpenAI 兼容 API 基础地址',
            default: 'https://api.xiaomimimo.com/v1',
            component: 'Input'
          },
          authMode: {
            type: 'string',
            label: '认证方式',
            description: '选择使用 api-key 头或 Authorization: Bearer 头进行认证',
            enum: ['api-key', 'bearer'],
            default: 'api-key',
            component: 'Select'
          },
          apiKey: {
            type: 'string',
            label: 'API Key',
            description: '小米 MiMo API Key（通过控制台创建）',
            default: '',
            component: 'InputPassword'
          },
          chatModel: {
            type: 'string',
            label: '聊天模型',
            description: '用于文本对话的模型名称，例如 mimo-v2-flash',
            default: 'mimo-v2-flash',
            component: 'Input'
          },
          temperature: {
            type: 'number',
            label: '温度',
            description: '生成文本的随机性，范围 0-2，建议 0.0~1.0',
            min: 0,
            max: 2,
            default: 0.3,
            component: 'InputNumber'
          },
          maxTokens: {
            type: 'number',
            label: '最大 Tokens',
            description: '单次回复的最大 Token 数（最终会映射到 max_completion_tokens）',
            min: 1,
            default: 1024,
            component: 'InputNumber'
          },
          topP: {
            type: 'number',
            label: 'Top P',
            description: '核采样参数，范围 0-1',
            min: 0,
            max: 1,
            default: 0.95,
            component: 'InputNumber'
          },
          frequencyPenalty: {
            type: 'number',
            label: 'Frequency Penalty',
            description: '频率惩罚（-2 到 2），用于减少重复内容',
            min: -2,
            max: 2,
            default: 0,
            component: 'InputNumber'
          },
          presencePenalty: {
            type: 'number',
            label: 'Presence Penalty',
            description: '存在惩罚（-2 到 2），用于鼓励引入新话题',
            min: -2,
            max: 2,
            default: 0,
            component: 'InputNumber'
          },
          stop: {
            type: 'array',
            label: '停止词',
            description: '停止词列表，当生成包含这些词时停止',
            itemType: 'string',
            default: [],
            component: 'Input'
          },
          thinkingType: {
            type: 'string',
            label: '思维链模式',
            description: '控制是否启用思维链（thinking.type），默认 disabled',
            enum: ['enabled', 'disabled'],
            default: 'disabled',
            component: 'Select'
          },
          response_format: {
            type: 'string',
            label: '响应格式',
            description: '响应格式，如 json_object',
            default: '',
            component: 'Input'
          },
          toolChoice: {
            type: 'string',
            label: '工具选择模式',
            description: 'tool_choice 字段，目前官方仅支持 auto',
            default: 'auto',
            component: 'Input'
          },
          timeout: {
            type: 'number',
            label: '超时时间 (ms)',
            description: 'API 请求超时时间',
            min: 1000,
            default: 360000,
            component: 'InputNumber'
          },
          path: {
            type: 'string',
            label: '接口路径',
            description: 'OpenAI 兼容聊天接口路径，默认为 /chat/completions',
            default: '/chat/completions',
            component: 'Input'
          },
          enableTools: {
            type: 'boolean',
            label: '启用工具调用',
            description: '开启后会自动注入 MCP 工具列表（无需手写 tools）',
            default: true,
            component: 'Switch'
          },
          maxToolRounds: {
            type: 'number',
            label: '最大工具轮次',
            description: '多轮 tool calling 的最大轮次',
            min: 1,
            max: 20,
            default: 5,
            component: 'InputNumber'
          },
          enableStream: {
            type: 'boolean',
            label: '启用流式输出',
            description: '是否启用流式输出（默认启用，所有运营商均支持）',
            default: true,
            component: 'Switch'
          }
        }
      }
    });
  }
}


