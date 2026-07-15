import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

export default class CherryINCompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'cherryin_compat_llm',
      displayName: 'CherryIN 兼容 LLM 工厂',
      description: 'CherryIN 网关（OpenAI Chat Completions），通过 providers[] 管理多端点',
      filePath: (runtimeConfig) => {
        const port = runtimeConfig?.port ?? runtimeConfig?._port;
        if (!port) throw new Error('CherryINCompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/cherryin_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: { fields: { providers: buildLlmProvidersFromPreset('cherryin_compat') } }
    });
  }
}
