import { HttpResponse } from '#utils/http-utils.js';
import { getAiWorkflowConfigOptional } from '#utils/ai-workflow-config.js';
import runtimeConfig from '#infrastructure/config/config.js';

/** 规范化 IP / Host 字符串（去 IPv6 mapped、zone id、端口、括号） */
export function normalizeIpOrHost(value) {
  if (!value || typeof value !== 'string') return '';
  let s = value.toLowerCase().trim();
  if (s.startsWith('[') && s.includes(']')) {
    s = s.slice(1, s.indexOf(']'));
  } else if (s.includes(':') && /^[\d.]+:\d+$/.test(s)) {
    s = s.slice(0, s.lastIndexOf(':'));
  }
  return s.replace(/^::ffff:/, '').replace(/%.+$/, '');
}

/** 是否为本机 127.* 回环（AgentRuntime.checkApiAuthorization 与单测共用） */
export function isLoopback127Connection(address) {
  const ip = normalizeIpOrHost(address);
  return /^127\./.test(ip);
}

/** Host / hostname 是否表示本机访问（仅此时允许「回环免 Key」） */
export function isLoopbackHost(hostHeader) {
  const host = normalizeIpOrHost(String(hostHeader || '').split(',')[0]);
  if (!host) return false;
  return host === 'localhost' || host === '::1' || isLoopback127Connection(host);
}

/**
 * 从常见反代头取客户端 IP（仅当 TCP 对端已是回环时才应调用，防直连伪造）。
 * @returns {string|null}
 */
export function extractProxiedClientAddress(req) {
  const headers = req?.headers || {};
  const candidates = [
    headers['cf-connecting-ip'],
    headers['true-client-ip'],
    headers['x-real-ip'],
    typeof headers['x-forwarded-for'] === 'string'
      ? headers['x-forwarded-for'].split(',')[0]
      : Array.isArray(headers['x-forwarded-for'])
        ? headers['x-forwarded-for'][0]
        : null,
  ];
  for (const raw of candidates) {
    const ip = normalizeIpOrHost(String(raw || '').trim());
    if (ip) return ip;
  }
  return null;
}

/**
 * 是否适用「本机回环免 API Key」。
 * 反代 / frp 场景下 socket 常为 127.*，但 Host 为公网 IP 或带 X-Forwarded-*：不得免鉴权。
 */
export function isLoopbackAuthExempt(req) {
  if (!req) return false;
  if (!isLoopbackHost(req.headers?.host || req.headers?.Host)) {
    return false;
  }
  const socketAddr = req.socket?.remoteAddress || '';
  if (!isLoopback127Connection(socketAddr)) {
    return false;
  }
  const proxied = extractProxiedClientAddress(req);
  if (proxied && !isLoopback127Connection(proxied) && normalizeIpOrHost(proxied) !== '::1') {
    return false;
  }
  const expressIp = normalizeIpOrHost(req.ip || '');
  if (expressIp && !isLoopback127Connection(expressIp) && expressIp !== '::1') {
    return false;
  }
  return true;
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
