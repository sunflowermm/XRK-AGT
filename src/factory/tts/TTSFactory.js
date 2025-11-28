/**
 * TTS工厂类
 * 统一管理不同平台的TTS客户端创建
 * 支持扩展多个TTS服务提供商
 */

import VolcengineTTSClient from './VolcengineTTSClient.js';

const providers = new Map([
    ['volcengine', (deviceId, config, Bot) => new VolcengineTTSClient(deviceId, config, Bot)]
]);

export default class TTSFactory {
    static registerProvider(name, factoryFn) {
        if (!name || typeof factoryFn !== 'function') {
            throw new Error('注册TTS提供商时必须提供名称和工厂函数');
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
            throw new Error('TTS未启用');
        }

        const provider = (config.provider || 'volcengine').toLowerCase();
        const factory = providers.get(provider);
        if (!factory) {
            throw new Error(`不支持的TTS提供商: ${provider}`);
        }

        return factory(deviceId, config, Bot);
    }
}