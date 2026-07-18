/**
 * 轻量可观测性：请求关联 ID + ALS 上下文 + span + 就绪聚合。
 * 不引入 OpenTelemetry SDK；与 RuntimeUtil.makeLog / HTTP 头对齐。
 * Prometheus 文本由 formatPrometheusMetrics 导出。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import RuntimeUtil from '#utils/runtime-util.js';

const requestAls = new AsyncLocalStorage();

const REQUEST_ID_HEADERS = ['x-request-id', 'x-correlation-id', 'x-trace-id'];

/**
 * @param {import('express').Request} req
 * @returns {string}
 */
export function resolveRequestId(req) {
  const headers = req?.headers || {};
  for (const key of REQUEST_ID_HEADERS) {
    const raw = headers[key];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 128);
  }
  return `${Date.now()}-${RuntimeUtil.shortId()}`;
}

/** @returns {{ requestId?: string, path?: string, method?: string }|undefined} */
export function getRequestContext() {
  return requestAls.getStore();
}

/**
 * @param {{ requestId: string, path?: string, method?: string }} ctx
 */
export function enterRequestContext(ctx) {
  requestAls.enterWith(ctx);
}

/**
 * @template T
 * @param {{ requestId: string, path?: string, method?: string }} ctx
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithRequestContext(ctx, fn) {
  return requestAls.run(ctx, fn);
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} [attrs]
 */
export function createSpan(name, attrs = {}) {
  const start = Date.now();
  const requestId = getRequestContext()?.requestId;
  const base = { ...attrs, ...(requestId ? { requestId } : {}) };

  const finish = (level, extra = {}) => {
    const durationMs = Date.now() - start;
    const payload = { span: name, durationMs, ...base, ...extra };
    const msg = Object.entries(payload)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    RuntimeUtil.makeLog(level, msg, 'Obs');
    return durationMs;
  };

  return {
    name,
    end: (extra) => finish('debug', extra),
    fail: (err, extra = {}) =>
      finish('warn', {
        ...extra,
        error: (typeof Error.isError === 'function' ? Error.isError(err) : err instanceof Error)
          ? err.message
          : String(err ?? 'unknown'),
      }),
  };
}

/**
 * 探测已配置子服 /health（短超时；失败仅 degraded，不拖垮 Redis 就绪）
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 */
export async function probeSubserverHealth(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 800;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const out = {};

  try {
    const { SUBSERVER_RUNTIME_CATALOG } = await import('#utils/subserver-runtimes.js');
    const { getSubserverConfig } = await import('#utils/subserver-client.js');
    const runtimeConfig = (await import('#infrastructure/config/config.js')).default;
    const root = runtimeConfig.subserver ?? {};
    const runtimes = root.runtimes && typeof root.runtimes === 'object' ? root.runtimes : {};

    const ids = Object.keys(SUBSERVER_RUNTIME_CATALOG).filter((id) => {
      const entry = runtimes[id];
      return !(entry && entry.enabled === false);
    });

    await Promise.all(
      ids.map(async (id) => {
        try {
          const { baseUrl } = getSubserverConfig(id);
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeoutMs);
          try {
            const res = await fetchImpl(`${baseUrl}/health`, {
              method: 'GET',
              signal: ctrl.signal,
            });
            out[id] = {
              status: res.ok ? 'operational' : 'degraded',
              httpStatus: res.status,
            };
          } finally {
            clearTimeout(timer);
          }
        } catch (err) {
          out[id] = {
            status: 'unavailable',
            error: (typeof Error.isError === 'function' ? Error.isError(err) : err instanceof Error)
              ? err.message
              : String(err ?? 'unreachable'),
          };
        }
      })
    );
  } catch (err) {
    return {
      status: 'unavailable',
      error: (typeof Error.isError === 'function' ? Error.isError(err) : err instanceof Error)
        ? err.message
        : String(err),
    };
  }

  const values = Object.values(out);
  const anyUp = values.some((v) => v?.status === 'operational');
  const allMissing = values.length === 0 || values.every((v) => v?.status === 'unavailable');
  return {
    status: anyUp ? 'operational' : allMissing ? 'unavailable' : 'degraded',
    runtimes: out,
  };
}

