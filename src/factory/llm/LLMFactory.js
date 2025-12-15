import GenericLLMClient from './GenericLLMClient.js';
import VolcengineLLMClient from './VolcengineLLMClient.js';

const providers = new Map([
  // generic 提供商：默认的 GPT-LLM 标准调用方式（兼容 OpenAI Chat Completions 协议）
  // 适用于所有遵循 OpenAI 协议的 API（如 GPTGod、OpenAI、Azure OpenAI 等）
  ['generic', (config) => new GenericLLMClient(config)],
  // 火山引擎提供商：火山引擎豆包大模型
  // 接口地址：https://ark.cn-beijing.volces.com/api/v3
  // 详细文档：https://www.volcengine.com/docs/82379
  ['volcengine', (config) => new VolcengineLLMClient(config)]
]);

export default class LLMFactory {
  /**
   * 注册自定义 LLM 提供商
   * @param {string} name - 提供商名称
   * @param {Function} factoryFn - 工厂函数，接收 config 参数，返回 LLM 客户端实例
   */
  static registerProvider(name, factoryFn) {
    if (!name || typeof factoryFn !== 'function') {
      throw new Error('注册LLM提供商需要有效的名称和工厂函数');
    }
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
   * 
   * 提供商选择逻辑：
   * 1. 如果 config.provider 指定了提供商，使用指定的提供商
   * 2. 如果未指定或提供商不存在，默认使用 generic（GPT-LLM 标准调用方式）
   * 
   * @param {Object} config - 配置对象
   *   - provider: 提供商名称（如 'generic', 'volcengine'）
   *   - baseUrl: API 基础地址
   *   - apiKey: API 密钥
   *   - 其他 LLM 参数
   * @returns {Object} LLM 客户端实例
   */
  static createClient(config = {}) {
    const provider = (config.provider || 'generic').toLowerCase();
    const factory = providers.get(provider) || providers.get('generic');

    if (!factory) {
      throw new Error(`没有可用的LLM提供商: ${provider}`);
    }

    return factory(config);
  }
}

