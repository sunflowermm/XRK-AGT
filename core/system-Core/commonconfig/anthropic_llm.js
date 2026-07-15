import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

/**
 * Anthropic 官方 LLM 工厂配置
 * 配置文件：data/server_bots/{port}/anthropic_llm.yaml
 */
export default class AnthropicLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'anthropic_llm',
      displayName: 'Anthropic LLM 工厂配置（官方）',
      description: 'Claude / Messages API 配置，通过 providers[] 管理多 API / 多模型端点',
      filePath: (runtimeConfig) => {
        const port = runtimeConfig?.port ?? runtimeConfig?._port;
        if (!port) throw new Error('AnthropicLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/anthropic_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: buildLlmProvidersFromPreset('anthropic')
        }
      }
    });
  }
}
