import path from 'path';
import paths from './paths.js';
import { scanFiles } from './core-fs.js';
import { SCAN_IGNORE_PREFIXES } from './loader-constants.js';

/**
 * Loader 文件扫描（走 paths 缓存 + core-fs）
 */
export class FileLoader {
  /**
   * @param {string} dir
   * @param {{ ext?: string, recursive?: boolean, ignore?: string[], exclude?: string[] }} [options]
   * @returns {Promise<string[]>}
   */
  static async readFiles(dir, options = {}) {
    const {
      ext = '',
      recursive = true,
      ignore = SCAN_IGNORE_PREFIXES,
      exclude = []
    } = options;

    return scanFiles(dir, {
      ext: typeof ext === 'string' ? ext : '',
      recursive,
      ignore,
      exclude
    });
  }

  /**
   * @param {string} subDir
   * @param {{ ext?: string, recursive?: boolean, ignore?: string[], exclude?: string[] }} [options]
   * @returns {Promise<string[]>}
   */
  static async getCoreSubDirFiles(subDir, options = {}) {
    const scanOpts = {
      ext: typeof options.ext === 'string' ? options.ext : '',
      recursive: options.recursive !== false,
      ignore: options.ignore || SCAN_IGNORE_PREFIXES,
      exclude: options.exclude || []
    };

    const subDirs = await paths.getCoreSubDirs(subDir);
    if (subDirs.length === 0) return [];

    const batches = await Promise.all(subDirs.map((dir) => scanFiles(dir, scanOpts)));
    return batches.flat();
  }
}
