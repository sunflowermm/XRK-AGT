/**
 * data/ 相对路径 → 子服务端文件 API 代理（供 /subserver-file 与业务插件共用）
 */

/** @typedef {{ prefix: string, upstream: string, runtime?: string }} SubserverFileRoute */

/**
 * @param {string} relPath data/ 下相对路径（posix）
 * @returns {SubserverFileRoute|null}
 */
export function resolveSubserverFileUpstream(relPath) {
  const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith('data/')) return null;

  const match = /^data\/([^/]+)\//.exec(normalized);
  if (!match) return null;

  const group = match[1];
  if (group === 'subserver') return null;

  return {
    prefix: `data/${group}/`,
    upstream: `/api/${group}/file`,
    runtime: 'pyserver'
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
