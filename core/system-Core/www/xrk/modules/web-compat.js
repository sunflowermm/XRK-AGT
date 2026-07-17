/**
 * Core www 浏览器兼容层（语义权威；随 /xrk 进 git）
 *
 * 路径：`core/system-Core/www/xrk/modules/web-compat.js`
 * 控制台：`import { … } from './web-compat.js'`（utils.js 再导出）
 * 其它产品 Core：**只内联**同语义，禁止依赖本 URL（避免跨应用 404）
 *
 * 约定：skill `xrk-www-compat` · `RESERVED_ROOT_SEGMENTS` 含 `shared`
 */

/** @param {string} [prefix='id'] @returns {string} */
export function randomId(prefix = 'id') {
  try {
    const uuid = globalThis.crypto?.randomUUID;
    if (typeof uuid === 'function') return uuid.call(globalThis.crypto);
  } catch {
    /* fall through */
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * 解包 HttpResponse.success（对象拍平；数组/标量在 data）
 * @param {object} json
 * @returns {any}
 */
export function unwrapSuccess(json) {
  if (!json?.success) throw new Error(json?.message || '请求失败');
  if (json.data !== undefined) return json.data;
  const { success: _ok, message: _msg, ...rest } = json;
  return rest;
}

/** @param {number} ms @returns {AbortSignal} */
export function abortTimeout(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  return controller.signal;
}

/** @param {any} value @returns {any} */
export function deepClone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through */
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return Array.isArray(value) ? value.slice() : { ...value };
  }
}
