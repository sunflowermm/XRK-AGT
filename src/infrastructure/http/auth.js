import { HttpResponse } from '#utils/http-utils.js';
import { getAiWorkflowConfigOptional } from '#utils/ai-workflow-config.js';
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
 * 是否为回环或 RFC1918/ULA 私网（限流 skip 用；与鉴权「仅 127.* 免」刻意不同）。
 * 家用/内网部署下私网客户端不该被全局限流误伤；鉴权仍须 API Key（非 127）。
 */
export function isPrivateOrLoopbackAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const ip = address.toLowerCase().trim()
    .replace(/^::ffff:/, '')
    .replace(/%.+$/, '');
  if (ip === 'localhost' || ip === '127.0.0.1' || ip === '::1' || /^127\./.test(ip)) {
    return true;
  }
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
    return true;
  }
  if (/^fe80:/i.test(ip) || /^fc00:/i.test(ip) || /^fd00:/i.test(ip)) {
    return true;
  }
  return false;
}

/**
 * tools.file.runEnabled（及同类危险能力）开启时，loopback 也不得免鉴权。
 * 默认 true；可在 server.auth.requireLoopbackAuthWhenToolsRun 显式关闭。
 */
export function shouldForceAuthOnLoopbackWhenToolsRun() {
  const toolsOn = getAiWorkflowConfigOptional()?.tools?.file?.runEnabled === true;
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
