/**
 * 前端工程静态模式：只 build、不启进程。
 *
 * 前端工程一共两种（见 docs/www-mount.md）：
 * 1. enabled=false / serve=static → 本模块：默认每次启动 build，然后挂 dist；Launcher 不启动
 * 2. enabled=true  / serve=proxy  → FrontendLauncher：启进程 + 反代（不走这里）
 *
 * Windows 下不能 `execFile('pnpm')`（ENOENT）；统一走 `#utils/command-spawn.js` 解析。
 */
import path from 'node:path';
import fsSync from 'node:fs';
import { spawn } from 'node:child_process';
import RuntimeUtil from '#utils/runtime-util.js';
import {
  getPnpmInstallHint,
  resolveCommandSpawn,
} from '#utils/command-spawn.js';
import { resolveWwwStaticRoot } from '#infrastructure/http/www-app-resolve.js';

/**
 * @param {unknown} raw
 * @param {string} appDir
 * @returns {{ command: string, args: string[], cwd: string, env: Record<string, string> } | null}
 */
export function normalizeWwwBuildSpec(raw, appDir) {
  if (!raw || typeof raw !== 'object') return null;
  const command = raw.command != null ? String(raw.command).trim() : '';
  if (!command) return null;
  const args = Array.isArray(raw.args) ? raw.args.map((a) => String(a)) : [];
  const cwd = raw.cwd ? path.resolve(appDir, String(raw.cwd)) : appDir;
  const env =
    raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
      ? Object.fromEntries(
          Object.entries(raw.env).map(([k, v]) => [String(k), v == null ? '' : String(v)])
        )
      : {};
  return { command, args, cwd, env };
}

/**
 * 静态模式用的 build 命令：`sign.build`，否则有 package.json 时默认 `pnpm build`。
 *
 * @param {object} sign
 * @param {string} appDir
 */
export function resolveSignedStaticBuildSpec(sign, appDir) {
  const fromSign = normalizeWwwBuildSpec(sign?.build, appDir);
  if (fromSign) return fromSign;
  if (fsSync.existsSync(path.join(appDir, 'package.json'))) {
    return { command: 'pnpm', args: ['build'], cwd: appDir, env: {} };
  }
  return null;
}

/**
 * 静态模式是否要在挂载前 build。
 * 默认：**每次启动都 build**（有 dist 也编），避免改源码后挂旧产物。
 * 显式 `"buildOnStart": false` 可关闭（自行保证 dist 正确）。
 *
 * @param {object} sign
 * @param {{ via: string, warn?: string }} [_resolved] 保留参数，兼容旧调用
 * @param {string} [appDir] 应用目录；传入时校验是否具备 build 规格
 */
export function shouldRunSignedStaticBuild(sign, _resolved, appDir) {
  if (!sign || typeof sign !== 'object') return false;
  if (sign.buildOnStart === false) return false;
  if (appDir) return Boolean(resolveSignedStaticBuildSpec(sign, appDir));
  if (sign.build && typeof sign.build === 'object' && sign.build.command) return true;
  return true;
}

/**
 * 解析跨平台可执行命令并跑完，收集 stdout/stderr。
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd: string, env?: Record<string, string> }} opts
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
function runResolvedCommand(command, args, opts) {
  let spawnSpec;
  try {
    spawnSpec = resolveCommandSpawn(command, args, opts.cwd);
  } catch (err) {
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, BROWSER: 'none' },
      shell: spawnSpec.shell,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      if (err?.code === 'ENOENT' || err?.code === 'EINVAL') {
        const hint = command === 'pnpm' ? `，请执行: ${getPnpmInstallHint()}` : '';
        reject(new Error(`${command} 未安装或不在 PATH 中${hint}`));
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code: 0 });
        return;
      }
      const detail = (stderr || stdout || '').trim().slice(0, 800);
      const err = new Error(
        `${command} ${args.join(' ')} 退出码 ${code ?? 'unknown'}${detail ? ` — ${detail}` : ''}`
      );
      err.stdout = stdout;
      err.stderr = stderr;
      err.code = code;
      reject(err);
    });
  });
}

/**
 * @param {string} appDir
 * @param {object} sign
 * @param {string} [label]
 */
export async function runSignedStaticBuild(appDir, sign, label = appDir) {
  const spec = resolveSignedStaticBuildSpec(sign, appDir);
  if (!spec) {
    RuntimeUtil.makeLog(
      'warn',
      `${label}: 静态模式无法 build（需 package.json 或 sign.build）`,
      'AgentRuntime'
    );
    return false;
  }

  const display = `${spec.command} ${spec.args.join(' ')}`.trim();
  RuntimeUtil.makeLog(
    'info',
    `前端工程静态模式：启动时构建产物（不启进程）: ${label} (${display})`,
    'AgentRuntime'
  );

  try {
    const { stdout, stderr } = await runResolvedCommand(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
    });
    if (stdout?.trim()) {
      RuntimeUtil.makeLog('debug', `build stdout (${label}): ${stdout.trim().slice(-800)}`, 'AgentRuntime');
    }
    if (stderr?.trim()) {
      RuntimeUtil.makeLog('debug', `build stderr (${label}): ${stderr.trim().slice(-800)}`, 'AgentRuntime');
    }
    RuntimeUtil.makeLog('info', `前端工程构建完成: ${label}`, 'AgentRuntime');
    return true;
  } catch (err) {
    const msg = err?.stderr || err?.message || String(err);
    RuntimeUtil.makeLog(
      'error',
      `前端工程构建失败: ${label} — ${String(msg).trim().slice(0, 500)}`,
      'AgentRuntime'
    );
    return false;
  }
}

/**
 * 静态模式：默认启动时 build，再解析静态根。不启动任何前端进程。
 *
 * @param {string} appDir
 * @param {object} sign
 * @param {string} [mountPath]
 */
export async function ensureSignedStaticArtifacts(appDir, sign, mountPath) {
  let resolved = resolveWwwStaticRoot(appDir, sign);
  if (!shouldRunSignedStaticBuild(sign, resolved, appDir)) {
    return resolved;
  }

  const ok = await runSignedStaticBuild(appDir, sign, mountPath || path.basename(appDir));
  if (!ok) return resolved;
  return resolveWwwStaticRoot(appDir, sign);
}
