/**
 * 主服务端 → Python 子服务端 HTTP 客户端
 *
 * 配置单一来源：aistream.yaml 的 subserver 段（host/port/timeout）。
 * 子服务端仅提供底层框架与 apis/ 扩展；LLM/RAG 由主服务端 Node 侧负责。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8000;
const DEFAULT_TIMEOUT = 30000;

/** @returns {{ host: string, port: number, timeout: number, baseUrl: string }} */
export function getSubserverConfig() {
  const config = getAistreamConfigOptional().subserver || {};
  const host = config.host || DEFAULT_HOST;
  const port = Number(config.port) || DEFAULT_PORT;
  const timeout = Number(config.timeout) || DEFAULT_TIMEOUT;
  return {
    host,
    port,
    timeout,
    baseUrl: `http://${host}:${port}`
  };
}

/**
 * 调用子服务端 HTTP API
 * @param {string} requestPath - 如 /health、/api/system/ping
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal, rawResponse?: boolean, timeout?: number, query?: Record<string, unknown> }} [options]
 */
export async function callSubserver(requestPath, options = {}) {
  const { baseUrl, timeout: defaultTimeout } = getSubserverConfig();
  const { method = 'POST', body, signal, rawResponse, timeout, query } = options;
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

/** 子服务端根 URL */
export function getSubserverBaseUrl() {
  return getSubserverConfig().baseUrl;
}

/**
 * 从子服务端下载二进制到本地
 * @param {string} requestPath - 子服务 GET 路径（如 /api/xxx/file）
 * @param {{ query?: Record<string, unknown>, dest: string, timeout?: number }} options
 */
export async function fetchSubserverToPath(requestPath, options = {}) {
  const { query, dest, timeout } = options;
  if (!dest) throw new Error('fetchSubserverToPath 需要 dest');

  const response = await callSubserver(requestPath, {
    method: 'GET',
    query,
    rawResponse: true,
    timeout
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('子服务端返回空文件');

  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buffer);
  return dest;
}
