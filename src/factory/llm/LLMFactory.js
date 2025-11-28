import GenericLLMClient from './GenericLLMClient.js';

/**
 * LLM 工厂
 * 负责按 provider 创建对应的客户端实例
 */
export default class LLMFactory {
  static createClient(config = {}) {
    const provider = (config.provider || 'generic').toLowerCase();
    switch (provider) {
      case 'generic':
      default:
        return new GenericLLMClient(config);
    }
  }
}

