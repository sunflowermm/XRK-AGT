/**
 * 延迟直方图与汇总统计（生产级压测共用）
 */
export class LatencyHistogram {
  constructor() {
    /** @type {number[]} */
    this.samples = [];
    this.ok = 0;
    this.fail = 0;
    this.statusCounts = Object.create(null);
    this.bytesIn = 0;
    this.startMs = 0;
    this.endMs = 0;
  }

  begin() {
    this.startMs = Date.now();
  }

  end() {
    this.endMs = Date.now();
  }

  /**
   * @param {{ ok: boolean, ms: number, status?: number, bytes?: number }} row
   */
  record(row) {
    this.samples.push(row.ms);
    if (row.ok) this.ok += 1;
    else this.fail += 1;
    const st = row.status ?? 0;
    this.statusCounts[st] = (this.statusCounts[st] || 0) + 1;
    this.bytesIn += row.bytes || 0;
  }

  get elapsedMs() {
    return Math.max(1, (this.endMs || Date.now()) - this.startMs);
  }

  get total() {
    return this.ok + this.fail;
  }

  get rps() {
    return (this.total / this.elapsedMs) * 1000;
  }

  get errorRate() {
    return this.total === 0 ? 0 : this.fail / this.total;
  }

  /**
   * @param {number} p 0–100
   */
  percentile(p) {
    if (!this.samples.length) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }

  summary() {
    const avg =
      this.samples.length === 0
        ? 0
        : this.samples.reduce((s, v) => s + v, 0) / this.samples.length;
    return {
      total: this.total,
      ok: this.ok,
      fail: this.fail,
      errorRate: Number(this.errorRate.toFixed(6)),
      elapsedMs: this.elapsedMs,
      rps: Number(this.rps.toFixed(2)),
      latencyMs: {
        min: this.samples.length ? Math.min(...this.samples) : 0,
        avg: Number(avg.toFixed(3)),
        p50: this.percentile(50),
        p90: this.percentile(90),
        p95: this.percentile(95),
        p99: this.percentile(99),
        max: this.samples.length ? Math.max(...this.samples) : 0,
      },
      statusCounts: { ...this.statusCounts },
      bytesIn: this.bytesIn,
    };
  }
}

/**
 * @param {ReturnType<LatencyHistogram['summary']>} summary
 * @param {{ maxP99Ms?: number, maxErrorRate?: number, minRps?: number }} slo
 */
export function evaluateSlo(summary, slo = {}) {
  const violations = [];
  if (slo.maxP99Ms != null && summary.latencyMs.p99 > slo.maxP99Ms) {
    violations.push(`p99 ${summary.latencyMs.p99}ms > ${slo.maxP99Ms}ms`);
  }
  if (slo.maxErrorRate != null && summary.errorRate > slo.maxErrorRate) {
    violations.push(`errorRate ${summary.errorRate} > ${slo.maxErrorRate}`);
  }
  if (slo.minRps != null && summary.rps < slo.minRps) {
    violations.push(`rps ${summary.rps} < ${slo.minRps}`);
  }
  return { ok: violations.length === 0, violations };
}
