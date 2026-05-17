import BotUtil from '#utils/botutil.js';

/**
 * 安全获取请求优先级
 */
export function getApiPriority(api) {
  if (!api || typeof api !== 'object') {
    return 100;
  }
  const priority = api.priority;
  if (priority == null || isNaN(priority)) {
    return 100;
  }
  return Number(priority);
}

/**
 * 验证 API 实例（ApiLoader 加载时使用）
 */
export function validateApiInstance(api, key = 'unknown') {
  if (!api || typeof api !== 'object') {
    BotUtil.makeLog('warn', `API实例无效: ${key}`, 'HttpHelpers');
    return false;
  }

  if (!api.name) api.name = key;
  if (!api.dsc) api.dsc = '暂无描述';
  if (api.priority == null || isNaN(api.priority)) {
    api.priority = 100;
  } else {
    api.priority = Number(api.priority);
  }
  if (api.enable === undefined) api.enable = true;

  if (api.routes && !Array.isArray(api.routes)) {
    BotUtil.makeLog('warn', `API模块 ${key} 的routes不是数组`, 'HttpHelpers');
    api.routes = [];
  } else if (!api.routes) {
    api.routes = [];
  }

  return true;
}
