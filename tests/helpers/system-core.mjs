import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const SYSTEM_CORE_DIR = path.join(root, 'core', 'system-Core');

/** 框架基准：仅 system-Core 官方自带（见 tests/helpers/system-core.mjs） */
export const SYSTEM_CORE_BASELINE = Object.freeze({
  http: 11,
  stream: 7,
  plugin: 15,
  tasker: 4,
  events: 3,
});

export function listSystemCoreJs(subdir) {
  const dir = path.join(SYSTEM_CORE_DIR, subdir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
}

export function systemCoreHttpApiKeys() {
  return listSystemCoreJs('http').map((f) => `http/${f.replace(/\.js$/, '')}`);
}

export function systemCoreStreamBasenames() {
  return listSystemCoreJs('stream').map((f) => f.replace(/\.js$/, ''));
}
