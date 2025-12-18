import ConfigBase from '../../src/infrastructure/commonconfig/commonconfig.js';

/**
 * GPTGod 识图工厂配置管理（Vision）
 * 管理 GPTGod 识图能力相关配置：
 * - 文件上传地址
 * - 识图模型（visionModel）
 * - Vision 接口的参数与超时
 * 配置文件位于 data/server_bots/{port}/god_vision.yaml
 */
export default class GodVisionConfig extends ConfigBase {
  constructor() {
    super({
      name: 'god_vision',
      displayName: 'GPTGod 识图工厂配置',
      description: 'GPTGod 识图能力配置，包括文件上传与 vision 模型等参数',
      filePath: (cfg) => {
        const port = cfg?._port ?? cfg?.server?.server?.port;
        if (!port) {
          throw new Error(`GodVisionConfig: 未提供端口，无法解析路径`);
        }
        return `data/server_bots/${port}/god_vision.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          // API 基础配置
          baseUrl: {
            type: 'string',
            label: 'API 基础地址',
            description: 'GPTGod API 基础地址（用于识图调用）',
            default: 'https://api.gptgod.online/v1',
            component: 'Input'
          },
          apiKey: {
            type: 'string',
            label: 'API Key',
            description: 'GPTGod API 密钥（用于识图调用）',
            default: '',
            component: 'InputPassword'
          },
          fileUploadUrl: {
            type: 'string',
            label: '文件上传地址',
            description: '用于识图的图片上传 API 地址',
            default: 'https://api.gptgod.online/v1/files',
            component: 'Input'
          },

          // 识图模型配置
          visionModel: {
            type: 'string',
            label: '识图模型',
            description: '用于图片识别的 GPTGod 模型名称',
            default: 'glm-4-alltools',
            component: 'Input'
          },

          // API 参数配置
          temperature: {
            type: 'number',
            label: '温度',
            description: '控制识图结果的随机性（0-2），值越大越发散',
            min: 0,
            max: 2,
            default: 0.8,
            component: 'InputNumber'
          },
          maxTokens: {
            type: 'number',
            label: '最大 Tokens',
            description: '识图描述的最大 token 数量',
            min: 1,
            default: 6000,
            component: 'InputNumber'
          },
          topP: {
            type: 'number',
            label: 'Top P',
            description: '核采样参数（0-1），控制输出多样性',
            min: 0,
            max: 1,
            default: 0.9,
            component: 'InputNumber'
          },
          presencePenalty: {
            type: 'number',
            label: 'Presence Penalty',
            description: '存在惩罚（-2 到 2），鼓励模型描述更多细节',
            min: -2,
            max: 2,
            default: 0.6,
            component: 'InputNumber'
          },
          frequencyPenalty: {
            type: 'number',
            label: 'Frequency Penalty',
            description: '频率惩罚（-2 到 2），减少重复描述',
            min: -2,
            max: 2,
            default: 0.6,
            component: 'InputNumber'
          },
          timeout: {
            type: 'number',
            label: '超时时间 (ms)',
            description: '识图接口请求超时时间（毫秒）',
            min: 1000,
            default: 360000,
            component: 'InputNumber'
          },

          // 接口路径配置
          path: {
            type: 'string',
            label: '接口路径',
            description: 'GPTGod 识图接口路径，默认为 /chat/completions',
            default: '/chat/completions',
            component: 'Input'
          }
        }
      }
    });
  }
}


