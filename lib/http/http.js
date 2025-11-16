import ApiLoader from "./loader.js";
import BotUtil from "../common/util.js";

/**
 * HTTP API基础类
 * 提供统一的API接口结构
 */
export default class HttpApi {
  /**
   * HTTP API构造函数
   * @param {Object} data - API配置
   * @param {string} data.name - API名称
   * @param {string} data.dsc - API描述
   * @param {Array} data.routes - 路由配置
   * @param {number} data.priority - 优先级（默认100）
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
      return;
    }
    
    for (const route of this.routes) {
      const { method, path, handler, middleware = [] } = route;
      
      if (!method || !path || !handler) {
        BotUtil.makeLog('warn', `[HttpApi] ${this.name} 路由配置不完整`, 'HttpApi');
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
      try {
        // 添加Bot实例到请求对象
        req.bot = bot;
        
        // 添加API实例引用
        req.api = this;
        
        await handler(req, res, bot, next);
      } catch (error) {
        BotUtil.makeLog('error', `[HttpApi] ${this.name} 处理请求失败: ${error.message}`, 'HttpApi', error);
        
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
          });
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

