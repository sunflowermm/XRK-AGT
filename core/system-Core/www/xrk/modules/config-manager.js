/**
 * 配置管理模块
 * 提供配置的读取、编辑、保存等功能
 *
 * 这是一个简化的基础版本，包含核心的配置管理逻辑
 * 完整版本需要从 app.js 中提取更多方法
 */

import { cloneValue, isSameValue } from './utils.js';

/**
 * 配置管理器类
 */
export class ConfigManager {
  constructor(serverUrl, getHeaders) {
    this.serverUrl = serverUrl;
    this.getHeaders = getHeaders;
    this.currentConfig = null;
    this.configState = null;
    this.schemaCache = {};
    this.isDirty = false;
  }

  /**
   * 获取配置列表
   * @returns {Promise<Array>} 配置列表
   */
  async getConfigList() {
    const res = await fetch(`${this.serverUrl}/api/config/list`, {
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error('获取配置列表失败');
    const data = await res.json();
    return data.configs || [];
  }

  /**
   * 获取配置结构（Schema）
   * @param {string} name - 配置名称
   * @returns {Promise<Object>} 配置结构
   */
  async getConfigStructure(name) {
    if (this.schemaCache[name]) {
      return this.schemaCache[name];
    }

    const res = await fetch(`${this.serverUrl}/api/config/${name}/structure`, {
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error(`获取配置结构失败: ${name}`);
    const data = await res.json();

    this.schemaCache[name] = data.structure;
    return data.structure;
  }

  /**
   * 读取配置数据
   * @param {string} name - 配置名称
   * @returns {Promise<Object>} 配置数据
   */
  async readConfig(name) {
    const res = await fetch(`${this.serverUrl}/api/config/${name}`, {
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error(`读取配置失败: ${name}`);
    const data = await res.json();
    return data.config || {};
  }

  /**
   * 保存配置数据
   * @param {string} name - 配置名称
   * @param {Object} config - 配置数据
   * @returns {Promise<Object>} 保存结果
   */
  async saveConfig(name, config) {
    const res = await fetch(`${this.serverUrl}/api/config/${name}`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ config })
    });
    if (!res.ok) throw new Error(`保存配置失败: ${name}`);
    return await res.json();
  }

  /**
   * 扁平化对象
   * @param {Object} obj - 对象
   * @param {string} prefix - 前缀
   * @param {Object} out - 输出对象
   * @returns {Object} 扁平化后的对象
   */
  flattenObject(obj, prefix = '', out = {}) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      // 允许保存空对象：{} 也应当在 flat 中占位，才能覆盖/清空后端旧值
      if (prefix && Object.keys(obj).length === 0) {
        out[prefix] = {};
        return out;
      }
      Object.entries(obj).forEach(([key, val]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          this.flattenObject(val, path, out);
        } else {
          out[path] = val;
        }
      });
      return out;
    }
    if (prefix) out[prefix] = obj;
    return out;
  }

  /**
   * 展开扁平化对象
   * @param {Object} flat - 扁平化对象
   * @returns {Object} 展开后的对象
   */
  unflattenObject(flat = {}) {
    const result = {};
    Object.entries(flat).forEach(([path, value]) => {
      const keys = path.split('.');
      let cursor = result;
      keys.forEach((key, idx) => {
        if (idx === keys.length - 1) {
          cursor[key] = cloneValue(value);
        } else {
          if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
          cursor = cursor[key];
        }
      });
    });
    return result;
  }

  /**
   * 获取嵌套值
   * @param {Object} obj - 对象
   * @param {string} path - 路径（点分隔）
   * @returns {any} 值
   */
  getNestedValue(obj = {}, path = '') {
    if (!path) return obj;
    return path.split('.').reduce((current, key) => (current ? current[key] : undefined), obj);
  }

  /**
   * 设置嵌套值
   * @param {Object} source - 源对象
   * @param {string} path - 路径（点分隔）
   * @param {any} value - 值
   * @returns {Object} 新对象
   */
  setNestedValue(source = {}, path = '', value) {
    if (!path) return cloneValue(value);
    const clone = Array.isArray(source) ? [...source] : { ...source };
    const keys = path.split('.');
    let cursor = clone;
    keys.forEach((key, idx) => {
      if (idx === keys.length - 1) {
        cursor[key] = cloneValue(value);
      } else {
        if (!cursor[key] || typeof cursor[key] !== 'object') {
          cursor[key] = {};
        }
        cursor = cursor[key];
      }
    });
    return clone;
  }

