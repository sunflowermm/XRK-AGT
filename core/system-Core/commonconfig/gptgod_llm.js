import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * GPTGod LLM 工厂配置管理（文本）
 * 仅管理 GPTGod 大语言模型（聊天）相关配置
 * 识图配置已经拆分到单独的 gptgod_vision.yaml / gptgod_vision.js
 * 支持前端编辑，配置文件位于 data/server_bots/{port}/gptgod_llm.yaml
 */
export default class GPTGodLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'gptgod_llm',
      displayName: 'GPTGod LLM 工厂配置（文本）',
      description: 'GPTGod 大语言模型文本聊天配置，包括 API 参数和聊天模型选择',
      filePath: (cfg) => {
        const port = cfg?._port ?? cfg?.server?.server?.port;
        if (!port) {
          throw new Error(`GPTGodLLMConfig: 未提供端口，无法解析路径`);
        }
        return `data/server_bots/${port}/gptgod_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          // API 基础配置
          baseUrl: {
            type: 'string',
            label: 'API 基础地址',
            description: 'GPTGod API 基础地址',
            default: 'https://api.gptgod.online/v1',
            component: 'Input'
          },
          apiKey: {
            type: 'string',
            label: 'API Key',
            description: 'GPTGod API 密钥',
            default: '',
            component: 'InputPassword'
          },
          // 聊天模型配置
          chatModel: {
            type: 'string',
            label: '聊天模型',
            description: '用于文本对话的模型名称',
            default: 'gemini-exp-1114',
            component: 'Input'
          },

          // API 参数配置
          temperature: {
            type: 'number',
            label: '温度',
            description: '控制输出的随机性（0-2），值越大越随机',
            min: 0,
            max: 2,
            default: 0.8,
            component: 'InputNumber'
          },
          maxTokens: {
            type: 'number',
            label: '最大 Tokens',
            description: '生成的最大 token 数量',
            min: 1,
            default: 6000,
            component: 'InputNumber'
          },
          topP: {
            type: 'number',
            label: 'Top P',
            description: '核采样参数（0-1），控制输出的多样性',
            min: 0,
            max: 1,
            default: 0.9,
            component: 'InputNumber'
          },
          presencePenalty: {
            type: 'number',
            label: 'Presence Penalty',
            description: '存在惩罚（-2 到 2），鼓励模型谈论新话题',
            min: -2,
            max: 2,
            default: 0.6,
            component: 'InputNumber'
          },
          frequencyPenalty: {
            type: 'number',
            label: 'Frequency Penalty',
            description: '频率惩罚（-2 到 2），减少重复内容',
            min: -2,
            max: 2,
            default: 0.6,
            component: 'InputNumber'
          },
          timeout: {
            type: 'number',
            label: '超时时间 (ms)',
            description: 'API 请求超时时间（毫秒）',
            min: 1000,
            default: 30000,
            component: 'InputNumber'
          },

          // 接口路径配置
          path: {
            type: 'string',
            label: '接口路径',
            description: 'API 接口路径，默认为 /chat/completions',
            default: '/chat/completions',
            component: 'Input'
          },
          enableTools: {
            type: 'boolean',
            label: '启用工具调用',
            description: '是否启用工具调用功能',
            default: false,
            component: 'Switch'
          }
        }
      }
    });
  }
}

