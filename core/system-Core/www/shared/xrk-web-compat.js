/**
 * Core www 浏览器兼容层（底层标准实现）
 *
 * 挂载：`core/system-Core/www/shared/` → `/shared/`（见 `mountCoreWwwStatic`）
 * URL：`/shared/xrk-web-compat.js`
 * 约定：skill `xrk-www-compat` · rules `xrk-dev-requirements` · `docs/coding-style.md` §1.1
 *
 * 面向校园 WebView / HTTP 非安全上下文 / 旧 Chromium：
 * **勿**假设 Node 26 或桌面 Chrome 全量 API（`randomUUID`、`AbortSignal.timeout`、`structuredClone`）。
 *
 * @example ESM
 * import { randomId, unwrapSuccess, abortTimeout, deepClone } from '/shared/xrk-web-compat.js';
 *
 * @example 经典脚本
 * // 内联同名函数，并注释「与 /shared/xrk-web-compat.js 对齐」
 *
 * 控制台再导出：`core/system-Core/www/xrk/modules/utils.js`
 */

/**
 * 生成短 ID（优先 crypto.randomUUID；缺失或不可调用时降级）
 * @param {string} [prefix='id']
 * @returns {string}
 */
export function randomId(prefix = 'id') {
  try {
    const uuid = globalThis.crypto?.randomUUID;
    if (typeof uuid === 'function') return uuid.call(globalThis.crypto);
  } catch {
    /* fall through：非安全上下文 / 残缺 WebCrypto */
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * 解包 `HttpResponse.success` 的 JSON 体（与服务端拍平约定对称）
 *
 * - `success !== true` → throw（message 优先）
 * - 存在 `data` 字段（含数组/标量/刻意 `{ data: payload }`）→ 返回 `json.data`
 * - 否则去掉 `success`/`message` 后返回剩余业务字段（可能为 `{}`）
 *
 * @param {object} json
 * @returns {any}
 * @throws {Error} 当 `json.success` 不为真
 * @see HttpResponse.success in `src/utils/http-utils.js`
 */
export function unwrapSuccess(json) {
  if (!json?.success) throw new Error(json?.message || '请求失败');
  if (json.data !== undefined) return json.data;
  const { success: _ok, message: _msg, ...rest } = json;
  return rest;
}

/**
 * 带超时的 AbortSignal（优先原生 `AbortSignal.timeout`，否则 AbortController 降级）
 *
 * 服务端 Node 代码应继续用 `AbortSignal.timeout`；**仅浏览器 www** 走本函数。
 *
 * @param {number} ms
 * @returns {AbortSignal}
 */
export function abortTimeout(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  return controller.signal;
}

/**
 * 深拷贝：优先 `structuredClone`；失败则 JSON 往返；仍失败则浅拷贝数组/对象
 *
 * @param {any} value
 * @returns {any}
 */
export function deepClone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* 含不可克隆值时 fall through */
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return Array.isArray(value) ? value.slice() : { ...value };
  }
}
