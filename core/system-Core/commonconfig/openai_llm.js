import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

/**
 * OpenAI 官方 Chat Completions 工厂配置
 * 配置文件：data/server_bots/{port}/openai_llm.yaml
 */
export default class OpenAILLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'openai_llm',
      displayName: 'OpenAI LLM 工厂配置（官方）',
      description: 'OpenAI Chat Completions 配置，通过 providers[] 管理多 API / 多模型端点',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) throw new Error('OpenAILLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/openai_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: buildLlmProvidersFromPreset('openai')
        }
      }
    });
  }
}
