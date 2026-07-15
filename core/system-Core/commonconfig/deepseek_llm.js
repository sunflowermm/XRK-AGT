import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

/**
 * DeepSeek LLM 工厂配置
 * 配置文件：data/server_bots/{port}/deepseek_llm.yaml
 */
export default class DeepSeekLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'deepseek_llm',
      displayName: 'DeepSeek LLM 工厂配置',
      description: 'DeepSeek 官方大语言模型配置，通过 providers[] 管理多 API / 多模型端点',
      filePath: (runtimeConfig) => {
        const port = runtimeConfig?.port ?? runtimeConfig?._port;
        if (!port) throw new Error('DeepSeekLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/deepseek_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: buildLlmProvidersFromPreset('deepseek')
        }
      }
    });
  }
}
