/**
 * AgentRuntime 存活/指标/状态 HTTP 处理（从 agent-runtime 拆出，降 Facade 集中度）
 */
import { HttpResponse } from '#utils/http-utils.js';
import MonitorService from '#infrastructure/ai-workflow/monitor-service.js';
import runtimeConfig from '#infrastructure/config/config.js';
import {
  buildProcessMetrics,
  formatPrometheusMetrics,
} from '#utils/observability.js';

/**
 * @param {object} runtime AgentRuntime
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function handleLiveness(runtime, req, res) {
  if (runtime._checkHeadersSent(res)) return;
  return HttpResponse.json(res, {
    status: '健康',
    uptime: process.uptime(),
    timestamp: Date.now(),
    requestId: req.requestId || null,
  });
}

/**
 * @param {object} runtime AgentRuntime
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function handleStatus(runtime, req, res) {
  if (runtime._checkHeadersSent(res)) return;

  const status = {
    status: '运行中',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    timestamp: Date.now(),
    version: process.version,
    platform: process.platform,
    server: {
      httpPort: runtime.httpPort,
      httpsPort: runtime.httpsPort,
      actualPort: runtime.actualPort,
      actualHttpsPort: runtime.actualHttpsPort,
      https: runtimeConfig.server?.https?.enabled || false,
      proxy: runtime.proxyEnabled,
      domains: runtime.proxyEnabled ? Array.from(runtime.domainConfigs.keys()) : [],
    },
    auth: {
      apiKeyEnabled: runtimeConfig.server?.auth?.apiKey?.enabled !== false,
    },
  };

  return HttpResponse.json(res, status);
}

/**
 * @param {object} runtime AgentRuntime
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function handleMetrics(runtime, req, res) {
  if (runtime._checkHeadersSent(res)) return;

  const metrics = buildProcessMetrics({
    getWebSocketStats: () => runtime.getWebSocketStats(),
    getTraceSummary: () => MonitorService.getTraceSummary(),
    httpPort: runtime.httpPort,
    httpsPort: runtime.httpsPort,
    actualPort: runtime.actualPort,
    actualHttpsPort: runtime.actualHttpsPort,
    proxyEnabled: runtime.proxyEnabled,
  });

  const wantProm =
    String(req.query?.format || '').toLowerCase() === 'prometheus' ||
    String(req.headers?.accept || '').includes('text/plain');

  if (wantProm) {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(formatPrometheusMetrics(metrics));
    return;
  }

  return HttpResponse.json(res, metrics);
}
