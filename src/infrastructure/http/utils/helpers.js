import BotUtil from '#utils/botutil.js';
import { HttpResponse } from '#utils/http-utils.js';

/**
 * HTTP工具函数库
 * 提供常用的HTTP请求处理、响应处理、数据验证等工具函数
 */

/**
 * 安全获取请求优先级
 * @param {Object} api - API实例
 * @returns {number} 优先级值
 */
export function getApiPriority(api) {
  if (!api || typeof api !== 'object') {
    return 100;
  }
  const priority = api.priority;
  if (priority == null || isNaN(priority)) {
    return 100;
  }
  return Number(priority);
}

/**
 * 验证API实例
 * @param {Object} api - API实例
 * @param {string} key - API键名
 * @returns {boolean} 是否有效
 */
export function validateApiInstance(api, key = 'unknown') {
  if (!api || typeof api !== 'object') {
    BotUtil.makeLog('warn', `API实例无效: ${key}`, 'HttpHelpers');
    return false;
  }
  
  // 确保基本属性存在
  if (!api.name) api.name = key;
  if (!api.dsc) api.dsc = '暂无描述';
  if (api.priority == null || isNaN(api.priority)) {
    api.priority = 100;
  } else {
    api.priority = Number(api.priority);
  }
  if (api.enable === undefined) api.enable = true;
  
  // 验证routes属性
  if (api.routes && !Array.isArray(api.routes)) {
    BotUtil.makeLog('warn', `API模块 ${key} 的routes不是数组`, 'HttpHelpers');
    api.routes = [];
  } else if (!api.routes) {
    api.routes = [];
  }
  
  return true;
}

/**
 * 验证请求参数
 * @param {Object} req - Express请求对象
 * @param {Object} schema - 验证模式 { field: { required: boolean, type: string, validator: function } }
 * @returns {{valid: boolean, errors: Array}}
 */
export function validateRequest(req, schema) {
  const errors = [];
  const body = req.body || {};
  const query = req.query || {};
  const params = req.params || {};
  
  for (const [field, rules] of Object.entries(schema)) {
    const value = body[field] ?? query[field] ?? params[field];
    
    if (rules.required && (value === undefined || value === '')) {
      errors.push(`字段 ${field} 是必需的`);
      continue;
    }
    
    if (value !== undefined && rules.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== rules.type) {
        errors.push(`字段 ${field} 类型错误，期望 ${rules.type}，实际 ${actualType}`);
        continue;
      }
    }
    
    if (value !== undefined && rules.validator) {
      const result = rules.validator(value);
      if (result !== true) {
        errors.push(result || `字段 ${field} 验证失败`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 提取请求体（支持JSON和FormData）
 * @param {Object} req - Express请求对象
 * @returns {Promise<Object>} 请求体对象
 */
export async function extractRequestBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && Object.keys(req.body).length > 0) {
      return resolve(req.body);
    }
    
    let data = '';
    req.on('data', chunk => {
      data += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        if (data) {
          resolve(JSON.parse(data));
        } else {
          resolve({});
        }
      } catch {
        reject(new Error('无效的JSON格式'));
      }
    });
    
    req.on('error', reject);
  });
}

/**
 * 创建速率限制中间件
 * @param {Object} options - 选项 { windowMs: number, max: number, keyGenerator: function }
 * @returns {Function} Express中间件
 */
export function createRateLimiter(options = {}) {
  const {
    windowMs = 60000, // 1分钟
    max = 100, // 最大请求数
    keyGenerator = (req) => req.ip
  } = options;
  
  const requests = new Map();
  
  // 清理过期记录
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of requests.entries()) {
      if (now - record.startTime > windowMs) {
        requests.delete(key);
      }
    }
  }, windowMs);
  
  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();
    
    let record = requests.get(key);
    
    if (!record || now - record.startTime > windowMs) {
      record = {
        startTime: now,
        count: 0
      };
      requests.set(key, record);
    }
    
    record.count++;
    
    if (record.count > max) {
      return HttpResponse.error(res, new Error('请求过于频繁，请稍后再试'), 429);
    }
    
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count));
    res.setHeader('X-RateLimit-Reset', new Date(record.startTime + windowMs).toISOString());
    
    next();
  };
}

/**
 * 创建认证中间件
 * @param {Function} verifyFn - 验证函数 (req) => Promise<{valid: boolean, user?: Object}>
 * @returns {Function} Express中间件
 */
export function createAuthMiddleware(verifyFn) {
  return async (req, res, next) => {
    try {
      const result = await verifyFn(req);
      if (result.valid) {
        req.user = result.user;
        next();
      } else {
        HttpResponse.error(res, new Error(result.message || '认证失败'), 401);
      }
    } catch (error) {
      BotUtil.makeLog('error', `认证中间件错误: ${error.message}`, 'HttpHelpers', error);
      HttpResponse.error(res, error, 500);
    }
  };
}

/**
 * 创建CORS中间件
 * @param {Object} options - CORS选项
 * @returns {Function} Express中间件
 */
export function createCorsMiddleware(options = {}) {
  const {
    origin = '*',
    methods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders = ['Content-Type', 'Authorization'],
    credentials = false
  } = options;
  
  return (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(', '));
    res.setHeader('Access-Control-Allow-Credentials', credentials);
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    next();
  };
}

/**
 * 创建请求日志中间件
 * @param {Object} options - 选项 { logLevel: string, skipPaths: Array }
 * @returns {Function} Express中间件
 */
export function createRequestLogger(options = {}) {
  const {
    logLevel = 'info',
    skipPaths = []
  } = options;
  
  return (req, res, next) => {
    const startTime = Date.now();
    const shouldSkip = skipPaths.some(path => req.path.startsWith(path));
    
    if (shouldSkip) {
      return next();
    }
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const message = `${req.method} ${req.path} ${res.statusCode} ${duration}ms`;
      BotUtil.makeLog(logLevel, message, 'RequestLogger');
    });
    
    next();
  };
}

/**
 * 创建分页响应
 * @param {Object} res - Express响应对象
 * @param {Array} data - 数据数组
 * @param {Object} pagination - 分页信息 { page: number, pageSize: number, total: number }
 */
export function sendPaginatedResponse(res, data, pagination) {
  const { page = 1, pageSize = 10, total = 0 } = pagination;
  const totalPages = Math.ceil(total / pageSize);
  
  HttpResponse.success(res, {
    items: data,
    pagination: {
      page: Number(page),
      pageSize: Number(pageSize),
      total: Number(total),
      totalPages
    }
  });
}

/**
 * 提取查询参数
 * @param {Object} req - Express请求对象
 * @param {Object} defaults - 默认值
 * @returns {Object} 提取的参数
 */
export function extractQueryParams(req, defaults = {}) {
  const params = { ...defaults };
  
  for (const [key, value] of Object.entries(req.query || {})) {
    if (value !== undefined && value !== '') {
      params[key] = value;
    }
  }
  
  return params;
}

