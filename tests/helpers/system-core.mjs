import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 框架基准仅统计内置 core/system-Core（扩展 core 不计入） */
export const SYSTEM_CORE_DIR = path.join(root, 'core', 'system-Core');

/**
 * 不计入框架基准的 system-Core 文件（个人/后期扩展，勿与官方自带模块混淆）
 */
export const SYSTEM_CORE_NON_BASELINE = Object.freeze({
  stream: ['screen.js', 'react-bits-mcp.js'],
  plugin: ['远行商人.js'],
});

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
  const skip = new Set(SYSTEM_CORE_NON_BASELINE[subdir] || []);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !skip.has(f));
}

/** ApiLoader key：http/<basename> */
export function systemCoreHttpApiKeys() {
  return listSystemCoreJs('http').map((f) => `http/${f.replace(/\.js$/, '')}`);
}

export function systemCoreStreamBasenames() {
  return listSystemCoreJs('stream').map((f) => f.replace(/\.js$/, ''));
}
