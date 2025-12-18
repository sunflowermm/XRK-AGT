import GPTGodVisionClient from './providers/GPTGodVisionClient.js';
import VolcengineVisionClient from './providers/VolcengineVisionClient.js';

/**
 * 识图工厂
 *
 * 注意：
 * - 工作流不会直接调用识图工厂；
 * - 只有 LLM 层（如 GPTGodLLMClient、VolcengineLLMClient 等）在检测到图片时，
 *   才会把图片 URL / 本地绝对路径交给识图工厂，由工厂路由到具体运营商。
 */
const providers = new Map([
  // GPTGod 识图提供商：通过文件上传 + vision 模型描述图片
  ['gptgod', (config) => new GPTGodVisionClient(config)],
  // 火山引擎识图提供商：使用豆包 vision 模型直接识图
  ['volcengine', (config) => new VolcengineVisionClient(config)]
]);

export default class VisionFactory {
  /**
   * 注册自定义识图提供商
   * @param {string} name - 提供商名称（如 gptgod）
   * @param {Function} factoryFn - 工厂函数，接收 config 参数，返回 VisionClient 实例
   */
  static registerProvider(name, factoryFn) {
    providers.set(String(name).toLowerCase(), factoryFn);
  }

  /**
   * 检查提供商是否存在
   * @param {string} name
   * @returns {boolean}
   */
  static hasProvider(name) {
    return providers.has((name || '').toLowerCase());
  }

  /**
   * 列出所有已注册的识图提供商
   * @returns {Array<string>}
   */
  static listProviders() {
    return Array.from(providers.keys());
  }

  /**
   * 创建识图客户端
   * @param {Object} config
   *   - provider: 运营商名称（如 'gptgod', 'volcengine'）
   *   - 其他字段为各自运营商的识图配置
   * @returns {Object} VisionClient 实例
   */
  static createClient(config = {}) {
    const provider = (config.provider || '').toLowerCase();
    const factory = providers.get(provider);

    if (!factory) {
      throw new Error(`不支持的识图提供商: ${provider || '未指定'}`);
    }

    return factory(config);
  }
}


