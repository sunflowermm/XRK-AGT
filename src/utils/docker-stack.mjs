#!/usr/bin/env node
/** Docker 全栈：clean · build · up · fresh · status */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = path.join(root, 'config', 'docker.env');
const compose = path.join(root, 'docker-compose.yml');

const BASE_IMAGES = [
  'node:26-slim',
  'redis:7-alpine',
  'mongo:8.0',
  'golang:1.23-alpine',
  'alpine:3.20',
  'php:8.3-cli-alpine',
  'eclipse-temurin:21-jdk-alpine',
  'eclipse-temurin:21-jre-alpine',
  'rust:1.83-alpine',
  'ghcr.io/astral-sh/uv:latest',
  'mcr.microsoft.com/dotnet/sdk:8.0-alpine',
  'mcr.microsoft.com/dotnet/aspnet:8.0-alpine'
];

const HEALTH_ENDPOINTS = [
  ['主服', `http://127.0.0.1:${process.env.XRK_SERVER_PORT || '8080'}/health`],
  ['py', 'http://127.0.0.1:8000/health'],
  ['go', 'http://127.0.0.1:8001/health'],
  ['php', 'http://127.0.0.1:8002/health'],
  ['java', 'http://127.0.0.1:8003/health'],
  ['net', 'http://127.0.0.1:8004/health'],
  ['rust', 'http://127.0.0.1:8005/health']
];

function dockerSpawn(args, opts = {}) {
  return spawnSync('docker', args, {
    cwd: root,
    shell: process.platform === 'win32',
    ...opts
  });
}

function ensureDocker() {
  const r = dockerSpawn(['info'], { encoding: 'utf8', stdio: 'pipe' });
  if (r.status === 0) return;
  console.error('>>> Docker 未运行：请先启动 Docker Desktop 并等待引擎就绪');
  process.exit(1);
}

function composeArgs() {
  const args = ['compose', '-f', compose];
  if (fs.existsSync(envFile)) args.push('--env-file', envFile);
  return args;
}

function run(cmd, args, opts = {}) {
  const { env: extraEnv, ...rest } = opts;
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    ...rest
  });
  if (r.error?.code === 'ETIMEDOUT') {
    console.error('>>> 超时');
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function runSoft(cmd, args) {
  spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
}

function dockerLines(subcommand, extraArgs = []) {
  const r = dockerSpawn([subcommand, ...extraArgs], { encoding: 'utf8', stdio: 'pipe' });
  return (r.stdout || '').trim().split(/\s+/).filter(Boolean);
}

function removeAll(ids, removeCmd) {
  if (ids.length === 0) return;
  const batch = 50;
  for (let i = 0; i < ids.length; i += batch) {
    runSoft('docker', [removeCmd, '-f', ...ids.slice(i, i + batch)]);
  }
}

function imageExistsLocally(image) {
  return dockerSpawn(['image', 'inspect', image], { stdio: 'pipe' }).status === 0;
}

function pullImage(image, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) console.log(`>>> 重试 pull ${image} (${attempt + 1}/${retries})`);
    else console.log(`>>> pull ${image}`);
    if (dockerSpawn(['pull', image], { stdio: 'inherit' }).status === 0) return true;
  }
  return false;
}

function prefetchBaseImages() {
  console.log('>>> 预拉取 base 镜像（顺序执行，已存在则跳过）');
  const failed = [];
  for (const image of BASE_IMAGES) {
    if (imageExistsLocally(image)) {
      console.log(`>>> skip ${image}（本地已有）`);
      continue;
    }
    if (!pullImage(image)) failed.push(image);
  }
  if (failed.length) {
    console.error(`\n>>> 拉取失败: ${failed.join(', ')}`);
    console.error('>>> 请检查: Docker Desktop 代理 · config/docker.env · %USERPROFILE%\\.docker\\daemon.json 镜像源');
    process.exit(1);
  }
}

function cleanAll() {
  ensureDocker();
  console.log('>>> compose down');
  runSoft('docker', [...composeArgs(), 'down', '--rmi', 'all', '--remove-orphans', '-v']);

  const running = dockerLines('ps', ['-q']);
  if (running.length) {
    console.log(`>>> 停止 ${running.length} 个容器`);
    runSoft('docker', ['stop', ...running]);
  }

  const containers = dockerLines('ps', ['-aq']);
  if (containers.length) {
    console.log(`>>> 删除 ${containers.length} 个容器`);
    removeAll(containers, 'rm');
  }

  const images = dockerLines('images', ['-aq']);
  if (images.length) {
    console.log(`>>> 删除 ${images.length} 个镜像`);
    removeAll(images, 'rmi');
  }

  console.log('>>> builder / system prune');
  runSoft('docker', ['builder', 'prune', '-af']);
  runSoft('docker', ['system', 'prune', '-af', '--volumes']);

  console.log('>>> clean 完成');
}

function build() {
  ensureDocker();
  prefetchBaseImages();
  console.log('>>> build 全栈（xrk-agt + 六语言子服 + redis + mongo）');
  run('docker', [...composeArgs(), 'build'], {
    timeout: 90 * 60 * 1000,
    env: { COMPOSE_PARALLEL_LIMIT: '2' }
  });
}

function up() {
  ensureDocker();
  run('docker', [...composeArgs(), 'up', '-d', '--wait'], { timeout: 15 * 60 * 1000 });
}

function down() {
  ensureDocker();
  run('docker', [...composeArgs(), 'down']);
}

async function status() {
  ensureDocker();
  runSoft('docker', [...composeArgs(), 'ps']);
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
  build();
  up();
  console.log('\n>>> 全栈已构建并启动 · 主服 http://127.0.0.1:8080 · 子服 8000–8005');
}

const mode = process.argv[2] || 'help';
switch (mode) {
  case 'clean':
    cleanAll();
    break;
  case 'build':
    build();
    break;
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
  build   构建 docker-compose.yml 全栈
  up      启动全栈（等待 healthcheck）
  down    停止全栈
  status  查看 compose ps + HTTP 健康探测
  fresh   clean + build + up`);
    process.exit(mode === 'help' ? 0 : 1);
}
