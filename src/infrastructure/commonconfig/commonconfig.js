import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import yaml from 'yaml';
import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';

/**
 * 配置文件管理基类
 * 
 * 提供统一的配置文件读写接口，支持YAML和JSON格式。
 * 支持动态路径、缓存、备份、验证等功能。
 * 
 * @abstract
 * @class ConfigBase
 * @example
 * // 继承ConfigBase创建自定义配置类
 * class MyConfig extends ConfigBase {
 *   constructor() {
 *     super({
 *       name: 'myconfig',
 *       displayName: '我的配置',
 *       description: '自定义配置示例',
 *       filePath: 'config/myconfig.yaml',
 *       fileType: 'yaml',
 *       schema: { /* 配置结构定义 *\/ }
 *     });
 *   }
 * }
 * 
 * // 使用
 * const config = new MyConfig();
 * const data = await config.read();
 * await config.write({ key: 'value' });
 */
export default class ConfigBase {
  /**
   * 构造函数
   * 
   * @param {Object} metadata - 配置元数据
   * @param {string} metadata.name - 配置名称（用于标识，必填）
   * @param {string} metadata.displayName - 显示名称（用于UI显示）
   * @param {string} metadata.description - 配置描述
   * @param {string|Function} metadata.filePath - 配置文件相对路径或动态路径函数
   *   - 字符串：相对于项目根目录的路径，如 'config/myconfig.yaml'
   *   - 函数：动态计算路径，接收cfg对象，返回路径字符串
   * @param {string} metadata.fileType - 文件类型：'yaml' 或 'json'（默认'yaml'）
   * @param {Object} metadata.schema - 配置结构定义（用于验证）
   */
  constructor(metadata = {}) {
    this.name = metadata.name || 'config';
    this.displayName = metadata.displayName || this.name;
    this.description = metadata.description || '';
    this.filePath = metadata.filePath || '';
    this.fileType = metadata.fileType || 'yaml';
    this.schema = metadata.schema || {};

    // 严格校验：在构造阶段即校验 schema 的默认值与类型一致性，避免运行期回退逻辑
    this._assertSchemaStrict(this.schema);
    
    // 如果 filePath 是函数，则动态计算路径
    if (typeof this.filePath === 'function') {
      this._getFilePath = this.filePath;
    } else if (this.filePath) {
      // 完整文件路径
      this.fullPath = path.join(paths.root, this.filePath);
    } else {
      this.fullPath = undefined;
    }
    
    // 缓存配置内容
    this._cache = null;
    this._cacheTime = 0;
    this._cacheTTL = 5000; // 5秒缓存
  }
  
