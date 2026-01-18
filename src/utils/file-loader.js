import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import paths from './paths.js';

/**
 * 通用文件加载工具
 * 提供统一的文件读取和目录扫描功能，减少重复代码
 */
export class FileLoader {
  /**
   * 递归读取目录中的所有文件
   * @param {string} dir - 目录路径
   * @param {Object} options - 选项
   * @param {string|RegExp} options.ext - 文件扩展名过滤（如 '.js' 或 /\.js$/）
   * @param {boolean} options.recursive - 是否递归读取子目录
   * @param {Array<string>} options.ignore - 忽略的文件名前缀（如 ['.', '_']）
   * @returns {Promise<Array<string>>} 文件路径数组
   */
  static async readFiles(dir, options = {}) {
    const {
      ext = null,
      recursive = true,
      ignore = ['.', '_']
    } = options;

    if (!existsSync(dir)) {
      return [];
    }

    const files = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && recursive) {
        const subFiles = await this.readFiles(fullPath, options);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        if (this.shouldIncludeFile(entry.name, ext, ignore)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  /**
   * 判断文件是否应该被包含
   * @param {string} filename - 文件名
   * @param {string|RegExp} ext - 扩展名过滤
   * @param {Array<string>} ignore - 忽略的前缀
   * @returns {boolean}
   */
  static shouldIncludeFile(filename, ext, ignore) {
    if (ignore.some(prefix => filename.startsWith(prefix))) {
      return false;
    }

    if (!ext) return true;

    if (typeof ext === 'string') {
      return filename.endsWith(ext);
    }

    if (ext instanceof RegExp) {
      return ext.test(filename);
    }

    return true;
  }

  /**
   * 获取所有 core 目录下的指定子目录
   * @param {string} subDir - 子目录名（如 'plugin', 'http'）
   * @returns {Promise<Array<string>>} 子目录路径数组
   */
  static async getCoreSubDirs(subDir) {
    return paths.getCoreSubDirs(subDir);
  }

  /**
   * 获取所有 core 目录下指定子目录中的文件
   * @param {string} subDir - 子目录名
   * @param {Object} options - 文件读取选项
   * @returns {Promise<Array<string>>} 文件路径数组
   */
  static async getCoreSubDirFiles(subDir, options = {}) {
    const subDirs = await this.getCoreSubDirs(subDir);
    const allFiles = [];

    for (const subDirPath of subDirs) {
      const files = await this.readFiles(subDirPath, options);
      allFiles.push(...files);
    }

    return allFiles;
  }

  /**
   * 读取单个文件并解析为模块
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object>} 模块导出对象
   */
  static async importFile(filePath) {
    try {
      const fileUrl = pathToFileURL(filePath).href;
      const module = await import(fileUrl);
      return module.default || module;
    } catch (error) {
      throw new Error(`无法导入文件 ${filePath}: ${error.message}`);
    }
  }
}

export default FileLoader;