/**
 * @param {{ agentRuntime?: object, includeLoaders?: boolean, includeMcp?: boolean, includeSubservers?: boolean, subserverFetch?: typeof fetch }} [opts]
 */
export async function buildReadinessSnapshot(opts = {}) {
  const {
    agentRuntime = null,
    includeLoaders = true,
    includeMcp = true,
    includeSubservers = true,
  } = opts;
  const services = {};
  let overall = 'healthy';

  // Redis / SQLite：Runtime 硬依赖，失败 → unhealthy
  try {
    const { getDatabaseManager } = await import('#infrastructure/database/index.js');
    const dm = getDatabaseManager();
    const redisOk = await dm.checkRedis();
    services.redis = redisOk ? 'operational' : 'down';
    if (!redisOk) overall = 'unhealthy';

    const sqliteOk =
      typeof dm.checkSqlite === 'function' ? dm.checkSqlite() : false;
    services.sqlite = sqliteOk ? 'operational' : 'down';
    if (!sqliteOk) overall = 'unhealthy';
  } catch {
    services.redis = 'down';
    services.sqlite = 'down';
    overall = 'unhealthy';
  }

  if (agentRuntime) {
    const bots = Array.isArray(agentRuntime.uin) ? agentRuntime.uin.length : 0;
    services.bot = bots > 0 ? 'operational' : 'degraded';
    if (bots === 0 && overall === 'healthy') overall = 'degraded';
  }

  services.api = 'operational';

  if (includeLoaders) {
    try {
      const { default: AiWorkflowLoader } = await import('#infrastructure/ai-workflow/loader.js');
      const stats = AiWorkflowLoader.getStats?.() || {};
      services.workflows = {
        status: 'operational',
        total: stats.total ?? AiWorkflowLoader.workflows?.size ?? 0,
        enabled: stats.enabled ?? null,
      };
    } catch (err) {
      services.workflows = { status: 'down', error: err?.message || String(err) };
      if (overall === 'healthy') overall = 'degraded';
    }
  }

  if (includeMcp) {
    try {
      const { default: AiWorkflowLoader } = await import('#infrastructure/ai-workflow/loader.js');
      const mcp = AiWorkflowLoader.mcpServer;
      services.mcp = mcp
        ? {
            status: mcp.initialized ? 'operational' : 'degraded',
            tools: mcp.tools?.size ?? 0,
          }
        : { status: 'unavailable' };
    } catch {
      services.mcp = { status: 'unavailable' };
    }
  }

  if (includeSubservers) {
    const sub = await probeSubserverHealth({
      fetchImpl: opts.subserverFetch,
      timeoutMs: 600,
    });
    services.subservers = sub;
    if (sub.status === 'degraded' && overall === 'healthy') overall = 'degraded';
  }

  // 可选多模存储探活：仅展示；全挂不会单独 unhealthy；部分可用 → soft degraded
  try {
    const { probePersistenceProviders } = await import(
      '#infrastructure/database/persistence-registry.js'
    );
    const persistence = await probePersistenceProviders();
    services.persistence = persistence;
    if (persistence.status === 'degraded' && overall === 'healthy') {
      overall = 'degraded';
    }
  } catch {
    services.persistence = { status: 'idle', stores: {} };
  }

  return {
    status: overall,
    timestamp: Date.now(),
    uptime: process.uptime(),
    requestId: getRequestContext()?.requestId ?? null,
    services,
  };
}

/**
 * 将进程指标转为 Prometheus exposition（text/plain）
 * @param {object} metrics buildProcessMetrics() 结果
 * @returns {string}
 */
