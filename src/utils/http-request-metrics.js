/**
 * 入站 HTTP 延迟聚合
 * 水库采样 + 滑动错误窗口；导出至 `/metrics.http` 与 Prometheus。
 */
import { LatencyHistogram } from '#utils/metrics-stats.js';

const DEFAULT_RESERVOIR = 8_000;
const DEFAULT_SLIDING = 500;

/** @type {LatencyHistogram|null} */
let hist = null;
let startedAt = 0;

function ensure() {
  if (!hist) {
    hist = new LatencyHistogram({
      reservoirSize: DEFAULT_RESERVOIR,
      slidingWindow: DEFAULT_SLIDING,
    });
    hist.begin();
    startedAt = Date.now();
  }
  return hist;
}

/** 测试用：重置全局直方图 */
export function resetHttpRequestMetrics() {
  hist = null;
  startedAt = 0;
}

/**
 * @param {{ ok: boolean, ms: number, status?: number, bytes?: number }} row
 */
export function recordHttpRequest(row) {
  ensure().record(row);
}

/**
 * @returns {ReturnType<LatencyHistogram['summary']> & { startedAt: number }}
 */
export function getHttpRequestMetricsSummary() {
  const h = ensure();
  return { ...h.summary(), startedAt };
}

/**
 * Express 中间件：在 `finish` 时记录延迟（默认跳过 `/metrics`）
 * @param {{ skipPaths?: string[] }} [opts]
 * @returns {import('express').RequestHandler}
 */
export function createHttpRequestMetricsMiddleware(opts = {}) {
  const skip = opts.skipPaths || ['/metrics'];
  return function httpRequestMetricsMiddleware(req, res, next) {
    const t0 = performance.now();
    res.once('finish', () => {
      const path = req.path || '';
      if (skip.some((p) => path === p || path.startsWith(`${p}/`))) return;
      const ms = performance.now() - t0;
      const status = res.statusCode || 0;
      const ok = status >= 200 && status < 500;
      recordHttpRequest({ ok, ms, status });
    });
    next();
  };
}
