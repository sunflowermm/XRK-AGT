/**
 * ASR 工厂：按 provider 创建客户端（默认 volcengine）
 */
import VolcengineASRClient from './VolcengineASRClient.js';
import BaseFactory from '../BaseFactory.js';

export default BaseFactory.createMediaFactoryClass({
  factoryName: 'ASR',
  defaultProvider: 'volcengine',
  disabledMessage: 'ASR未启用',
  unsupportedMessage: (provider) => `不支持的ASR提供商: ${provider}`,
  providers: new Map([
    ['volcengine', (deviceId, config, AgentRuntime) =>
      new VolcengineASRClient(deviceId, config, AgentRuntime)],
  ]),
});
