/**
 * 配置表单工具函数（扁平化路径、嵌套读写、默认值）
 */
import { cloneValue, isSameValue } from './utils.js';

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

export function castValue(value, type) {
  switch ((type ?? '').toLowerCase()) {
    case 'number': return Number(value);
    case 'boolean': return value === 'true' || value === true;
    default: return value;
  }
}

export function normalizeTemplatePath(path = '') {
  return path.replace(/\[\d+\]/g, '[]');
}

export function buildDefaultsFromFields(fields = {}, cloneValueFn = cloneValue) {
  const result = {};
  Object.entries(fields).forEach(([key, schema]) => {
    if (schema.type === 'object' && schema.fields) {
      result[key] = buildDefaultsFromFields(schema.fields, cloneValueFn);
      return;
    }
    if (schema.type === 'array') {
      if (schema.itemType === 'object') {
        result[key] = [];
      } else {
        result[key] = Array.isArray(schema.default) ? [...schema.default] : [];
      }
      return;
    }
    if (Object.hasOwn(schema, 'default')) {
      result[key] = cloneValueFn(schema.default);
    }
  });
  return result;
}

export function formatGroupLabel(label) {
  if (!label || label === '基础') return '基础设置';
  return label.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
