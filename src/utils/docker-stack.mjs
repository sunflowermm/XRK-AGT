#!/usr/bin/env node
/** Docker 全栈：clean · build · up · fresh */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = path.join(root, 'config', 'docker.env');
const compose = path.join(root, 'docker-compose.yml');

function ensureDocker() {
  const r = spawnSync('docker', ['info'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'pipe'
  });
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
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts
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
  const r = spawnSync('docker', [subcommand, ...extraArgs], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  return (r.stdout || '').trim().split(/\s+/).filter(Boolean);
}

function removeAll(ids, removeCmd) {
  if (ids.length === 0) return;
  const batch = 50;
  for (let i = 0; i < ids.length; i += batch) {
    runSoft('docker', [removeCmd, '-f', ...ids.slice(i, i + batch)]);
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
  console.log('>>> build 全栈（xrk-agt + 六语言子服 + redis + mongo）');
  run('docker', [...composeArgs(), 'build', '--pull'], { timeout: 90 * 60 * 1000 });
}

function up() {
  ensureDocker();
  run('docker', [...composeArgs(), 'up', '-d', '--wait'], { timeout: 15 * 60 * 1000 });
}

function down() {
  ensureDocker();
  run('docker', [...composeArgs(), 'down']);
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
  case 'fresh':
    fresh();
    break;
  default:
    console.log(`用法: node src/utils/docker-stack.mjs <命令>

  clean   删除全部容器/镜像/build 缓存
  build   构建 docker-compose.yml 全栈
  up      启动全栈
  down    停止全栈
  fresh   clean + build + up`);
    process.exit(mode === 'help' ? 0 : 1);
}
