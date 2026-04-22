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
    this._wsDisposers = [];
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
    // 清理旧的 WS 注册，避免热重载叠加
    this._disposeWebSocketHandlers();
    this._wsDisposers = this.registerWebSocketHandlers(bot, this.key || this.name || 'unknown');
    
    if (typeof this.initHook === 'function') {
      await this.initHook(app, bot);
    }
    
    return true;
  }
  
  registerRoutes(app, bot) {
    if (!Array.isArray(this.routes) || this.routes.length === 0) return;
    
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
  
  registerWebSocketHandlers(bot, ownerKey = 'unknown') {
    if (!this.wsHandlers || typeof this.wsHandlers !== 'object') {
      return [];
    }
    
    if (!bot.wsf) {
      bot.wsf = {};
    }
    
    const disposers = [];

    for (const [path, handlers] of Object.entries(this.wsHandlers)) {
      if (!bot.wsf[path]) {
        bot.wsf[path] = [];
      }
      
      const handlerArray = Array.isArray(handlers) ? handlers : [handlers];
      
      for (const handlerEntry of handlerArray) {
        const rawHandler = typeof handlerEntry === 'function'
          ? handlerEntry
          : (handlerEntry && typeof handlerEntry.handler === 'function' ? handlerEntry.handler : null);
        if (typeof rawHandler === 'function') {
          const wrapped = (conn, req, socket, head) => {
            try {
              rawHandler(conn, req, bot, socket, head);
            } catch (error) {
              BotUtil.makeLog('error', `[HttpApi] ${this.name} WebSocket处理失败: ${error.message}`, 'HttpApi', error);
            }
          };
          wrapped.__ownerKey = ownerKey;
          wrapped.__originalHandler = rawHandler;
          if (handlerEntry && typeof handlerEntry === 'object' && handlerEntry.skipAuth === true) {
            wrapped.skipAuth = true;
            wrapped.handler = wrapped;
          }

          const exists = bot.wsf[path].some(
            h => h && h.__ownerKey === ownerKey && h.__originalHandler === rawHandler
          );
          if (exists) continue;

          bot.wsf[path].push(wrapped);
          disposers.push(() => {
            const list = bot.wsf[path];
            if (!Array.isArray(list)) return;
            const index = list.indexOf(wrapped);
            if (index >= 0) list.splice(index, 1);
            if (list.length === 0) delete bot.wsf[path];
          });
        }
      }
    }

    return disposers;
  }

  _disposeWebSocketHandlers() {
    for (const dispose of this._wsDisposers || []) {
      try {
        if (typeof dispose === 'function') dispose();
      } catch {}
    }
    this._wsDisposers = [];
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
    this._disposeWebSocketHandlers();
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

