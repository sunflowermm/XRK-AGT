/**
 * 开发/测试用服务端混沌钩子（默认关闭）
 * 启用：XRK_CHAOS_ENABLED=1（建议同时 XRK_TEST=1）
 *
 * 环境变量：
 *   XRK_CHAOS_LATENCY_MS   额外延迟上限毫秒（默认 0）
 *   XRK_CHAOS_ERROR_RATE   0–1，随机 503 概率（默认 0）
 *   XRK_CHAOS_PATHS        逗号分隔路径前缀，默认 /health,/metrics
 */
import RuntimeUtil from '#utils/runtime-util.js';

function isEnabled() {
  return process.env.XRK_CHAOS_ENABLED === '1';
}

function parsePaths() {
  const raw = process.env.XRK_CHAOS_PATHS || '/health,/metrics';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {import('express').Application} app
 */
export function attachChaosMiddleware(app) {
  if (!isEnabled()) return;

  const latencyCap = Math.max(0, Number(process.env.XRK_CHAOS_LATENCY_MS || 0) || 0);
  const errorRate = Math.min(1, Math.max(0, Number(process.env.XRK_CHAOS_ERROR_RATE || 0) || 0));
  const paths = parsePaths();

    RuntimeUtil.makeLog(
      'info',
      `混沌中间件已启用 latency≤${latencyCap}ms errorRate=${errorRate} paths=${paths.join('|')}`,
      'Chaos'
    );

  app.use(async (req, res, next) => {
    const hit = paths.some((p) => req.path === p || req.path.startsWith(p));
    if (!hit) return next();

    if (latencyCap > 0) {
      const wait = Math.floor(Math.random() * latencyCap);
      await new Promise((r) => setTimeout(r, wait));
    }

    if (errorRate > 0 && Math.random() < errorRate) {
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: 'chaos_injected',
          requestId: req.requestId || null,
        });
      }
      return;
    }

    next();
  });
}

/**
 * 供单元测：是否应启用
 */
export function chaosEnabled() {
  return isEnabled();
}
