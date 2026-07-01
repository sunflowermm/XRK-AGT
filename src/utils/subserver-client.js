/**
 * 主服务端 → 多语言子服务端 HTTP 客户端
 *
 * 配置：aistream.yaml → subserver（default、timeout、runtimes）
 */
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import {
  SUBSERVER_RUNTIME_CATALOG,
  listSubserverRuntimes
} from '#utils/subserver-runtimes.js';

export { listSubserverRuntimes, SUBSERVER_RUNTIME_CATALOG };

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_TIMEOUT = 30000;

/** Docker Compose 内用服务名覆盖 yaml 中的 127.0.0.1 */
function applyDockerHostOverride(id, host, port) {
  if (!process.env.DOCKER_CONTAINER) return { host, port };
  const key = id.toUpperCase().replace(/-/g, '_');
  const envHost = process.env[`SUBSERVER_${key}_HOST`];
  const envPort = process.env[`SUBSERVER_${key}_PORT`];
  return {
    host: envHost || host,
    port: envPort ? Number(envPort) || port : port
  };
}

/**
 * 读取 runtime 端点（aistream.yaml → subserver.runtimes）
 * @param {Record<string, unknown>} config
 * @param {string} id
 */
function resolveRuntimeEntry(config, id) {
  const root = /** @type {Record<string, unknown>} */ (config.subserver || {});
  const runtimes = /** @type {Record<string, Record<string, unknown>>|undefined} */ (root.runtimes);
  if (runtimes?.[id] && typeof runtimes[id] === 'object') {
    return runtimes[id];
  }
  return null;
}

/** @returns {string} */
export function getSubserverDefaultRuntime() {
  const config = getAistreamConfigOptional();
  const id = config.subserver?.default;
  if (id && SUBSERVER_RUNTIME_CATALOG[id]) return id;
  return 'pyserver';
}

/**
 * @param {string} [runtimeId]
 */
export function getSubserverConfig(runtimeId) {
  const config = getAistreamConfigOptional();
  const root = config.subserver || {};
  const id = runtimeId || getSubserverDefaultRuntime();
  const catalog = SUBSERVER_RUNTIME_CATALOG[id] || SUBSERVER_RUNTIME_CATALOG.pyserver;

  let host = DEFAULT_HOST;
  let port = catalog.port;
  let timeout = Number(root.timeout) || DEFAULT_TIMEOUT;

  const entry = resolveRuntimeEntry(config, id);
  if (entry) {
    if (entry.enabled === false) {
      throw new Error(`子服务 runtime ${id} 已在配置中禁用`);
    }
    if (entry.host) host = String(entry.host);
    if (entry.port != null) port = Number(entry.port) || port;
    if (entry.timeout != null) timeout = Number(entry.timeout) || timeout;
  }

  ({ host, port } = applyDockerHostOverride(id, host, port));

  return {
    id,
    host,
    port,
    timeout,
    language: catalog.language,
    label: catalog.label,
    baseUrl: `http://${host}:${port}`
  };
}

/**
 * @param {string} requestPath
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal, rawResponse?: boolean, timeout?: number, query?: Record<string, unknown>, runtime?: string }} [options]
 */
export async function callSubserver(requestPath, options = {}) {
  const { runtime, method = 'POST', body, signal, rawResponse, timeout, query } = options;
  const { baseUrl, timeout: defaultTimeout } = getSubserverConfig(runtime);
  const url = new URL(`${baseUrl}${requestPath}`);

  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    }
  }

  const headers = {};
  const payload = body == null ? undefined : JSON.stringify(body);
  if (payload != null) headers['Content-Type'] = 'application/json';

  const requestTimeout = Number.isFinite(timeout) && timeout > 0 ? timeout : defaultTimeout;

  const response = await fetch(url, {
    method,
    headers,
    body: payload,
    signal: signal || AbortSignal.timeout(requestTimeout)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  if (rawResponse) return response;
  return response.json();
}

export async function fetchSubserverToPath(requestPath, options = {}) {
  const { query, dest, timeout, runtime } = options;
  if (!dest) throw new Error('fetchSubserverToPath 需要 dest');

  const response = await callSubserver(requestPath, {
    method: 'GET',
    query,
    rawResponse: true,
    timeout,
    runtime
  });

  await fs.mkdir(path.dirname(dest), { recursive: true });

  if (response.body) {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
  } else {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('子服务端返回空文件');
    await fs.writeFile(dest, buffer);
  }

  const stat = await fs.stat(dest);
  if (!stat.size) throw new Error('子服务端返回空文件');
  return dest;
}
