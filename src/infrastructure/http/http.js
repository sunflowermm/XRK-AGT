import BotUtil from "#utils/botutil.js";

/**
 * HTTP API基础类
 * 提供统一的HTTP API接口结构，支持路由注册、WebSocket处理、中间件等。
 */
export default class HttpApi {
  constructor(data = {}) {
    this.name = data.name || 'unnamed-api';
    this.dsc = data.dsc || '暂无描述';
    this.routes = data.routes || [];
    this.priority = data.priority || 100;
    this.enable = data.enable !== false;
    this.initHook = data.init || null;
    this.wsHandlers = data.ws || {};
    this.middleware = data.middleware || [];
    this.createTime = Date.now();
  }
  
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
  
  registerRoutes(app, bot) {
    if (!Array.isArray(this.routes) || this.routes.length === 0) return;
    
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
    
  }
  
  wrapHandler(handler, bot) {
    return async (req, res, next) => {
      if (res.headersSent) return;
      
      try {
        req.bot = bot;
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
  
  getInfo() {
    return {
      name: this.name,
      dsc: this.dsc,
      priority: this.priority,
      routes: this.routes ? this.routes.length : 0,
      ws: this.wsHandlers ? Object.keys(this.wsHandlers).length : 0,
      enable: this.enable,
      createTime: this.createTime
    };
  }

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

