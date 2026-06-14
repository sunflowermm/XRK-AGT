import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const SYSTEM_CORE_DIR = path.join(root, 'core', 'system-Core');

/** 框架基准：与 `git ls-files core/system-Core/<subdir>/*.js` 一致（vendor = 未入库本地 .js） */
export const SYSTEM_CORE_BASELINE = Object.freeze({
  http: 12,
  stream: 7,
  plugin: 15,
  tasker: 4,
  events: 4,
});

/** @param {string} subdir http | stream | plugin | tasker | events */
export function listSystemCoreJs(subdir) {
  const glob = `core/system-Core/${subdir}/*.js`;
  try {
    const out = execSync(`git ls-files -z -- "${glob}"`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split('\0')
      .filter(Boolean)
      .map((p) => path.basename(p.replace(/^"|"$/g, '')));
  } catch {
    const dir = path.join(SYSTEM_CORE_DIR, subdir);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  }
}

/** 与 ApiLoader.resolveCoreModuleKey 一致：core/http 下相对路径（无 .js） */
export function systemCoreHttpApiKeys() {
  return listSystemCoreJs('http').map((f) => f.replace(/\.js$/, ''));
}

export function systemCoreStreamBasenames() {
  return listSystemCoreJs('stream').map((f) => f.replace(/\.js$/, ''));
}
