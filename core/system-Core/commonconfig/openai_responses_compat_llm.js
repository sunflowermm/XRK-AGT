import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

export default class OpenAIResponsesCompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'openai_responses_compat_llm',
      displayName: 'OpenAI Responses 协议兼容 LLM 工厂',
      description: 'OpenAI Responses 协议运营商，通过 providers[] 管理多 API / 多模型端点',
      filePath: (runtimeConfig) => {
        const port = runtimeConfig?.port ?? runtimeConfig?._port;
        if (!port) throw new Error('OpenAIResponsesCompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/openai_responses_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: { fields: { providers: buildLlmProvidersFromPreset('openai_responses_compat') } }
    });
  }
}
