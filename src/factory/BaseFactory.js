/**
 * 工厂基类：提供商注册与媒体工厂（ASR/TTS）同构封装
 */
export default class BaseFactory {
  /**
   * @param {Map<string, Function>} [providers]
   * @param {string} [factoryName]
   */
  constructor(providers, factoryName = 'Factory') {
    // 勿用 `providers = new Map()` 默认参：会跨实例共享同一 Map
    this.providers = providers ?? new Map();
    this.factoryName = factoryName;
  }

  /**
   * @param {string} name
   * @param {Function} factoryFn
   */
  registerProvider(name, factoryFn) {
    if (!name || typeof factoryFn !== 'function') {
      throw new Error(`注册${this.factoryName}提供商时必须提供名称和工厂函数`);
    }
    this.providers.set(String(name).toLowerCase(), factoryFn);
  }

  /** @returns {string[]} */
  listProviders() {
    return Array.from(this.providers.keys());
  }

  /** @param {string} provider */
  isProviderSupported(provider) {
    return this.providers.has((provider || '').toLowerCase());
  }

  /** @param {string} provider @returns {Function|undefined} */
  getProviderFactory(provider) {
    return this.providers.get((provider || '').toLowerCase());
  }

  /**
   * 创建设备媒体工厂类（ASR/TTS 等同构）
   * @param {Object} options
   * @param {Map<string, Function>} options.providers
   * @param {string} options.factoryName
   * @param {string} options.defaultProvider
   * @param {string} options.disabledMessage
   * @param {(provider: string) => string} options.unsupportedMessage
   */
  static createMediaFactoryClass({
    providers,
    factoryName,
    defaultProvider,
    disabledMessage,
    unsupportedMessage,
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
