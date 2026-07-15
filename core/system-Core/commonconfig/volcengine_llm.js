import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

/**
 * 火山引擎 LLM 工厂配置
 * 配置文件：data/server_bots/{port}/volcengine_llm.yaml
 */
export default class VolcengineLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'volcengine_llm',
      displayName: '火山引擎 LLM 工厂配置（文本）',
      description: '火山引擎豆包大语言模型配置，通过 providers[] 管理多 API / 多模型端点',
      filePath: (runtimeConfig) => {
        const port = runtimeConfig?.port ?? runtimeConfig?._port;
        if (!port) throw new Error('VolcengineLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/volcengine_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: buildLlmProvidersFromPreset('volcengine')
        }
      }
    });
  }
}
