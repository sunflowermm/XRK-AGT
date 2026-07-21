/**
 * Core www 应用挂载决策（纯函数，可单测）
 *
 * ## 两类 www 子目录（勿混谈）
 *
 * | 类型 | 判定 | 对外 URL | 磁盘根 | 谁服务 |
 * |------|------|----------|--------|--------|
 * | **普通静态** | 无有效 `sign.json` | 固定 `/${文件夹名}` | 目录本体 | 仅 `mountCoreWwwStatic` |
 * | **前端工程（特殊）** | 有有效 `sign.json` | `proxy.mount` → `mount` → `/${id}` | `staticRoot`/dist 等，或反代 | 静态挂 dist，或 Launcher 反代 |
 *
 * 权威说明：`docs/www-mount.md`。
 *
 * 调用方：
 * - `mount-core-www.js`：两类都扫；`mode=proxy` 时跳过静态
 * - `frontend/launcher.js`：只拉起「前端工程 + 需反代」
 */
import path from 'node:path';
import fsSync from 'node:fs';

/** 前端工程静态产物相对路径候选（相对 www/<app>/；仅 signed 使用） */
export const WWW_BUILD_OUT_CANDIDATES = [
  'dist',
  'build',
  'out',
  path.join('.output', 'public'),
];

/**
 * @typedef {{ ok: boolean, value: object | null, error?: string }} WwwSignRead
 */

/**
 * @typedef {{
 *   kind: 'plain' | 'signed',
 *   mode: 'static' | 'proxy',
 *   staticRoot: string | null,
 *   mountPath: string,
 *   reason: string,
 *   warn?: string,
 *   sign: object | null,
 * }} WwwAppMountDecision
 */

/**
 * 读取并解析 sign.json。
 * - 文件不存在 → ok + value=null（普通静态）
 * - JSON 非法 / 非对象 → ok=false（按普通静态回退并记 error）
 *
 * @param {string} signPath
 * @returns {WwwSignRead}
 */
export function readWwwSignFile(signPath) {
  try {
    if (!fsSync.existsSync(signPath)) {
      return { ok: true, value: null };
    }
    const raw = fsSync.readFileSync(signPath, 'utf8');
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, value: null, error: 'sign.json 根须为对象' };
    }
    return { ok: true, value };
  } catch (err) {
    return {
      ok: false,
      value: null,
      error: err?.message || String(err),
    };
  }
}

/**
 * 前端工程是否走反代（与静态互斥）。普通静态（sign=null）恒为 false。
 *
 * | serve           | enabled     | 结果     |
 * |-----------------|-------------|----------|
 * | static / dist   | 任意        | 不反代   |
 * | proxy / dev     | 未关        | 反代     |
 * | （未写）        | false       | 不反代   |
 * | （未写）        | true / 缺省 | 反代     |
 *
 * @param {object | null | undefined} sign
 * @returns {boolean}
 */