  /**
   * 严格校验 schema：
   * - 确保每个字段的 default 类型与 type 一致（若提供）
   * - enum 必须包含 default（若提供）
   * - array 的 itemType 与 default 数组元素类型一致（若提供）
   * - object 的 fields 递归校验
   */
  _assertSchemaStrict(schema) {
    if (!schema || !schema.fields) return;
    const check = (fields) => {
      for (const [key, fs] of Object.entries(fields)) {
        // 校验 default 与 type
        if (Object.prototype.hasOwnProperty.call(fs, 'default')) {
          const def = fs.default;
          const t = fs.type;
          if (t === 'number' && !(typeof def === 'number')) {
            throw new Error(`配置(${this.name}).schema 字段 ${key} 的 default 必须为 number`);
          }
          if (t === 'string' && !(typeof def === 'string')) {
            throw new Error(`配置(${this.name}).schema 字段 ${key} 的 default 必须为 string`);
          }
          if (t === 'boolean' && !(typeof def === 'boolean')) {
            throw new Error(`配置(${this.name}).schema 字段 ${key} 的 default 必须为 boolean`);
          }
          if (t === 'array' && !Array.isArray(def)) {
            throw new Error(`配置(${this.name}).schema 字段 ${key} 的 default 必须为 array`);
          }
          if (t === 'object' && (def !== undefined) && (def !== null) && (typeof def !== 'object' || Array.isArray(def))) {
            throw new Error(`配置(${this.name}).schema 字段 ${key} 的 default 必须为 object`);
          }
        }
        // 校验 enum 与 default
        if (fs.enum && Object.prototype.hasOwnProperty.call(fs, 'default')) {
          const def = fs.default;
          // 对于数组类型，要求每个默认值都在 enum 中
          if (fs.type === 'array' && Array.isArray(def)) {
            for (const v of def) {
              if (!fs.enum.includes(v)) {
                throw new Error(`配置(${this.name}).schema 字段 ${key} 的 default 中的值 "${v}" 必须属于 enum: ${fs.enum.join(', ')}`);
              }
            }
          } else if (!fs.enum.includes(def)) {
            throw new Error(`配置(${this.name}).schema 字段 ${key} 的 default 必须属于 enum: ${fs.enum.join(', ')}`);
          }
        }
        // 校验 array 元素类型
        if (fs.type === 'array' && fs.itemType && Array.isArray(fs.default)) {
          for (const [i, v] of fs.default.entries()) {
            if (fs.itemType === 'number' && typeof v !== 'number') throw new Error(`配置(${this.name}).schema 字段 ${key}[${i}] 必须为 number`);
            if (fs.itemType === 'string' && typeof v !== 'string') throw new Error(`配置(${this.name}).schema 字段 ${key}[${i}] 必须为 string`);
            if (fs.itemType === 'boolean' && typeof v !== 'boolean') throw new Error(`配置(${this.name}).schema 字段 ${key}[${i}] 必须为 boolean`);
            if (fs.itemType === 'object' && (typeof v !== 'object' || Array.isArray(v))) throw new Error(`配置(${this.name}).schema 字段 ${key}[${i}] 必须为 object`);
          }
        }
        // 递归校验 object 子字段
        if (fs.type === 'object' && fs.fields) {
          check(fs.fields);
        }
        // 递归校验 array 中的对象 itemSchema
        if (fs.type === 'array' && fs.itemType === 'object' && fs.itemSchema?.fields) {
          check(fs.itemSchema.fields);
        }
      }
    };
    check(schema.fields);
  }
  
  /**
   * 获取配置文件的完整路径（支持动态路径）
   * @returns {string}
   */
  _resolveFilePath() {
    if (this._getFilePath) {
      const dynamicPath = this._getFilePath(global.cfg);
      if (!dynamicPath) {
        throw new Error('动态路径函数未返回有效路径');
      }
      return path.join(paths.root, dynamicPath);
    }
    // 如果没有 fullPath，则认为未正确配置
    if (!this.fullPath) {
      throw new Error(`未指定配置文件路径: ${this.name}`);
    }
    return this.fullPath;
  }

  /**
   * 获取配置文件的完整路径
   * @returns {string}
   */
  getFilePath() {
    return this._resolveFilePath();
  }

