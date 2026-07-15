import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

/**
 * Azure OpenAI 官方 LLM 工厂配置
 * 配置文件：data/server_bots/{port}/azure_openai_llm.yaml
 */
export default class AzureOpenAILLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'azure_openai_llm',
      displayName: 'Azure OpenAI LLM 工厂配置（官方）',
      description: 'Azure OpenAI Chat Completions 配置，通过 providers[] 管理多 deployment / 多模型端点',
      filePath: (runtimeConfig) => {
        const port = runtimeConfig?.port ?? runtimeConfig?._port;
        if (!port) throw new Error('AzureOpenAILLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/azure_openai_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: buildLlmProvidersFromPreset('azure_openai')
        }
      }
    });
  }
}
