import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';

/**
 * 配置加载器
 * 负责加载和管理所有配置类
 */
class ConfigLoader {
  constructor() {
    /** 所有配置实例 */
    this.configs = new Map();
    
    /** 加载状态 */
    this.loaded = false;
    
    /** 配置目录路径（不再使用固定路径） */
    this.configDir = null;
    
    /** 文件监视器 */
    this.watcher = null;
  }

  /**
   * 加载所有配置
   * @returns {Promise<Map>}
   */
  async load() {
    try {
      const startTime = Date.now();
      BotUtil.makeLog('info', '开始加载配置管理器...', 'ConfigLoader');

      // 获取所有 core 目录下的 commonconfig 目录
      const configDirs = await paths.getCoreSubDirs('commonconfig');

      // 加载每个配置目录
      for (const configDir of configDirs) {
        const files = await this._getConfigFiles(configDir);
        for (const file of files) {
          await this._loadConfig(file);
        }
      }

      this.loaded = true;
      const loadTime = Date.now() - startTime;
      
      BotUtil.makeLog('info', 
        `配置管理器加载完成: ${this.configs.size}个配置, 耗时${loadTime}ms`, 
        'ConfigLoader'
      );

      return this.configs;
    } catch (error) {
      BotUtil.makeLog('error', '配置管理器加载失败', 'ConfigLoader', error);
      throw error;
    }
  }

  /**
   * 获取配置文件列表
   * @private
   */
  async _getConfigFiles(dir) {
    try {
      const { FileLoader } = await import('#utils/file-loader.js');
      return FileLoader.readFiles(dir, {
        ext: '.js',
        recursive: false,
        ignore: ['.', '_']
      });
    } catch (error) {
      BotUtil.makeLog('error', `读取配置目录失败: ${dir}`, 'ConfigLoader', error);
      return [];
    }
  }

  /**
   * 加载单个配置文件
   * @private
   */
  async _loadConfig(filePath) {
    try {
      const key = path.basename(filePath, '.js');
      
      // 动态导入
      const fileUrl = `file://${filePath}?t=${Date.now()}`;
      const module = await import(fileUrl);
      
      if (!module.default) {
        BotUtil.makeLog('warn', `无效的配置模块: ${key} (缺少default导出)`, 'ConfigLoader');
        return false;
      }

      let configInstance;
      
      // 支持类和对象两种导出方式
      if (typeof module.default === 'function') {
        try {
          configInstance = new module.default();
        } catch (e) {
          BotUtil.makeLog('warn', `无法实例化配置模块: ${key}`, 'ConfigLoader');
          return false;
        }
      } else if (typeof module.default === 'object' && module.default !== null) {
        configInstance = module.default;
      } else {
        BotUtil.makeLog('warn', `无效的配置模块: ${key} (导出类型错误)`, 'ConfigLoader');
        return false;
      }

      // 验证配置实例
      if (!configInstance || typeof configInstance !== 'object') {
        BotUtil.makeLog('warn', `配置实例创建失败: ${key}`, 'ConfigLoader');
        return false;
      }

      // 存储配置实例
      this.configs.set(key, configInstance);
      
      BotUtil.makeLog('debug', `加载配置: ${configInstance.displayName || key}`, 'ConfigLoader');
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `加载配置失败: ${filePath} - ${error.message}`, 'ConfigLoader', error);
      return false;
    }
  }

  /**
   * 获取配置实例
   * @param {string} name - 配置名称
   * @returns {Object|null}
   */
  get(name) {
    return this.configs.get(name) || null;
  }

  /**
   * 获取所有配置
   * @returns {Map}
   */
  getAll() {
    return this.configs;
  }

  /**
   * 获取配置列表（用于API）
   * @returns {Array}
   */
  getList() {
    const list = [];
    
    for (const config of this.configs.values()) {
      if (config && typeof config.getStructure === 'function') {
        list.push(config.getStructure());
      }
    }
    
    return list;
  }

  /**
   * 重新加载指定配置
   * @param {string} name - 配置名称
   * @returns {Promise<boolean>}
   */
  async reload(name) {
    try {
      // 查找配置文件
      const configDirs = await paths.getCoreSubDirs('commonconfig');
      let configPath = null;
      
      for (const configDir of configDirs) {
        const filePath = path.join(configDir, `${name}.js`);
        if (fsSync.existsSync(filePath)) {
          configPath = filePath;
          break;
        }
      }
      
      if (!configPath) {
        throw new Error(`配置文件不存在: ${name}`);
      }

      await this._loadConfig(configPath);
      
      BotUtil.makeLog('info', `配置已重载: ${name}`, 'ConfigLoader');
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `配置重载失败: ${name}`, 'ConfigLoader', error);
      return false;
    }
  }

  /**
   * 清除所有缓存
   */
  clearAllCache() {
    for (const config of this.configs.values()) {
      if (typeof config.clearCache === 'function') {
        config.clearCache();
      }
    }
    BotUtil.makeLog('debug', '已清除所有配置缓存', 'ConfigLoader');
  }

  /**
   * 启用文件监视（热加载）
   * @param {boolean} enable - 是否启用
   */
  async watch(enable = true) {
    if (!enable) {
      if (this.watcher) {
        await this.watcher.close()
        this.watcher = null
      }
      return
    }

    if (this.watcher) return

    try {
      const { HotReloadBase } = await import('#utils/hot-reload-base.js')
      const hotReload = new HotReloadBase({ loggerName: 'ConfigLoader' })
      
      const configDirs = await paths.getCoreSubDirs('commonconfig')
      if (configDirs.length === 0) {
        BotUtil.makeLog('debug', '未找到 commonconfig 目录，跳过文件监视', 'ConfigLoader')
        return
      }

      await hotReload.watch(true, {
        dirs: configDirs,
        onAdd: async (filePath) => {
          const key = hotReload.getFileKey(filePath)
          BotUtil.makeLog('info', `检测到新配置文件: ${key}`, 'ConfigLoader')
          await this._loadConfig(filePath)
        },
        onChange: async (filePath) => {
          const key = hotReload.getFileKey(filePath)
          BotUtil.makeLog('info', `检测到配置文件变更: ${key}`, 'ConfigLoader')
          await this.reload(key)
        },
        onUnlink: async (filePath) => {
          const key = hotReload.getFileKey(filePath)
          BotUtil.makeLog('info', `检测到配置文件删除: ${key}`, 'ConfigLoader')
          this.configs.delete(key)
        }
      })

      this.watcher = hotReload.watcher
    } catch (error) {
      BotUtil.makeLog('error', '启动配置文件监视失败', 'ConfigLoader', error)
    }
  }
}

// 导出单例
export default new ConfigLoader();