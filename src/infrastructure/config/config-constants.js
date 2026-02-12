/**
 * 配置常量定义
 * 统一管理全局配置、服务器配置和工厂配置的分类
 */

// 全局配置列表（不随端口变化，存储在server_bots/根目录）
export const GLOBAL_CONFIGS = ['agt', 'device', 'monitor', 'notice', 'mongodb', 'redis', 'aistream'];

// 服务器配置列表（随端口变化，存储在server_bots/{port}/）
export const SERVER_CONFIGS = ['server', 'chatbot', 'group'];

// 工厂配置名称模式（随端口变化）
export const FACTORY_CONFIG_PATTERNS = [
  'volcengine_',
  'xiaomimimo_',
  'openai_',
  'gemini_',
  'anthropic_',
  'azure_'
];

/**
 * 判断配置名称是否为工厂配置
 * @param {string} configName - 配置名称
 * @returns {boolean}
 */
export function isFactoryConfig(configName) {
  return FACTORY_CONFIG_PATTERNS.some(pattern => configName.includes(pattern));
}

/**
 * 判断配置名称是否为服务器配置（包括服务器配置和工厂配置）
 * @param {string} configName - 配置名称
 * @returns {boolean}
 */
export function isServerOrFactoryConfig(configName) {
  return SERVER_CONFIGS.includes(configName) || isFactoryConfig(configName);
}
