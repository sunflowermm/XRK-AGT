/**
 * sign.json 与主服 server 配置合并：sign 已写字段优先，未写则回落主服。
 * 仅覆盖「可按挂载点覆盖」的段（static / rateLimit），不改 host/port 等全局项。
 */
import rateLimit from 'express-rate-limit';
import { isPrivateOrLoopbackAddress } from '#infrastructure/http/auth.js';

/**
 * 深度合并：overlay 中已定义的键覆盖 base；`undefined` 不覆盖。
 * 数组整段替换（不做按索引合并）。
 *
 * @param {unknown} base
 * @param {unknown} overlay
 * @returns {unknown}
 */
export function mergePreferDefined(base, overlay) {
  if (overlay === undefined) {
    return base !== null && typeof base === 'object' && !Array.isArray(base)
      ? { ...base }
      : base;
  }
  if (overlay === null || typeof overlay !== 'object' || Array.isArray(overlay)) {
    return overlay;
  }
  if (base === null || typeof base !== 'object' || Array.isArray(base)) {
    return { ...overlay };
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (v === undefined) continue;
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      out[k] !== null &&
      typeof out[k] === 'object' &&
      !Array.isArray(out[k])
    ) {
      out[k] = mergePreferDefined(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * 解析本挂载点相对主服的覆盖项。
 *
 * @param {object | null | undefined} sign
 * @param {object} [serverOrRoot] `runtimeConfig.server` 或整份 `runtimeConfig`（取 `.server`）
 * @returns {{
 *   static: object,
 *   rateLimit: null | { enabled: false } | { enabled: true, windowMs?: number, max?: number, message?: string },
 * }}
 */
export function resolveWwwMountOverlays(sign, serverOrRoot = {}) {
  const server =
    serverOrRoot && typeof serverOrRoot === 'object' && serverOrRoot.server
      ? serverOrRoot.server
      : serverOrRoot || {};
  const serverStatic =
    server.static && typeof server.static === 'object' ? server.static : {};
  const signStatic =
    sign?.static && typeof sign.static === 'object' && !Array.isArray(sign.static)
      ? sign.static
      : {};
  const topCache =
    sign && sign.cacheTime != null ? { cacheTime: sign.cacheTime } : {};
  const staticMerged = /** @type {object} */ (
    mergePreferDefined(serverStatic, { ...signStatic, ...topCache })
  );

  /** @type {null | { enabled: false } | { enabled: true, windowMs?: number, max?: number, message?: string }} */
  let mountRateLimit = null;
  if (sign?.rateLimit && typeof sign.rateLimit === 'object' && !Array.isArray(sign.rateLimit)) {
    const serverRl =
      server.rateLimit && typeof server.rateLimit === 'object' ? server.rateLimit : {};
    const merged = /** @type {Record<string, any>} */ (
      mergePreferDefined(serverRl, sign.rateLimit)
    );
    if (merged.enabled === false) {
      mountRateLimit = { enabled: false };
    } else {
      const fromMount =
        merged.mount && typeof merged.mount === 'object' && !Array.isArray(merged.mount)
          ? merged.mount
          : null;
      const fromGlobal =
        merged.global && typeof merged.global === 'object' && !Array.isArray(merged.global)
          ? merged.global
          : {};
      const leaf = fromMount
        ? /** @type {Record<string, any>} */ (mergePreferDefined(fromGlobal, fromMount))
        : {
            windowMs: merged.windowMs ?? fromGlobal.windowMs,
            max: merged.max ?? fromGlobal.max,
            message: merged.message ?? fromGlobal.message,
          };
      mountRateLimit = {
        enabled: true,
        windowMs: leaf.windowMs,
        max: leaf.max,
        message: leaf.message,
      };
    }
  }

  return { static: staticMerged, rateLimit: mountRateLimit };
}

/**
 * 在全局 `createStaticOptions` 基础上套本挂载的 static 覆盖。
 *
 * @param {object} baseStaticOptions
 * @param {object} [overlayStatic]
 */
export function applyWwwStaticOverlay(baseStaticOptions, overlayStatic = {}) {
  const o = overlayStatic && typeof overlayStatic === 'object' ? overlayStatic : {};
  return {
    ...baseStaticOptions,
    ...(o.index !== undefined ? { index: o.index } : {}),
    ...(o.extensions !== undefined ? { extensions: o.extensions } : {}),
    ...(o.cacheTime !== undefined ? { maxAge: o.cacheTime } : {}),
    ...(o.immutable !== undefined ? { immutable: o.immutable !== false } : {}),
  };
}

/**
 * 本挂载路径限流中间件；`rateLimit.enabled === false` 或未配置则返回 null。
 *
 * @param {null | { enabled?: boolean, windowMs?: number, max?: number, message?: string }} rateLimitOverlay
 * @returns {import('express').RequestHandler | null}
 */
export function createWwwMountRateLimiter(rateLimitOverlay) {
  if (!rateLimitOverlay || rateLimitOverlay.enabled === false) return null;
  return rateLimit({
    windowMs: rateLimitOverlay.windowMs || 15 * 60 * 1000,
    max: rateLimitOverlay.max || 1000,
    message: rateLimitOverlay.message || '请求过于频繁，请稍后再试',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => isPrivateOrLoopbackAddress(req.ip),
  });
}
