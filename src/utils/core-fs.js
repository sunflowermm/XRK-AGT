import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { SCAN_IGNORE_PREFIXES } from './loader-constants.js';

export function normalizeScanOptions({
  ext = '',
  recursive = true,
  ignore = SCAN_IGNORE_PREFIXES,
  exclude = []
} = {}) {
  return { ext, recursive, ignore, exclude };
}

async function walkDir(dir, opts, out) {
  let entries;
  try {
    entries = await fsPromises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (opts.ignore.some((prefix) => entry.name.startsWith(prefix))) continue;
    if (opts.exclude.includes(entry.name)) continue;

    if (entry.isDirectory()) {
      if (opts.recursive) await walkDir(fullPath, opts, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (opts.ext && !entry.name.endsWith(opts.ext)) continue;
    out.push(fullPath);
  }
}

/** @param {string} dir @param {object} [options] @returns {Promise<string[]>} */
export async function scanFiles(dir, options) {
  const files = [];
  await walkDir(dir, normalizeScanOptions(options), files);
  return files;
}

function statKindSync(pathsList, kind) {
  return pathsList.map((p) => {
    try {
      return fs.statSync(p)[kind]();
    } catch {
      return false;
    }
  });
}

export const statDirs = (pathsList) => statKindSync(pathsList, 'isDirectory');
export const statFiles = (pathsList) => statKindSync(pathsList, 'isFile');

/** @param {string} coreRoot @param {string[]} subDirNames */
export async function discoverCoreSubDirs(coreRoot, subDirNames) {
  const result = Object.fromEntries(subDirNames.map((name) => [name, []]));
  const entries = await fsPromises.readdir(coreRoot, { withFileTypes: true });
  const coreDirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => path.join(coreRoot, e.name));

  const candidates = [];
  for (const coreDir of coreDirs) {
    for (const subName of subDirNames) {
      candidates.push({ subName, fullPath: path.join(coreDir, subName) });
    }
  }
  if (candidates.length === 0) return result;

  const exists = statDirs(candidates.map((c) => c.fullPath));
  candidates.forEach((c, i) => {
    if (exists[i]) result[c.subName].push(c.fullPath);
  });
  return result;
}

/** @param {string[]} pathsList @returns {(string | null)[]} */
export function readTextFilesSync(pathsList) {
  return pathsList.map((p) => {
    try {
      if (!fs.statSync(p).isFile()) return null;
      return fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  });
}

/** @param {string[]} pathsList @returns {number} */
export function pickFirstExistingSync(pathsList) {
  return pathsList.findIndex((p) => fs.existsSync(p));
}

/** @param {string[]} subDirs @param {string} fileBaseName */
export function findInCoreSubDirs(subDirs, fileBaseName) {
  const idx = pickFirstExistingSync(subDirs.map((dir) => path.join(dir, `${fileBaseName}.js`)));
  return idx >= 0 ? path.join(subDirs[idx], `${fileBaseName}.js`) : null;
}

/**
 * 从 core 子目录内绝对路径解析模块 key（相对 core 子目录，不含 .js）
 * @param {string} filePath
 * @param {string[]} [coreDirs] 如 paths.getCoreSubDirs('http') 的返回值
 */
export function resolveCoreModuleKey(filePath, coreDirs = []) {
  const normalizedPath = path.resolve(filePath);
  for (const coreDir of coreDirs) {
    const normalizedCoreDir = path.resolve(coreDir);
    const rel = path.relative(normalizedCoreDir, normalizedPath);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return rel.replace(/\\/g, '/').replace(/\.js$/, '');
    }
  }
  return path.basename(filePath, '.js');
}

/** @param {string} pattern @param {string} event */
export function matchEventPattern(pattern, event) {
  if (pattern === event) return true;
  if (!pattern.includes('*')) return false;

  const patternParts = pattern.split('.');
  const eventParts = event.split('.');
  if (patternParts.length !== eventParts.length) return false;

  return patternParts.every((part, i) => part === '*' || part === eventParts[i]);
}
