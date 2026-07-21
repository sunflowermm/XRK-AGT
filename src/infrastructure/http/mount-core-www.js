/**
 * 挂载各 Core 的 www。
 *
 * 两类子目录逻辑不同，决策在 `www-app-resolve.js`，说明见 `docs/www-mount.md`：
 *
 * 1. **普通静态**（无 sign）：`/${文件夹名}` → 目录本体（如 `/xrk`）
 * 2. **前端工程**（有 sign）：URL 由 `proxy.mount` 等决定；静态挂 dist，或跳过交给 Launcher 反代
 *
 * 另：`/core/<Core名>` 始终挂该 Core 的整个 `www/`（调试/直链用）。
 * 同名对外路径先到先得；保留段见 `RESERVED_ROOT_SEGMENTS`。
 */
import path from 'node:path';
import fsSync from 'node:fs';
import express from 'express';
import RuntimeUtil from '#utils/runtime-util.js';
import paths from '#utils/paths.js';
import { statDirs } from '#utils/core-fs.js';
import {
  resolveWwwAppMount,
  wwwMountPathRootSegment,
} from '#infrastructure/http/www-app-resolve.js';

export {
  resolveWwwAppMount,
  resolveWwwStaticRoot,
  resolveWwwPublicMountPath,
  wwwMountPathRootSegment,
  shouldProxyFrontend,
  readWwwSignFile,
  WWW_BUILD_OUT_CANDIDATES,
  isActiveFrontendSign,
  resolveWwwAppStaticRoot,
} from '#infrastructure/http/www-app-resolve.js';

/**
 * 不可占用的对外路径第一段。
 * `shared` 为历史保留段；产品页勿用，见 skill `xrk-www-compat`。
 */
export const RESERVED_ROOT_SEGMENTS = ['api', 'core', 'media', 'uploads', 'File', 'shared'];

/**
 * @param {import('express').Application} app
 * @param {object} [staticOptions] express.static 选项
 * @returns {Promise<Set<string>>} 已挂载路径（含 `/core/<名>` 与对外 `/…`）
 */
export async function mountCoreWwwStatic(app, staticOptions = {}) {
  const coreDirs = await paths.getCoreDirs();
  const mountedPaths = new Set();
  const wwwDirPaths = coreDirs.map((coreDir) => path.join(coreDir, 'www'));
  const wwwIsDir = await statDirs(wwwDirPaths);

  for (let ci = 0; ci < coreDirs.length; ci++) {
    const coreDir = coreDirs[ci];
    const wwwDir = wwwDirPaths[ci];
    const coreName = path.basename(coreDir);

    if (!wwwIsDir[ci]) continue;

    const coreMountPath = `/core/${coreName}`;
    if (!mountedPaths.has(coreMountPath)) {
      app.use(coreMountPath, express.static(wwwDir, staticOptions));
      mountedPaths.add(coreMountPath);
      RuntimeUtil.makeLog('info', `挂载 Core www: ${coreMountPath} -> ${wwwDir}`, 'AgentRuntime');
    }

    let dirEntries = [];
    try {
      dirEntries = fsSync
        .readdirSync(wwwDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory());
    } catch (error) {
      RuntimeUtil.makeLog(
        'debug',
        `扫描 www 子目录失败: ${wwwDir} - ${error.message}`,
        'AgentRuntime'
      );
      continue;
    }

    for (const entry of dirEntries) {
      const subDirName = entry.name;
      const subDirPath = path.join(wwwDir, subDirName);
      const decision = resolveWwwAppMount(subDirPath);
      const mountPath = decision.mountPath || `/${subDirName}`;
      const rootSeg = wwwMountPathRootSegment(mountPath);
      const kindLabel = decision.kind === 'signed' ? '前端工程' : '普通静态';

      if (RESERVED_ROOT_SEGMENTS.includes(rootSeg) || RESERVED_ROOT_SEGMENTS.includes(subDirName)) {
        RuntimeUtil.makeLog(
          'warn',
          `跳过保留路径: ${mountPath} (dir=${subDirName}, core: ${coreName})`,
          'AgentRuntime'
        );
        continue;
      }

      if (mountedPaths.has(mountPath)) {
        RuntimeUtil.makeLog(
          'warn',
          `路径冲突，跳过: ${mountPath} (dir=${subDirName}, core: ${coreName})，已被其他core占用`,
          'AgentRuntime'
        );
        continue;
      }

      if (decision.mode === 'proxy') {
        RuntimeUtil.makeLog(
          'info',
          `${kindLabel}反代，跳过静态: ${mountPath} (dir=${subDirName}, core: ${coreName}) — ${decision.reason}`,
          'AgentRuntime'
        );
        continue;
      }

      if (!decision.staticRoot) {
        RuntimeUtil.makeLog(
          'warn',
          `静态挂载无有效根目录，跳过: ${mountPath} (dir=${subDirName}, core: ${coreName})`,
          'AgentRuntime'
        );
        continue;
      }

      app.use(mountPath, express.static(decision.staticRoot, staticOptions));
      mountedPaths.add(mountPath);
      RuntimeUtil.makeLog(
        'info',
        `挂载${kindLabel}: ${mountPath} -> ${decision.staticRoot} (dir=${subDirName}, core: ${coreName}; ${decision.reason})`,
        'AgentRuntime'
      );
      if (decision.warn) {
        RuntimeUtil.makeLog('warn', `${mountPath}: ${decision.warn}`, 'AgentRuntime');
      }
    }
  }

  return mountedPaths;
}
