/**
 * ASR工厂类
 * 统一管理不同平台的ASR客户端创建
 * 支持扩展多个ASR服务提供商
 */

import VolcengineASRClient from './VolcengineASRClient.js';
import BaseFactory from '../BaseFactory.js';

export default BaseFactory.createMediaFactoryClass({
  factoryName: 'ASR',
  defaultProvider: 'volcengine',
  disabledMessage: 'ASR未启用',
  unsupportedMessage: (provider) => `不支持的ASR提供商: ${provider}`,
  providers: new Map([
    ['volcengine', (deviceId, config, AgentRuntime) => new VolcengineASRClient(deviceId, config, AgentRuntime)]
  ])
});
