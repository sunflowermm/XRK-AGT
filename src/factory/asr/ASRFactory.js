/**
 * ASR工厂类
 * 统一管理不同平台的ASR客户端创建
 * 支持扩展多个ASR服务提供商
 */

import VolcengineASRClient from './VolcengineASRClient.js';
import BaseFactory from '../BaseFactory.js';

const providers = new Map([
    ['volcengine', (deviceId, config, Bot) => new VolcengineASRClient(deviceId, config, Bot)]
]);

const baseFactory = new BaseFactory(providers, 'ASR');

export default class ASRFactory {
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
            throw new Error('ASR未启用');
        }

        const provider = (config.provider || 'volcengine').toLowerCase();
        const factory = baseFactory.providers.get(provider);
        if (!factory) {
            throw new Error(`不支持的ASR提供商: ${provider}`);
        }
        return factory(deviceId, config, Bot);
    }
}