import { HttpResponse } from '#utils/http-utils.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import runtimeConfig from '#infrastructure/config/config.js';

/** 是否为本机 127.* 回环（AgentRuntime.checkApiAuthorization 与单测共用） */
export function isLoopback127Connection(address) {
  if (!address || typeof address !== 'string') return false;
  const ip = address.toLowerCase().trim()
    .replace(/^::ffff:/, '')
    .replace(/%.+$/, '');
  return /^127\./.test(ip);
}

/**
 * tools.file.runEnabled（及同类危险能力）开启时，loopback 也不得免鉴权。
 * 默认 true；可在 server.auth.requireLoopbackAuthWhenToolsRun 显式关闭。
 */
export function shouldForceAuthOnLoopbackWhenToolsRun() {
  const toolsOn = getAistreamConfigOptional()?.tools?.file?.runEnabled === true;
  if (!toolsOn) return false;
  return runtimeConfig.server?.auth?.requireLoopbackAuthWhenToolsRun !== false;
}

/**
 * system-Core HTTP 统一鉴权（复用 AgentRuntime.checkApiAuthorization）
 * @returns {object|undefined} 未通过时返回 HttpResponse.error 结果，通过时返回 undefined
 */
export function ensureSystemCoreAuth(req, res, bot, context = 'system-Core') {
  if (!bot?.checkApiAuthorization?.(req)) {
    return HttpResponse.error(res, new Error('未授权'), 401, context);
  }
}
