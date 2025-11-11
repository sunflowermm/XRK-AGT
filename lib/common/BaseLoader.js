/**
 * @file BaseLoader.js
 * @description 标准化加载器基类
 * @author XRK
 * @copyright 2025 XRK Studio
 * @license MIT
 * 
 * 提供统一的加载器接口和规范：
 * - 统一的加载流程
 * - 标准的错误处理
 * - 一致的日志记录
 * - 规范的统计信息
 * - 统一的热更新支持
 */

import path from 'path';
import BotUtil from './util.js';

/**
 * 标准化加载器基类
 * 所有加载器都应继承此类以确保一致性
 * 
 * @abstract
 * @class BaseLoader
 */
export default class BaseLoader {
  /**
   * @param {Object} options - 加载器配置选项
   * @param {string} options.name - 加载器名称
   * @param {string} options.dir - 加载目录路径
   * @param {string} options.pattern - 文件匹配模式（如 '*.js'）
   * @param {boolean} options.recursive - 是否递归加载子目录
   * @param {boolean} options.watch - 是否启用文件监视
   */
  constructor(options = {}) {
    /** @type {string} 加载器名称 */
    this.name = options.name || 'BaseLoader';
    
    /** @type {string} 加载目录路径 */
    this.dir = options.dir || '';
    
    /** @type {string} 文件匹配模式 */
    this.pattern = options.pattern || '*.js';
    
    /** @type {boolean} 是否递归加载 */
    this.recursive = options.recursive ?? false;
    
    /** @type {boolean} 是否启用文件监视 */
    this.watch = options.watch ?? false;
    
    /** @type {Map} 加载的模块集合 */
    this.modules = new Map();
    
    /** @type {Object} 文件监视器 */
    this.watchers = {};
    
    /** @type {boolean} 加载状态 */
    this.loaded = false;
    
    /** @type {Object} 加载统计信息 */
    this.loadStats = {
      modules: [],
      totalLoadTime: 0,
      startTime: 0,
      totalModules: 0,
      failedModules: 0,
      skippedModules: 0
    };
    
    /** @type {Array} 加载的模块列表（按优先级排序） */
    this.priority = [];
  }

  /**
   * 标准化加载流程
   * 子类可以重写此方法以实现自定义加载逻辑
   * 
   * @param {boolean} isRefresh - 是否为刷新加载
   * @returns {Promise<void>}
   */
  async load(isRefresh = false) {
    if (!isRefresh && this.loaded) {
      BotUtil.makeLog('debug', `⚠️ ${this.name} 已加载，跳过`, this.name);
      return;
    }

    try {
      this.loadStats.startTime = Date.now();
      this.loadStats.modules = [];
      this.loadStats.failedModules = 0;
      this.loadStats.skippedModules = 0;

      if (!isRefresh) {
        this.modules.clear();
        this.priority = [];
      }

      BotUtil.makeLog('info', '━━━━━━━━━━━━━━━━━━━━━━━━━━━', this.name);
      BotUtil.makeLog('info', `【开始加载 ${this.name}】`, this.name);

      // 确保目录存在
      await this.ensureDirectory();

      // 获取文件列表
      const files = await this.getFiles();
      
      if (files.length === 0) {
        BotUtil.makeLog('warn', `└─ ⚠️ 未找到文件`, this.name);
        BotUtil.makeLog('info', '━━━━━━━━━━━━━━━━━━━━━━━━━━━', this.name);
        this.loaded = true;
        return;
      }

      BotUtil.makeLog('info', `├─ 📦 发现 ${files.length} 个文件`, this.name);

      // 加载所有文件
      await this.loadFiles(files);

      // 排序
      this.sortModules();

      this.loadStats.totalLoadTime = Date.now() - this.loadStats.startTime;
      this.loadStats.totalModules = this.modules.size;
      this.loaded = true;

      // 显示加载结果
      this.displayLoadSummary();

      // 启用文件监视
      if (this.watch) {
        await this.startWatching();
      }
    } catch (error) {
      BotUtil.makeLog('error', `❌ ${this.name} 加载失败: ${error.message}`, this.name, error);
      throw error;
    }
  }

