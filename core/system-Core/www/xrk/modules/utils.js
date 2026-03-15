/**
 * 工具函数模块
 * 提供格式化、转义、剪贴板等通用工具函数
 */

/**
 * 格式化字节大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的字符串
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * 格式化时间
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串
 */
export function formatTime(seconds) {
  if (!seconds || seconds === 0) return '0秒';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Number((seconds % 60).toFixed(2));

  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}时`);
  if (minutes > 0) parts.push(`${minutes}分`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}秒`);

  return parts.join('');
}

/**
 * 格式化数字（添加千分位）
 * @param {number} num - 数字
 * @returns {string} 格式化后的字符串
 */
export function formatNumber(num) {
  if (num == null || isNaN(num)) return '--';
  return Number(num).toLocaleString('zh-CN');
}

/**
 * 格式化百分比
 * @param {number} value - 数值
 * @param {number} total - 总数
 * @returns {string} 格式化后的百分比字符串
 */
export function formatPercent(value, total) {
  if (!total || total === 0) return '0%';
  const percent = (value / total) * 100;
  return percent.toFixed(1) + '%';
}

/**
 * 格式化 JSON
 * @param {any} obj - 要格式化的对象
 * @param {number} indent - 缩进空格数
 * @returns {string} 格式化后的 JSON 字符串
 */
export function formatJSON(obj, indent = 2) {
  try {
    return JSON.stringify(obj, null, indent);
  } catch (e) {
    return String(obj);
  }
}

/**
 * 转义 HTML 特殊字符
 * @param {string} text - 要转义的文本
 * @returns {string} 转义后的文本
 */
export function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * 转义 CSS 选择器中的特殊字符
 * @param {string} str - 要转义的字符串
 * @returns {string} 转义后的字符串
 */
export function escapeSelector(str) {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(str);
  }
  return String(str).replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');
}

/**
 * 复制文本到剪贴板
 * @param {string} text - 要复制的文本
 * @returns {Promise<boolean>} 是否成功
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // 降级方案
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch (e) {
    console.error('复制失败:', e);
    return false;
  }
}

/**
 * 深度克隆值
 * @param {any} value - 要克隆的值
 * @returns {any} 克隆后的值
 */
export function cloneValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value);
  if (value instanceof RegExp) return new RegExp(value);
  if (Array.isArray(value)) return value.map(cloneValue);

  const cloned = {};
  for (const key in value) {
    if (value.hasOwnProperty(key)) {
      cloned[key] = cloneValue(value[key]);
    }
  }
  return cloned;
}

/**
 * 比较两个值是否相同（深度比较）
 * @param {any} a - 值 A
 * @param {any} b - 值 B
 * @returns {boolean} 是否相同
 */
export function isSameValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => isSameValue(item, b[i]));
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  return keysA.every(key => isSameValue(a[key], b[key]));
}

/**
 * 组合路径
 * @param {...string} parts - 路径部分
 * @returns {string} 组合后的路径
 */
export function combinePath(...parts) {
  return parts
    .filter(Boolean)
    .map((part, i) => {
      if (i === 0) return part.replace(/\/+$/, '');
      if (i === parts.length - 1) return part.replace(/^\/+/, '');
      return part.replace(/^\/+|\/+$/g, '');
    })
    .join('/');
}

/**
 * 格式化键值对行（用于 Tags 组件）
 * @param {Object} obj - 对象
 * @returns {string} 格式化后的字符串
 */
export function formatKeyValueLines(obj = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  return Object.entries(obj)
    .map(([k, v]) => {
      if (v === undefined) return `${k}=`;
      if (typeof v === 'string') return `${k}=${v}`;
      try {
        return `${k}=${JSON.stringify(v)}`;
      } catch {
        return `${k}=${String(v)}`;
      }
    })
    .join('\n');
}

/**
 * 解析键值对行
 * @param {string} text - 文本
 * @returns {Object} 解析后的对象
 */
export function parseKeyValueLines(text = '') {
  const out = {};
  const lines = String(text).split(/\r?\n/);
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (!key) continue;
    if (!raw) {
      out[key] = '';
      continue;
    }
    // 尝试解析 JSON
    if ((raw.startsWith('{') && raw.endsWith('}')) ||
        (raw.startsWith('[') && raw.endsWith(']')) ||
        raw === 'true' || raw === 'false' || raw === 'null' ||
        /^-?\d+(\.\d+)?$/.test(raw)) {
      try {
        out[key] = JSON.parse(raw);
        continue;
      } catch {
        // 解析失败，当作字符串
      }
    }
    out[key] = raw;
  }
  return out;
}

/**
 * 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * 节流函数
 * @param {Function} func - 要节流的函数
 * @param {number} limit - 时间限制（毫秒）
 * @returns {Function} 节流后的函数
 */
export function throttle(func, limit) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}
