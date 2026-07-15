import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

export default class OllamaCompatibleLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'ollama_compat_llm',
      displayName: 'Ollama 协议兼容 LLM 工厂',
      description: 'Ollama /api/chat 兼容运营商，通过 providers[] 管理多本地/远程端点',
      filePath: (runtimeConfig) => {
        const port = runtimeConfig?.port ?? runtimeConfig?._port;
        if (!port) throw new Error('OllamaCompatibleLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/ollama_compat_llm.yaml`;
      },
      fileType: 'yaml',
      schema: { fields: { providers: buildLlmProvidersFromPreset('ollama_compat') } }
    });
  }
}
