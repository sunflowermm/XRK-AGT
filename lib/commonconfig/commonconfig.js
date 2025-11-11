import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import yaml from 'yaml';
import BotUtil from '../common/util.js';

/**
 * 配置文件管理基类
 * 提供统一的配置文件读写接口
 */
export default class ConfigBase {
  /**
   * @param {Object} metadata - 配置元数据
   * @param {string} metadata.name - 配置名称（用于标识）
   * @param {string} metadata.displayName - 显示名称
   * @param {string} metadata.description - 配置描述
   * @param {string} metadata.filePath - 配置文件相对路径（相对于项目根目录）
   * @param {string} metadata.fileType - 文件类型：'yaml' 或 'json'
   * @param {Object} metadata.schema - 配置结构定义
   */
  constructor(metadata = {}) {
    this.name = metadata.name || 'config';
    this.displayName = metadata.displayName || this.name;
    this.description = metadata.description || '';
    this.filePath = metadata.filePath || '';
    this.fileType = metadata.fileType || 'yaml';
    this.schema = metadata.schema || {};
    
    // 完整文件路径
    this.fullPath = path.join(process.cwd(), this.filePath);
    
    // 缓存配置内容
    this._cache = null;
    this._cacheTime = 0;
    this._cacheTTL = 5000; // 5秒缓存
  }

  /**
   * 获取配置文件的完整路径
   * @returns {string}
   */
  getFilePath() {
    return this.fullPath;
  }

  /**
   * 检查文件是否存在
   * @returns {Promise<boolean>}
   */
  async exists() {
    try {
      await fs.access(this.fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 读取配置文件
   * @param {boolean} useCache - 是否使用缓存
   * @returns {Promise<Object>}
   */
  async read(useCache = true) {
    try {
      // 检查缓存
      if (useCache && this._cache && (Date.now() - this._cacheTime < this._cacheTTL)) {
        return this._cache;
      }

      // 检查文件是否存在
      if (!await this.exists()) {
        throw new Error(`配置文件不存在: ${this.filePath}`);
      }

      // 读取文件内容
      const content = await fs.readFile(this.fullPath, 'utf8');

      // 解析内容
      let data;
      if (this.fileType === 'yaml') {
        data = yaml.parse(content);
      } else if (this.fileType === 'json') {
        data = JSON.parse(content);
      } else {
        throw new Error(`不支持的文件类型: ${this.fileType}`);
      }

      // 更新缓存
      this._cache = data;
      this._cacheTime = Date.now();

      return data;
    } catch (error) {
      BotUtil.makeLog('error', `读取配置失败 [${this.name}]: ${error.message}`, 'ConfigBase');
      throw error;
    }
  }

  /**
   * 写入配置文件
   * @param {Object} data - 配置数据
   * @param {Object} options - 写入选项
   * @param {boolean} options.backup - 是否备份原文件
   * @param {boolean} options.validate - 是否验证数据
   * @returns {Promise<boolean>}
   */
  async write(data, options = {}) {
    const { backup = true, validate = true } = options;

    try {
      // 验证数据
      if (validate) {
        const validation = await this.validate(data);
        if (!validation.valid) {
          throw new Error(`配置验证失败: ${validation.errors.join(', ')}`);
        }
      }

      // 备份原文件
      if (backup && await this.exists()) {
        await this.backup();
      }

      // 确保目录存在
      const dir = path.dirname(this.fullPath);
      if (!fsSync.existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }

      // 序列化数据
      let content;
      if (this.fileType === 'yaml') {
        content = yaml.stringify(data, {
          indent: 2,
          lineWidth: 0,
          minContentWidth: 0
        });
      } else if (this.fileType === 'json') {
        content = JSON.stringify(data, null, 2);
      } else {
        throw new Error(`不支持的文件类型: ${this.fileType}`);
      }

      // 写入文件
      await fs.writeFile(this.fullPath, content, 'utf8');

      // 清除缓存
      this._cache = data;
      this._cacheTime = Date.now();

      BotUtil.makeLog('info', `配置已保存 [${this.name}]`, 'ConfigBase');
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `写入配置失败 [${this.name}]: ${error.message}`, 'ConfigBase');
      throw error;
    }
  }

  /**
   * 备份配置文件
   * @returns {Promise<string>} 备份文件路径
   */
  async backup() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const backupPath = `${this.fullPath}.backup.${timestamp}`;
      
      await fs.copyFile(this.fullPath, backupPath);
      
      BotUtil.makeLog('debug', `配置已备份 [${this.name}]: ${backupPath}`, 'ConfigBase');
      return backupPath;
    } catch (error) {
      BotUtil.makeLog('error', `备份配置失败 [${this.name}]: ${error.message}`, 'ConfigBase');
      throw error;
    }
  }

