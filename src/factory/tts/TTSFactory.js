/**
 * TTS工厂类
 * 统一管理不同平台的TTS客户端创建
 * 支持扩展多个TTS服务提供商
 */

import VolcengineTTSClient from './VolcengineTTSClient.js';
import BaseFactory from '../BaseFactory.js';

const providers = new Map([
    ['volcengine', (deviceId, config, Bot) => new VolcengineTTSClient(deviceId, config, Bot)]
]);

const baseFactory = new BaseFactory(providers, 'TTS');

export default class TTSFactory {
    static registerProvider(name, factoryFn) {
        baseFactory.registerProvider(name, factoryFn);
    }

    static listProviders() {
        return baseFactory.listProviders();
    }

    static isProviderSupported(provider) {
        return baseFactory.isProviderSupported(provider);
    }

    static createClient(deviceId, config = {}, Bot) {
        if (!config.enabled) {
            throw new Error('TTS未启用');
        }

        const provider = (config.provider || 'volcengine').toLowerCase();
        const factory = baseFactory.providers.get(provider);
        if (!factory) {
            throw new Error(`不支持的TTS提供商: ${provider}`);
        }

        return factory(deviceId, config, Bot);
    }
}