/**
 * AgentRuntime API 鉴权辅助（密钥生成 / 校验 / 提取 / 白名单）
 * 由 AgentRuntime 类方法薄包装委托，不改变对外行为。
 */
import path from 'path';
import fs from 'node:fs/promises';
import * as fsSync from 'fs';
import crypto from 'crypto';
import RuntimeUtil from '#utils/runtime-util.js';
import runtimeConfig from '#infrastructure/config/config.js';
import paths from '#utils/paths.js';
import {
  isLoopbackAuthExempt,
  shouldForceAuthOnLoopbackWhenToolsRun,
} from '#infrastructure/http/auth.js';

/**
 * @param {string} value
 * @param {number} [keepStart=6]
 * @param {number} [keepEnd=4]
 */
export function maskSensitive(value, keepStart = 6, keepEnd = 4) {
  if (typeof value !== 'string' || value.length === 0) return '';
  if (value.length <= keepStart + keepEnd) return '*'.repeat(value.length);
  return `${value.slice(0, keepStart)}${'*'.repeat(value.length - keepStart - keepEnd)}${value.slice(-keepEnd)}`;
}

/**
 * @param {import('../../agent-runtime.js').default} runtime
 */
export async function generateApiKey(runtime) {
  const apiKeyConfig = runtimeConfig.server.auth.apiKey || {};

  if (apiKeyConfig.enabled === false) {
    RuntimeUtil.makeLog('info', '⚠ API密钥认证已禁用', '服务器');
    return null;
  }

  const apiKeyPath = path.join(paths.root,
    apiKeyConfig.file || 'config/server_config/api_key.json');

  try {
    if (fsSync.statSync(apiKeyPath).isFile()) {
      const keyData = JSON.parse(await fs.readFile(apiKeyPath, 'utf8'));
      const loaded = typeof keyData?.key === 'string' ? keyData.key.trim() : '';
      if (!loaded) throw new Error('empty key');
      runtime.apiKey = loaded;
      RuntimeUtil.apiKey = runtime.apiKey;
      RuntimeUtil.makeLog('debug', '从文件加载API密钥', '服务器');
      return runtime.apiKey;
    }
  } catch {
    // 文件不存在，生成新密钥
  }

  const keyLength = apiKeyConfig.length || 64;
  runtime.apiKey = RuntimeUtil.randomString(keyLength);

  await RuntimeUtil.mkdir(path.dirname(apiKeyPath));
  await fs.writeFile(apiKeyPath, JSON.stringify({
    key: runtime.apiKey,
    generated: new Date().toISOString(),
    note: '远程访问API密钥'
  }, null, 2), 'utf8');

  if (process.platform !== 'win32') {
    await fs.chmod(apiKeyPath, 0o600).catch(() => {});
  }

  RuntimeUtil.apiKey = runtime.apiKey;
  const maskedKey = maskSensitive(runtime.apiKey);
  RuntimeUtil.makeLog('success', `⚡ 生成新API密钥：${maskedKey}`, '服务器');
  return runtime.apiKey;
}

/**
 * @param {import('../../agent-runtime.js').default} runtime
 * @param {object} req
 * @param {object} [options]
 */
export function checkApiAuthorization(runtime, req, options = {}) {
  if (!req) {
    RuntimeUtil.makeLog('debug', '[Auth] checkApiAuthorization: req 为空', '认证');
    return false;
  }

  // 关闭 API Key 时远程也应放行（原先 enabled=false 仍因无密钥一律拒绝）
  if (runtimeConfig.server?.auth?.apiKey?.enabled === false) {
    return true;
  }

  const forceAuth = options.forceAuth === true || shouldForceAuthOnLoopbackWhenToolsRun();
  // 本机免 Key 必须显式打开 server.auth.loopbackExempt（默认 false）。
  // 历史上仅凭 socket===127 放行，nginx/frp/Host 被改写时会导致公网裸奔。
  const loopbackExempt = typeof options.loopbackExempt === 'boolean'
    ? options.loopbackExempt
    : runtimeConfig.server?.auth?.loopbackExempt === true;
  if (!forceAuth && loopbackExempt && isLoopbackAuthExempt(req)) {
    return true;
  }

  if (isApiWhitelistPath(runtime, req.path || req.url || req.originalUrl || '')) {
    return true;
  }

  if (!runtime.apiKey) {
    RuntimeUtil.makeLog('warn', '[Auth] API 认证已启用但服务端密钥未加载，拒绝请求', '认证');
    return false;
  }

  const authKey = extractApiKeyFromRequest(req);
  const requestPath = req.path || req.url || req.originalUrl || 'unknown';

  if (!authKey) {
    RuntimeUtil.makeLog('debug', `[Auth] API 认证失败：缺少密钥 path=${requestPath} ip=${req.ip}`, '认证');
    return false;
  }

  try {
    const authKeyBuffer = Buffer.from(String(authKey));
    const apiKeyBuffer = Buffer.from(String(runtime.apiKey));

    if (authKeyBuffer.length !== apiKeyBuffer.length) {
      RuntimeUtil.makeLog('warn', `[Auth] 未授权：密钥长度不一致 path=${requestPath} 来自 ${req.socket?.remoteAddress || req.ip}`, '认证');
      return false;
    }

    const ok = crypto.timingSafeEqual(authKeyBuffer, apiKeyBuffer);
    if (!ok) RuntimeUtil.makeLog('debug', `[Auth] 未授权：密钥不匹配 path=${requestPath} ip=${req.ip}`, '认证');
    return ok;
  } catch (error) {
    RuntimeUtil.makeLog('error', `[Auth] API 认证异常：${error.message} path=${requestPath}`, '认证');
    return false;
  }
}

