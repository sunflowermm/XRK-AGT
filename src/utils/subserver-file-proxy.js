/**
 * data/ 相对路径 → 子服务端文件 API 代理（供 /subserver-file 与业务插件共用）
 */
import { parseDataSubserverPath } from '#utils/subserver-runtimes.js';

/** @typedef {{ prefix: string, upstream: string, runtime: string }} SubserverFileRoute */

/**
 * @param {string} relPath data/ 下相对路径（posix）
 * @returns {SubserverFileRoute|null}
 */
export function resolveSubserverFileUpstream(relPath) {
  const parsed = parseDataSubserverPath(relPath);
  if (!parsed) return null;
  const { dir, runtime } = parsed;
  return {
    prefix: `data/${dir}/`,
    upstream: `/api/${dir}/file`,
    runtime
  };
}

/**
 * @param {string} baseUrl 主服务公网根地址
 * @param {string} relPath data/ 相对路径
 */
export function buildSubserverFileLink(baseUrl, relPath) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!base || !relPath) return '';
  const params = new URLSearchParams({ path: relPath });
  return `${base}/subserver-file?${params}`;
}
