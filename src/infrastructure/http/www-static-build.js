/**
 * 前端工程静态模式：只 build、不启进程。
 *
 * 前端工程一共两种（见 docs/www-mount.md）：
 * 1. enabled=false / serve=static → 本模块：缺产物则 build，然后挂 dist；Launcher 不启动
 * 2. enabled=true  / serve=proxy  → FrontendLauncher：启进程 + 反代（不走这里）
 */
import path from 'node:path';
import fsSync from 'node:fs';
import RuntimeUtil from '#utils/runtime-util.js';
import { execFile } from '#utils/exec-async.js';
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
 * 静态模式是否要在挂载前 build：仅缺产物时（已有 dist 则跳过，避免每次重启都编）。
 * `buildOnStart: false` 可关闭自动 build。
 *
 * @param {object} sign
 * @param {{ via: string, warn?: string }} resolved
 */
export function shouldRunSignedStaticBuild(sign, resolved) {
  if (!sign || typeof sign !== 'object') return false;
  if (sign.buildOnStart === false) return false;
  return resolved.via === '.' || Boolean(resolved.warn);
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
      `${label}: 静态模式缺产物且无可用 build 命令（需 package.json 或 sign.build）`,
      'AgentRuntime'
    );
    return false;
  }

  const display = `${spec.command} ${spec.args.join(' ')}`.trim();
  RuntimeUtil.makeLog(
    'info',
    `前端工程静态模式：构建产物（不启进程）: ${label} (${display})`,
    'AgentRuntime'
  );

  try {
    const { stdout, stderr } = await execFile(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env, BROWSER: 'none' },
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
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
 * 静态模式：缺 dist 则 build，再解析静态根。不启动任何前端进程。
 *
 * @param {string} appDir
 * @param {object} sign
 * @param {string} [mountPath]
 */
export async function ensureSignedStaticArtifacts(appDir, sign, mountPath) {
  let resolved = resolveWwwStaticRoot(appDir, sign);
  if (!shouldRunSignedStaticBuild(sign, resolved)) {
    return resolved;
  }

  const ok = await runSignedStaticBuild(appDir, sign, mountPath || path.basename(appDir));
  if (!ok) return resolved;
  return resolveWwwStaticRoot(appDir, sign);
}