  /**
   * 检查文件是否存在
   * @returns {Promise<boolean>}
   */
  async exists() {
    const filePath = this._resolveFilePath();
    try {
      await fs.access(filePath);
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
    // 检查缓存
    if (useCache && this._cache && (Date.now() - this._cacheTime < this._cacheTTL)) {
      return this._cache;
    }

    // 检查文件是否存在
    if (!await this.exists()) {
      throw new Error(`配置文件不存在: ${this.filePath || this._resolveFilePath()}`);
    }
    
    try {

      // 读取文件内容
      const filePath = this._resolveFilePath();
      const content = await fs.readFile(filePath, 'utf8');

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
      const filePath = this._resolveFilePath();
      const dir = path.dirname(filePath);
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
      await fs.writeFile(filePath, content, 'utf8');

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
      const filePath = this._resolveFilePath();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const backupPath = `${filePath}.backup.${timestamp}`;
      
      await fs.copyFile(filePath, backupPath);
      
      BotUtil.makeLog('debug', `配置已备份 [${this.name}]: ${backupPath}`, 'ConfigBase');
      return backupPath;
    } catch (error) {
      BotUtil.makeLog('error', `备份配置失败 [${this.name}]: ${error.message}`, 'ConfigBase');
      throw error;
    }
  }

  /**
   * 获取指定路径的配置值
   * 
   * 支持点号路径和数组索引，如 'server.host' 或 'server.proxy.domains[0].domain'
   * 
   * @param {string} keyPath - 键路径
   *   - 点号分隔：'server.host'
   *   - 数组索引：'domains[0]' 或 'server.proxy.domains[0].domain'
   * @returns {Promise<any>} 配置值，如果路径不存在返回undefined
   * @example
   * const host = await config.get('server.host');
   * const firstDomain = await config.get('server.proxy.domains[0].domain');
   */
  async get(keyPath) {
    const data = await this.read();
    return this._getValueByPath(data, keyPath);
  }

  /**
   * 设置指定路径的配置值
   * 
   * 如果路径不存在，会自动创建中间对象。
   * 
   * @param {string} keyPath - 键路径（支持点号和数组索引）
   * @param {any} value - 新值
   * @param {Object} options - 写入选项
   *   - backup: 是否备份（默认true）
   *   - validate: 是否验证（默认true）
   * @returns {Promise<boolean>} 是否成功
   * @example
   * await config.set('server.host', '0.0.0.0');
   * await config.set('server.proxy.domains[0].domain', 'example.com');
   */
  async set(keyPath, value, options = {}) {
    const data = await this.read();
    this._setValueByPath(data, keyPath, value);
    return await this.write(data, options);
  }

  /**
   * 删除指定路径的配置
   * 
   * 删除指定路径的配置项，如果路径不存在则忽略。
   * 
   * @param {string} keyPath - 键路径（支持点号和数组索引）
   * @param {Object} options - 写入选项
   * @returns {Promise<boolean>} 是否成功
   * @example
   * await config.delete('server.proxy.domains[0]');
   */
  async delete(keyPath, options = {}) {
    const data = await this.read();
    this._deleteValueByPath(data, keyPath);
    return await this.write(data, options);
  }

  /**
   * 追加到数组配置
   * 
   * 将值追加到指定路径的数组末尾。
   * 
   * @param {string} keyPath - 数组键路径（必须是数组类型）
   * @param {any} value - 要追加的值
   * @param {Object} options - 写入选项
   * @returns {Promise<boolean>} 是否成功
   * @throws {Error} 如果路径不是数组类型
   * @example
   * await config.append('server.auth.whitelist', '/new-path');
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
   * 从数组配置中移除元素
   * 
   * 支持通过索引或查找函数移除数组元素。
   * 
   * @param {string} keyPath - 数组键路径（必须是数组类型）
   * @param {number|Function} indexOrPredicate - 移除方式
   *   - 数字：按索引移除，如 0 移除第一个元素
   *   - 函数：查找函数，如 (item) => item.id === 'target'
   * @param {Object} options - 写入选项
   * @returns {Promise<boolean>} 是否成功
   * @throws {Error} 如果路径不是数组类型
   * @example
   * // 按索引移除
   * await config.remove('server.auth.whitelist', 0);
   * 
   * // 按条件移除
   * await config.remove('domains', (item) => item.domain === 'old.com');
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
   * 
   * 将新配置数据合并到现有配置中，支持浅合并和深合并。
   * 
   * @param {Object} newData - 新配置数据
   * @param {Object} options - 合并选项
   *   - deep: 是否深度合并（默认true）
   *   - backup: 是否备份（默认true）
   *   - validate: 是否验证（默认true）
   * @returns {Promise<boolean>} 是否成功
   * @example
   * await config.merge({
   *   server: {
   *     host: '0.0.0.0',
   *     port: 8086
   *   }
   * });
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
   * 
   * 根据schema定义验证配置数据的类型、范围、长度等。
   * 
   * @param {Object} data - 要验证的数据
   * @returns {Promise<Object>} 验证结果
   *   - valid: 是否有效
   *   - errors: 错误信息数组
   * @example
   * const result = await config.validate({ host: '0.0.0.0', port: 8086 });
   * if (!result.valid) {
   *   console.error('验证失败:', result.errors);
   * }
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

      if (this.schema.fields) {
        for (const [field, fieldSchema] of Object.entries(this.schema.fields)) {
          if (!(field in data)) continue;

          const fieldPath = field;
          let value = data[field];
          value = this._normalizeValueBySchema(value, fieldSchema);
          data[field] = value;

          if (value === null || value === undefined) {
            if (fieldSchema.nullable === true) continue;
            errors.push(`字段 ${fieldPath} 不允许为空`);
            continue;
          }

          if (fieldSchema.type && !this._checkType(value, fieldSchema.type)) {
            errors.push(`字段 ${fieldPath} 类型错误，期望 ${fieldSchema.type}`);
            continue;
          }

          this._runFieldValidators(value, fieldSchema, fieldPath, errors);

          if (fieldSchema.type === 'array') {
            this._validateArrayField(value, fieldSchema, fieldPath, errors);
          }

          if ((fieldSchema.type === 'object' || fieldSchema.type === 'map') && fieldSchema.fields) {
            this._validateObjectField(value, fieldSchema, fieldPath, errors);
          }
        }
      }

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

  // ========== 生成默认对象与扁平化工具 ==========

  buildDefaultFromSchema(schema = this.schema) {
    const result = {};
    if (!schema || !schema.fields) return result;
    for (const [key, fs] of Object.entries(schema.fields)) {
      if (fs.type === 'object') {
        result[key] = this.buildDefaultFromSchema({ fields: fs.fields || {} });
      } else if (fs.type === 'array') {
        result[key] = Array.isArray(fs.default) ? [...fs.default] : [];
      } else if (Object.prototype.hasOwnProperty.call(fs, 'default')) {
        result[key] = fs.default;
      }
    }
    return result;
  }

  getDefaultFromSchema() { return this.buildDefaultFromSchema(this.schema); }

  getFlatSchema(prefix = '', schema = this.schema) {
    const list = [];
    if (!schema || !schema.fields) return list;
    for (const [key, fs] of Object.entries(schema.fields)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (fs.type === 'object') {
        list.push(...this.getFlatSchema(path, { fields: fs.fields || {} }));
      } else if (fs.type === 'array' && fs.itemType === 'object' && fs.itemSchema?.fields) {
        // 仅描述数组元素的结构，不枚举索引
        list.push({ path, type: 'array<object>', component: fs.component, meta: { ...fs } });
        list.push(...this.getFlatSchema(`${path}[]`, { fields: fs.itemSchema.fields }));
      } else {
        list.push({ path, type: fs.type, component: fs.component, meta: { ...fs } });
      }
    }
    return list;
  }

  flattenData(obj, prefix = '') {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(out, this.flattenData(v, path));
      } else {
        out[path] = v;
      }
    }
    return out;
  }

  expandFlatData(flat) {
    const data = {};
    for (const [path, value] of Object.entries(flat || {})) {
      this._setValueByPath(data, path, value);
    }
    return data;
  }

  // ==================== 私有辅助方法 ====================

  _runFieldValidators(value, schema, path, errors) {
    const expectedType = schema.type;
    if (expectedType === 'number') {
      if (schema.min !== undefined && value < schema.min) {
        errors.push(`字段 ${path} 不能小于 ${schema.min}`);
      }
      if (schema.max !== undefined && value > schema.max) {
        errors.push(`字段 ${path} 不能大于 ${schema.max}`);
      }
    }

    if (expectedType === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`字段 ${path} 长度不能小于 ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`字段 ${path} 长度不能大于 ${schema.maxLength}`);
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push(`字段 ${path} 格式不正确`);
      }
    }

    // 对于数组类型，检查每个元素是否在 enum 中
    if (schema.enum) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (!schema.enum.includes(item)) {
            errors.push(`字段 ${path} 中的值 "${item}" 必须是: ${schema.enum.join(', ')}`);
          }
        }
      } else if (!schema.enum.includes(value)) {
        errors.push(`字段 ${path} 值必须是: ${schema.enum.join(', ')}`);
      }
    }
  }

  _validateArrayField(value, schema, path, errors) {
    if (!Array.isArray(value)) {
      errors.push(`字段 ${path} 必须为数组`);
      return;
    }

    if (!schema.itemType) return;

    const itemSchema = schema.itemSchema || (schema.fields ? { fields: schema.fields } : {});

    value.forEach((item, idx) => {
      const itemPath = `${path}[${idx}]`;
      const expectedType = schema.itemType;

      const normalizedItem = this._normalizeValueBySchema(item, { ...itemSchema, type: expectedType });
      value[idx] = normalizedItem;

      if (!this._checkType(normalizedItem, expectedType)) {
        errors.push(`字段 ${itemPath} 类型错误，应为 ${expectedType}`);
        return;
      }

      this._runFieldValidators(normalizedItem, { ...itemSchema, type: expectedType }, itemPath, errors);

      if ((expectedType === 'object' || expectedType === 'map') && (itemSchema.fields || schema.fields)) {
        const nestedSchema = { ...itemSchema, type: expectedType };
        if (!nestedSchema.fields && schema.fields) nestedSchema.fields = schema.fields;
        this._validateObjectField(normalizedItem, nestedSchema, itemPath, errors);
      }
    });
  }

  _validateObjectField(value, schema, path, errors) {
    if (!this._isObject(value)) {
      errors.push(`字段 ${path} 必须为对象`);
      return;
    }

    const fields = schema.fields || {};
    for (const [key, childSchema] of Object.entries(fields)) {
      const childPath = `${path}.${key}`;
      let childValue = value[key];

      if (childValue === undefined || childValue === null) {
        if (childSchema?.nullable === true || childValue === undefined) continue;
        errors.push(`字段 ${childPath} 不允许为空`);
        continue;
      }

      childValue = this._normalizeValueBySchema(childValue, childSchema);
      value[key] = childValue;

      if (childSchema.type && !this._checkType(childValue, childSchema.type)) {
        errors.push(`字段 ${childPath} 类型错误，期望 ${childSchema.type}`);
        continue;
      }

      this._runFieldValidators(childValue, childSchema, childPath, errors);

      if (childSchema.type === 'array') {
        this._validateArrayField(childValue, childSchema, childPath, errors);
      }

      if ((childSchema.type === 'object' || childSchema.type === 'map') && childSchema.fields) {
        this._validateObjectField(childValue, childSchema, childPath, errors);
      }
    }
  }

  _normalizeValueBySchema(value, schema = {}) {
    if (value === undefined) return value;
    const expectedType = schema.type;

    if (expectedType === 'string') {
      if (typeof value !== 'string' && value !== null && value !== undefined) {
        return String(value);
      }
      return value;
    }

    if (expectedType === 'number') {
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && value !== '') {
        const num = Number(value);
        return isNaN(num) ? value : num;
      }
      return value;
    }

    if (expectedType === 'boolean') {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const normalized = value.toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
      }
      if (typeof value === 'number') return value !== 0;
      return !!value;
    }

    if (expectedType === 'array') {
      let arr = Array.isArray(value) ? [...value] : (value === undefined || value === null ? [] : [value]);
      if (schema.itemType) {
        const itemSchema = schema.itemSchema || (schema.fields ? { fields: schema.fields } : {});
        arr = arr.map(item => this._normalizeValueBySchema(item, { ...itemSchema, type: schema.itemType }));
      }
      return arr;
    }

    if ((expectedType === 'object' || expectedType === 'map') && this._isObject(value)) {
      const clone = { ...value };
      const fields = schema.fields || {};
      for (const [key, childSchema] of Object.entries(fields)) {
        if (clone[key] !== undefined) {
          clone[key] = this._normalizeValueBySchema(clone[key], childSchema);
        }
      }
      return clone;
    }

    return value;
  }

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
      case 'map':
        return this._isObject(value);
      default:
        return true;
    }
  }
}