  /**
   * 组合路径
   * @param {string} base - 基础路径
   * @param {string} tail - 尾部路径
   * @returns {string} 组合后的路径
   */
  combinePath(base, tail) {
    if (!base) return tail;
    if (!tail) return base;
    return `${base}.${tail}`;
  }

  /**
   * 规范化字段值
   * @param {any} value - 值
   * @param {Object} meta - 字段元数据
   * @param {string} typeHint - 类型提示
   * @returns {any} 规范化后的值
   */
  normalizeFieldValue(value, meta, typeHint) {
    return normalizeFieldValue(value, meta, typeHint);
  }

  /**
   * 转换值类型
   * @param {any} value - 值
   * @param {string} type - 目标类型
   * @returns {any} 转换后的值
   */
  castValue(value, type) {
    return castValue(value, type);
  }

  /**
   * 标记配置为已修改
   */
  markDirty() {
    this.isDirty = true;
  }

  /**
   * 标记配置为未修改
   */
  markClean() {
    this.isDirty = false;
  }

  /**
   * 检查配置是否已修改
   * @returns {boolean} 是否已修改
   */
  checkDirty() {
    return this.isDirty;
  }

  /**
   * 比较两个配置是否相同
   * @param {Object} config1 - 配置1
   * @param {Object} config2 - 配置2
   * @returns {boolean} 是否相同
   */
  compareConfigs(config1, config2) {
    return isSameValue(config1, config2);
  }

  /**
   * 克隆配置
   * @param {Object} config - 配置
   * @returns {Object} 克隆后的配置
   */
  cloneConfig(config) {
    return cloneValue(config);
  }

  /**
   * 验证配置字段
   * @param {any} value - 值
   * @param {Object} fieldDef - 字段定义
   * @returns {Object} 验证结果 {valid, error}
   */
  validateField(value, fieldDef) {
    if (!fieldDef) return { valid: true };

    // 必填检查
    if (fieldDef.required && (value === undefined || value === null || value === '')) {
      return { valid: false, error: '此字段为必填项' };
    }

    // 类型检查
    const type = fieldDef.type;
    if (type === 'number' && typeof value === 'number') {
      if (fieldDef.min !== undefined && value < fieldDef.min) {
        return { valid: false, error: `值不能小于 ${fieldDef.min}` };
      }
      if (fieldDef.max !== undefined && value > fieldDef.max) {
        return { valid: false, error: `值不能大于 ${fieldDef.max}` };
      }
    }

    if (type === 'string' && typeof value === 'string') {
      if (fieldDef.minLength !== undefined && value.length < fieldDef.minLength) {
        return { valid: false, error: `长度不能小于 ${fieldDef.minLength}` };
      }
      if (fieldDef.maxLength !== undefined && value.length > fieldDef.maxLength) {
        return { valid: false, error: `长度不能大于 ${fieldDef.maxLength}` };
      }
      if (fieldDef.pattern) {
        const regex = new RegExp(fieldDef.pattern);
        if (!regex.test(value)) {
          return { valid: false, error: '格式不正确' };
        }
      }
    }

    // 枚举检查
    if (fieldDef.enum && fieldDef.enum.length > 0) {
      if (Array.isArray(value)) {
        const invalid = value.find(v => !fieldDef.enum.includes(v));
        if (invalid) {
          return { valid: false, error: `值 "${invalid}" 不在允许的选项中` };
        }
      } else if (!fieldDef.enum.includes(value)) {
        return { valid: false, error: '值不在允许的选项中' };
      }
    }

    return { valid: true };
  }
}

// 导出配置管理器类
export default ConfigManager;

// 导出独立的工具函数
export function flattenObject(obj, prefix = '', out = {}) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    if (prefix && Object.keys(obj).length === 0) {
      out[prefix] = {};
      return out;
    }
    Object.entries(obj).forEach(([key, val]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        flattenObject(val, path, out);
      } else {
        out[path] = val;
      }
    });
    return out;
  }
  if (prefix) out[prefix] = obj;
  return out;
}