/**
 * @param {import('../../agent-runtime.js').default} runtime
 * @param {string} requestPath
 */
export function isApiWhitelistPath(runtime, requestPath) {
  const rules = getAuthWhitelistRules(runtime);
  if (rules.length === 0) return false;
  const p = String(requestPath || '').split('?')[0].split('#')[0];
  return rules.some((rule) => matchWhitelistRule(rule, p));
}

/** @param {{ type: string, value: RegExp|string }} rule @param {string} path */
export function matchWhitelistRule(rule, path) {
  if (!rule || !path) return false;
  if (rule.type === 'regex') return rule.value.test(path);
  if (rule.type === 'prefix') return path === rule.value || path.startsWith(rule.value);
  // exact：本路径或其子路径（/health 不匹配 /healthz）
  return path === rule.value || path.startsWith(`${rule.value}/`);
}

/**
 * `/`、`/api` 等前缀会放行全部或全部 API，直接丢弃。
 * @param {string} base 已去掉尾部 * 的路径
 */
export function isDangerousAuthWhitelistPrefix(base) {
  const p = String(base || '').trim().replace(/\/+$/, '') || '/';
  return p === '/' || p === '/api';
}

/**
 * @param {string} pattern
 * @returns {{ type: 'regex'|'prefix'|'exact', value: RegExp|string }|null}
 */
export function compileAuthWhitelistRule(pattern) {
  const raw = String(pattern || '').trim();
  if (!raw) return null;

  if (raw.startsWith('^') || raw.startsWith('regex:')) {
    const src = raw.startsWith('regex:') ? raw.slice(6) : raw;
    try {
      return { type: 'regex', value: new RegExp(src) };
    } catch {
      RuntimeUtil.makeLog('warn', `[Auth] 忽略无效白名单正则: ${raw}`, '认证');
      return null;
    }
  }

  const starred = raw.endsWith('*');
  const base = starred ? raw.slice(0, -1) : raw;
  if (isDangerousAuthWhitelistPrefix(base)) {
    RuntimeUtil.makeLog(
      'warn',
      `[Auth] 忽略危险白名单「${raw}」（会放行全部或全部 /api）；静态页/health 本就不走 API Key`,
      '认证',
    );
    return null;
  }

  if (starred) return { type: 'prefix', value: base };
  return { type: 'exact', value: base };
}

/**
 * @param {import('../../agent-runtime.js').default} runtime
 */
export function getAuthWhitelistRules(runtime) {
  const list = runtimeConfig?.server?.auth?.whitelist;
  if (runtime._authWhitelistCache.ref === list) {
    return runtime._authWhitelistCache.rules;
  }

  const rules = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      const rule = compileAuthWhitelistRule(item);
      if (rule) rules.push(rule);
    }
  }

  runtime._authWhitelistCache = { ref: list, rules };
  return rules;
}

/**
 * @param {*} value
 */
export function normalizeApiKeyCandidate(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeApiKeyCandidate(item);
      if (normalized) return normalized;
    }
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) return null;
  if (/[\r\n]/.test(normalized)) return null;
  return normalized;
}

/**
 * @param {string} headerValue
 */
export function extractApiKeyFromAuthHeader(headerValue) {
  const header = normalizeApiKeyCandidate(headerValue);
  if (!header) return null;

  const match = header.match(/^(Bearer|Token|ApiKey)\s+(.+)$/i);
  if (match) {
    return normalizeApiKeyCandidate(match[2]);
  }

  if (!header.includes(' ')) return header;
  return null;
}

/**
 * @param {object} req
 */
export function extractApiKeyFromRequest(req) {
  const headers = req?.headers || {};
  const query = req?.query || {};

  for (const candidate of [
    headers['x-api-key'],
    headers['api-key'],
    extractApiKeyFromAuthHeader(headers.authorization),
  ]) {
    const key = normalizeApiKeyCandidate(candidate);
    if (key) return key;
  }

  // WS / 兼容：仅 api_key|apiKey；勿收 token/key/body（易进日志、易撞字段）
  for (const candidate of [query.api_key, query.apiKey]) {
    const key = normalizeApiKeyCandidate(candidate);
    if (key) return key;
  }

  return null;
}
