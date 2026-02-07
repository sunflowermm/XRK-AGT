/**
 * 工厂基类
 * 提供通用的工厂模式实现，减少重复代码
 */
export default class BaseFactory {
  constructor(providers = new Map(), factoryName = 'Factory') {
    this.providers = providers;
    this.factoryName = factoryName;
  }

  /**
   * 注册提供商
   * @param {string} name - 提供商名称
   * @param {Function} factoryFn - 工厂函数
   * @throws {Error} 如果参数无效
   */
  registerProvider(name, factoryFn) {
    if (!name || typeof factoryFn !== 'function') {
      throw new Error(`注册${this.factoryName}提供商时必须提供名称和工厂函数`);
    }
    this.providers.set(String(name).toLowerCase(), factoryFn);
  }

  /**
   * 列出所有已注册的提供商
   * @returns {Array<string>} 提供商名称列表
   */
  listProviders() {
    return Array.from(this.providers.keys());
  }

  /**
   * 检查提供商是否支持
   * @param {string} provider - 提供商名称
   * @returns {boolean} 是否支持
   */
  isProviderSupported(provider) {
    return this.providers.has((provider || '').toLowerCase());
  }

  /**
   * 创建客户端（子类需要实现）
   * @param {...any} args - 参数
   * @returns {*} 客户端实例
   * @throws {Error} 如果提供商不存在
   */
  createClient(...args) {
    throw new Error('子类必须实现 createClient 方法');
  }
}
