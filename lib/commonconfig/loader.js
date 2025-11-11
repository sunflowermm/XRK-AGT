import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import BotUtil from '../common/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    
    /** 配置目录路径 */
    this.configDir = path.join(process.cwd(), 'config/commonconfig');
  }

  /**
   * 加载所有配置
   * @returns {Promise<Map>}
   */
  async load() {
    try {
      const startTime = Date.now();
      BotUtil.makeLog('mark', '开始加载配置管理器', 'ConfigLoader');

      // 确保配置目录存在
      if (!fsSync.existsSync(this.configDir)) {
        await fs.mkdir(this.configDir, { recursive: true });
        BotUtil.makeLog('info', '配置目录已创建', 'ConfigLoader');
      }

      // 获取所有配置文件
      const files = await this._getConfigFiles(this.configDir);

      // 加载每个配置
      for (const file of files) {
        await this._loadConfig(file);
      }

      this.loaded = true;
      const loadTime = Date.now() - startTime;
      
      BotUtil.makeLog('info', 
        `配置管理器加载完成，共${this.configs.size}个配置，耗时${loadTime}ms`, 
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
    const files = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.js')) {
          // 跳过以 . 或 _ 开头的文件
          if (!entry.name.startsWith('.') && !entry.name.startsWith('_')) {
            files.push(path.join(dir, entry.name));
          }
        }
      }
    } catch (error) {
      BotUtil.makeLog('error', `读取配置目录失败: ${dir}`, 'ConfigLoader', error);
    }
    
    return files;
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
      BotUtil.makeLog('error', `加载配置失败: ${filePath}`, 'ConfigLoader', error);
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
      const configPath = path.join(this.configDir, `${name}.js`);
      
      if (!fsSync.existsSync(configPath)) {
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
}

// 导出单例
export default new ConfigLoader();