  /**
   * 确保目录存在
   * @protected
   * @returns {Promise<void>}
   */
  async ensureDirectory() {
    if (!this.dir) return;
    
    try {
      const fs = await import('fs/promises');
      await fs.mkdir(this.dir, { recursive: true });
    } catch (error) {
      BotUtil.makeLog('error', `创建目录失败: ${this.dir}`, this.name, error);
      throw error;
    }
  }

  /**
   * 获取文件列表
   * @protected
   * @returns {Promise<Array>} 文件路径数组
   */
  async getFiles() {
    if (!this.dir) return [];
    
    try {
      const fs = await import('fs/promises');
      const files = [];
      
      if (this.recursive) {
        // 递归获取文件
        const entries = await fs.readdir(this.dir, { withFileTypes: true, recursive: true });
        
        for (const entry of entries) {
          if (entry.isFile() && this.matchFile(entry.name)) {
            files.push(path.join(entry.path || this.dir, entry.name));
          }
        }
      } else {
        // 只获取当前目录文件
        const entries = await fs.readdir(this.dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isFile() && this.matchFile(entry.name)) {
            files.push(path.join(this.dir, entry.name));
          }
        }
      }
      
      return files;
    } catch (error) {
      BotUtil.makeLog('error', `读取目录失败: ${this.dir}`, this.name, error);
      return [];
    }
  }

  /**
   * 匹配文件名
   * @protected
   * @param {string} filename - 文件名
   * @returns {boolean} 是否匹配
   */
  matchFile(filename) {
    if (!this.pattern) return true;
    
    // 跳过以 . 或 _ 开头的文件
    if (filename.startsWith('.') || filename.startsWith('_')) {
      return false;
    }
    
    // 简单的模式匹配
    if (this.pattern === '*.js') {
      return filename.endsWith('.js');
    }
    
    // 可以扩展更多模式匹配逻辑
    return true;
  }

  /**
   * 加载所有文件
   * @protected
   * @param {Array} files - 文件路径数组
   * @returns {Promise<void>}
   */
  async loadFiles(files) {
    const batchSize = 10; // 批量加载大小
    
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map(file => this.loadModule(file))
      );
    }
  }

  /**
   * 加载单个模块
   * 子类必须实现此方法
   * 
   * @abstract
   * @protected
   * @param {string} filePath - 文件路径
   * @returns {Promise<boolean>} 是否成功
   */
  async loadModule(filePath) {
    throw new Error('loadModule 方法必须由子类实现');
  }

  /**
   * 获取模块键名
   * @protected
   * @param {string} filePath - 文件路径
   * @returns {string} 模块键名
   */
  getModuleKey(filePath) {
    const relativePath = path.relative(this.dir, filePath);
    return relativePath.replace(/\\/g, '/').replace(/\.js$/, '');
  }

  /**
   * 排序模块
   * @protected
   * @returns {void}
   */
  sortModules() {
    this.priority = Array.from(this.modules.values())
      .filter(module => module && module.enable !== false)
      .sort((a, b) => {
        const priorityA = a.priority ?? 100;
        const priorityB = b.priority ?? 100;
        return priorityB - priorityA; // 优先级高的在前
      });
  }

  /**
   * 显示加载摘要
   * @protected
   * @returns {void}
   */
  displayLoadSummary() {
    const successCount = this.modules.size;
    const failedCount = this.loadStats.failedModules;
    const totalTime = (this.loadStats.totalLoadTime / 1000).toFixed(2);

    BotUtil.makeLog('info', '├─ 【加载完成】', this.name);
    BotUtil.makeLog('success', `│  ✅ 成功: ${successCount} 个`, this.name);
    
    if (failedCount > 0) {
      BotUtil.makeLog('error', `│  ❌ 失败: ${failedCount} 个`, this.name);
    }
    
    if (this.loadStats.skippedModules > 0) {
      BotUtil.makeLog('warn', `│  ⏭️ 跳过: ${this.loadStats.skippedModules} 个`, this.name);
    }
    
    BotUtil.makeLog('success', `└─ ⏱️ 耗时: ${totalTime}秒`, this.name);
    BotUtil.makeLog('info', '━━━━━━━━━━━━━━━━━━━━━━━━━━━', this.name);
  }

  /**
   * 启动文件监视
   * @protected
   * @returns {Promise<void>}
   */
  async startWatching() {
    if (!this.watch || !this.dir) return;
    
    try {
      const chokidar = await import('chokidar');
      
      this.watchers.main = chokidar.watch(this.dir, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        }
      });
      
      this.watchers.main
        .on('add', filePath => {
          BotUtil.makeLog('info', `检测到新文件: ${filePath}`, this.name);
          this.loadModule(filePath).then(() => {
            this.sortModules();
          });
        })
        .on('change', filePath => {
          BotUtil.makeLog('info', `检测到文件变更: ${filePath}`, this.name);
          this.reloadModule(filePath);
        })
        .on('unlink', async filePath => {
          BotUtil.makeLog('info', `检测到文件删除: ${filePath}`, this.name);
          await this.unloadModule(filePath);
          this.sortModules();
        });
      
      BotUtil.makeLog('info', '文件监视已启动', this.name);
    } catch (error) {
      BotUtil.makeLog('error', '启动文件监视失败', this.name, error);
    }
  }

  /**
   * 重新加载模块
   * @param {string} filePath - 文件路径
   * @returns {Promise<boolean>} 是否成功
   */
  async reloadModule(filePath) {
    const key = this.getModuleKey(filePath);
    const existing = this.modules.get(key);
    
    if (existing && typeof existing.cleanup === 'function') {
      await existing.cleanup().catch(() => {});
    }
    
    return await this.loadModule(filePath);
  }

  /**
   * 卸载模块
   * @param {string} filePath - 文件路径
   * @returns {Promise<void>}
   */
  async unloadModule(filePath) {
    const key = this.getModuleKey(filePath);
    const module = this.modules.get(key);
    
    if (module && typeof module.cleanup === 'function') {
      await module.cleanup().catch(() => {});
    }
    
    this.modules.delete(key);
  }

  /**
   * 获取模块
   * @param {string} key - 模块键名
   * @returns {Object|null} 模块实例
   */
  getModule(key) {
    return this.modules.get(key) || null;
  }

  /**
   * 获取所有模块
   * @returns {Array} 模块数组
   */
  getAllModules() {
    return Array.from(this.modules.values());
  }

  /**
   * 获取启用的模块
   * @returns {Array} 启用的模块数组
   */
  getEnabledModules() {
    return this.getAllModules().filter(m => m && m.enable !== false);
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计信息对象
   */
  getStats() {
    return {
      name: this.name,
      total: this.modules.size,
      enabled: this.getEnabledModules().length,
      disabled: this.modules.size - this.getEnabledModules().length,
      loadStats: this.loadStats,
      loaded: this.loaded,
      watching: Object.keys(this.watchers).length > 0
    };
  }

  /**
   * 清理所有资源
   * @returns {Promise<void>}
   */
  async cleanup() {
    BotUtil.makeLog('info', `🧹 清理 ${this.name} 资源...`, this.name);
    
    // 清理所有模块
    for (const module of this.modules.values()) {
      if (module && typeof module.cleanup === 'function') {
        await module.cleanup().catch(() => {});
      }
    }
    
    // 停止文件监视
    for (const watcher of Object.values(this.watchers)) {
      if (watcher && typeof watcher.close === 'function') {
        await watcher.close();
      }
    }
    
    // 清理数据
    this.modules.clear();
    this.priority = [];
    this.watchers = {};
    this.loaded = false;
    
    BotUtil.makeLog('success', `✅ ${this.name} 清理完成`, this.name);
  }
}

