/**
 * 可复现伪随机（Mulberry32）与指数延迟采样
 * 混沌中间件、水库采样等可注入固定种子。
 */

/**
 * @param {number} seed
 * @returns {() => number} [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {string|number|null|undefined} seed 空则退回 Math.random
 * @returns {() => number}
 */
export function createRng(seed) {
  if (seed == null || seed === '') return Math.random;
  const n = typeof seed === 'number' ? seed : hashStringToU32(String(seed));
  return mulberry32(n);
}

/**
 * FNV-1a 风格串哈希 → u32
 * @param {string} s
 * @returns {number}
 */
export function hashStringToU32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 指数分布延迟（截断到 capMs）
 * @param {number} meanMs 均值
 * @param {number} capMs 上限
 * @param {() => number} [rng]
 * @returns {number} 整数毫秒
 */
export function exponentialDelayMs(meanMs, capMs, rng = Math.random) {
  const mean = Math.max(0, Number(meanMs) || 0);
  const cap = Math.max(0, Number(capMs) || 0);
  if (mean <= 0 || cap <= 0) return 0;
  const u = Math.min(0.999999, Math.max(1e-12, rng()));
  const x = -mean * Math.log(1 - u);
  return Math.min(cap, Math.floor(x));
}
