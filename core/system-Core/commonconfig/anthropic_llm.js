import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

/**
 * Anthropic 官方 LLM 工厂配置管理（文本）
 * 配置文件：data/server_bots/{port}/anthropic_llm.yaml
 */
export default class AnthropicLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'anthropic_llm',
      displayName: 'Anthropic LLM 工厂配置（官方）',
      description: 'Claude / Messages API 配置（文本）',
      filePath: (cfg) => {
        const port = cfg?._port ?? cfg?.server?.server?.port;
        if (!port) throw new Error('AnthropicLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/anthropic_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          baseUrl: {
            type: 'string',
            label: 'API 基础地址',
            default: 'https://api.anthropic.com/v1',
            component: 'Input'
          },
          apiKey: {
            type: 'string',
            label: 'API Key',
            default: '',
            component: 'InputPassword'
          },
          path: {
            type: 'string',
            label: '接口路径',
            default: '/messages',
            component: 'Input'
          },
          model: {
            type: 'string',
            label: '模型（model）',
            default: 'claude-3-5-sonnet-latest',
            component: 'Input'
          },
          anthropicVersion: {
            type: 'string',
            label: 'anthropic-version',
            default: '2023-06-01',
            component: 'Input'
          },
          temperature: {
            type: 'number',
            label: '温度',
            min: 0,
            max: 2,
            default: 0.7,
            component: 'InputNumber'
          },
          maxTokens: {
            type: 'number',
            label: '最大 Tokens',
            min: 1,
            default: 2048,
            component: 'InputNumber'
          },
          enableTools: {
            type: 'boolean',
            label: '启用工具调用（MCP）',
            description: 'Anthropic 协议不同，本实现默认不注入 MCP tools',
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
            component: 'SubForm',
            fields: {}
          }
        }
      }
    });
  }
}

