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
   * 获取提供商工厂函数
   * @param {string} provider - 提供商名称
   * @returns {Function|undefined}
   */
  getProviderFactory(provider) {
    return this.providers.get((provider || '').toLowerCase());
  }

  /**
   * 创建设备媒体工厂类（ASR/TTS 等同构工厂）
   * @param {Object} options
   * @param {Map<string, Function>} options.providers - 提供商映射
   * @param {string} options.factoryName - 工厂名称（用于错误提示）
   * @param {string} options.defaultProvider - 默认提供商
   * @param {string} options.disabledMessage - 未启用时的错误信息
   * @param {(provider: string) => string} options.unsupportedMessage - 不支持提供商时的错误信息
   * @returns {typeof MediaFactory} 静态媒体工厂类
   */
  static createMediaFactoryClass({
    providers,
    factoryName,
    defaultProvider,
    disabledMessage,
    unsupportedMessage
  }) {
    const baseFactory = new BaseFactory(providers, factoryName);

    return class MediaFactory {
      static registerProvider(name, factoryFn) {
        baseFactory.registerProvider(name, factoryFn);
      }

      static listProviders() {
        return baseFactory.listProviders();
      }

      static isProviderSupported(provider) {
        return baseFactory.isProviderSupported(provider);
      }

      static createClient(deviceId, config = {}, AgentRuntime) {
        if (!config.enabled) {
          throw new Error(disabledMessage);
        }

        const provider = (config.provider || defaultProvider).toLowerCase();
        const factory = baseFactory.getProviderFactory(provider);
        if (!factory) {
          throw new Error(unsupportedMessage(provider));
        }

        return factory(deviceId, config, AgentRuntime);
      }
    };
  }
}
