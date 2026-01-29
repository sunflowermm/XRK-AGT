import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * Gemini 官方 LLM 工厂配置管理（文本）
 * 配置文件：data/server_bots/{port}/gemini_llm.yaml
 *
 * 注意：
 * - Gemini 的 function calling 协议与 OpenAI 不同；
 * - 本项目当前 Gemini LLMClient 默认不注入 MCP tools（建议 enableTools=false）。
 */
export default class GeminiLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'gemini_llm',
      displayName: 'Gemini LLM 工厂配置（官方）',
      description: 'Google Generative Language API 配置（文本）',
      filePath: (cfg) => {
        const port = cfg?._port ?? cfg?.server?.server?.port;
        if (!port) {
          throw new Error('GeminiLLMConfig: 未提供端口，无法解析路径');
        }
        return `data/server_bots/${port}/gemini_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          baseUrl: {
            type: 'string',
            label: 'API 基础地址',
            description: 'Generative Language API 基础地址',
            default: 'https://generativelanguage.googleapis.com',
            component: 'Input'
          },
          apiKey: {
            type: 'string',
            label: 'API Key',
            description: 'Google API Key（Generative Language）',
            default: '',
            component: 'InputPassword'
          },
          path: {
            type: 'string',
            label: '接口路径（可选）',
            description: '留空则使用 /v1beta/models/{model}:generateContent',
            default: '',
            component: 'Input'
          },
          model: {
            type: 'string',
            label: '模型（model）',
            description: 'Gemini 模型名称，例如 gemini-1.5-flash',
            default: 'gemini-1.5-flash',
            component: 'Input'
          },
          temperature: {
            type: 'number',
            label: '温度（generationConfig.temperature）',
            min: 0,
            max: 2,
            default: 0.7,
            component: 'InputNumber'
          },
          topP: {
            type: 'number',
            label: 'Top P（generationConfig.topP）',
            min: 0,
            max: 1,
            default: 1.0,
            component: 'InputNumber'
          },
          topK: {
            type: 'number',
            label: 'Top K（generationConfig.topK）',
            description: '可选，高级采样参数',
            min: 0,
            default: 0,
            component: 'InputNumber'
          },
          maxTokens: {
            type: 'number',
            label: '最大输出（generationConfig.maxOutputTokens）',
            min: 1,
            default: 2048,
            component: 'InputNumber'
          },
          timeout: {
            type: 'number',
            label: '超时时间 (ms)',
            min: 1000,
            default: 360000,
            component: 'InputNumber'
          },
          enableTools: {
            type: 'boolean',
            label: '启用工具调用（MCP）',
            description: 'Gemini 协议不同，默认关闭；如需启用需实现 Gemini function calling 适配',
            default: false,
            component: 'Switch'
          },
          enableStream: {
            type: 'boolean',
            label: '启用流式输出',
            default: true,
            component: 'Switch'
          },
          headers: {
            type: 'object',
            label: '额外请求头',
            component: 'SubForm',
            fields: {}
          },
          extraBody: {
            type: 'object',
            label: '额外请求体字段',
            description: '原样合并到 payload 顶层（高级用法）',
            component: 'SubForm',
            fields: {}
          }
        }
      }
    });
  }
}