export function unflattenObject(flat = {}) {
  const result = {};
  Object.entries(flat).forEach(([path, value]) => {
    const keys = path.split('.');
    let cursor = result;
    keys.forEach((key, idx) => {
      if (idx === keys.length - 1) {
        cursor[key] = cloneValue(value);
      } else {
        if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
        cursor = cursor[key];
      }
    });
  });
  return result;
}

export function getNestedValue(obj = {}, path = '') {
  if (!path) return obj;
  return path.split('.').reduce((current, key) => (current ? current[key] : undefined), obj);
}

export function setNestedValue(source = {}, path = '', value) {
  if (!path) return cloneValue(value);
  const clone = Array.isArray(source) ? [...source] : { ...source };
  const keys = path.split('.');
  let cursor = clone;
  keys.forEach((key, idx) => {
    if (idx === keys.length - 1) {
      cursor[key] = cloneValue(value);
    } else {
      if (!cursor[key] || typeof cursor[key] !== 'object') {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
  });
  return clone;
}

export function combineConfigPath(base, tail) {
  if (!base) return tail;
  if (!tail) return base;
  return `${base}.${tail}`;
}

/**
 * 规范化字段值（匹配 app.js 实现）
 * @param {any} value - 值
 * @param {Object} meta - 字段元数据
 * @param {string} typeHint - 类型提示
 * @returns {any} 规范化后的值
 */
export function normalizeFieldValue(value, meta, typeHint) {
  const type = (meta?.type ?? typeHint ?? '').toLowerCase();
  if (type === 'number') return value === null || value === '' ? null : Number(value);
  if (type === 'boolean') {
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return !!value;
  }
  if (type === 'array<object>' || (type === 'array' && meta?.itemType === 'object')) return Array.isArray(value) ? value : [];
  if (type === 'array' && Array.isArray(value)) return value;
  if (type === 'array' && typeof value === 'string') return value ? value.split(',').map(v => v.trim()).filter(Boolean) : [];
  return value;
}

/**
 * 转换值类型
 * @param {any} value - 值
 * @param {string} type - 目标类型
 * @returns {any} 转换后的值
 */
export function castValue(value, type) {
  switch ((type ?? '').toLowerCase()) {
    case 'number': return Number(value);
    case 'boolean': return value === 'true' || value === true;
    default: return value;
  }
}

/**
 * 规范化模板路径（将数组索引替换为 []）
 * @param {string} path - 路径
 * @returns {string} 规范化后的路径
 */
export function normalizeTemplatePath(path = '') {
  return path.replace(/\[\d+\]/g, '[]');
}

/**
 * 从字段定义构建默认值对象
 * @param {Object} fields - 字段定义
 * @param {Function} cloneValueFn - 克隆函数（可选）
 * @returns {Object} 默认值对象
 */
export function buildDefaultsFromFields(fields = {}, cloneValueFn = cloneValue) {
  const result = {};
  Object.entries(fields).forEach(([key, schema]) => {
    // 嵌套对象：始终生成子对象结构
    if (schema.type === 'object' && schema.fields) {
      result[key] = buildDefaultsFromFields(schema.fields, cloneValueFn);
      return;
    }

    // 数组字段：仅在 schema 提供默认值时生成；否则用空数组
    if (schema.type === 'array') {
      if (schema.itemType === 'object') {
        result[key] = [];
      } else {
        result[key] = Array.isArray(schema.default) ? [...schema.default] : [];
      }
      return;
    }

    // 其余标量类型：只有在 schema 显式提供 default 时才生成字段；
    // 没有 default 的 number/string/boolean 视为"真正可选"，不创建 key，
    // 这样后端校验时不会因为空字符串或 0 误判为非法值。
    if (Object.hasOwn(schema, 'default')) {
      result[key] = cloneValueFn(schema.default);
    }
  });
  return result;
}

/**
 * 格式化分组标签
 * @param {string} label - 标签
 * @returns {string} 格式化后的标签
 */
export function formatGroupLabel(label) {
  if (!label || label === '基础') return '基础设置';
  return label.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
