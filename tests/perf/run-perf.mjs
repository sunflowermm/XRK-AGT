/**
 * 生产级 HTTP 性能 / 韧性测试 CLI
 *
 * 用法:
 *   node tests/perf/run-perf.mjs <mode> [options]
 *
 * mode:
 *   load       固定并发按时长（负载）
 *   stress     阶梯加压至 SLO 破坏（压力）
 *   soak       长时中等并发（浸泡）
 *   bench      固定请求数基准
 *   chaos      故障注入（--chaos-mode client|server）
 *   smoke      自举短跑（CI 可门禁）
 *
 * 常用 options:
 *   --base-url http://127.0.0.1:8080
 *   --self                 自动启动 test-server
 *   --target health|metrics|api_health|plugins_summary|mixed|...
 *   --concurrency 50
 *   --duration 30s|5m
 *   --requests 5000
 *   --api-key <key>        或读 config/server_config/api_key.json
 *   --max-p99-ms 100
 *   --max-error-rate 0.01
 *   --min-rps 100
 *   --json out.json
 *   --ramp 5s
 *   --chaos-mode client|server
 *   --chaos-error-rate 0.2   (server)
 *   --chaos-latency-ms 50    (server)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runDurationLoad,
  runFixedBenchmark,
  runStressRamp,
  runChaosLight,
} from './lib/http-bench.mjs';
import { evaluateSlo } from './lib/stats.mjs';
import {
  TARGETS,
  MIXED_PROFILE,
  loadApiKey,
  buildRequest,
  weightedPicker,
} from './lib/targets.mjs';
import { startSelfServer } from './lib/self-server.mjs';
import { PROFILES } from './profiles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseDuration(raw, fallbackMs) {
  if (raw == null || raw === '') return fallbackMs;
  const s = String(raw).trim();
  const m = s.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
  if (!m) throw new Error(`无效时长: ${raw}`);
  const n = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  if (unit === 'ms') return Math.floor(n);
  if (unit === 's') return Math.floor(n * 1000);
  if (unit === 'm') return Math.floor(n * 60_000);
  if (unit === 'h') return Math.floor(n * 3_600_000);
  return Math.floor(n * 1000);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      args._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function printHelp() {
  console.log(`XRK-AGT 生产级性能 / 韧性测试

Modes: load | stress | soak | bench | chaos | smoke

Examples:
  node tests/perf/run-perf.mjs smoke
  node tests/perf/run-perf.mjs load --profile local --self
  node tests/perf/run-perf.mjs load --self --target health --concurrency 100 --duration 30s
  node tests/perf/run-perf.mjs stress --base-url http://127.0.0.1:8080 --target health --max-concurrency 200
  node tests/perf/run-perf.mjs soak --profile soak30m --base-url http://127.0.0.1:8080
  node tests/perf/run-perf.mjs bench --profile prodgate --base-url http://127.0.0.1:8080
  node tests/perf/run-perf.mjs chaos --self --target health --inject-rate 0.05 --duration 20s
  node tests/perf/run-perf.mjs chaos --self --chaos-mode server --chaos-error-rate 0.2 --duration 15s

Profiles: ${Object.keys(PROFILES).join(', ')}
Targets: ${Object.keys(TARGETS).join(', ')}, mixed
`);
}

/**
 * @param {Record<string, unknown>} args
 */
function resolveBuilder(args, baseUrl, apiKey) {
  const targetName = String(args.target || 'health');
  if (targetName === 'mixed') {
    const pick = weightedPicker(MIXED_PROFILE);
    return () => buildRequest(baseUrl, pick(), { apiKey });
  }
  const t = TARGETS[targetName];
  if (!t) throw new Error(`未知 --target ${targetName}`);
  return () => buildRequest(baseUrl, t, { apiKey });
}

function printSummary(label, summary, extra = {}) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify({ ...summary, ...extra }, null, 2));
}

