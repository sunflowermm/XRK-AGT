/**
 * ASR工厂类
 * 统一管理不同平台的ASR客户端创建
 * 支持扩展多个ASR服务提供商
 */

import VolcengineASRClient from './VolcengineASRClient.js';

const providers = new Map([
    ['volcengine', (deviceId, config, Bot) => new VolcengineASRClient(deviceId, config, Bot)]
]);

export default class ASRFactory {
    static registerProvider(name, factoryFn) {
        if (!name || typeof factoryFn !== 'function') {
            throw new Error('注册ASR提供商时必须提供名称和工厂函数');
        }
        providers.set(name.toLowerCase(), factoryFn);
    }

    static listProviders() {
        return Array.from(providers.keys());
    }

    static isProviderSupported(provider) {
        return providers.has((provider || '').toLowerCase());
    }

    static createClient(deviceId, config = {}, Bot) {
        if (!config.enabled) {
            throw new Error('ASR未启用');
        }

        const provider = (config.provider || 'volcengine').toLowerCase();
        const factory = providers.get(provider);
        if (!factory) {
            throw new Error(`不支持的ASR提供商: ${provider}`);
        }
        return factory(deviceId, config, Bot);
    }
}