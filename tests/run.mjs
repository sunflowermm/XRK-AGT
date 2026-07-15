/**
 * 统一测试入口（package.json 各 test:* 脚本只调此文件）
 *
 * 用法: node tests/run.mjs <suite>
 *   fast         — 无 Bootstrap、无集成（默认 CI 快路径）
 *   unit         — 除 e2e 外全部单元/集成测
 *   integration  — 仅 Loader 集成
 *   e2e          — 真实启动 AgentRuntime
 *   all          — framework 下全部 *.test.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frameworkDir = path.join(root, 'tests/framework');

/** @type {Record<string, string[]>} */
const SUITES = {
  fast: [
    'auth-loopback.test.mjs',
    'config-alignment.test.mjs',
    'module-inventory.test.mjs',
    'module-import-error.test.mjs',
    'onebot-atbot.test.mjs',
    'lsy-user-store-mongo.test.mjs',
    'safe-os-network.test.mjs',
    'monitor-safety.test.mjs',
    'input-validator.test.mjs',
    'www-xrk.test.mjs',
    'http-api-structure.test.mjs',
  ],
  integration: ['loaders-integration.test.mjs'],
  e2e: ['server-e2e.test.mjs'],
};

function unitTests() {
  const e2e = new Set(SUITES.e2e);
  return fs
    .readdirSync(frameworkDir)
    .filter((f) => f.endsWith('.test.mjs') && !e2e.has(f))
    .sort();
}

function resolveFiles(mode) {
  if (mode === 'all') {
    return fs.readdirSync(frameworkDir).filter((f) => f.endsWith('.test.mjs')).sort();
  }
  if (mode === 'unit') return unitTests();
  const list = SUITES[mode];
  if (!list) return null;
  return list;
}

const mode = process.argv[2] || 'unit';
const files = resolveFiles(mode);
if (!files?.length) {
  console.error(`未知 suite: ${mode}；可用: fast | unit | integration | e2e | all`);
  process.exit(2);
}

const testArgs = [
  '--test',
  '--test-force-exit',
  ...files.map((f) => path.join('tests/framework', f)),
];

const result = spawnSync(process.execPath, testArgs, { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
