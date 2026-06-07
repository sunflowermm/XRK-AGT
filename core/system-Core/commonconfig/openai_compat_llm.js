import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

export default class OpenAICompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'openai_compat_llm',
      displayName: 'OpenAI Chat 协议兼容 LLM 工厂',
      description: 'OpenAI Chat Completions 兼容运营商，通过 providers[] 管理多 API / 多模型端点',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) throw new Error('OpenAICompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/openai_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: { fields: { providers: buildLlmProvidersFromPreset('openai_compat') } }
    });
  }
}
