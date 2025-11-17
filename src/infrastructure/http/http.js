import ApiLoader from "./loader.js";
import BotUtil from "../common/util.js";

/**
 * HTTP API基础类
 * 
 * 提供统一的HTTP API接口结构，支持路由注册、WebSocket处理、中间件等。
 * 所有API模块应继承此类或使用此类包装。
 * 
 * @class HttpApi
 * @example
 * // 方式1: 使用对象导出（推荐）
 * export default {
 *   name: 'my-api',
 *   dsc: '我的API',
 *   priority: 100,
 *   routes: [
 *     {
 *       method: 'GET',
 *       path: '/api/test',
 *       handler: async (req, res, Bot) => {
 *         res.json({ success: true });
 *       }
 *     }
 *   ],
 *   init: async (app, Bot) => {
 *     // 初始化逻辑
 *   }
 * };
 * 
 * // 方式2: 继承HttpApi类
 * export default class MyApi extends HttpApi {
 *   constructor() {
 *     super({
 *       name: 'my-api',
 *       routes: [/* ... *\/]
 *     });
 *   }
 * }
 */
export default class HttpApi {
  /**
   * HTTP API构造函数
   * 
   * @param {Object} data - API配置对象
   * @param {string} data.name - API名称（必填，用于标识）
   * @param {string} data.dsc - API描述（用于文档和日志）
   * @param {Array<Object>} data.routes - 路由配置数组
   *   - method: HTTP方法（GET/POST/PUT/DELETE等）
   *   - path: 路由路径
   *   - handler: 处理函数 (req, res, Bot, next) => {}
   *   - middleware: 可选中间件数组
   * @param {number} data.priority - 优先级（数字越大优先级越高，默认100）
   * @param {boolean} data.enable - 是否启用（默认true）
   * @param {Function} data.init - 初始化钩子函数 (app, Bot) => {}
   * @param {Object} data.ws - WebSocket处理器对象 { '/path': handler }
   * @param {Array<Function>} data.middleware - 全局中间件数组
   */
  constructor(data = {}) {
    /** API名称 */
    this.name = data.name || 'unnamed-api';
    
    /** API描述 */
    this.dsc = data.dsc || '暂无描述';
    
    /** 路由配置 */
    this.routes = data.routes || [];
    
    /** 优先级 */
    this.priority = data.priority || 100;
    
    /** API加载器 */
    this.loader = ApiLoader;
    
    /** 是否启用 */
    this.enable = data.enable !== false;
    
    /** 初始化钩子 */
    this.initHook = data.init || null;
    
    /** WebSocket处理器 */
    this.wsHandlers = data.ws || {};
    
    /** 中间件 */
    this.middleware = data.middleware || [];
    
    /** 创建时间 */
    this.createTime = Date.now();
  }
  
  /**
   * 初始化方法
   * @param {Object} app - Express应用实例
   * @param {Object} bot - Bot实例
   */
  async init(app, bot) {
    if (this.middleware && this.middleware.length > 0) {
      for (const mw of this.middleware) {
        if (typeof mw === 'function') {
          app.use(mw);
        }
      }
    }
    
    this.registerRoutes(app, bot);
    this.registerWebSocketHandlers(bot);
    
    if (typeof this.initHook === 'function') {
      await this.initHook(app, bot);
    }
    
    return true;
  }
  
