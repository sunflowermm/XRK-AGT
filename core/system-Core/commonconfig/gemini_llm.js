import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

/**
 * Gemini 官方 LLM 工厂配置
 * 配置文件：data/server_bots/{port}/gemini_llm.yaml
 */
export default class GeminiLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'gemini_llm',
      displayName: 'Gemini LLM 工厂配置（官方）',
      description: 'Google Generative Language API 配置，通过 providers[] 管理多 API / 多模型端点',
      filePath: (cfg) => {
        const port = cfg?.port ?? cfg?._port;
        if (!port) throw new Error('GeminiLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/gemini_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: buildLlmProvidersFromPreset('gemini')
        }
      }
    });
  }
}