  /**
   * 获取指定路径的配置值
   * @param {string} keyPath - 键路径，如 'server.host' 或 'server.proxy.domains[0].domain'
   * @returns {Promise<any>}
   */
  async get(keyPath) {
    const data = await this.read();
    return this._getValueByPath(data, keyPath);
  }

  /**
   * 设置指定路径的配置值
   * @param {string} keyPath - 键路径
   * @param {any} value - 新值
   * @param {Object} options - 写入选项
   * @returns {Promise<boolean>}
   */
  async set(keyPath, value, options = {}) {
    const data = await this.read();
    this._setValueByPath(data, keyPath, value);
    return await this.write(data, options);
  }

  /**
   * 删除指定路径的配置
   * @param {string} keyPath - 键路径
   * @param {Object} options - 写入选项
   * @returns {Promise<boolean>}
   */
  async delete(keyPath, options = {}) {
    const data = await this.read();
    this._deleteValueByPath(data, keyPath);
    return await this.write(data, options);
  }

  /**
   * 追加到数组配置
   * @param {string} keyPath - 数组键路径
   * @param {any} value - 要追加的值
   * @param {Object} options - 写入选项
   * @returns {Promise<boolean>}
   */
  async append(keyPath, value, options = {}) {
    const data = await this.read();
    const current = this._getValueByPath(data, keyPath);
    
    if (!Array.isArray(current)) {
      throw new Error(`路径 ${keyPath} 不是数组`);
    }
    
    current.push(value);
    return await this.write(data, options);
  }

  /**
   * 从数组配置中移除
   * @param {string} keyPath - 数组键路径
   * @param {number|Function} indexOrPredicate - 索引或查找函数
   * @param {Object} options - 写入选项
   * @returns {Promise<boolean>}
   */
  async remove(keyPath, indexOrPredicate, options = {}) {
    const data = await this.read();
    const current = this._getValueByPath(data, keyPath);
    
    if (!Array.isArray(current)) {
      throw new Error(`路径 ${keyPath} 不是数组`);
    }
    
    if (typeof indexOrPredicate === 'number') {
      current.splice(indexOrPredicate, 1);
    } else if (typeof indexOrPredicate === 'function') {
      const index = current.findIndex(indexOrPredicate);
      if (index !== -1) {
        current.splice(index, 1);
      }
    }
    
    return await this.write(data, options);
  }

  /**
   * 合并配置
   * @param {Object} newData - 新配置数据
   * @param {Object} options - 合并选项
   * @param {boolean} options.deep - 是否深度合并
   * @returns {Promise<boolean>}
   */
  async merge(newData, options = {}) {
    const { deep = true } = options;
    const currentData = await this.read();
    
    const mergedData = deep 
      ? this._deepMerge(currentData, newData)
      : { ...currentData, ...newData };
    
    return await this.write(mergedData, options);
  }

