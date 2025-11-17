/**
 * ASR工厂类
 * 统一管理不同平台的ASR客户端创建
 * 支持扩展多个ASR服务提供商
 */

import VolcengineASRClient from './VolcengineASRClient.js';

/**
 * ASR工厂类
 */
export default class ASRFactory {
    /**
     * 创建ASR客户端
     * @param {string} deviceId - 设备ID
     * @param {Object} config - ASR配置
     * @param {Object} Bot - Bot实例
     * @returns {Object} ASR客户端实例
     */
    static createClient(deviceId, config, Bot) {
        if (!config.enabled) {
            throw new Error('ASR未启用');
        }

        const provider = config.provider || 'volcengine';

        switch (provider.toLowerCase()) {
            case 'volcengine':
                return new VolcengineASRClient(deviceId, config, Bot);
            
            // 可以在这里添加其他ASR提供商
            // case 'aliyun':
            //     return new AliyunASRClient(deviceId, config, Bot);
            // case 'tencent':
            //     return new TencentASRClient(deviceId, config, Bot);
            
            default:
                throw new Error(`不支持的ASR提供商: ${provider}`);
        }
    }

    /**
     * 获取支持的ASR提供商列表
     * @returns {Array<string>} 提供商列表
     */
    static getSupportedProviders() {
        return ['volcengine'];
    }

    /**
     * 检查提供商是否支持
     * @param {string} provider - 提供商名称
     * @returns {boolean} 是否支持
     */
    static isProviderSupported(provider) {
        return this.getSupportedProviders().includes(provider.toLowerCase());
    }
}