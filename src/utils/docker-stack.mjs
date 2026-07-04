#!/usr/bin/env node
/** Docker 全栈：clean · build · up · fresh · status */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = path.join(root, 'config', 'docker.env');
const compose = path.join(root, 'docker-compose.yml');

const HEALTH_ENDPOINTS = [
  ['主服', `http://127.0.0.1:${process.env.XRK_SERVER_PORT || '8080'}/health`],
  ['py', 'http://127.0.0.1:8000/health'],
  ['go', 'http://127.0.0.1:8001/health'],
  ['php', 'http://127.0.0.1:8002/health'],
  ['java', 'http://127.0.0.1:8003/health'],
  ['net', 'http://127.0.0.1:8004/health'],
  ['rust', 'http://127.0.0.1:8005/health']
];

function docker(args, { soft = false, timeout, env, stdio = 'inherit' } = {}) {
  const r = spawnSync('docker', args, {
    cwd: root,
    shell: process.platform === 'win32',
    stdio,
    encoding: stdio === 'pipe' ? 'utf8' : undefined,
    env: env ? { ...process.env, ...env } : process.env,
    timeout
  });
  if (!soft) {
    if (r.error?.code === 'ETIMEDOUT') {
      console.error('>>> 超时');
      process.exit(1);
    }
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  return r;
}

function ensureDocker() {
  if (docker(['info'], { stdio: 'pipe' }).status === 0) return;
  console.error('>>> Docker 未运行：请先启动 Docker Desktop');
  process.exit(1);
}

function composeArgs() {
  const args = ['compose', '-f', compose];
  if (fs.existsSync(envFile)) args.push('--env-file', envFile);
  return args;
}

function batchRemove(removeCmd, ids) {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 50) {
    docker([removeCmd, '-f', ...ids.slice(i, i + 50)], { soft: true });
  }
}

function pruneLegacyImages() {
  const lines = docker(['images', '--format', '{{.Repository}}:{{.Tag}}'], { stdio: 'pipe', soft: true })
    .stdout?.trim().split('\n').filter(Boolean) ?? [];
  const legacy = lines.filter((tag) => /^xrk-agt-xrk-/i.test(tag.split(':')[0]));
  if (legacy.length) {
    console.log(`>>> 删除 ${legacy.length} 个旧 compose 镜像（xrk-agt-xrk-*）`);
    for (const tag of legacy) docker(['rmi', '-f', tag], { soft: true });
  }
}

function cleanAll() {
  ensureDocker();
  console.log('>>> compose down');
  docker([...composeArgs(), 'down', '--rmi', 'all', '--remove-orphans', '-v'], { soft: true });
  pruneLegacyImages();

  const containers = docker(['ps', '-aq'], { stdio: 'pipe', soft: true }).stdout?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (containers.length) {
    console.log(`>>> 删除 ${containers.length} 个容器`);
    batchRemove('rm', containers);
  }

  const images = docker(['images', '-aq'], { stdio: 'pipe', soft: true }).stdout?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (images.length) {
    console.log(`>>> 删除 ${images.length} 个镜像`);
    batchRemove('rmi', images);
  }

  console.log('>>> prune');
  docker(['builder', 'prune', '-af'], { soft: true });
  docker(['system', 'prune', '-af', '--volumes'], { soft: true });
  console.log('>>> clean 完成');
}

function build({ pull = false, services = [] } = {}) {
  ensureDocker();
  const args = [...composeArgs(), 'build'];
  if (pull) args.push('--pull');
  if (services.length) args.push(...services);
  console.log(`>>> build${services.length ? ` ${services.join(' ')}` : ' 全栈'}${pull ? '（--pull）' : '（本地缓存）'}`);
  docker(args, {
    timeout: 90 * 60 * 1000,
    env: { COMPOSE_PARALLEL_LIMIT: '2' }
  });
}

function up() {
  ensureDocker();
  docker([...composeArgs(), 'up', '-d', '--wait'], { timeout: 15 * 60 * 1000 });
}

function down() {
  ensureDocker();
  docker([...composeArgs(), 'down']);
}

async function status() {
  ensureDocker();
  docker([...composeArgs(), 'ps'], { soft: true });
  console.log('\n>>> HTTP 健康探测');
  for (const [name, url] of HEALTH_ENDPOINTS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      console.log(`  ${name.padEnd(4)} ${res.ok ? 'OK' : `HTTP ${res.status}`}  ${url}`);
    } catch (e) {
      console.log(`  ${name.padEnd(4)} FAIL  ${url} (${e.message})`);
    }
  }
}

function fresh() {
  cleanAll();
  build({ pull: true });
  up();
  console.log('\n>>> 全栈已构建并启动 · 主服 http://127.0.0.1:8080 · 子服 8000–8005');
}

const mode = process.argv[2] || 'help';
switch (mode) {
  case 'clean':
    cleanAll();
    break;
  case 'build': {
    const pull = process.argv.includes('--pull');
    const services = process.argv.slice(3).filter((a) => !a.startsWith('--'));
    build({ pull, services });
    break;
  }
  case 'up':
    up();
    break;
  case 'down':
    down();
    break;
  case 'status':
    await status();
    break;
  case 'fresh':
    fresh();
    break;
  default:
    console.log(`用法: node src/utils/docker-stack.mjs <命令>

  clean   删除全部容器/镜像/build 缓存
  build   构建全栈或指定服务（例: build xrk-agt xrk-subserver-java；加 --pull 强制拉 base）
  up      启动全栈（等待 healthcheck）
  down    停止全栈
  status  compose ps + HTTP 健康探测
  fresh   clean + build + up`);
    process.exit(mode === 'help' ? 0 : 1);
}