export function shouldProxyFrontend(sign) {
  if (!sign || typeof sign !== 'object') return false;
  if (sign.enabled === false) return false;

  const serve = String(sign.serve || '').toLowerCase().trim();
  if (serve === 'static' || serve === 'dist') return false;
  if (serve === 'proxy' || serve === 'dev') return true;

  return true;
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
function hasIndexHtml(dir) {
  try {
    return fsSync.existsSync(path.join(dir, 'index.html'));
  } catch {
    return false;
  }
}

/**
 * 粗判「Vite 源码树尚未 build」（仅 signed 缺产物时 warn）。
 *
 * @param {string} appDir
 * @returns {boolean}
 */
function looksLikeFrontendSourceTree(appDir) {
  try {
    if (!fsSync.existsSync(path.join(appDir, 'package.json'))) return false;
    if (hasIndexHtml(appDir)) {
      const html = fsSync.readFileSync(path.join(appDir, 'index.html'), 'utf8');
      if (/src=["']\/src\//i.test(html) || /src=["']\.\/src\//i.test(html)) {
        return true;
      }
    }
    return (
      fsSync.existsSync(path.join(appDir, 'vite.config.js')) ||
      fsSync.existsSync(path.join(appDir, 'vite.config.ts')) ||
      fsSync.existsSync(path.join(appDir, 'vite.config.mts')) ||
      fsSync.existsSync(path.join(appDir, 'vite.config.mjs'))
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} appDir
 * @param {string} candidateAbs
 * @returns {boolean}
 */
function isInsideAppDir(appDir, candidateAbs) {
  let base;
  let target;
  try {
    base = fsSync.realpathSync(appDir);
  } catch {
    base = path.resolve(appDir);
  }
  try {
    target = fsSync.existsSync(candidateAbs)
      ? fsSync.realpathSync(candidateAbs)
      : path.resolve(candidateAbs);
  } catch {
    target = path.resolve(candidateAbs);
  }
  const rel = path.relative(base, target);
  if (!rel || rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return !rel.split(path.sep).includes('..');
}

/**
 * 解析静态文件根目录。
 *
 * - **普通静态**（无 sign）：始终挂应用目录本体，不探测 dist。
 * - **前端工程**（有 sign）：`staticRoot`/`outDir` → dist/build/out/…（须含 index.html）。
 *
 * @param {string} appDir
 * @param {object | null} [sign]
 * @returns {{ root: string, via: string, warn?: string }}
 */
export function resolveWwwStaticRoot(appDir, sign = null) {
  if (!sign || typeof sign !== 'object') {
    return { root: appDir, via: '.' };
  }

  const preferred = [];
  const fromSign =
    (sign.staticRoot && String(sign.staticRoot).trim()) ||
    (sign.outDir && String(sign.outDir).trim()) ||
    '';
  if (fromSign) preferred.push(fromSign);
  for (const c of WWW_BUILD_OUT_CANDIDATES) {
    if (!preferred.includes(c)) preferred.push(c);
  }

  for (const rel of preferred) {
    const abs = path.resolve(appDir, rel);
    if (!isInsideAppDir(appDir, abs)) continue;
    if (hasIndexHtml(abs)) {
      return { root: abs, via: rel.replace(/\\/g, '/') };
    }
  }

  const warn = looksLikeFrontendSourceTree(appDir)
    ? '前端工程未找到 dist/build 等产物，暂挂源码目录；请先 pnpm build，或设置 sign.staticRoot'
    : undefined;

  return { root: appDir, via: '.', warn };
}

/**
 * 对外 URL 挂载路径。
 *
 * - **普通静态**：恒为 `/${文件夹名}`（忽略任何虚构字段）。
 * - **前端工程**：`proxy.mount` → `mount` → `/${id}` → 回退 `/${文件夹名}`。
 *
 * @param {string} appDirName www 下文件夹名
 * @param {object | null | undefined} sign 有效 sign 对象；null=普通静态
 * @returns {string} 形如 `/example`（无尾斜杠）
 */
export function resolveWwwPublicMountPath(appDirName, sign = null) {
  const fallback = `/${String(appDirName || '').replace(/^\/+|\/+$/g, '') || 'app'}`;
  if (!sign || typeof sign !== 'object') return fallback;

  const fromProxy =
    sign.proxy && typeof sign.proxy === 'object' && sign.proxy.mount != null
      ? String(sign.proxy.mount).trim()
      : '';
  const fromMount = sign.mount != null ? String(sign.mount).trim() : '';
  const fromId = sign.id != null ? String(sign.id).trim() : '';

  let raw = fromProxy || fromMount || (fromId ? `/${fromId}` : '') || fallback;
  if (!raw.startsWith('/')) raw = `/${raw}`;
  raw = raw.replace(/\/+$/, '') || '/';
  if (raw.includes('..') || raw === '/') return fallback;
  return raw;
}

/**
 * @param {string} mountPath
 * @returns {string}
 */
export function wwwMountPathRootSegment(mountPath) {
  const s = String(mountPath || '').replace(/^\/+/, '').split('/')[0] || '';
  return s;
}

/**
 * 综合决策：普通静态 | 前端工程(static|proxy)。
 *
 * @param {string} appDir www 下某一应用目录绝对路径
 * @param {string} [signPath] 默认 `appDir/sign.json`
 * @returns {WwwAppMountDecision}
 */
export function resolveWwwAppMount(appDir, signPath = path.join(appDir, 'sign.json')) {
  const appDirName = path.basename(appDir);
  const read = readWwwSignFile(signPath);

  // 无 sign 或损坏 → 普通静态
  if (!read.ok || !read.value) {
    const resolved = resolveWwwStaticRoot(appDir, null);
    const mountPath = resolveWwwPublicMountPath(appDirName, null);
    return {
      kind: 'plain',
      mode: 'static',
      staticRoot: resolved.root,
      mountPath,
      reason: !read.ok
        ? `sign 无效，按普通静态挂载 (${read.error})`
        : '普通静态（无 sign.json）',
      warn: !read.ok ? read.error : undefined,
      sign: null,
    };
  }

  const sign = read.value;
  const mountPath = resolveWwwPublicMountPath(appDirName, sign);

  if (shouldProxyFrontend(sign)) {
    return {
      kind: 'signed',
      mode: 'proxy',
      staticRoot: null,
      mountPath,
      reason: '前端工程：反代（serve=proxy/dev，或未写 serve 且 enabled 未关）',
      sign,
    };
  }

  const resolved = resolveWwwStaticRoot(appDir, sign);
  const serve = String(sign.serve || '').toLowerCase();
  let reason = '前端工程：静态托管产物';
  if (sign.enabled === false) reason = '前端工程：enabled=false，静态托管';
  else if (serve === 'static' || serve === 'dist') reason = '前端工程：serve=static，静态托管';

  return {
    kind: 'signed',
    mode: 'static',
    staticRoot: resolved.root,
    mountPath,
    reason: `${reason} → ${resolved.via}`,
    warn: resolved.warn,
    sign,
  };
}

/**
 * @deprecated 请用 `shouldProxyFrontend(readWwwSignFile(path).value)`
 * @param {string} signPath
 */
export function isActiveFrontendSign(signPath) {
  const read = readWwwSignFile(signPath);
  if (!read.ok) return false;
  return shouldProxyFrontend(read.value);
}

/**
 * @deprecated 请用 `resolveWwwStaticRoot(dir, null).root`（普通静态=目录本体）
 * @param {string} subDirPath
 */
export function resolveWwwAppStaticRoot(subDirPath) {
  return resolveWwwStaticRoot(subDirPath, null).root;
}