  /**
   * 注册路由
   * @param {Object} app - Express应用实例
   * @param {Object} bot - Bot实例
   */
  registerRoutes(app, bot) {
    if (!Array.isArray(this.routes) || this.routes.length === 0) {
      BotUtil.makeLog('debug', `[HttpApi] ${this.name} 没有路由需要注册`, 'HttpApi');
      return;
    }
    
    let registeredCount = 0;
    
    for (const route of this.routes) {
      const { method, path, handler, middleware = [] } = route;
      
      if (!method || !path || !handler) {
        BotUtil.makeLog('warn', `[HttpApi] ${this.name} 路由配置不完整: method=${method}, path=${path}`, 'HttpApi');
        continue;
      }
      
      const lowerMethod = method.toLowerCase();
      if (typeof app[lowerMethod] !== 'function') {
        BotUtil.makeLog('error', `[HttpApi] ${this.name} 不支持的HTTP方法: ${method}`, 'HttpApi');
        continue;
      }
      
      const wrappedHandler = this.wrapHandler(handler, bot);
      
      if (middleware.length > 0) {
        app[lowerMethod](path, ...middleware, wrappedHandler);
      } else {
        app[lowerMethod](path, wrappedHandler);
      }
      
      registeredCount++;
    }
    
    if (registeredCount > 0) {
      BotUtil.makeLog('info', `[HttpApi] ${this.name} 注册了 ${registeredCount} 个路由`, 'HttpApi');
    }
  }
  
  /**
   * 包装处理器
   * @param {Function} handler - 原始处理器
   * @param {Object} bot - Bot实例
   * @returns {Function} 包装后的处理器
   */
  wrapHandler(handler, bot) {
    return async (req, res, next) => {
      // 如果响应已发送，直接返回
      if (res.headersSent) {
        return;
      }
      
      try {
        // 添加Bot实例到请求对象
        req.bot = bot;
        
        // 添加API实例引用
        req.api = this;
        
        const result = await handler(req, res, bot, next);
        
        // 如果 handler 返回了结果但没有调用 res.send/res.json，且没有调用 next
        // 检查是否响应已发送
        if (!res.headersSent && result !== undefined && typeof result !== 'function') {
          // handler 可能返回了数据但没有发送响应
          // 这里不自动发送，让 handler 自己处理
        }
      } catch (error) {
        BotUtil.makeLog('error', `[HttpApi] ${this.name} 处理请求失败: ${error.message}`, 'HttpApi', error);
        
        // 确保响应未发送时才发送错误响应
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
          });
        } else {
          // 如果响应已发送，记录错误但不尝试发送响应
          BotUtil.makeLog('warn', `[HttpApi] ${this.name} 响应已发送，无法发送错误响应`, 'HttpApi');
        }
      }
    };
  }
  
  /**
   * 注册WebSocket处理器
   * @param {Object} bot - Bot实例
   */
  registerWebSocketHandlers(bot) {
    if (!this.wsHandlers || typeof this.wsHandlers !== 'object') {
      return;
    }
    
    if (!bot.wsf) {
      bot.wsf = {};
    }
    
    for (const [path, handlers] of Object.entries(this.wsHandlers)) {
      if (!bot.wsf[path]) {
        bot.wsf[path] = [];
      }
      
      const handlerArray = Array.isArray(handlers) ? handlers : [handlers];
      
      for (const handler of handlerArray) {
        if (typeof handler === 'function') {
          bot.wsf[path].push((conn, req, socket, head) => {
            try {
              handler(conn, req, bot, socket, head);
            } catch (error) {
              BotUtil.makeLog('error', `[HttpApi] ${this.name} WebSocket处理失败: ${error.message}`, 'HttpApi', error);
            }
          });
        }
      }
    }
  }
  
  /**
   * 获取API信息
   * @returns {Object} API信息
   */
  getInfo() {
    return {
      name: this.name,
      dsc: this.dsc,
      priority: this.priority,
      routes: this.routes ? this.routes.length : 0,
      enable: this.enable,
      createTime: this.createTime
    };
  }
  
  /**
   * 启用API
   */
  start() {
    this.enable = true;
    BotUtil.makeLog('info', `[HttpApi] ${this.name} 已启用`, 'HttpApi');
  }
  
  stop() {
    this.enable = false;
    BotUtil.makeLog('info', `[HttpApi] ${this.name} 已停用`, 'HttpApi');
  }
  
  async reload(app, bot) {
    BotUtil.makeLog('info', `[HttpApi] ${this.name} 开始重载`, 'HttpApi');
    this.stop();
    await this.init(app, bot);
    this.start();
    BotUtil.makeLog('info', `[HttpApi] ${this.name} 重载完成`, 'HttpApi');
  }
}

