/**
 * 压测目标预设（与 AgentRuntime 真实路由对齐）
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {{
 *   id: string,
 *   path: string,
 *   method?: string,
 *   auth?: boolean,
 *   expectStatus?: number | number[],
 *   weight?: number,
 *   note?: string,
 * }} TargetDef
 */

/** @type {Record<string, TargetDef>} */
export const TARGETS = {
  health: {
    id: 'health',
    path: '/health',
    auth: false,
    expectStatus: 200,
    note: '存活探活，无依赖',
  },
  metrics: {
    id: 'metrics',
    path: '/metrics',
    auth: false,
    expectStatus: 200,
    note: 'JSON 进程指标',
  },
  metrics_prom: {
    id: 'metrics_prom',
    path: '/metrics?format=prometheus',
    auth: false,
    expectStatus: 200,
    note: 'Prometheus 文本导出',
  },
  status: {
    id: 'status',
    path: '/status',
    auth: false,
    expectStatus: 200,
    note: '进程状态快照',
  },
  api_health: {
    id: 'api_health',
    path: '/api/health',
    auth: true,
    expectStatus: [200, 503],
    note: '就绪聚合（含 Redis/子服）',
  },
  plugins_summary: {
    id: 'plugins_summary',
    path: '/api/plugins/summary',
    auth: true,
    expectStatus: 200,
    note: '轻量鉴权读 API',
  },
  plugins_tasks: {
    id: 'plugins_tasks',
    path: '/api/plugins/tasks',
    auth: true,
    expectStatus: 200,
    note: '偏重鉴权读 API',
  },
  xrk: {
    id: 'xrk',
    path: '/xrk/',
    auth: false,
    expectStatus: 200,
    note: '控制台静态入口',
  },
};

/** 混合流量权重（生产近似） */
export const MIXED_PROFILE = [
  { id: 'health', weight: 70 },
  { id: 'plugins_summary', weight: 20 },
  { id: 'metrics_prom', weight: 10 },
];

/**
 * @param {string} repoRoot
 * @returns {string|null}
 */
export function loadApiKey(repoRoot) {
  const candidates = [
    path.join(repoRoot, 'config/server_config/api_key.json'),
    path.join(repoRoot, 'data/server_config/api_key.json'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof raw?.key === 'string' && raw.key.trim()) return raw.key.trim();
    } catch {
      // continue
    }
  }
  return process.env.XRK_API_KEY?.trim() || null;
}

/**
 * @param {string} baseUrl
 * @param {TargetDef} target
 * @param {{ apiKey?: string|null }} [opts]
 */
export function buildRequest(baseUrl, target, opts = {}) {
  const headers = {
    'x-request-id': `perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  if (target.auth && opts.apiKey) {
    headers['x-api-key'] = opts.apiKey;
  }
  const root = baseUrl.replace(/\/$/, '');
  return {
    url: `${root}${target.path}`,
    method: target.method || 'GET',
    headers,
    expectStatus: target.expectStatus,
    timeoutMs: 15_000,
  };
}

/**
 * @param {Array<{ id: string, weight: number }>} mix
 * @returns {() => TargetDef}
 */
export function weightedPicker(mix) {
  const expanded = [];
  for (const row of mix) {
    const t = TARGETS[row.id];
    if (!t) throw new Error(`未知目标: ${row.id}`);
    for (let i = 0; i < row.weight; i++) expanded.push(t);
  }
  if (!expanded.length) throw new Error('混合权重为空');
  return () => expanded[Math.floor(Math.random() * expanded.length)];
}
