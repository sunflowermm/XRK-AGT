/**
 * 纯 Node fetch 的并发 HTTP 压测引擎（无 k6/autocannon 依赖）
 */
import { LatencyHistogram } from './stats.mjs';

/**
 * @typedef {{
 *   url: string,
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: string | null,
 *   timeoutMs?: number,
 *   expectStatus?: number | number[],
 * }} RequestSpec
 */

/**
 * @param {RequestSpec} spec
 * @returns {Promise<{ ok: boolean, ms: number, status: number, bytes: number, error?: string }>}
 */
async function once(spec) {
  const started = performance.now();
  const ctrl = new AbortController();
  const timeoutMs = spec.timeoutMs ?? 10_000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(spec.url, {
      method: spec.method || 'GET',
      headers: spec.headers || {},
      body: spec.body ?? undefined,
      signal: ctrl.signal,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const ms = performance.now() - started;
    const expect = spec.expectStatus;
    const okStatuses = expect == null
      ? null
      : Array.isArray(expect)
        ? expect
        : [expect];
    const ok = okStatuses ? okStatuses.includes(res.status) : res.status >= 200 && res.status < 400;
    return { ok, ms, status: res.status, bytes: buf.length };
  } catch (err) {
    const ms = performance.now() - started;
    return {
      ok: false,
      ms,
      status: 0,
      bytes: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 固定并发、按时长跑（Load / Soak）
 * @param {{
 *   buildRequest: () => RequestSpec,
 *   concurrency: number,
 *   durationMs: number,
 *   rampMs?: number,
 *   onTick?: (hist: LatencyHistogram) => void,
 *   reservoirSize?: number|null,
 *   slidingWindow?: number,
 * }} opts
 */
export async function runDurationLoad(opts) {
  const longRun = (opts.durationMs || 0) >= 60_000;
  /** null = 强制全量；未传则长跑默认水库 */
  let reservoirSize = opts.reservoirSize;
  if (reservoirSize === undefined) {
    reservoirSize = longRun ? 10_000 : null;
  }
  const histOpts = {};
  if (reservoirSize != null && reservoirSize > 0) {
    histOpts.reservoirSize = reservoirSize;
  }
  if (opts.slidingWindow != null) {
    histOpts.slidingWindow = opts.slidingWindow;
  } else if (longRun) {
    histOpts.slidingWindow = 500;
  }
  const hist = new LatencyHistogram(histOpts);
  hist.begin();
  const endAt = Date.now() + opts.durationMs;
  const rampMs = opts.rampMs ?? 0;
  let active = true;
  let inFlight = 0;

  const workers = Array.from({ length: opts.concurrency }, async (_, workerIdx) => {
    if (rampMs > 0) {
      const delay = Math.floor((rampMs / opts.concurrency) * workerIdx);
      await new Promise((r) => setTimeout(r, delay));
    }
    while (active && Date.now() < endAt) {
      inFlight += 1;
      const row = await once(opts.buildRequest());
      inFlight -= 1;
      hist.record(row);
    }
  });

  const ticker = setInterval(() => {
    opts.onTick?.(hist);
  }, 2000);

  await Promise.all(workers);
  active = false;
  clearInterval(ticker);
  while (inFlight > 0) {
    await new Promise((r) => setTimeout(r, 10));
  }
  hist.end();
  return hist;
}

/**
 * 固定请求数（Benchmark）
 * @param {{
 *   buildRequest: () => RequestSpec,
 *   totalRequests: number,
 *   concurrency: number,
 * }} opts
 */
export async function runFixedBenchmark(opts) {
  const hist = new LatencyHistogram();
  hist.begin();
  let next = 0;
  const total = opts.totalRequests;

  const workers = Array.from({ length: opts.concurrency }, async () => {
    while (true) {
      const i = next++;
      if (i >= total) break;
      hist.record(await once(opts.buildRequest()));
    }
  });

  await Promise.all(workers);
  hist.end();
  return hist;
}

/**
 * 阶梯加压直到 SLO 破坏或达到 maxConcurrency（Stress）
 * @param {{
 *   buildRequest: () => RequestSpec,
 *   startConcurrency: number,
 *   maxConcurrency: number,
 *   step: number,
 *   stepDurationMs: number,
 *   slo: { maxP99Ms?: number, maxErrorRate?: number },
 * }} opts
 */
export async function runStressRamp(opts) {
  /** @type {Array<{ concurrency: number, summary: ReturnType<LatencyHistogram['summary']>, broke: boolean }>} */
  const steps = [];
  let brokeAt = null;

  for (
    let c = opts.startConcurrency;
    c <= opts.maxConcurrency;
    c += opts.step
  ) {
    const hist = await runDurationLoad({
      buildRequest: opts.buildRequest,
      concurrency: c,
      durationMs: opts.stepDurationMs,
      rampMs: Math.min(1000, Math.floor(opts.stepDurationMs / 4)),
    });
    const summary = hist.summary();
    const { ok } = evaluateStep(summary, opts.slo);
    steps.push({ concurrency: c, summary, broke: !ok });
    if (!ok) {
      brokeAt = c;
      break;
    }
  }

  return { steps, brokeAt, maxSustainable: brokeAt ? brokeAt - opts.step : opts.maxConcurrency };
}

function evaluateStep(summary, slo) {
  const violations = [];
  if (slo.maxP99Ms != null && summary.latencyMs.p99 > slo.maxP99Ms) {
    violations.push('p99');
  }
  if (slo.maxErrorRate != null && summary.errorRate > slo.maxErrorRate) {
    violations.push('errors');
  }
  return { ok: violations.length === 0, violations };
}

/**
 * 轻量混沌：间歇性注入超时/错误比例（客户端侧模拟坏网络）
 * @param {{
 *   buildRequest: () => RequestSpec,
 *   concurrency: number,
 *   durationMs: number,
 *   injectRate: number,
 * }} opts
 */
export async function runChaosLight(opts) {
  const inject = Math.min(1, Math.max(0, opts.injectRate));
  return runDurationLoad({
    buildRequest: () => {
      const base = opts.buildRequest();
      if (Math.random() < inject) {
        return {
          ...base,
          timeoutMs: 1,
          url: `${base.url.replace(/\/$/, '')}/__chaos_no_such_path__`,
        };
      }
      return base;
    },
    concurrency: opts.concurrency,
    durationMs: opts.durationMs,
  });
}
