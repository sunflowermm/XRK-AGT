import GenericLLMClient from './GenericLLMClient.js';

const providers = new Map([
  ['generic', (config) => new GenericLLMClient(config)]
]);

export default class LLMFactory {
  static registerProvider(name, factoryFn) {
    if (!name || typeof factoryFn !== 'function') {
      throw new Error('注册LLM提供商需要有效的名称和工厂函数');
    }
    providers.set(name.toLowerCase(), factoryFn);
  }

  static listProviders() {
    return Array.from(providers.keys());
  }

  static hasProvider(name) {
    return providers.has((name || '').toLowerCase());
  }

  static createClient(config = {}) {
    const provider = (config.provider || 'generic').toLowerCase();
    const factory = providers.get(provider) || providers.get('generic');
    if (!factory) {
      throw new Error(`没有可用的LLM提供商: ${provider}`);
    }
    return factory(config);
  }
}

