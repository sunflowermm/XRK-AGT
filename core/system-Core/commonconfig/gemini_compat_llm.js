import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

export default class GeminiCompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'gemini_compat_llm',
      displayName: 'Gemini 协议兼容 LLM 工厂',
      description: 'Google Generative Language API 兼容运营商，通过 providers[] 管理多 API / 多模型端点',
      filePath: (runtimeConfig) => {
        const port = runtimeConfig?.port ?? runtimeConfig?._port;
        if (!port) throw new Error('GeminiCompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/gemini_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: { fields: { providers: buildLlmProvidersFromPreset('gemini_compat') } }
    });
  }
}
