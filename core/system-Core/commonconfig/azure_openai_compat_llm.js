import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

export default class AzureOpenAICompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'azure_openai_compat_llm',
      displayName: 'Azure OpenAI 协议兼容 LLM 工厂',
      description: 'Azure OpenAI Chat Completions 兼容运营商，通过 providers[] 管理多 deployment 端点',
      filePath: (runtimeConfig) => {
        const port = runtimeConfig?.port ?? runtimeConfig?._port;
        if (!port) throw new Error('AzureOpenAICompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/azure_openai_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: { fields: { providers: buildLlmProvidersFromPreset('azure_openai_compat') } }
    });
  }
}
