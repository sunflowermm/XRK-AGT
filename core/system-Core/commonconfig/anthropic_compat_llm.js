import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

export default class AnthropicCompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'anthropic_compat_llm',
      displayName: 'Anthropic 协议兼容 LLM 工厂',
      description: 'Anthropic Messages API 兼容运营商，通过 providers[] 管理多 API / 多模型端点',
      filePath: (runtimeConfig) => {
        const port = runtimeConfig?.port ?? runtimeConfig?._port;
        if (!port) throw new Error('AnthropicCompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/anthropic_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: { fields: { providers: buildLlmProvidersFromPreset('anthropic_compat') } }
    });
  }
}
