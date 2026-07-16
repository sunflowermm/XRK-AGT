/**
 * 轻量可观测性：请求关联 ID + ALS 上下文 + 计时 span。
 * 不引入 OpenTelemetry SDK；与现有 RuntimeUtil.makeLog / HTTP 头对齐。
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
 * 绑定当前请求上下文（Express 中间件请用此方法，勿用 run+next，否则 ALS 会在 next 返回后失效）
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
 * @returns {{ name: string, end: (extra?: Record<string, unknown>) => number, fail: (err: unknown, extra?: Record<string, unknown>) => number }}
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
        error: Error.isError(err) ? err.message : String(err ?? 'unknown'),
      }),
  };
}

/**
 * 就绪探活聚合（供 /api/health 使用）
 * @param {{ agentRuntime?: object, includeLoaders?: boolean, includeMcp?: boolean }} [opts]
 */
export async function buildReadinessSnapshot(opts = {}) {
  const { agentRuntime = null, includeLoaders = true, includeMcp = true } = opts;
  const services = {};
  let overall = 'healthy';

  try {
    const { getDatabaseManager } = await import('#infrastructure/database/index.js');
    const redisOk = await getDatabaseManager().checkRedis();
    services.redis = redisOk ? 'operational' : 'down';
    if (!redisOk) overall = 'unhealthy';
  } catch {
    services.redis = 'down';
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

  return {
    status: overall,
    timestamp: Date.now(),
    uptime: process.uptime(),
    requestId: getRequestContext()?.requestId ?? null,
    services,
  };
}

export default {
  resolveRequestId,
  getRequestContext,
  enterRequestContext,
  runWithRequestContext,
  createSpan,
  buildReadinessSnapshot,
};
