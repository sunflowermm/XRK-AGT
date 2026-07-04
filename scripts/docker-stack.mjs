#!/usr/bin/env node
/** Docker 栈：clean · py wheels · 子服 build/up · 全栈 fresh */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, 'config', 'docker.env');
const subCompose = path.join(root, 'docker-compose.subservers.yml');
const mainCompose = path.join(root, 'docker-compose.yml');
const pyDir = path.join(root, 'subserver', 'pyserver');
const dockerDir = path.join(pyDir, '.docker');
const reqFile = path.join(dockerDir, 'requirements.txt');
const wheelsDir = path.join(dockerDir, 'wheels');

const PIP_LINUX = [
  '--platform', 'manylinux2014_x86_64',
  '--python-version', '3.12',
  '--implementation', 'cp',
  '--abi', 'cp312',
  '--only-binary=:all:'
];

const SUBSERVICES = [
  'xrk-subserver-py',
  'xrk-subserver-go',
  'xrk-subserver-php',
  'xrk-subserver-java',
  'xrk-subserver-net',
  'xrk-subserver-rust'
];

function composeArgs(file) {
  const args = ['compose', '-f', file];
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

function toLinuxRequirements(exported) {
  return exported
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return null;
      if (t.includes("sys_platform == 'win32'")) return null;
      if (t.includes("python_full_version < '3.11'")) return null;
      return t.split(';')[0].trim();
    })
    .filter(Boolean)
    .join('\n');
}

function preparePyWheels() {
  fs.mkdirSync(wheelsDir, { recursive: true });
  const exp = spawnSync(
    'uv',
    ['export', '--no-dev', '--no-emit-project', '--no-hashes', '-o', '-'],
    { cwd: pyDir, encoding: 'utf8', shell: process.platform === 'win32' }
  );
  if (exp.status !== 0) process.exit(exp.status ?? 1);
  fs.writeFileSync(reqFile, `${toLinuxRequirements(exp.stdout)}\n`);
  console.log(`>>> pip download (linux) -> ${wheelsDir}`);
  run('py', ['-3.12', '-m', 'pip', 'download', '-r', reqFile, '-d', wheelsDir, ...PIP_LINUX], {
    cwd: pyDir
  });
}

function cleanPyDockerCache() {
  if (fs.existsSync(wheelsDir)) fs.rmSync(wheelsDir, { recursive: true, force: true });
  for (const f of ['requirements.txt', 'requirements-install.txt']) {
    const p = path.join(dockerDir, f);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
}

function cleanAll() {
  console.log('>>> 停止并删除 xrk 容器');
  const ps = spawnSync('docker', ['ps', '-aq', '--filter', 'name=xrk'], {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  for (const id of (ps.stdout || '').trim().split(/\s+/).filter(Boolean)) {
    runSoft('docker', ['rm', '-f', id]);
  }

  console.log('>>> compose down（子服 + 全栈）');
  runSoft('docker', [...composeArgs(subCompose), 'down', '--rmi', 'all', '--remove-orphans', '-v']);
  runSoft('docker', [...composeArgs(mainCompose), 'down', '--rmi', 'all', '--remove-orphans', '-v']);

  console.log('>>> 删除 xrk 相关镜像');
  const imgs = spawnSync('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}'], {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  for (const line of (imgs.stdout || '').split('\n')) {
    const tag = line.trim();
    if (tag && /^xrk/i.test(tag.split(':')[0])) {
      runSoft('docker', ['rmi', '-f', tag]);
    }
  }

  console.log('>>> builder prune');
  runSoft('docker', ['builder', 'prune', '-af']);

  console.log('>>> 清除 pyserver .docker 缓存');
  cleanPyDockerCache();
  console.log('>>> clean 完成');
}

function buildSubservers() {
  preparePyWheels();
  for (const svc of SUBSERVICES) {
    console.log(`\n>>> build ${svc}`);
    run('docker', [...composeArgs(subCompose), 'build', '--pull', svc], { timeout: 20 * 60 * 1000 });
  }
}

function upSubservers() {
  run('docker', [...composeArgs(subCompose), 'up', '-d', '--wait'], { timeout: 10 * 60 * 1000 });
}

function buildMain() {
  console.log('\n>>> build 全栈（主服 + 子服 + redis/mongo pull）');
  run('docker', [...composeArgs(mainCompose), 'build', '--pull'], { timeout: 60 * 60 * 1000 });
}

function upMain() {
  run('docker', [...composeArgs(mainCompose), 'up', '-d', '--wait'], { timeout: 15 * 60 * 1000 });
}

function fresh() {
  cleanAll();
  buildSubservers();
  buildMain();
  console.log('\n>>> 构建完成。启动子服：pnpm docker:subservers · 全栈：pnpm docker:up');
}

const mode = process.argv[2] || 'help';
switch (mode) {
  case 'clean':
    cleanAll();
    break;
  case 'py-wheels':
    preparePyWheels();
    break;
  case 'subservers-build':
    buildSubservers();
    break;
  case 'subservers-up':
    upSubservers();
    break;
  case 'subservers-down':
    run('docker', [...composeArgs(subCompose), 'down']);
    break;
  case 'main-build':
    buildMain();
    break;
  case 'main-up':
    upMain();
    break;
  case 'main-down':
    run('docker', [...composeArgs(mainCompose), 'down']);
    break;
  case 'fresh':
    fresh();
    break;
  default:
    console.log(`用法: node scripts/docker-stack.mjs <命令>

  clean            删容器/镜像/build 缓存/py .docker
  fresh            clean + 子服 build + 全栈 build（从零拉取）
  py-wheels        仅准备 py 离线 wheel
  subservers-build / subservers-up / subservers-down
  main-build       / main-up           / main-down`);
    process.exit(mode === 'help' ? 0 : 1);
}
