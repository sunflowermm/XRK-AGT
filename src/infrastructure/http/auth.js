import { HttpResponse } from '#utils/http-utils.js';

/** 是否为本机 127.* 回环（Bot.checkApiAuthorization 与单测共用） */
export function isLoopback127Connection(address) {
  if (!address || typeof address !== 'string') return false;
  const ip = address.toLowerCase().trim()
    .replace(/^::ffff:/, '')
    .replace(/%.+$/, '');
  return /^127\./.test(ip);
}

/**
 * system-Core HTTP 统一鉴权（复用 Bot.checkApiAuthorization）
 * @returns {object|undefined} 未通过时返回 HttpResponse.error 结果，通过时返回 undefined
 */
export function ensureSystemCoreAuth(req, res, bot, context = 'system-Core') {
  if (!bot?.checkApiAuthorization?.(req)) {
    return HttpResponse.error(res, new Error('未授权'), 401, context);
  }
}
