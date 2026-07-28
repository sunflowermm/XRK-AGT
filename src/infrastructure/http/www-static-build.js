/**
 * 前端工程静态模式：只 build、不启进程。
 *
 * 前端工程一共两种（见 docs/www-mount.md）：
 * 1. enabled=false / serve=static → 本模块：默认产物过期才 build，然后挂 dist；Launcher 不启动
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
import { resolveWwwStaticRoot, isWwwSignedStaticRootOk } from '#infrastructure/http/www-app-resolve.js';

const BUILD_WALK_SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.vite',
  '.turbo',
  'coverage',
  'dist-ssr',
]);

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
          Object.entries(raw.env).map(([k, v]) => [String(k), v == null ? '' : String(v)]),
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
 * @param {object} sign
 * @returns {'always'|'never'|'if-stale'}
 */
export function normalizeWwwBuildOnStart(sign) {
  const v = sign?.buildOnStart;
  if (v === false || v === 'never') return 'never';
  if (v === true || v === 'always') return 'always';
  return 'if-stale';
}

/**
 * 目录/文件树中最新 mtime（ms）。跳过 node_modules / dist 等。
 * @param {string} target
 * @param {{ maxFiles?: number }} [opts]
 * @returns {number} 0 表示不可用
 */
export function maxMtimeMs(target, opts = {}) {
  const maxFiles = opts.maxFiles ?? 8000;
  let newest = 0;
  let seen = 0;

  /** @param {string} abs */
  function visit(abs) {
    if (seen >= maxFiles) return;
    let st;
    try {
      st = fsSync.lstatSync(abs);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    if (st.isFile()) {
      seen += 1;
      if (st.mtimeMs > newest) newest = st.mtimeMs;
      return;
    }
    if (!st.isDirectory()) return;
    if (st.mtimeMs > newest) newest = st.mtimeMs;
    let entries;
    try {
      entries = fsSync.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (seen >= maxFiles) return;
      if (BUILD_WALK_SKIP.has(ent.name)) continue;
      visit(path.join(abs, ent.name));
    }
  }

  visit(target);
  return newest;
}

/**
 * 参与「是否过期」判断的输入：配置文件 + src/public。
 * @param {string} appDir
 * @returns {number}
 */
export function maxWwwSourceMtimeMs(appDir) {
  const files = [
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    'vite.config.js',
    'vite.config.mjs',
    'vite.config.ts',
    'vite.config.cjs',
    'index.html',
    'sign.json',
    'tsconfig.json',
    'tsconfig.app.json',
    'jsconfig.json',
  ];
  let newest = 0;
  for (const rel of files) {
    const abs = path.join(appDir, rel);
    if (!fsSync.existsSync(abs)) continue;
    try {
      const t = fsSync.statSync(abs).mtimeMs;
      if (t > newest) newest = t;
    } catch {
      /* ignore */
    }
  }
  for (const rel of ['src', 'public']) {
    const abs = path.join(appDir, rel);
    if (!fsSync.existsSync(abs)) continue;
    const t = maxMtimeMs(abs);
    if (t > newest) newest = t;
  }
  return newest;
}

/**
 * @param {string} appDir
 * @param {object} sign
 * @param {{ root?: string, via?: string } | null | undefined} [resolved]
 */
export function resolveSignedStaticOutDir(appDir, sign, resolved) {
  if (resolved?.via && resolved.via !== '.' && resolved.root) {
    return resolved.root;
  }
  const rel =
    (sign?.staticRoot && String(sign.staticRoot).trim()) ||
    (sign?.outDir && String(sign.outDir).trim()) ||
    'dist';
  return path.resolve(appDir, rel);
}

/**
 * 产物是否落后于源码（缺 index.html 或源码更新 → 需要 build）。
 * @param {string} appDir
 * @param {object} sign
 * @param {{ root?: string, via?: string } | null | undefined} [resolved]
 */
export function isSignedStaticBuildStale(appDir, sign, resolved) {
  if (!appDir) return true;
  const outDir = resolveSignedStaticOutDir(appDir, sign, resolved);
  const indexHtml = path.join(outDir, 'index.html');
  if (!fsSync.existsSync(indexHtml)) return true;

  let distNewest = 0;
  try {
    distNewest = fsSync.statSync(indexHtml).mtimeMs;
  } catch {
    return true;
  }
  const assetsNewest = maxMtimeMs(outDir);
  if (assetsNewest > distNewest) distNewest = assetsNewest;
  if (!distNewest) return true;

  const srcNewest = maxWwwSourceMtimeMs(appDir);
  if (!srcNewest) return false;
  // 文件系统时间精度容差
  return srcNewest > distNewest + 2;
}

/**
 * 静态模式是否要在挂载前 build。
 * 默认 **if-stale**（有最新 dist 则跳过，避免每次重启卡启动）。
 * - `buildOnStart: true` / `"always"` → 每次都编
 * - `buildOnStart: false` / `"never"` → 永不自动编
 *
 * @param {object} sign
 * @param {{ root?: string, via?: string } | null | undefined} [resolved]
 * @param {string} [appDir]
 */
export function shouldRunSignedStaticBuild(sign, resolved, appDir) {
  if (!sign || typeof sign !== 'object') return false;
  const policy = normalizeWwwBuildOnStart(sign);
  if (policy === 'never') return false;
  if (appDir && !resolveSignedStaticBuildSpec(sign, appDir)) return false;
  if (policy === 'always') return true;
  if (!appDir) return true;
  return isSignedStaticBuildStale(appDir, sign, resolved);
}

/**
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
        `${command} ${args.join(' ')} 退出码 ${code ?? 'unknown'}${detail ? ` — ${detail}` : ''}`,
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
      'AgentRuntime',
    );
    return false;
  }

  const display = `${spec.command} ${spec.args.join(' ')}`.trim();
  RuntimeUtil.makeLog(
    'info',
    `前端工程静态模式：构建产物（不启进程）: ${label} (${display})`,
    'AgentRuntime',
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
      'AgentRuntime',
    );
    return false;
  }
}

/**
 * 静态模式：按需 build，再解析静态根。不启动任何前端进程。
 *
 * @param {string} appDir
 * @param {object} sign
 * @param {string} [mountPath]
 * @returns {Promise<{ root: string, via: string, warn?: string, buildFailed?: boolean, ok: boolean }>}
 */
export async function ensureSignedStaticArtifacts(appDir, sign, mountPath) {
  const label = mountPath || path.basename(appDir);
  let resolved = resolveWwwStaticRoot(appDir, sign);
  if (!shouldRunSignedStaticBuild(sign, resolved, appDir)) {
    const policy = normalizeWwwBuildOnStart(sign);
    if (policy === 'if-stale' && resolveSignedStaticBuildSpec(sign, appDir)) {
      RuntimeUtil.makeLog(
        'info',
        `前端工程产物已是最新，跳过构建: ${label}`,
        'AgentRuntime',
      );
    }
    return {
      ...resolved,
      ok: isWwwSignedStaticRootOk(appDir, sign, resolved),
      buildFailed: false,
    };
  }

  const okBuild = await runSignedStaticBuild(appDir, sign, label);
  if (!okBuild) {
    resolved = resolveWwwStaticRoot(appDir, sign);
    return {
      ...resolved,
      ok: isWwwSignedStaticRootOk(appDir, sign, resolved),
      buildFailed: true,
    };
  }
  resolved = resolveWwwStaticRoot(appDir, sign);
  return {
    ...resolved,
    ok: isWwwSignedStaticRootOk(appDir, sign, resolved),
    buildFailed: false,
  };
}
