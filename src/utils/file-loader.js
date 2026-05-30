import paths from './paths.js';
import { scanFiles } from './core-fs.js';
import { LOADER_BATCH_SIZE } from './loader-constants.js';

export class FileLoader {
  static readFiles(dir, options) {
    return scanFiles(dir, options);
  }

  static async getCoreSubDirFiles(subDir, options) {
    const subDirs = await paths.getCoreSubDirs(subDir);
    if (subDirs.length === 0) return [];
    const batches = await Promise.all(subDirs.map((dir) => scanFiles(dir, options)));
    return batches.flat();
  }

  static async mapInBatches(items, size, fn) {
    const results = [];
    for (let i = 0; i < items.length; i += size) {
      results.push(...await Promise.allSettled(items.slice(i, i + size).map(fn)));
    }
    return results;
  }

  static async forEachBatch(items, size, fn) {
    await FileLoader.mapInBatches(items, size ?? LOADER_BATCH_SIZE, fn);
  }
}

export { LOADER_BATCH_SIZE };