  /**
   * 验证配置数据
   * @param {Object} data - 要验证的数据
   * @returns {Promise<Object>} { valid: boolean, errors: string[] }
   */
  async validate(data) {
    const errors = [];

    try {
      // 基础验证：检查必需字段
      if (this.schema.required) {
        for (const field of this.schema.required) {
          if (!(field in data)) {
            errors.push(`缺少必需字段: ${field}`);
          }
        }
      }

      // 类型验证
      if (this.schema.fields) {
        for (const [field, fieldSchema] of Object.entries(this.schema.fields)) {
          if (field in data) {
            const value = data[field];
            const expectedType = fieldSchema.type;

            if (expectedType && !this._checkType(value, expectedType)) {
              errors.push(`字段 ${field} 类型错误，期望 ${expectedType}`);
            }

            // 数值范围验证
            if (expectedType === 'number') {
              if (fieldSchema.min !== undefined && value < fieldSchema.min) {
                errors.push(`字段 ${field} 不能小于 ${fieldSchema.min}`);
              }
              if (fieldSchema.max !== undefined && value > fieldSchema.max) {
                errors.push(`字段 ${field} 不能大于 ${fieldSchema.max}`);
              }
            }

            // 字符串长度验证
            if (expectedType === 'string') {
              if (fieldSchema.minLength !== undefined && value.length < fieldSchema.minLength) {
                errors.push(`字段 ${field} 长度不能小于 ${fieldSchema.minLength}`);
              }
              if (fieldSchema.maxLength !== undefined && value.length > fieldSchema.maxLength) {
                errors.push(`字段 ${field} 长度不能大于 ${fieldSchema.maxLength}`);
              }
              if (fieldSchema.pattern && !new RegExp(fieldSchema.pattern).test(value)) {
                errors.push(`字段 ${field} 格式不正确`);
              }
            }

            // 枚举值验证
            if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
              errors.push(`字段 ${field} 值必须是: ${fieldSchema.enum.join(', ')}`);
            }
          }
        }
      }

      // 自定义验证器
      if (typeof this.customValidate === 'function') {
        const customErrors = await this.customValidate(data);
        if (Array.isArray(customErrors)) {
          errors.push(...customErrors);
        }
      }

    } catch (error) {
      errors.push(`验证过程出错: ${error.message}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 获取配置结构（用于前端渲染表单）
   * @returns {Object}
   */
  getStructure() {
    return {
      name: this.name,
      displayName: this.displayName,
      description: this.description,
      filePath: this.filePath,
      fileType: this.fileType,
      schema: this.schema
    };
  }

  /**
   * 重置为默认配置
   * @param {Object} options - 写入选项
   * @returns {Promise<boolean>}
   */
  async reset(options = {}) {
    if (!this.defaultConfig) {
      throw new Error('未定义默认配置');
    }
    return await this.write(this.defaultConfig, options);
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this._cache = null;
    this._cacheTime = 0;
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 通过路径获取值
   * @private
   */
  _getValueByPath(obj, keyPath) {
    if (!keyPath) return obj;
    
    const keys = keyPath.split('.');
    let current = obj;

    for (const key of keys) {
      // 处理数组索引，如 domains[0]
      const arrayMatch = key.match(/^(.+?)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, arrayKey, index] = arrayMatch;
        current = current?.[arrayKey]?.[parseInt(index)];
      } else {
        current = current?.[key];
      }

      if (current === undefined) {
        return undefined;
      }
    }

    return current;
  }

  /**
   * 通过路径设置值
   * @private
   */
  _setValueByPath(obj, keyPath, value) {
    const keys = keyPath.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      
      // 处理数组索引
      const arrayMatch = key.match(/^(.+?)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, arrayKey, index] = arrayMatch;
        if (!current[arrayKey]) current[arrayKey] = [];
        if (!current[arrayKey][index]) current[arrayKey][index] = {};
        current = current[arrayKey][index];
      } else {
        if (!current[key]) current[key] = {};
        current = current[key];
      }
    }

    const lastKey = keys[keys.length - 1];
    const arrayMatch = lastKey.match(/^(.+?)\[(\d+)\]$/);
    
    if (arrayMatch) {
      const [, arrayKey, index] = arrayMatch;
      if (!current[arrayKey]) current[arrayKey] = [];
      current[arrayKey][parseInt(index)] = value;
    } else {
      current[lastKey] = value;
    }
  }

  /**
   * 通过路径删除值
   * @private
   */
  _deleteValueByPath(obj, keyPath) {
    const keys = keyPath.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      const arrayMatch = key.match(/^(.+?)\[(\d+)\]$/);
      
      if (arrayMatch) {
        const [, arrayKey, index] = arrayMatch;
        current = current[arrayKey]?.[parseInt(index)];
      } else {
        current = current[key];
      }

      if (!current) return;
    }

    const lastKey = keys[keys.length - 1];
    const arrayMatch = lastKey.match(/^(.+?)\[(\d+)\]$/);
    
    if (arrayMatch) {
      const [, arrayKey, index] = arrayMatch;
      current[arrayKey]?.splice(parseInt(index), 1);
    } else {
      delete current[lastKey];
    }
  }

  /**
   * 深度合并对象
   * @private
   */
  _deepMerge(target, source) {
    const output = { ...target };

    if (this._isObject(target) && this._isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this._isObject(source[key])) {
          if (!(key in target)) {
            output[key] = source[key];
          } else {
            output[key] = this._deepMerge(target[key], source[key]);
          }
        } else {
          output[key] = source[key];
        }
      });
    }

    return output;
  }

  /**
   * 检查是否为对象
   * @private
   */
  _isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  /**
   * 类型检查
   * @private
   */
  _checkType(value, expectedType) {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return this._isObject(value);
      default:
        return true;
    }
  }
}