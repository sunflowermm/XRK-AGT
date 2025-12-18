import ConfigBase from '../../src/infrastructure/commonconfig/commonconfig.js';

/**
 * 火山引擎 豆包 识图工厂配置管理（Vision）
 * 管理火山引擎 vision 模型相关配置：
 * - 识图模型（doubao-vision-*）
 * - API 基础地址与区域
 * - 超时与参数等
 * 配置文件位于 data/server_bots/{port}/volcengine_vision.yaml
 */
export default class VolcengineVisionConfig extends ConfigBase {
  constructor() {
    super({
      name: 'volcengine_vision',
      displayName: '火山引擎 识图工厂配置',
      description: '火山引擎豆包 vision 识图能力配置，包括模型与接口参数',
      filePath: (cfg) => {
        const port = cfg?._port ?? cfg?.server?.server?.port;
        if (!port) {
          throw new Error(`VolcengineVisionConfig: 未提供端口，无法解析路径`);
        }
        return `data/server_bots/${port}/volcengine_vision.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          // API 基础配置
          baseUrl: {
            type: 'string',
            label: 'API 基础地址',
            description: '火山引擎豆包 API 基础地址（用于识图调用）',
            default: 'https://ark.cn-beijing.volces.com/api/v3',
            component: 'Input'
          },
          apiKey: {
            type: 'string',
            label: 'API Key',
            description: '火山引擎 API Key（用于识图调用）',
            default: '',
            component: 'InputPassword'
          },
          region: {
            type: 'string',
            label: '区域',
            description: '火山引擎服务区域，如 cn-beijing、cn-shanghai',
            default: 'cn-beijing',
            component: 'Input'
          },

          // 识图模型配置
          visionModel: {
            type: 'string',
            label: '识图模型',
            description: '火山引擎识图模型名称，如 doubao-vision-pro-32k',
            default: 'doubao-vision-pro-32k',
            component: 'Input'
          },

          // API 参数配置
          temperature: {
            type: 'number',
            label: '温度',
            description: '控制识图结果的随机性（0-2）',
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
            default: 4000,
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
            description: '火山引擎识图接口路径，默认为 /chat/completions',
            default: '/chat/completions',
            component: 'Input'
          }
        }
      }
    });
  }
}


