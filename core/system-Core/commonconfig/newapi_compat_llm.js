import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

export default class NewAPICompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'newapi_compat_llm',
      displayName: 'New API 兼容 LLM 工厂',
      description: 'New API 网关（OpenAI Chat Completions），通过 providers[] 管理多端点',
      filePath: (runtimeConfig) => {
        const port = runtimeConfig?.port ?? runtimeConfig?._port;
        if (!port) throw new Error('NewAPICompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/newapi_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: { fields: { providers: buildLlmProvidersFromPreset('newapi_compat') } }
    });
  }
}
