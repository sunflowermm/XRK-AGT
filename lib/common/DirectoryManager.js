/**
 * @file DirectoryManager.js
 * @description 统一目录管理工具
 * @author XRK
 * @copyright 2025 XRK Studio
 * @license MIT
 * 
 * 提供统一的目录创建和管理方法，避免重复创建，支持多环境
 */

import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';

/**
 * 目录管理器
 * @class DirectoryManager
 */
export default class DirectoryManager {
  /** @type {Set<string>} 已创建的目录缓存 */
  static createdDirs = new Set();

  /**
   * 创建目录（统一方法，避免重复创建）
   * @param {string} dirPath - 目录路径
   * @param {Object} options - 选项
   * @param {boolean} options.recursive - 递归创建
   * @param {boolean} options.checkExists - 检查是否存在（默认true）
   * @returns {Promise<boolean>} 是否创建成功（已存在返回false，新创建返回true）
   */
  static async createDir(dirPath, options = { recursive: true, checkExists: true }) {
    if (!dirPath) return false;

    // 规范化路径
    const normalizedPath = path.normalize(dirPath);
    const absPath = path.isAbsolute(normalizedPath) 
      ? normalizedPath 
      : path.join(process.cwd(), normalizedPath);

    // 检查缓存
    if (this.createdDirs.has(absPath)) {
      return false;
    }

    try {
      // 检查目录是否已存在
      if (options.checkExists) {
        try {
          const stats = await fs.stat(absPath);
          if (stats.isDirectory()) {
            this.createdDirs.add(absPath);
            return false; // 目录已存在
          }
          // 如果存在但不是目录，抛出错误
          throw new Error(`路径 ${absPath} 已存在但不是目录`);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      // 创建目录
      await fs.mkdir(absPath, { recursive: options.recursive });
      this.createdDirs.add(absPath);
      return true; // 新创建
    } catch (error) {
      if (error.code === 'EEXIST') {
        this.createdDirs.add(absPath);
        return false; // 目录已存在
      }
      throw error;
    }
  }

  /**
   * 同步创建目录（统一方法）
   * @param {string} dirPath - 目录路径
   * @param {Object} options - 选项
   * @returns {boolean} 是否创建成功
   */
  static createDirSync(dirPath, options = { recursive: true, checkExists: true }) {
    if (!dirPath) return false;

    const normalizedPath = path.normalize(dirPath);
    const absPath = path.isAbsolute(normalizedPath) 
      ? normalizedPath 
      : path.join(process.cwd(), normalizedPath);

    // 检查缓存
    if (this.createdDirs.has(absPath)) {
      return false;
    }

    try {
      // 检查目录是否已存在
      if (options.checkExists) {
        try {
          const stats = fsSync.statSync(absPath);
          if (stats.isDirectory()) {
            this.createdDirs.add(absPath);
            return false;
          }
          throw new Error(`路径 ${absPath} 已存在但不是目录`);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      // 创建目录
      fsSync.mkdirSync(absPath, { recursive: options.recursive });
      this.createdDirs.add(absPath);
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') {
        this.createdDirs.add(absPath);
        return false;
      }
      throw error;
    }
  }

  /**
   * 确保目录存在（不抛出错误，静默处理）
   * @param {string} dirPath - 目录路径
   * @param {Object} options - 选项
   * @returns {Promise<boolean>} 是否成功
   */
  static async ensureDir(dirPath, options = {}) {
    try {
      return await this.createDir(dirPath, options);
    } catch (error) {
      // 静默失败
      return false;
    }
  }

  /**
   * 批量创建目录
   * @param {string[]} dirPaths - 目录路径数组
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 创建结果 {path: success}
   */
  static async createDirs(dirPaths, options = {}) {
    const results = {};
    for (const dirPath of dirPaths) {
      try {
        results[dirPath] = await this.createDir(dirPath, options);
      } catch (error) {
        results[dirPath] = false;
      }
    }
    return results;
  }

  /**
   * 清除缓存
   */
  static clearCache() {
    this.createdDirs.clear();
  }

  /**
   * 获取已创建的目录列表
   * @returns {string[]} 目录路径数组
   */
  static getCreatedDirs() {
    return Array.from(this.createdDirs);
  }
}

