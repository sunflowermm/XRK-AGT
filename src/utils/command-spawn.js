import fsSync from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const IS_WINDOWS = process.platform === 'win32';

function exists(filePath) {
  return !!(filePath && fsSync.existsSync(filePath));
}

function findOnPath(name) {
  const lookup = IS_WINDOWS ? 'where' : 'which';
  const result = spawnSync(lookup, [name], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 || !result.stdout?.trim()) return null;
  const lines = result.stdout.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines[0] || null;
}

function spawnViaNode(scriptPath, args) {
  return { command: process.execPath, args: [scriptPath, ...args], shell: false };
}

function spawnWindowsCmd(cmdPath, args) {
  return { command: 'cmd.exe', args: ['/d', '/s', '/c', cmdPath, ...args], shell: false };
}

/** @returns {string[]} */
function pnpmCjsCandidates(cwd) {
  const candidates = [path.join(cwd, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')];
  const appData = process.env.APPDATA;
  if (appData) {
    candidates.push(path.join(appData, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
  }
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  candidates.push(path.join(programFiles, 'nodejs', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
  return [...new Set(candidates)].filter((candidate) => exists(candidate));
}

function toPnpmSpawn(executable, args, cwd = process.cwd()) {
  if (executable.endsWith('.cjs')) {
    return spawnViaNode(executable, args);
  }
  if (IS_WINDOWS) {
    if (executable.endsWith('.exe')) {
      return { command: executable, args, shell: false };
    }
    const cjsNearShim = path.join(path.dirname(executable), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
    if (exists(cjsNearShim)) {
      return spawnViaNode(cjsNearShim, args);
    }
    const cjs = pnpmCjsCandidates(cwd)[0];
    if (cjs) return spawnViaNode(cjs, args);

    const cmdPath = /\.(cmd|bat)$/i.test(executable) ? executable : `${executable}.cmd`;
    if (exists(cmdPath)) return spawnWindowsCmd(cmdPath, args);
  }
  return { command: executable, args, shell: false };
}

function localPnpmBin(cwd) {
  const bin = path.join(cwd, 'node_modules', '.bin', IS_WINDOWS ? 'pnpm.cmd' : 'pnpm');
  return exists(bin) ? bin : null;
}

function nodeCorepackPath() {
  const corepack = path.join(path.dirname(process.execPath), IS_WINDOWS ? 'corepack.cmd' : 'corepack');
  return exists(corepack) ? corepack : null;
}

function resolveNpmExecPnpm(args) {
  if (IS_WINDOWS) {
    const npmCmd = path.join(path.dirname(process.execPath), 'npm.cmd');
    if (exists(npmCmd)) return spawnWindowsCmd(npmCmd, ['exec', '--yes', 'pnpm', ...args]);
  }
  const npm = findOnPath('npm');
  if (npm) {
    return { command: npm, args: ['exec', '--yes', 'pnpm', ...args], shell: false };
  }
  return null;
}

export function getPnpmInstallHint() {
  return 'corepack enable pnpm  或  npm install -g pnpm  后重新运行 node app';
}

/** @returns {{ command: string, args: string[], shell: boolean }} */
export function resolvePnpmSpawn(args, cwd = process.cwd()) {
  const cjs = pnpmCjsCandidates(cwd)[0];
  if (cjs) return spawnViaNode(cjs, args);

  const local = localPnpmBin(cwd);
  if (local) return toPnpmSpawn(local, args, cwd);

  if (IS_WINDOWS) {
    const standalone = path.join(process.env.LOCALAPPDATA || '', 'pnpm', 'pnpm.exe');
    if (exists(standalone)) {
      return { command: standalone, args, shell: false };
    }
  }

  const onPath = findOnPath('pnpm');
  if (onPath) return toPnpmSpawn(onPath, args, cwd);

  const corepack = nodeCorepackPath();
  if (corepack) {
    return IS_WINDOWS
      ? spawnWindowsCmd(corepack, ['pnpm', ...args])
      : { command: corepack, args: ['pnpm', ...args], shell: false };
  }

  const npmExec = resolveNpmExecPnpm(args);
  if (npmExec) return npmExec;

  throw new Error(`pnpm 未安装或不在 PATH 中，请执行: ${getPnpmInstallHint()}`);
}

/** @returns {{ command: string, args: string[], shell: boolean }} */
export function resolveCommandSpawn(command, args, cwd = process.cwd()) {
  if (command === 'pnpm') {
    return resolvePnpmSpawn(args, cwd);
  }
  if (IS_WINDOWS && !/[\\/]/.test(command)) {
    const onPath = findOnPath(command);
    if (onPath) {
      if (/\.(cmd|bat)$/i.test(onPath)) return spawnWindowsCmd(onPath, args);
      return { command: onPath, args, shell: false };
    }
    return { command, args, shell: true };
  }
  return { command, args, shell: false };
}

export function spawnCommand(command, args, cwd, extraEnv = {}, baseEnv = process.env) {
  return new Promise((resolve, reject) => {
    let spawnSpec;
    try {
      spawnSpec = resolveCommandSpawn(command, args, cwd);
    } catch (err) {
      reject(err);
      return;
    }

    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd,
      shell: spawnSpec.shell,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...baseEnv, ...extraEnv }
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT' || err.code === 'EINVAL') {
        const hint = command === 'pnpm' ? `，请执行: ${getPnpmInstallHint()}` : '';
        reject(new Error(`${command} 未安装或不在 PATH 中${hint}`));
        return;
      }
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (signal === 'SIGINT' || code === 130) {
        reject(new Error(`${command} 安装已中断（Ctrl+C），请重新运行 pnpm install`));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} 退出码 ${code ?? 'unknown'}`));
    });
  });
}