export function formatPrometheusMetrics(metrics) {
  const lines = [];
  const mem = metrics.memory || {};
  const cpu = metrics.cpu || {};
  const wf = metrics.workflow?.traces || {};

  const num = (name, value, help, type = 'gauge') => {
    if (!Number.isFinite(Number(value))) return;
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    lines.push(`${name} ${Number(value)}`);
  };

  num('xrk_process_uptime_seconds', metrics.uptime, 'Process uptime in seconds');
  num('xrk_nodejs_heap_used_bytes', mem.heapUsed, 'Node.js heap used bytes');
  num('xrk_nodejs_heap_total_bytes', mem.heapTotal, 'Node.js heap total bytes');
  num('xrk_nodejs_rss_bytes', mem.rss, 'Node.js resident set size bytes');
  num('xrk_process_cpu_user_microseconds', cpu.user, 'CPU user time microseconds', 'counter');
  num('xrk_process_cpu_system_microseconds', cpu.system, 'CPU system time microseconds', 'counter');
  num('xrk_workflow_traces_total', wf.total, 'Workflow execution traces total');
  num('xrk_workflow_traces_failed', wf.failed, 'Workflow execution traces failed');
  num('xrk_workflow_avg_duration_ms', metrics.workflow?.avgDurationMs, 'Workflow avg duration ms');

  const http = metrics.http || {};
  const lat = http.latencyMs || {};
  num('xrk_http_requests_total', http.total, 'HTTP requests observed total', 'counter');
  num('xrk_http_requests_failed', http.fail, 'HTTP requests failed (status>=500 or client abort)', 'counter');
  num('xrk_http_error_rate', http.errorRate, 'HTTP error rate (all-time window)');
  num('xrk_http_sliding_error_rate', http.slidingErrorRate, 'HTTP error rate (sliding window)');
  num('xrk_http_rps', http.rps, 'HTTP requests per second (since metrics start)');
  num('xrk_http_latency_ms_avg', lat.avg, 'HTTP latency average ms');
  num('xrk_http_latency_ms_p50', lat.p50, 'HTTP latency p50 ms (R-7)');
  num('xrk_http_latency_ms_p95', lat.p95, 'HTTP latency p95 ms (R-7)');
  num('xrk_http_latency_ms_p99', lat.p99, 'HTTP latency p99 ms (R-7)');
  num('xrk_http_latency_ms_max', lat.max, 'HTTP latency max ms');

  return `${lines.join('\n')}\n`;
}

/**
 * @param {{ getWebSocketStats?: () => object, getTraceSummary?: () => object, httpPort?: number, httpsPort?: number, actualPort?: number, actualHttpsPort?: number, proxyEnabled?: boolean, workflow?: object, http?: object }} [runtime]
 */
export function buildProcessMetrics(runtime = {}) {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  const workflow =
    typeof runtime.getTraceSummary === 'function'
      ? runtime.getTraceSummary()
      : runtime.workflow ?? null;

  return {
    timestamp: Date.now(),
    uptime: process.uptime(),
    requestId: getRequestContext()?.requestId ?? null,
    memory: {
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system,
    },
    websocket: typeof runtime.getWebSocketStats === 'function' ? runtime.getWebSocketStats() : null,
    workflow,
    /** 入站 HTTP 延迟直方图摘要（水库采样）；未注入时为 null */
    http: runtime.http ?? null,
    server: {
      httpPort: runtime.httpPort,
      httpsPort: runtime.httpsPort,
      actualPort: runtime.actualPort,
      actualHttpsPort: runtime.actualHttpsPort,
      proxyEnabled: runtime.proxyEnabled,
    },
    platform: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  };
}

export default {
  resolveRequestId,
  getRequestContext,
  enterRequestContext,
  runWithRequestContext,
  createSpan,
  buildReadinessSnapshot,
  probeSubserverHealth,
  formatPrometheusMetrics,
  buildProcessMetrics,
};
