/**
 * 预设档位（生产验收可复制命令）
 *
 * smoke   — CI 门禁（自举，宽松 SLO）
 * local   — 本机开发压测
 * staging — 预发验收（对已运行实例）
 * prodgate— 生产放行前硬门槛（需热机 + 关闭/放宽限流）
 */
export const PROFILES = {
  smoke: {
    mode: 'smoke',
    concurrency: 10,
    duration: '8s',
    target: 'health',
    slo: { maxP99Ms: 800, maxErrorRate: 0.02, minRps: 30 },
  },
  local: {
    mode: 'load',
    concurrency: 50,
    duration: '30s',
    target: 'health',
    slo: { maxP99Ms: 150, maxErrorRate: 0.01, minRps: 200 },
  },
  staging: {
    mode: 'load',
    concurrency: 80,
    duration: '2m',
    target: 'mixed',
    slo: { maxP99Ms: 120, maxErrorRate: 0.005, minRps: 300 },
  },
  prodgate: {
    mode: 'bench',
    concurrency: 100,
    requests: 10000,
    target: 'health',
    slo: { maxP99Ms: 50, maxErrorRate: 0.001, minRps: 800 },
  },
  soak30m: {
    mode: 'soak',
    concurrency: 25,
    duration: '30m',
    target: 'mixed',
    slo: { maxP99Ms: 200, maxErrorRate: 0.01 },
  },
};
