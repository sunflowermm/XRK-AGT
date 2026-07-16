import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const SYSTEM_CORE_DIR = path.join(root, 'core', 'system-Core');

/** 框架基准：与 `git ls-files core/system-Core/<subdir>/*.js` 一致（vendor = 未入库本地 .js） */
export const SYSTEM_CORE_BASELINE = Object.freeze({
  http: 12,
  workflow: 8,
  plugin: 15,
  tasker: 4,
  events: 4,
});

/** @param {string} subdir http | workflow | plugin | tasker | events */
export function listSystemCoreJs(subdir) {
  const glob = `core/system-Core/${subdir}/*.js`;
  const fromDisk = () => {
    const dir = path.join(SYSTEM_CORE_DIR, subdir);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  };
  try {
    const out = execSync(`git ls-files -z -- "${glob}"`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const tracked = out
      .split('\0')
      .filter(Boolean)
      .map((p) => path.basename(p.replace(/^"|"$/g, '')));
    // 目录刚 rename 尚未入库时 ls-files 为空，回退磁盘
    return tracked.length > 0 ? tracked : fromDisk();
  } catch {
    return fromDisk();
  }
}

/**
 * 与 HttpApiLoader.getApiKey（resolveQualifiedCoreModuleKey）一致：
 * `system-Core/<相对 http/ 路径无 .js>`
 */
export function systemCoreHttpApiKeys() {
  return listSystemCoreJs('http').map((f) => `system-Core/${f.replace(/\.js$/, '')}`);
}

/** 与 PluginLoader.getPlugins().name（_pluginQualifiedKey）一致 */
export function systemCorePluginKeys() {
  return listSystemCoreJs('plugin').map((f) => `system-Core/${f.replace(/\.js$/, '')}`);
}

export function systemCoreStreamBasenames() {
  return listSystemCoreJs('workflow').map((f) => f.replace(/\.js$/, ''));
}