async function main() {
  let args = parseArgs(process.argv.slice(2));
  const modeArg = args._[0];
  if (!modeArg || args.help || args.h) {
    printHelp();
    process.exit(modeArg ? 0 : 2);
  }

  // --profile 注入默认参数（CLI 显式值优先）
  if (typeof args.profile === 'string' && PROFILES[args.profile]) {
    const p = PROFILES[args.profile];
    args = {
      ...Object.fromEntries(
        Object.entries({
          concurrency: p.concurrency,
          duration: p.duration,
          target: p.target,
          requests: p.requests,
          'max-p99-ms': p.slo?.maxP99Ms,
          'max-error-rate': p.slo?.maxErrorRate,
          'min-rps': p.slo?.minRps,
        }).filter(([, v]) => v != null)
      ),
      ...args,
      _: [p.mode || modeArg, ...args._.slice(1)],
    };
  }

  const mode = args._[0];

  let self = null;
  let baseUrl = String(args['base-url'] || process.env.XRK_PERF_BASE_URL || '');
  try {
    if (args.self || mode === 'smoke' || (mode === 'chaos' && String(args['chaos-mode'] || '') === 'server')) {
      console.log('[perf] starting self-server…');
      const chaosEnv =
        mode === 'chaos' && String(args['chaos-mode'] || '') === 'server'
          ? {
              XRK_CHAOS_ENABLED: '1',
              XRK_CHAOS_ERROR_RATE: String(args['chaos-error-rate'] || '0.2'),
              XRK_CHAOS_LATENCY_MS: String(args['chaos-latency-ms'] || '50'),
              XRK_CHAOS_PATHS: String(args['chaos-paths'] || '/health,/metrics'),
            }
          : {};
      self = await startSelfServer({ env: chaosEnv });
      baseUrl = self.baseUrl;
      console.log(`[perf] self-server ready ${baseUrl}`);
    }
    if (!baseUrl) {
      throw new Error('需要 --base-url 或 --self（smoke 默认 --self）');
    }

    const apiKey =
      (typeof args['api-key'] === 'string' ? args['api-key'] : null) ||
      loadApiKey(root);

    const build = resolveBuilder(args, baseUrl, apiKey);
    const slo = {
      maxP99Ms: args['max-p99-ms'] != null ? Number(args['max-p99-ms']) : undefined,
      maxErrorRate:
        args['max-error-rate'] != null ? Number(args['max-error-rate']) : undefined,
      minRps: args['min-rps'] != null ? Number(args['min-rps']) : undefined,
    };

    let report = { mode, baseUrl, target: args.target || 'health', startedAt: new Date().toISOString() };

    if (mode === 'smoke') {
      // CI 门禁：冷启动 Windows 亦可过；生产验收请用 load/bench 收紧 SLO
      const hist = await runDurationLoad({
        buildRequest: () => buildRequest(baseUrl, TARGETS.health, { apiKey }),
        concurrency: Number(args.concurrency || 10),
        durationMs: parseDuration(args.duration, 8_000),
        rampMs: 800,
      });
      const summary = hist.summary();
      const gate = evaluateSlo(summary, {
        maxP99Ms: slo.maxP99Ms ?? 800,
        maxErrorRate: slo.maxErrorRate ?? 0.02,
        minRps: slo.minRps ?? 30,
      });
      report = { ...report, summary, slo: gate };
      printSummary('smoke', summary, { slo: gate });
      if (!gate.ok) {
        console.error('[perf] SMOKE FAILED:', gate.violations.join('; '));
        process.exitCode = 1;
      } else {
        console.log('[perf] SMOKE PASSED');
      }
    } else if (mode === 'load' || mode === 'soak') {
      const defaults = mode === 'soak'
        ? { concurrency: 20, duration: '10m' }
        : { concurrency: 50, duration: '30s' };
      const hist = await runDurationLoad({
        buildRequest: build,
        concurrency: Number(args.concurrency || defaults.concurrency),
        durationMs: parseDuration(args.duration, parseDuration(defaults.duration, 30_000)),
        rampMs: parseDuration(args.ramp, mode === 'soak' ? 5_000 : 2_000),
        onTick: (h) => {
          const s = h.summary();
          process.stdout.write(
            `\r[perf] ${mode} rps=${s.rps} p99=${s.latencyMs.p99}ms err=${(s.errorRate * 100).toFixed(2)}%   `
          );
        },
      });
      process.stdout.write('\n');
      const summary = hist.summary();
      const gate = evaluateSlo(summary, slo);
      report = { ...report, summary, slo: gate };
      printSummary(mode, summary, { slo: gate });
      if (Object.values(slo).some((v) => v != null) && !gate.ok) {
        console.error('[perf] SLO FAILED:', gate.violations.join('; '));
        process.exitCode = 1;
      }
    } else if (mode === 'bench') {
      const hist = await runFixedBenchmark({
        buildRequest: build,
        totalRequests: Number(args.requests || 2000),
        concurrency: Number(args.concurrency || 50),
      });
      const summary = hist.summary();
      const gate = evaluateSlo(summary, slo);
      report = { ...report, summary, slo: gate };
      printSummary('bench', summary, { slo: gate });
      if (Object.values(slo).some((v) => v != null) && !gate.ok) {
        console.error('[perf] SLO FAILED:', gate.violations.join('; '));
        process.exitCode = 1;
      }
    } else if (mode === 'stress') {
      const result = await runStressRamp({
        buildRequest: build,
        startConcurrency: Number(args['start-concurrency'] || 10),
        maxConcurrency: Number(args['max-concurrency'] || 200),
        step: Number(args.step || 20),
        stepDurationMs: parseDuration(args['step-duration'] || args.duration, 8_000),
        slo: {
          maxP99Ms: slo.maxP99Ms ?? 250,
          maxErrorRate: slo.maxErrorRate ?? 0.05,
        },
      });
      report = { ...report, result };
      printSummary('stress', {
        brokeAt: result.brokeAt,
        maxSustainable: result.maxSustainable,
        steps: result.steps.map((s) => ({
          concurrency: s.concurrency,
          broke: s.broke,
          rps: s.summary.rps,
          p99: s.summary.latencyMs.p99,
          errorRate: s.summary.errorRate,
        })),
      });
    } else if (mode === 'chaos') {
      const chaosMode = String(args['chaos-mode'] || 'client');
      const hist = await runChaosLight({
        buildRequest: build,
        concurrency: Number(args.concurrency || 30),
        durationMs: parseDuration(args.duration, 20_000),
        // server 模式依赖服务端中间件；客户端仍可叠加少量注入
        injectRate: chaosMode === 'server' ? Number(args['inject-rate'] || 0) : Number(args['inject-rate'] || 0.05),
      });
      const summary = hist.summary();
      report = {
        ...report,
        summary,
        chaosMode,
        injectRate: Number(args['inject-rate'] || (chaosMode === 'server' ? 0 : 0.05)),
      };
      printSummary('chaos', summary, { chaosMode });
      if (summary.ok < 1 && chaosMode !== 'server') {
        console.error('[perf] CHAOS FAILED: no successful requests');
        process.exitCode = 1;
      } else if (chaosMode === 'server' && summary.fail < 1 && Number(args['chaos-error-rate'] || process.env.XRK_CHAOS_ERROR_RATE || 0) > 0) {
        console.error('[perf] SERVER CHAOS FAILED: expected injected errors');
        process.exitCode = 1;
      } else {
        console.log(`[perf] CHAOS completed (mode=${chaosMode})`);
      }
    } else {
      throw new Error(`未知 mode: ${mode}`);
    }

    if (typeof args.json === 'string') {
      const out = path.isAbsolute(args.json) ? args.json : path.join(root, args.json);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(report, null, 2));
      console.log(`[perf] wrote ${out}`);
    }
  } catch (err) {
    console.error('[perf] fatal:', err instanceof Error ? err.stack || err.message : err);
    process.exitCode = 1;
  } finally {
    if (self) {
      console.log('[perf] stopping self-server…');
      await self.stop();
    }
  }
}

await main();
