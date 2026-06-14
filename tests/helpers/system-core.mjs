import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYSTEM_CORE_VENDOR_PLUGINS } from '../../src/utils/loader-constants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const SYSTEM_CORE_DIR = path.join(root, 'core', 'system-Core');

/** 框架基准：仅 system-Core 官方自带（第三方 vendor 插件不计入） */
export const SYSTEM_CORE_BASELINE = Object.freeze({
  http: 12,
  stream: 7,
  plugin: 16,
  tasker: 4,
  events: 4,
});

export function listSystemCoreJs(subdir) {
  const dir = path.join(SYSTEM_CORE_DIR, subdir);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  if (subdir !== 'plugin') return files;
  return files.filter((f) => !SYSTEM_CORE_VENDOR_PLUGINS.includes(f));
}

export function systemCoreHttpApiKeys() {
  return listSystemCoreJs('http').map((f) => `http/${f.replace(/\.js$/, '')}`);
}

export function systemCoreStreamBasenames() {
  return listSystemCoreJs('stream').map((f) => f.replace(/\.js$/, ''));
}
