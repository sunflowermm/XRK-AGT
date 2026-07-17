/**
 * 挂载各 Core 的 www 静态目录（从 AgentRuntime 内聚逻辑抽出，便于单测与复用）
 *
 * 规则（与 skill `xrk-www-compat` / `docs/app-dev.md` 一致）：
 * - 每个 Core：`core/<名>/www` → 额外挂 `/core/<名>`（整棵 www）
 * - www 下每个**子目录** → `/<子目录名>`（如 `www/xrk`→`/xrk`，`www/shared`→`/shared`）
 * - 同名 `/<子目录>` 先挂载者占用，后者 warn 跳过（勿让产品 Core 抢 `shared`）
 * - 子目录含 `sign.json`：跳过根路径静态挂载（自建前端构建约定）
 * - 保留段不可作应用名：见 RESERVED_ROOT_SEGMENTS
 */
import path from 'node:path';
import fsSync from 'node:fs';
import express from 'express';
import RuntimeUtil from '#utils/runtime-util.js';
import paths from '#utils/paths.js';
import { statDirs, statFiles } from '#utils/core-fs.js';

/** 根路径保留段：不可被 Core www 子目录占用 */
const RESERVED_ROOT_SEGMENTS = ['api', 'core', 'media', 'uploads', 'File'];

/**
 * @param {import('express').Application} app
 * @param {object} staticOptions express.static 选项
 * @returns {Promise<Set<string>>} 已挂载路径（含 `/core/<名>` 与 `/<app>`）
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
      RuntimeUtil.makeLog('info', `挂载静态资源: ${coreMountPath} -> ${wwwDir}`, 'AgentRuntime');
    }

    try {
      const entries = fsSync.readdirSync(wwwDir, { withFileTypes: true });
      const dirEntries = entries.filter((entry) => entry.isDirectory());
      const signPaths = dirEntries.map((entry) =>
        path.join(wwwDir, entry.name, 'sign.json')
      );
      const signExists = signPaths.length > 0 ? await statFiles(signPaths) : [];

      for (let di = 0; di < dirEntries.length; di++) {
        const entry = dirEntries[di];
        const subDirName = entry.name;
        const subDirPath = path.join(wwwDir, entry.name);
        const mountPath = `/${subDirName}`;

        if (signExists[di]) {
          RuntimeUtil.makeLog(
            'info',
            `检测到前端 sign.json，跳过子目录静态挂载: ${mountPath} (core: ${coreName})`,
            'AgentRuntime'
          );
          continue;
        }

        if (RESERVED_ROOT_SEGMENTS.includes(subDirName)) {
          RuntimeUtil.makeLog('warn', `跳过保留路径: ${mountPath} (core: ${coreName})`, 'AgentRuntime');
          continue;
        }

        if (mountedPaths.has(mountPath)) {
          RuntimeUtil.makeLog(
            'warn',
            `路径冲突，跳过: ${mountPath} (core: ${coreName})，已被其他core占用`,
            'AgentRuntime'
          );
          continue;
        }

        app.use(mountPath, express.static(subDirPath, staticOptions));
        mountedPaths.add(mountPath);
        RuntimeUtil.makeLog(
          'info',
          `挂载子目录: ${mountPath} -> ${subDirPath} (core: ${coreName})`,
          'AgentRuntime'
        );
      }
    } catch (error) {
      RuntimeUtil.makeLog('debug', `扫描 www 子目录失败: ${wwwDir} - ${error.message}`, 'AgentRuntime');
    }
  }

  return mountedPaths;
}
