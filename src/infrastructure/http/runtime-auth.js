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
  isLoopback127Connection,
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
      runtime.apiKey = keyData.key;
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

  const forceAuth = options.forceAuth === true || shouldForceAuthOnLoopbackWhenToolsRun();
  const remoteAddress = req.socket?.remoteAddress || req.ip || '';
  if (!forceAuth && isLoopback127Connection(remoteAddress)) {
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
  return rules.some((rule) => rule.type === 'regex' ? rule.value.test(p) : p.startsWith(rule.value));
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
      const pattern = String(item || '').trim();
      if (!pattern) continue;
      if (pattern.startsWith('^')) {
        try {
          rules.push({ type: 'regex', value: new RegExp(pattern) });
        } catch {
          // ignore invalid regex
        }
      } else {
        rules.push({ type: 'prefix', value: pattern });
      }
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
  const body = req?.body || {};

  const headerCandidates = [
    headers['x-api-key'],
    headers['api-key'],
    headers['x-auth-token'],
    headers['x-access-token'],
    extractApiKeyFromAuthHeader(headers.authorization),
    extractApiKeyFromAuthHeader(headers['proxy-authorization']),
  ];
  for (const candidate of headerCandidates) {
    const key = normalizeApiKeyCandidate(candidate);
    if (key) return key;
  }

  const queryCandidates = [
    query.api_key,
    query.apiKey,
    query.apikey,
    query.access_token,
    query.token,
    query.key,
  ];
  for (const candidate of queryCandidates) {
    const key = normalizeApiKeyCandidate(candidate);
    if (key) return key;
  }

  const bodyCandidates = [
    body.api_key,
    body.apiKey,
    body.apikey,
    body.access_token,
    body.token,
    body.key,
  ];
  for (const candidate of bodyCandidates) {
    const key = normalizeApiKeyCandidate(candidate);
    if (key) return key;
  }

  return null;
}
