/**
 * 主服务端 → 多语言子服务端 HTTP 客户端
 *
 * 配置：ai-workflow.yaml → subserver（default、timeout、runtimes）
 */
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { getAiWorkflowConfigOptional } from '#utils/ai-workflow-config.js';
import runtimeConfig from '#infrastructure/config/config.js';
import { normalizeError } from '#utils/normalize-error.js';
import { SUBSERVER_RUNTIME_CATALOG } from '#utils/subserver-runtimes.js';

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
 * @param {Record<string, unknown>} subserverRoot ai-workflow.yaml → subserver
 * @param {string} id
 */
function resolveRuntimeEntry(subserverRoot, id) {
  const runtimes = /** @type {Record<string, Record<string, unknown>>|undefined} */ (subserverRoot?.runtimes);
  const entry = runtimes?.[id];
  return entry && typeof entry === 'object' ? entry : null;
}

/** @returns {string} */
export function getSubserverDefaultRuntime() {
  const root = runtimeConfig.subserver ?? getAiWorkflowConfigOptional().subserver ?? {};
  const id = root.default;
  if (id && SUBSERVER_RUNTIME_CATALOG[id]) return id;
  return 'pyserver';
}

/**
 * @param {string} [runtimeId]
 */
export function getSubserverConfig(runtimeId) {
  const root = runtimeConfig.subserver ?? {};
  const id = runtimeId || getSubserverDefaultRuntime();
  const catalog = SUBSERVER_RUNTIME_CATALOG[id] || SUBSERVER_RUNTIME_CATALOG.pyserver;

  let host = DEFAULT_HOST;
  let port = catalog.port;
  let timeout = Number(root.timeout) || DEFAULT_TIMEOUT;

  const entry = resolveRuntimeEntry(root, id);
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

/** @param {unknown} err */
function errorCauseCode(err) {
  const error = normalizeError(err);
  const cause = error.cause;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return String(/** @type {{ code?: string }} */ (cause).code || '');
  }
  if ('code' in error && typeof error.code === 'string') return error.code;
  return '';
}

/** @param {unknown} err */
export function isSubserverConnectionError(err) {
  const error = normalizeError(err);
  const code = errorCauseCode(error);
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
    return true;
  }
  if (error.name === 'TimeoutError') return true;
  const msg = error.message.toLowerCase();
  return msg.includes('timeout') || msg.includes('fetch failed');
}

/**
 * 将子服务调用异常转为用户可读说明
 * @param {unknown} err
 * @param {{ id?: string, label?: string, baseUrl?: string, host?: string, port?: number }} [runtime]
 */
export function formatSubserverError(err, runtime) {
  const error = normalizeError(err);
  const endpoint = runtime?.baseUrl || (runtime?.host ? `http://${runtime.host}:${runtime.port}` : '');
  const runtimeLabel = runtime?.label || runtime?.id || 'pyserver';
  const suffix = endpoint ? `（${runtimeLabel} @ ${endpoint}）` : `（${runtimeLabel}）`;

  const code = errorCauseCode(error);
  if (code === 'ECONNREFUSED') {
    return `子服务端可能未启动，连接被拒绝${suffix}\n请启动对应 runtime 并在 CommonConfig → AiWorkflow → 子服务端 核对地址端口`;
  }
  if (code === 'ECONNRESET') {
    return `子服务端连接被重置，可能正在重启或处理超时${suffix}`;
  }
  if (code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
    return `无法解析或到达子服务端${suffix}\n请检查 subserver 配置中的 host/port`;
  }
  if (error.name === 'TimeoutError' || error.message.toLowerCase().includes('timeout')) {
    return `子服务端响应超时${suffix}\n任务可能仍在后台运行，请稍后查看子服务日志`;
  }
  if (error.message.startsWith('HTTP ')) {
    const status = error.message.slice(5).split(':')[0].trim();
    if (status === '502' || status === '503' || status === '504') {
      return `子服务端不可用（HTTP ${status}）${suffix}\n请确认对应进程已启动`;
    }
    const detail = error.message.includes(':')
      ? error.message.slice(error.message.indexOf(':') + 1).trim()
      : '';
    return detail ? `子服务 HTTP ${status}: ${detail}` : `子服务 HTTP ${status}${suffix}`;
  }
  if (error.message.toLowerCase().includes('fetch failed')) {
    return `无法连接子服务端${suffix}\n请确认子服务进程已启动且网络可达`;
  }
  return error.message;
}

async function readHttpErrorDetail(response) {
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      const body = await response.json();
      if (body && typeof body === 'object') {
        return body.detail || body.error || body.message || '';
      }
    }
    const text = (await response.text()).trim();
    return text.slice(0, 300);
  } catch {
    return '';
  }
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
    const detail = await readHttpErrorDetail(response);
    throw new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
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
