import YAML from 'yaml';
import { normalizeError } from '#utils/normalize-error.js';

import {
  pickFirstExistingSync,
  readTextFilesSync,
  statFiles
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
  const raw = readTextFilesSync([watchFile])[0];
  if (!raw) return { config: {}, watchFile };

  try {
    return { config: YAML.parse(raw) || {}, watchFile };
  } catch (error) {
    const err = normalizeError(error);
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
  const defaultConfig = defaultText ? YAML.parse(defaultText) : {};
  const serverConfig = serverText ? YAML.parse(serverText) : {};
  return { ...defaultConfig, ...serverConfig };
}

/** @param {string} filePath */
export function fileExistsSync(filePath) {
  return statFiles([filePath])[0];
}
