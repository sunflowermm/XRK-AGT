#!/usr/bin/env node
/** Windows 无 MSVC 时回退 GNU 工具链；其它平台直接 cargo run */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
}

function hasMsvcLinker() {
  if (process.platform !== 'win32') return true;
  return spawnSync('where', ['link.exe'], { encoding: 'utf8', shell: true }).status === 0;
}

function gnuToolchainReady() {
  return (
    spawnSync('rustc', ['+stable-x86_64-pc-windows-gnu', '-V'], { encoding: 'utf8', shell: true }).status === 0
  );
}

function ensureGnuToolchain() {
  if (gnuToolchainReady()) return true;
  console.log('正在安装 stable-x86_64-pc-windows-gnu …');
  const install = run('rustup', ['toolchain', 'install', 'stable-x86_64-pc-windows-gnu']);
  return install.status === 0 && gnuToolchainReady();
}

let args;
if (hasMsvcLinker()) {
  args = ['run'];
} else if (ensureGnuToolchain()) {
  args = ['+stable-x86_64-pc-windows-gnu', 'run'];
} else {
  console.error(
    'Rust 编译需要 Visual Studio Build Tools（link.exe）或 GNU 工具链。\n' +
      '请执行: rustup toolchain install stable-x86_64-pc-windows-gnu\n' +
      '并确保 MinGW gcc 在 PATH（见 subserver/SETUP.md）'
  );
  process.exit(1);
}

process.exit(run('cargo', args).status ?? 1);
