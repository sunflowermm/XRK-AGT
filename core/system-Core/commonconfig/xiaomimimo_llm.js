import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';
import { buildLlmProvidersFromPreset } from './shared/llm-provider-fields.js';

/**
 * 小米 MiMo LLM 工厂配置
 * 配置文件：data/server_bots/{port}/xiaomimimo_llm.yaml
 */
export default class XiaomiMiMoLLMConfig extends ConfigBase {
  constructor() {
    super({
      name: 'xiaomimimo_llm',
      displayName: '小米 MiMo LLM 工厂配置',
      description: '小米 MiMo 大语言模型配置，通过 providers[] 管理多 API / 多模型端点',
      filePath: (runtimeConfig) => {
        const port = runtimeConfig?.port ?? runtimeConfig?._port;
        if (!port) throw new Error('XiaomiMiMoLLMConfig: 未提供端口，无法解析路径');
        return `data/server_bots/${port}/xiaomimimo_llm.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          providers: buildLlmProvidersFromPreset('xiaomimimo')
        }
      }
    });
  }
}
