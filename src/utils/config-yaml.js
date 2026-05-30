import YAML from 'yaml';

import {
  pickFirstExistingSync,
  readTextFilesSync,
  statFilesSync
} from './core-fs.js';

/**
 * @param {string[]} candidates
 * @param {string} [logLabel]
 * @returns {{ config: object, watchFile: string | null }}
 */
export function loadYamlFromCandidates(candidates, logLabel = 'config') {
  const paths = candidates.filter(Boolean);
  const idx = pickFirstExistingSync(paths);
  if (idx < 0) return { config: {}, watchFile: null };

  const watchFile = paths[idx];
  const texts = readTextFilesSync([watchFile]);
  const raw = texts[0];
  if (raw == null || raw === '') return { config: {}, watchFile };

  try {
    return { config: YAML.parse(raw) ?? {}, watchFile };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    err.configLabel = logLabel;
    err.configPath = watchFile;
    throw err;
  }
}

/**
 * @param {string[]} paths
 * @returns {Map<string, string>}
 */
export function readYamlTextsBatch(paths) {
  const unique = [...new Set(paths.filter(Boolean))];
  const texts = readTextFilesSync(unique);
  const map = new Map();
  unique.forEach((p, i) => {
    if (texts[i] != null) map.set(p, texts[i]);
  });
  return map;
}

/**
 * @param {string | undefined} defaultText
 * @param {string | undefined} serverText
 * @returns {object}
 */
export function mergeYamlTexts(defaultText, serverText) {
  let config = {};
  if (defaultText) {
    try {
      config = YAML.parse(defaultText) ?? {};
    } catch {
      config = {};
    }
  }
  if (serverText) {
    try {
      config = { ...config, ...(YAML.parse(serverText) ?? {}) };
    } catch {
      // 保留 default
    }
  }
  return config;
}

/** @param {string} filePath */
export function fileExistsSync(filePath) {
  return statFilesSync([filePath])[0] === true;
}
