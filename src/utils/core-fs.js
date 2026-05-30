import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { SCAN_IGNORE_PREFIXES } from './loader-constants.js';

function scanOpts(options = {}) {
  return {
    ext: options.ext || '',
    recursive: options.recursive !== false,
    ignore: options.ignore || SCAN_IGNORE_PREFIXES,
    exclude: options.exclude || []
  };
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

/**
 * @param {string} dir
 * @param {object} [options]
 * @returns {Promise<string[]>}
 */
export async function scanFiles(dir, options = {}) {
  const opts = scanOpts(options);
  try {
    await fsPromises.access(dir);
  } catch {
    return [];
  }
  const files = [];
  await walkDir(dir, opts, files);
  return files;
}

/**
 * @param {string[]} pathsList
 * @returns {Promise<boolean[]>}
 */
export async function statDirs(pathsList) {
  return statDirsSync(pathsList);
}

/**
 * @param {string[]} pathsList
 * @returns {Promise<boolean[]>}
 */
export async function statFiles(pathsList) {
  return statFilesSync(pathsList);
}

/**
 * @param {string[]} pathsList
 * @returns {boolean[]}
 */
export function statDirsSync(pathsList) {
  return pathsList.map((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * @param {string[]} pathsList
 * @returns {boolean[]}
 */
export function statFilesSync(pathsList) {
  return pathsList.map((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * @param {string} coreRoot
 * @param {string[]} subDirNames
 * @returns {Promise<Record<string, string[]>>}
 */
export async function discoverCoreSubDirs(coreRoot, subDirNames) {
  /** @type {Record<string, string[]>} */
  const result = Object.fromEntries(subDirNames.map((name) => [name, []]));

  let coreDirs = [];
  try {
    const entries = await fsPromises.readdir(coreRoot, { withFileTypes: true });
    coreDirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => path.join(coreRoot, entry.name));
  } catch {
    return result;
  }

  const candidates = [];
  for (const coreDir of coreDirs) {
    for (const subName of subDirNames) {
      candidates.push({ subName, fullPath: path.join(coreDir, subName) });
    }
  }
  if (candidates.length === 0) return result;

  const exists = statDirsSync(candidates.map((item) => item.fullPath));
  candidates.forEach((item, index) => {
    if (exists[index]) result[item.subName].push(item.fullPath);
  });
  return result;
}

/**
 * @param {string[]} pathsList
 * @returns {(string | null)[]}
 */
export function readTextFilesSync(pathsList) {
  return pathsList.map((p) => {
    try {
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
      return fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  });
}

/**
 * @param {string[]} pathsList
 * @returns {number}
 */
export function pickFirstExistingSync(pathsList) {
  for (let i = 0; i < pathsList.length; i++) {
    try {
      if (fs.existsSync(pathsList[i])) return i;
    } catch {
      // continue
    }
  }
  return -1;
}

/**
 * @param {string[]} candidates
 * @returns {string | null}
 */
export function findFirstExistingFile(candidates) {
  const list = candidates?.filter(Boolean) ?? [];
  if (list.length === 0) return null;
  const idx = pickFirstExistingSync(list);
  return idx >= 0 ? list[idx] : null;
}

/**
 * @param {string[]} subDirs
 * @param {string} fileBaseName
 * @returns {string | null}
 */
export function findInCoreSubDirs(subDirs, fileBaseName) {
  const candidates = subDirs.map((dir) => path.join(dir, `${fileBaseName}.js`));
  return findFirstExistingFile(candidates);
}

/**
 * @param {string} pattern
 * @param {string} event
 * @returns {boolean}
 */
export function matchEventPattern(pattern, event) {
  if (pattern === event) return true;
  if (!pattern.includes('*')) return false;

  const patternParts = pattern.split('.');
  const eventParts = event.split('.');
  if (patternParts.length !== eventParts.length) return false;

  return patternParts.every((part, i) => part === '*' || part === eventParts[i]);
}
