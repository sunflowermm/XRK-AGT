import GPTGodLLMClient from './GPTGodLLMClient.js';
import VolcengineLLMClient from './VolcengineLLMClient.js';

const providers = new Map([
  // GPTGod 提供商：GPTGod 大语言模型，支持识图功能
  // 接口地址：https://api.gptgod.online/v1
  ['gptgod', (config) => new GPTGodLLMClient(config)],
  // 火山引擎提供商：火山引擎豆包大模型
  // 接口地址：https://ark.cn-beijing.volces.com/api/v3
  ['volcengine', (config) => new VolcengineLLMClient(config)]
]);

export default class LLMFactory {
  /**
   * 注册自定义 LLM 提供商
   * @param {string} name - 提供商名称
   * @param {Function} factoryFn - 工厂函数，接收 config 参数，返回 LLM 客户端实例
   */
  static registerProvider(name, factoryFn) {
    providers.set(String(name).toLowerCase(), factoryFn);
  }

  /**
   * 列出所有已注册的提供商
   * @returns {Array<string>} 提供商名称列表
   */
  static listProviders() {
    return Array.from(providers.keys());
  }

  /**
   * 检查提供商是否存在
   * @param {string} name - 提供商名称
   * @returns {boolean} 是否存在
   */
  static hasProvider(name) {
    return providers.has((name || '').toLowerCase());
  }

  /**
   * 创建 LLM 客户端
   * @param {Object} config - 配置对象
   *   - provider: 提供商名称（如 'gptgod', 'volcengine'）
   *   - baseUrl: API 基础地址
   *   - apiKey: API 密钥
   *   - 其他 LLM 参数
   * @returns {Object} LLM 客户端实例
   */
  static createClient(config = {}) {
    const provider = (config.provider || 'gptgod').toLowerCase();
    const factory = providers.get(provider);

    if (!factory) {
      throw new Error(`不支持的LLM提供商: ${provider}`);
    }

    return factory(config);
  }
}
