import ConfigBase from '../../src/infrastructure/commonconfig/commonconfig.js';

/**
 * 火山引擎 LLM 工厂配置管理（文本）
 * 管理火山引擎大语言模型（LLM 文本聊天）相关配置
 * 识图配置已经拆分到 volcengine_vision.yaml / volcengine_vision.js
 * 支持前端编辑，配置文件位于 data/server_bots/{port}/volcengine_llm.yaml
 */
export default class VolcengineLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'volcengine_llm',
      displayName: '火山引擎 LLM 工厂配置（文本）',
      description: '火山引擎豆包大语言模型文本聊天配置',
      filePath: (cfg) => {
        const port = cfg?._port ?? cfg?.server?.server?.port;
        if (!port) {
          throw new Error(`VolcengineLLMConfig: 未提供端口，无法解析路径`);
        }
        return `data/server_bots/${port}/volcengine_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          baseUrl: {
            type: 'string',
            label: 'API 基础地址',
            description: '火山引擎豆包 API 基础地址',
            default: 'https://ark.cn-beijing.volces.com/api/v3',
            component: 'Input'
          },
          apiKey: {
            type: 'string',
            label: 'API Key',
            description: '火山引擎 API Key',
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
          chatModel: {
            type: 'string',
            label: '聊天模型',
            description: '火山引擎聊天模型名称',
            default: 'doubao-pro-4k',
            component: 'Input'
          },
          temperature: {
            type: 'number',
            label: '温度',
            description: '生成文本的随机性，范围 0-2',
            min: 0,
            max: 2,
            default: 0.8,
            component: 'InputNumber'
          },
          maxTokens: {
            type: 'number',
            label: '最大 Tokens',
            description: '生成文本的最大长度',
            min: 1,
            default: 4000,
            component: 'InputNumber'
          },
          topP: {
            type: 'number',
            label: 'Top P',
            description: '核采样参数，范围 0-1',
            min: 0,
            max: 1,
            default: 0.9,
            component: 'InputNumber'
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
            description: 'API 接口路径',
            default: '/chat/completions',
            component: 'Input'
          }
        }
      }
    });
  }
}

