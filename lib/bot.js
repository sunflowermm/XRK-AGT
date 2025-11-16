import path from 'path';
import fs from 'node:fs/promises';
import * as fsSync from 'fs';
import { EventEmitter } from "events";
import express from "express";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { WebSocketServer } from "ws";
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import os from 'node:os';
import dgram from 'node:dgram';
import chalk from 'chalk';
import { createProxyMiddleware } from 'http-proxy-middleware';

import PluginsLoader from "./plugins/loader.js";
import ListenerLoader from "./listener/loader.js";
import ApiLoader from "./http/loader.js";
import Packageloader from "./config/loader.js";
import StreamLoader from "./aistream/loader.js";
import BotUtil from './common/util.js';
import cfg from './config/config.js';

/**
 * Bot主类
 * 
 * 系统的核心类，负责HTTP服务器、WebSocket、插件管理、配置管理等。
 * 继承自EventEmitter，支持事件驱动架构。
 * 
 * @class Bot
 * @extends EventEmitter
 * @example
 * // 创建Bot实例
 * import Bot from './lib/bot.js';
 * 
 * const bot = new Bot();
 * await bot.run({ port: 8086 });
 * 
 * // 监听事件
 * bot.on('online', ({ url, apis }) => {
 *   console.log(`服务器已启动: ${url}`);
 * });
 */
export default class Bot extends EventEmitter {
  /**
   * Bot构造函数
   * 
   * 初始化Bot实例，设置Express应用、WebSocket服务器、配置等。
   * 自动初始化HTTP服务器、生成API密钥、设置信号处理等。
   */
  constructor() {
    super();
    
    // 核心属性初始化
    this.stat = { start_time: Date.now() / 1000 };
    this.bot = this;
    this.bots = {};
    this.adapter = [];
    this.uin = this._createUinManager();
    
    // Express应用和服务器
    this.express = Object.assign(express(), { skip_auth: [], quiet: [] });
    this.server = null;
    this.httpsServer = null;
    this.wss = new WebSocketServer({ noServer: true });
    this.wsf = Object.create(null);
    this.fs = Object.create(null);
    
    // 配置属性
    this.apiKey = '';
    this._cache = BotUtil.getMap('yunzai_cache', { ttl: 60000, autoClean: true });
    this._rateLimiters = new Map();
    this.httpPort = null;
    this.httpsPort = null;
    this.actualPort = null;
    this.actualHttpsPort = null;
    this.url = cfg.server.server.url || '';
    
    // 反向代理相关
    this.proxyEnabled = false;
    this.proxyApp = null;
    this.proxyServer = null;
    this.proxyHttpsServer = null;
    this.proxyMiddlewares = new Map();
    this.domainConfigs = new Map();
    this.sslContexts = new Map();
    
    this.ApiLoader = ApiLoader;
    this._initHttpServer();
    this._setupSignalHandlers();
    this.generateApiKey();
    
    return this._createProxy();
  }
  /**
   * 静态方法版本的makeError
   * @static
   * @param {string|Error} message - 错误消息或错误对象
   * @param {string} [type='Error'] - 错误类型
   * @param {Object} [details={}] - 额外的错误详情
   * @returns {Error} 标准化的错误对象
   */
  makeError(message, type = 'Error', details = {}) {
    let error;

    if (message instanceof Error) {
      error = message;
      if (type === 'Error' && error.type) {
        type = error.type;
      }
    } else {
      error = new Error(message);
    }

    error.type = type;
    error.timestamp = Date.now();

    if (details && typeof details === 'object') {
      Object.assign(error, details);
    }

    error.source = 'Bot';
    const logMessage = `${type}: ${error.message}`;
    const logDetails = Object.keys(details).length > 0 ?
      chalk.gray(` Details: ${JSON.stringify(details)}`) : '';

    if (typeof BotUtil !== 'undefined' && BotUtil.makeLog) {
      BotUtil.makeLog('error', chalk.red(`✗ ${logMessage}${logDetails}`), type);

      if (error.stack && cfg.debug) {
        BotUtil.makeLog('debug', chalk.gray(error.stack), type);
      }
    } else {
      console.error(`[${type}] ${error.message}`, details);
    }

    return error;
  }

  _createUinManager() {
    return Object.assign([], {
      toJSON() {
        if (!this.now) {
          if (this.length <= 2) return this[this.length - 1] || "";
          const array = this.slice(1);
          this.now = array[Math.floor(Math.random() * array.length)];
          setTimeout(() => delete this.now, 60000);
        }
        return this.now;
      },
      toString(raw, ...args) {
        return raw === true ?
          Array.prototype.toString.apply(this, args) :
          this.toJSON().toString(raw, ...args);
      },
      includes(value) {
        return this.some(i => i == value);
      }
    });
  }

  _initHttpServer() {
    this.server = http.createServer(this.express)
      .on("error", err => this._handleServerError(err, false))
      .on("upgrade", this.wsConnect.bind(this));
  }

  _handleServerError(err, isHttps) {
    const handler = this[`server${err.code}`];
    if (typeof handler === "function") {
      return handler.call(this, err, isHttps);
    }
    BotUtil.makeLog("error", err, isHttps ? "HTTPS服务器" : "HTTP服务器");
  }

  /**
   * 初始化代理应用和服务器
   */
  async _initProxyApp() {
    const proxyConfig = cfg.server.proxy;
    if (!proxyConfig?.enabled) return;
    
    // 创建独立的Express应用用于代理
    this.proxyApp = express();
    
    // 加载所有域名的SSL证书
    await this._loadDomainCertificates();
    
    // 配置代理路由
    this.proxyApp.use(async (req, res, next) => {
      const hostname = req.hostname || req.headers.host?.split(':')[0];
      
      if (!hostname) {
        return res.status(400).send('错误请求：缺少Host头');
      }
      
      // 查找域名配置
      const domainConfig = this._findDomainConfig(hostname);
      
      if (!domainConfig) {
        return res.status(404).send(`域名 ${hostname} 未配置`);
      }
      
      // 处理路径重写
      if (domainConfig.rewritePath) {
        const { from, to } = domainConfig.rewritePath;
        if (from && req.path.startsWith(from)) {
          const newPath = req.path.replace(from, to || '');
          req.url = newPath + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
          BotUtil.makeLog('debug', `路径重写：${req.path} → ${newPath}`, '代理');
        }
      }
      
      // 如果配置了自定义目标，使用自定义代理
      if (domainConfig.target) {
        let middleware = this.proxyMiddlewares.get(domainConfig.domain);
        if (!middleware) {
          middleware = this._createProxyMiddleware(domainConfig);
          this.proxyMiddlewares.set(domainConfig.domain, middleware);
        }
        return middleware(req, res, next);
      }
      
      // 默认代理到本地服务
      const targetPort = this.actualPort;
      const proxyOptions = {
        target: `http://127.0.0.1:${targetPort}`,
        changeOrigin: true,
        ws: domainConfig.ws !== false,
        secure: false,
        logLevel: 'warn',
        onError: (err, req, res) => {
          BotUtil.makeLog('error', `代理错误 [${hostname}]: ${err.message}`, '代理');
          if (!res.headersSent) {
            res.status(502).json({
              error: '网关错误',
              message: '无法连接到上游服务器',
              upstream: `http://127.0.0.1:${targetPort}`
            });
          }
        }
      };
      
      const proxy = createProxyMiddleware(proxyOptions);
      return proxy(req, res, next);
    });
    
    // 创建HTTP代理服务器
    this.proxyServer = http.createServer(this.proxyApp);
    this.proxyServer.on("error", err => {
      BotUtil.makeLog("error", `HTTP代理服务器错误：${err.message}`, '代理');
    });
    
    // 如果有HTTPS域名，创建HTTPS代理服务器
    if (this.sslContexts.size > 0) {
      await this._createHttpsProxyServer();
    }
  }

  /**
   * 加载域名SSL证书
   */
  async _loadDomainCertificates() {
    const proxyConfig = cfg.server.proxy;
    if (!proxyConfig?.domains) return;
    
    for (const domainConfig of proxyConfig.domains) {
      if (!domainConfig.ssl?.enabled || !domainConfig.ssl?.certificate) continue;
      
      const cert = domainConfig.ssl.certificate;
      if (!cert.key || !cert.cert) {
        BotUtil.makeLog("warn", `域名 ${domainConfig.domain} 缺少证书配置`, '代理');
        continue;
      }
      
      if (!fsSync.existsSync(cert.key) || !fsSync.existsSync(cert.cert)) {
        BotUtil.makeLog("warn", `域名 ${domainConfig.domain} 的证书文件不存在`, '代理');
        continue;
      }
      
      const httpsConfig = cfg.server.https || {};
      const tlsConfig = httpsConfig.tls || {};
      
      const context = tls.createSecureContext({
        key: await fs.readFile(cert.key),
        cert: await fs.readFile(cert.cert),
        ca: cert.ca && fsSync.existsSync(cert.ca) ? await fs.readFile(cert.ca) : undefined,
        minVersion: tlsConfig.minVersion || 'TLSv1.2',
        honorCipherOrder: true
      });
      
      this.sslContexts.set(domainConfig.domain, context);
      this.domainConfigs.set(domainConfig.domain, domainConfig);
      BotUtil.makeLog("info", `✓ 加载SSL证书：${domainConfig.domain}`, '代理');
    }
  }

  /**
   * 创建HTTPS代理服务器
   * 支持HTTP/2和SNI多域名
   */
  async _createHttpsProxyServer() {
    const [firstDomain] = this.sslContexts.keys();
    const domainConfig = this.domainConfigs.get(firstDomain);
    
    if (!domainConfig?.ssl?.certificate) {
      BotUtil.makeLog("error", "没有可用的SSL证书", '代理');
      return;
    }
    
    const cert = domainConfig.ssl.certificate;
    const httpsConfig = cfg.server.https || {};
    const tlsConfig = httpsConfig.tls || {};
    
    const httpsOptions = {
      key: await fs.readFile(cert.key),
      cert: await fs.readFile(cert.cert),
      ca: cert.ca && fsSync.existsSync(cert.ca) ? await fs.readFile(cert.ca) : undefined,
      minVersion: tlsConfig.minVersion || 'TLSv1.2',
      honorCipherOrder: true,
      SNICallback: (servername, cb) => {
        const context = this.sslContexts.get(servername) || this._findWildcardContext(servername);
        cb(null, context);
      }
    };
    
    if (tlsConfig.http2 === true) {
      const http2 = await import('http2');
      const { createSecureServer } = http2;
      
      httpsOptions.allowHTTP1 = true;
      this.proxyHttpsServer = createSecureServer(httpsOptions, this.proxyApp);
      this.proxyHttpsServer.on("error", err => {
        BotUtil.makeLog("error", `HTTPS代理服务器错误：${err.message}`, '代理');
      });
      BotUtil.makeLog("info", "✓ HTTPS代理服务器已启动（HTTP/2支持）", '代理');
      return;
    }
    
    this.proxyHttpsServer = https.createServer(httpsOptions, this.proxyApp);
    this.proxyHttpsServer.on("error", err => {
      BotUtil.makeLog("error", `HTTPS代理服务器错误：${err.message}`, '代理');
    });
  }

  /**
   * 创建域名专用代理中间件
   */
  _createProxyMiddleware(domainConfig) {
    const proxyOptions = {
      target: domainConfig.target,
      changeOrigin: true,
      ws: domainConfig.ws !== false,
      preserveHostHeader: domainConfig.preserveHostHeader === true,
      timeout: domainConfig.timeout || 30000,
      proxyTimeout: domainConfig.timeout || 30000,
      secure: false,
      logLevel: 'warn',
      
      onProxyReq: (proxyReq, req, res) => {
        // 添加自定义请求头
        if (domainConfig.headers?.request) {
          for (const [key, value] of Object.entries(domainConfig.headers.request)) {
            proxyReq.setHeader(key, value);
          }
        }
      },
      
      onProxyRes: (proxyRes, req, res) => {
        // 添加自定义响应头
        if (domainConfig.headers?.response) {
          for (const [key, value] of Object.entries(domainConfig.headers.response)) {
            res.setHeader(key, value);
          }
        }
      },
      
      onError: (err, req, res) => {
        BotUtil.makeLog('error', `代理错误 [${domainConfig.domain}]: ${err.message}`, '代理');
        if (!res.headersSent) {
          res.status(502).json({
            error: '网关错误',
            message: '代理服务器错误',
            domain: domainConfig.domain,
            target: domainConfig.target
          });
        }
      }
    };
    
    // 路径重写规则
    if (domainConfig.pathRewrite && typeof domainConfig.pathRewrite === 'object') {
      proxyOptions.pathRewrite = domainConfig.pathRewrite;
    }
    
    return createProxyMiddleware(proxyOptions);
  }

  /**
   * 查找域名配置（支持通配符）
   */
  _findDomainConfig(hostname) {
    // 精确匹配
    if (this.domainConfigs.has(hostname)) {
      return this.domainConfigs.get(hostname);
    }
    
    // 通配符匹配
    for (const [domain, config] of this.domainConfigs) {
      if (domain.startsWith('*.')) {
        const baseDomain = domain.substring(2);
        if (hostname === baseDomain || hostname.endsWith('.' + baseDomain)) {
          const subdomain = hostname === baseDomain ? '' : 
                           hostname.substring(0, hostname.length - baseDomain.length - 1);
          const configCopy = { ...config, subdomain };
          
          // 替换路径中的变量
          if (config.rewritePath?.to?.includes('${subdomain}')) {
            configCopy.rewritePath = {
              ...config.rewritePath,
              to: config.rewritePath.to.replace('${subdomain}', subdomain)
            };
          }
          
          return configCopy;
        }
      }
    }
    
    return null;
  }

  /**
   * 查找通配符SSL证书
   */
  _findWildcardContext(servername) {
    for (const [domain, context] of this.sslContexts) {
      if (domain.startsWith('*.')) {
        const baseDomain = domain.substring(2);
        if (servername === baseDomain || servername.endsWith('.' + baseDomain)) {
          return context;
        }
      }
    }
    return null;
  }

  /**
   * 初始化中间件和路由
   * 按照nginx风格的路由匹配顺序：精确匹配 > 前缀匹配 > 正则匹配 > 默认
   */
  _initializeMiddlewareAndRoutes() {
    // ========== 第一阶段：全局中间件（所有请求） ==========
    // 1. 请求追踪和基础信息
    this.express.use((req, res, next) => {
      req.startTime = Date.now();
      req.requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      next();
    });
    
    // 2. 压缩中间件（优先处理，减少传输）
    if (cfg.server.compression.enabled !== false) {
      this.express.use(compression({
        filter: (req, res) => {
          if (req.headers['x-no-compression']) return false;
          if (req.path.startsWith('/api/')) {
            const contentType = res.getHeader('content-type') || '';
            return compression.filter(req, res) && 
                   (contentType.includes('json') || contentType.includes('text'));
          }
          return compression.filter(req, res);
        },
        level: cfg.server.compression.level || 6,
        threshold: cfg.server.compression.threshold || 1024
      }));
    }
    
    // 3. 安全头部（在所有响应前设置）
    if (cfg.server.security.helmet.enabled !== false) {
      this.express.use(helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        hsts: cfg.server.security.hsts.enabled === true ? {
          maxAge: cfg.server.security.hsts.maxAge || 31536000,
          includeSubDomains: cfg.server.security.hsts.includeSubDomains !== false,
          preload: cfg.server.security.hsts.preload === true
        } : false
      }));
    }
    
    // 4. CORS（API请求需要）
    this._setupCors();
    
    // 5. 请求日志（记录所有请求）
    this._setupRequestLogging();
    
    // 6. 速率限制（防止滥用）
    this._setupRateLimiting();
    
    // 7. 请求体解析（POST/PUT等需要）
    this._setupBodyParsers();
    
    // ========== 第二阶段：精确路由匹配（优先级最高） ==========
    // 系统路由（精确匹配，无需认证）
    this.express.get('/status', this._statusHandler.bind(this));
    this.express.get('/health', this._healthHandler.bind(this));
    this.express.get('/robots.txt', this._handleRobotsTxt.bind(this));
    this.express.get('/favicon.ico', this._handleFavicon.bind(this));
    
    // ========== 第三阶段：前缀路由匹配 ==========
    // 文件服务路由（/File前缀）
    this.express.use('/File', this._fileHandler.bind(this));
    
    // ========== 第四阶段：认证中间件（API和受保护资源） ==========
    // 认证中间件（对需要认证的路径生效）
    this.express.use(this._authMiddleware.bind(this));
    
    // ========== 第五阶段：UI Cookie设置（同源前端） ==========
    this.express.use((req, res, next) => {
      if (req.path.startsWith('/xrk') && !res.headersSent) {
        try {
          res.cookie?.('xrk_ui', '1', {
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 86400000
          });
          if (!res.cookie) {
            res.setHeader('Set-Cookie', 'xrk_ui=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400');
          }
        } catch {}
      }
      next();
    });

    // ========== 第六阶段：静态文件服务（最后匹配） ==========
    // 注意：静态文件服务应该在API路由之后，避免拦截API请求
    // 但这里先设置，因为API路由在ApiLoader.register中注册
    this._setupStaticServing();
  }

  /**
   * 配置CORS跨域
   * 适配最新HTTP生态，支持预检请求和凭证传递
   */
  _setupCors() {
    const corsConfig = cfg.server.cors;
    if (corsConfig.enabled === false) return;
    
    this.express.use((req, res, next) => {
      // 如果响应已发送，直接跳过
      if (res.headersSent) {
        return next();
      }
      
      const config = corsConfig || {};
      const allowedOrigins = config.origins || ['*'];
      const origin = req.headers.origin;
      
      // 处理预检请求（OPTIONS）
      if (req.method === 'OPTIONS') {
        if (allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin))) {
          res.header('Access-Control-Allow-Origin', origin || '*');
        }
        res.header('Access-Control-Allow-Methods',
          config.methods?.join(', ') || 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD');
        res.header('Access-Control-Allow-Headers',
          config.headers?.join(', ') || 'Content-Type, Authorization, X-API-Key, X-Requested-With');
        res.header('Access-Control-Allow-Credentials',
          config.credentials ? 'true' : 'false');
        res.header('Access-Control-Max-Age',
          String(config.maxAge || 86400));
        res.header('Access-Control-Expose-Headers',
          'X-Request-Id, X-Response-Time');
        return res.sendStatus(204);
      }
      
      // 处理实际请求
      if (allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin))) {
        res.header('Access-Control-Allow-Origin', origin || '*');
      }
      
      res.header('Access-Control-Allow-Methods',
        config.methods?.join(', ') || 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD');
      res.header('Access-Control-Allow-Headers',
        config.headers?.join(', ') || 'Content-Type, Authorization, X-API-Key, X-Requested-With');
      res.header('Access-Control-Allow-Credentials',
        config.credentials ? 'true' : 'false');
      res.header('Access-Control-Expose-Headers',
        'X-Request-Id, X-Response-Time');
      
      if (config.maxAge) {
        res.header('Access-Control-Max-Age', String(config.maxAge));
      }
      
      next();
    });
  }

  /**
   * 请求日志中间件
   * 添加请求ID追踪，适配现代HTTP生态
   */
  _setupRequestLogging() {
    if (cfg.server.logging.requests === false) return;
    
    this.express.use((req, res, next) => {
      const start = Date.now();
      
      // 设置请求ID（用于追踪）
      if (!req.requestId) {
        req.requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
      
      // 在响应发送前设置头部
      if (!res.headersSent) {
        res.setHeader('X-Request-Id', req.requestId);
      }
      
      // 监听响应完成事件，记录日志
      res.once('finish', () => {
        const duration = Date.now() - start;
        
        const quietPaths = cfg.server.logging.quiet || [];
        if (!quietPaths.some(p => req.path.startsWith(p))) {
          const statusColor = res.statusCode < 400 ? 'green' :
                             res.statusCode < 500 ? 'yellow' : 'red';
          const method = chalk.cyan(req.method.padEnd(6));
          const status = chalk[statusColor](res.statusCode);
          const time = chalk.gray(`${duration}ms`.padStart(7));
          const path = chalk.white(req.path);
          const host = req.hostname ? chalk.gray(` [${req.hostname}]`) : '';
          const requestId = chalk.gray(` [${req.requestId}]`);
          
          BotUtil.makeLog('debug', `${method} ${status} ${time} ${path}${host}${requestId}`, 'HTTP');
        }
      });
      
      // 拦截 writeHead 和 end 方法，在响应发送前设置响应时间头
      const originalWriteHead = res.writeHead;
      res.writeHead = function(statusCode, statusMessage, headers) {
        const duration = Date.now() - start;
        if (!res.headersSent) {
          res.setHeader('X-Response-Time', `${duration}ms`);
        }
        return originalWriteHead.apply(this, arguments);
      };
      
      // 如果使用 res.send/res.json 等，它们会调用 writeHead
      // 为了确保响应时间头被设置，我们也拦截 end 方法
      const originalEnd = res.end;
      res.end = function(chunk, encoding, callback) {
        const duration = Date.now() - start;
        // 在调用原始 end 前设置响应时间头（如果还未发送）
        if (!res.headersSent) {
          res.setHeader('X-Response-Time', `${duration}ms`);
        }
        return originalEnd.call(this, chunk, encoding, callback);
      };
      
      next();
    });
  }

  /**
   * 静态文件服务配置
   * 使用条件中间件，只处理非API请求
   */
  _setupStaticServing() {
    // 目录索引（仅对静态文件）
    this.express.use((req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      // 如果响应已发送，直接跳过
      if (res.headersSent) {
        return next();
      }
      this._directoryIndexMiddleware(req, res, next);
    });
    
    // 静态文件安全中间件（已优化，跳过API）
    this.express.use(this._staticSecurityMiddleware.bind(this));
    
    // 静态文件服务（条件匹配）
    this.express.use((req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      
      // 如果响应已发送，直接跳过
      if (res.headersSent) {
        return next();
      }
      
      const staticRoot = req.staticRoot || path.join(process.cwd(), 'www');
      
      if (!fsSync.existsSync(staticRoot)) {
        fsSync.mkdirSync(staticRoot, { recursive: true });
      }
      
      const staticOptions = {
        index: cfg.server.static.index || ['index.html', 'index.htm'],
        dotfiles: 'deny',
        extensions: cfg.server.static.extensions || false,
        fallthrough: true,
        maxAge: cfg.server.static.cacheTime || '1d',
        etag: true,
        lastModified: true,
        setHeaders: (res, filePath) => {
          // 确保在设置头部前检查响应状态
          if (!res.headersSent) {
            this._setStaticHeaders(res, filePath);
          }
        }
      };
      
      express.static(staticRoot, staticOptions)(req, res, next);
    });
  }

  /**
   * 目录索引中间件
   * 跳过API路由，只处理静态文件请求
   */
  _directoryIndexMiddleware(req, res, next) {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    
    // 如果响应已发送，直接跳过
    if (res.headersSent) {
      return next();
    }
    
    const hasExtension = path.extname(req.path);
    if (hasExtension || req.path.endsWith('/')) {
      return next();
    }
    
    const staticRoot = req.staticRoot || path.join(process.cwd(), 'www');
    const dirPath = path.join(staticRoot, req.path);
    
    if (fsSync.existsSync(dirPath) && fsSync.statSync(dirPath).isDirectory()) {
      const indexFiles = cfg.server.static.index || ['index.html', 'index.htm'];
      
      for (const indexFile of indexFiles) {
        const indexPath = path.join(dirPath, indexFile);
        if (fsSync.existsSync(indexPath)) {
          const redirectUrl = req.path + '/';
          BotUtil.makeLog('debug', `目录重定向：${req.path} → ${redirectUrl}`, '服务器');
          if (!res.headersSent) {
            return res.redirect(301, redirectUrl);
          }
          return;
        }
      }
    }
    
    next();
  }

  /**
   * 设置静态文件响应头
   * 确保在响应发送前设置头部
   */
  _setStaticHeaders(res, filePath) {
    // 如果响应已发送，不再设置头部
    if (res.headersSent) {
      return;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.htm': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.pdf': 'application/pdf',
      '.zip': 'application/zip',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.otf': 'font/otf'
    };
    
    // 再次检查（防止在检查后、设置前响应被发送）
    if (res.headersSent) {
      return;
    }
    
    if (mimeTypes[ext]) {
      res.setHeader('Content-Type', mimeTypes[ext]);
    }
    
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    const cacheConfig = cfg.server.static.cache || {};
    if (['.html', '.htm'].includes(ext)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (['.css', '.js', '.json'].includes(ext)) {
      res.setHeader('Cache-Control', `public, max-age=${cacheConfig.static || 86400}`);
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'].includes(ext)) {
      res.setHeader('Cache-Control', `public, max-age=${cacheConfig.images || 604800}`);
    }
  }

  /**
   * 静态文件安全中间件
   * nginx风格：只处理静态文件，不拦截API路由
   */
  _staticSecurityMiddleware(req, res, next) {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    
    // 如果响应已发送，直接跳过
    if (res.headersSent) {
      return next();
    }
    
    const normalizedPath = path.normalize(req.path);
    
    if (normalizedPath.includes('..')) {
      return res.status(403).json({ error: '禁止访问' });
    }
    
    const hiddenPatterns = cfg.server.security.hiddenFiles || [
      /^\./, /\/\./, /node_modules/, /\.git/
    ];
    
    const isHidden = hiddenPatterns.some(pattern => {
      if (typeof pattern === 'string') {
        return normalizedPath.includes(pattern);
      }
      if (pattern instanceof RegExp) {
        return pattern.test(normalizedPath);
      }
      return false;
    });
    
    if (isHidden) {
      return res.status(404).json({ error: '未找到' });
    }
    
    next();
  }

  /**
   * 处理favicon请求
   */
  async _handleFavicon(req, res) {
    if (res.headersSent) return;
    
    const staticRoot = req.staticRoot || path.join(process.cwd(), 'www');
    const faviconPath = path.join(staticRoot, 'favicon.ico');
    
    if (fsSync.existsSync(faviconPath)) {
      if (!res.headersSent) {
        res.set({
          'Content-Type': 'image/x-icon',
          'Cache-Control': 'public, max-age=604800'
        });
        return res.sendFile(faviconPath);
      }
      return;
    }
    
    if (!res.headersSent) {
      res.status(204).end();
    }
  }

  /**
   * 处理robots.txt请求
   */
  async _handleRobotsTxt(req, res) {
    if (res.headersSent) return;
    
    const staticRoot = req.staticRoot || path.join(process.cwd(), 'www');
    const robotsPath = path.join(staticRoot, 'robots.txt');
    
    if (fsSync.existsSync(robotsPath)) {
      if (!res.headersSent) {
        res.set({
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=86400'
        });
        return res.sendFile(robotsPath);
      }
      return;
    }
    
    const defaultRobots = `User-agent: *
Disallow: /api/
Disallow: /config/
Disallow: /data/
Disallow: /lib/
Disallow: /plugins/
Disallow: /temp/
Allow: /

Sitemap: ${this.getServerUrl()}/sitemap.xml`;
    
    if (!res.headersSent) {
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.send(defaultRobots);
    }
  }

  /**
   * 速率限制配置
   */
  _setupRateLimiting() {
    const rateLimitConfig = cfg.server.rateLimit;
    if (rateLimitConfig.enabled === false) return;
    
    const createLimiter = (options) => rateLimit({
      windowMs: options.windowMs || 15 * 60 * 1000,
      max: options.max || 100,
      message: options.message || '请求过于频繁',
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => this._isLocalConnection(req.ip)
    });
    
    // 全局限制
    if (rateLimitConfig?.global) {
      this.express.use(createLimiter(rateLimitConfig.global));
    }
    
    // API限制
    if (rateLimitConfig?.api) {
      this.express.use('/api', createLimiter(rateLimitConfig.api));
    }
  }

  /**
   * 请求体解析器配置
   */
  _setupBodyParsers() {
    const limits = cfg.server.limits || {};
    
    this.express.use(express.urlencoded({
      extended: false,
      limit: limits.urlencoded || '10mb'
    }));
    
    this.express.use(express.json({
      limit: limits.json || '10mb'
    }));
    
    this.express.use(express.raw({
      limit: limits.raw || '10mb'
    }));
  }

  /**
   * 信号处理器设置
   */
  _setupSignalHandlers() {
    const closeHandler = async () => await this.closeServer();
    process.on('SIGINT', closeHandler);
    process.on('SIGTERM', closeHandler);
  }

  /**
   * 创建Bot代理对象
   */
  _createProxy() {
    return new Proxy(this.bots, {
      get: (target, prop) => {
        if (target[prop] !== undefined) return target[prop];
        if (this[prop] !== undefined) return this[prop];
        
        const utilValue = BotUtil[prop];
        if (utilValue !== undefined) {
          return typeof utilValue === 'function' ?
            utilValue.bind(BotUtil) : utilValue;
        }
        
        for (const botId of [this.uin.toString(), ...this.uin]) {
          const bot = target[botId];
          if (bot?.[prop] !== undefined) {
            BotUtil.makeLog("trace", `重定向 Bot.${prop} 到 Bot.${botId}.${prop}`);
            return typeof bot[prop] === "function" ?
              bot[prop].bind(bot) : bot[prop];
          }
        }
        
        BotUtil.makeLog("trace", `Bot.${prop} 不存在`);
        return undefined;
      }
    });
  }

  /**
   * 生成API密钥
   */
  async generateApiKey() {
    const apiKeyConfig = cfg.server.auth.apiKey || {};
    
    // 如果明确禁用API密钥，则不生成
    if (apiKeyConfig.enabled === false) {
      BotUtil.makeLog('info', '⚠ API密钥认证已禁用', '服务器');
      return null;
    }
    
    const apiKeyPath = path.join(process.cwd(),
      apiKeyConfig.file || 'config/server_config/api_key.json');
    
    if (fsSync.existsSync(apiKeyPath)) {
      const keyData = JSON.parse(await fs.readFile(apiKeyPath, 'utf8'));
      this.apiKey = keyData.key;
      BotUtil.apiKey = this.apiKey;
      BotUtil.makeLog('info', '✓ 已加载API密钥', '服务器');
      return this.apiKey;
    }
    
    const keyLength = apiKeyConfig.length || 64;
    this.apiKey = BotUtil.randomString(keyLength);
    
    await BotUtil.mkdir(path.dirname(apiKeyPath));
    await fs.writeFile(apiKeyPath, JSON.stringify({
      key: this.apiKey,
      generated: new Date().toISOString(),
      note: '远程访问API密钥'
    }, null, 2), 'utf8');
    
    if (process.platform !== 'win32') {
      await fs.chmod(apiKeyPath, 0o600).catch(() => {});
    }
    
    BotUtil.apiKey = this.apiKey;
    BotUtil.makeLog('success', `⚡ 生成新API密钥：${this.apiKey}`, '服务器');
    return this.apiKey;
  }

  /**
   * 认证中间件
   * 采用nginx风格的location匹配：精确 > 前缀 > 正则 > 默认
   */
  _authMiddleware(req, res, next) {
    // 如果响应已发送，直接跳过
    if (res.headersSent) {
      return next();
    }
    
    req.rid = `${req.ip}:${req.socket.remotePort}`;
    req.sid = `${req.protocol}://${req.hostname}:${req.socket.localPort}${req.originalUrl}`;
    
    const authConfig = cfg.server.auth || {};
    const whitelist = authConfig.whitelist || [
      '/', '/favicon.ico', '/health', '/status', '/robots.txt'
    ];
    
    // ========== 快速路径检查（性能优化） ==========
    // 1. 系统路由（已在前面精确匹配，这里作为兜底）
    const systemRoutes = ['/status', '/health', '/robots.txt', '/favicon.ico'];
    if (systemRoutes.includes(req.path)) {
      return next();
    }
    
    // 2. 静态文件（通过扩展名判断，快速跳过）
    const isStaticFile = /\.(html|css|js|json|png|jpg|jpeg|gif|svg|webp|ico|mp4|webm|mp3|wav|pdf|zip|woff|woff2|ttf|otf)$/i.test(req.path);
    if (isStaticFile && !req.path.startsWith('/api/')) {
      return next();
    }
    
    // ========== 白名单匹配（nginx location风格） ==========
    let isWhitelisted = false;
    
    for (const whitelistPath of whitelist) {
      // 精确匹配（最高优先级）
      if (whitelistPath === req.path) {
        isWhitelisted = true;
        break;
      }
      
      // 前缀匹配（通配符 *）
      if (whitelistPath.endsWith('*')) {
        const prefix = whitelistPath.slice(0, -1);
        if (req.path.startsWith(prefix)) {
          isWhitelisted = true;
          break;
        }
      }
      
      // 目录匹配（以/结尾的路径）
      if (whitelistPath.endsWith('/') && req.path.startsWith(whitelistPath)) {
        isWhitelisted = true;
        break;
      }
    }
    
    if (isWhitelisted) {
      return next();
    }
    
    // ========== 本地连接检查 ==========
    if (this._isLocalConnection(req.ip)) {
      return next();
    }
    
    // ========== 同源Cookie认证（前端UI） ==========
    try {
      const cookies = String(req.headers.cookie || '');
      const hasUiCookie = /(?:^|;\s*)xrk_ui=1(?:;|$)/.test(cookies);
      if (hasUiCookie) {
        const origin = req.headers.origin || '';
        const referer = req.headers.referer || '';
        const host = req.headers.host || '';
        const serverUrl = this.getServerUrl();
        const sameOrigin = (origin && serverUrl && origin.startsWith(serverUrl)) ||
                           (referer && serverUrl && referer.startsWith(serverUrl)) ||
                           (!origin && !referer && !!host);
        if (sameOrigin) {
          return next();
        }
      }
    } catch {}

    // ========== API密钥认证检查 ==========
    if (authConfig.apiKey?.enabled === false) {
      return next();
    }
    
    // 对于API路径，必须通过认证
    if (req.path.startsWith('/api/')) {
      if (!this._checkApiAuthorization(req)) {
        // 再次检查响应状态
        if (!res.headersSent) {
          res.status(401).json({
            success: false,
            message: 'Unauthorized',
            error: '未授权',
            detail: '无效或缺失的API密钥',
            hint: '请提供 X-API-Key 头或 api_key 参数'
          });
        }
        return;
      }
    }
    
    next();
  }

  /**
   * 检查API授权
   */
  _checkApiAuthorization(req) {
    if (!req) return false;
    
    // 如果没有API密钥（认证被禁用），返回true
    if (!this.apiKey) {
      return true;
    }
    
    const authKey = req.headers?.["x-api-key"] ??
      req.headers?.["authorization"]?.replace('Bearer ', '') ??
      req.query?.api_key ??
      req.body?.api_key;
    
    if (!authKey) {
      BotUtil.makeLog("debug", `API认证失败：缺少密钥`, '认证');
      return false;
    }
    
    try {
      const authKeyBuffer = Buffer.from(String(authKey));
      const apiKeyBuffer = Buffer.from(String(this.apiKey));
      
      if (authKeyBuffer.length !== apiKeyBuffer.length) {
        BotUtil.makeLog("warn", `未授权访问来自 ${req.socket?.remoteAddress || req.ip}`, '认证');
        return false;
      }
      
      return crypto.timingSafeEqual(authKeyBuffer, apiKeyBuffer);
      
    } catch (error) {
      BotUtil.makeLog("error", `API认证错误：${error.message}`, '认证');
      return false;
    }
  }

  checkApiAuthorization(req) {
    return this._checkApiAuthorization(req);
  }

  /**
   * 检查是否为本地连接
   */
  _isLocalConnection(address) {
    if (!address || typeof address !== 'string') return false;
    
    const ip = address.toLowerCase().trim()
      .replace(/^::ffff:/, '')
      .replace(/%.+$/, '');
    
    return ip === 'localhost' ||
      ip === '127.0.0.1' ||
      ip === '::1' ||
      this._isPrivateIP(ip);
  }

  /**
   * 检查是否为私有IP
   */
  _isPrivateIP(ip) {
    if (!ip) return false;
    
    const patterns = {
      ipv4: [
        /^10\./,
        /^172\.(1[6-9]|2\d|3[01])\./,
        /^192\.168\./,
        /^127\./
      ],
      ipv6: [
        /^fe80:/i,
        /^fc00:/i,
        /^fd00:/i
      ]
    };
    
    const isIPv4 = ip.includes('.');
    const testPatterns = isIPv4 ? patterns.ipv4 : patterns.ipv6;
    
    return testPatterns.some(pattern => pattern.test(ip));
  }

  /**
   * 状态处理器
   */
  _statusHandler(req, res) {
    if (res.headersSent) return;
    
    const status = {
      status: '运行中',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      timestamp: Date.now(),
      version: process.version,
      platform: process.platform,
      server: {
        httpPort: this.httpPort,
        httpsPort: this.httpsPort,
        actualPort: this.actualPort,
        actualHttpsPort: this.actualHttpsPort,
        https: cfg.server?.https?.enabled || false,
        proxy: this.proxyEnabled,
        domains: this.proxyEnabled ? Array.from(this.domainConfigs.keys()) : []
      },
      auth: {
        apiKeyEnabled: cfg.server?.auth?.apiKey?.enabled !== false,
        whitelist: cfg.server?.auth?.whitelist || []
      }
    };
    
    res.type('json').send(JSON.stringify(status, null, 2));
  }

  /**
   * 健康检查处理器
   */
  _healthHandler(req, res) {
    if (res.headersSent) return;
    
    res.json({
      status: '健康',
      uptime: process.uptime(),
      timestamp: Date.now()
    });
  }

  /**
   * 文件处理器
   */
  _fileHandler(req, res) {
    if (res.headersSent) return;
    
    const url = req.url.replace(/^\//, "");
    let file = this.fs[url];
    
    if (!file) {
      file = this.fs[404];
      if (!file) {
        if (!res.headersSent) {
          return res.status(404).json({ error: '未找到', file: url });
        }
        return;
      }
    }
    
    if (typeof file.times === "number") {
      if (file.times > 0) {
        file.times--;
      } else {
        file = this.fs.timeout;
        if (!file) {
          if (!res.headersSent) {
            return res.status(410).json({
              error: '已过期',
              message: '文件访问次数已达上限'
            });
          }
          return;
        }
      }
    }
    
    // 确保在发送响应前设置头部
    if (!res.headersSent) {
      if (file.type?.mime) {
        res.setHeader("Content-Type", file.type.mime);
      }
      res.setHeader("Content-Length", file.buffer.length);
      res.setHeader("Cache-Control", "no-cache");
      
      BotUtil.makeLog("debug", `文件发送：${file.name} (${BotUtil.formatFileSize(file.buffer.length)})`, '服务器');
      
      res.send(file.buffer);
    }
  }

  /**
   * WebSocket连接处理
   */
  wsConnect(req, socket, head) {
    req.rid = `${req.socket.remoteAddress}:${req.socket.remotePort}-${req.headers["sec-websocket-key"]}`;
    req.sid = `ws://${req.headers.host || `${req.socket.localAddress}:${req.socket.localPort}`}${req.url}`;
    req.query = Object.fromEntries(new URL(req.sid).searchParams.entries());
    
    // WebSocket认证 - 使用相同的白名单和认证逻辑
    const authConfig = cfg.server.auth || {};
    const whitelist = authConfig.whitelist || [];
    
    // 检查WebSocket路径是否在白名单中
    const path = req.url.split("?")[0]; // 去除查询参数
    const isWhitelisted = whitelist.some(whitelistPath => {
      if (whitelistPath === path) return true;
      if (whitelistPath.endsWith('*')) {
        return path.startsWith(whitelistPath.slice(0, -1));
      }
      return false;
    });
    
    // 如果不在白名单且不是本地连接，则需要认证
    if (!isWhitelisted && !this._isLocalConnection(req.socket.remoteAddress)) {
      if (authConfig.apiKey?.enabled !== false && !this._checkApiAuthorization(req)) {
        BotUtil.makeLog("error", `WebSocket认证失败：${req.url}`, '服务器');
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        return socket.destroy();
      }
    }
    
    const wsPath = req.url.split("/")[1];
    if (!(wsPath in this.wsf)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      return socket.destroy();
    }
    
    this.wss.handleUpgrade(req, socket, head, conn => {
      BotUtil.makeLog("debug", `WebSocket连接建立：${req.url}`, '服务器');
      
      conn.on("error", err => BotUtil.makeLog("error", err, '服务器'));
      conn.on("close", () => BotUtil.makeLog("debug", `WebSocket断开：${req.url}`, '服务器'));
      
      conn.on("message", msg => {
        const logMsg = Buffer.isBuffer(msg) && msg.length > 1024 ?
          `[二进制消息，长度：${msg.length}]` : BotUtil.String(msg);
        BotUtil.makeLog("trace", `WS消息：${logMsg}`, '服务器');
      });
      
      conn.sendMsg = msg => {
        if (!Buffer.isBuffer(msg)) msg = BotUtil.String(msg);
        BotUtil.makeLog("trace", `WS发送：${msg}`, '服务器');
        return conn.send(msg);
      };
      
      for (const handler of this.wsf[wsPath]) {
        handler(conn, req, socket, head);
      }
    });
  }

  /**
   * 处理端口已占用错误
   */
  async serverEADDRINUSE(err, isHttps) {
    const serverType = isHttps ? 'HTTPS' : 'HTTP';
    const port = isHttps ? this.httpsPort : this.httpPort;
    
    BotUtil.makeLog("error", `${serverType}端口 ${port} 已被占用`, '服务器');
    
    const retryKey = isHttps ? 'https_retry_count' : 'http_retry_count';
    this[retryKey] = (this[retryKey] || 0) + 1;
    
    await BotUtil.sleep(this[retryKey] * 1000);
    
    const server = isHttps ? this.httpsServer : this.server;
    const host = cfg.server.server.host || '0.0.0.0';
    
    if (server) {
      server.listen(port, host);
    }
  }

  /**
   * 服务器加载完成
   */
  async serverLoad(isHttps) {
    const server = isHttps ? this.httpsServer : this.server;
    const port = isHttps ? this.httpsPort : this.httpPort;
    const host = cfg.server.server.host || '0.0.0.0';
    
    if (!server) return;
    
    server.listen(port, host);
    
    await BotUtil.promiseEvent(server, "listening", isHttps && "error").catch(() => { });
    
    const serverInfo = server.address();
    if (!serverInfo) {
      BotUtil.makeLog('error', `${isHttps ? 'HTTPS' : 'HTTP'}服务器启动失败`, '服务器');
      return;
    }
    
    if (isHttps) {
      this.httpsPort = serverInfo.port;
    } else {
      this.httpPort = serverInfo.port;
    }
    
    const protocol = isHttps ? 'https' : 'http';
    const serverType = isHttps ? 'HTTPS' : 'HTTP';
    
    BotUtil.makeLog("info", `✓ ${serverType}服务器监听在 ${host}:${serverInfo.port}`, '服务器');
    
    if (!isHttps && !this.proxyEnabled) {
      await this._displayAccessUrls(protocol, serverInfo.port);
    }
  }

  /**
   * 启动代理服务器
   */
  async startProxyServers() {
    const proxyConfig = cfg.server.proxy;
    if (!proxyConfig?.enabled) return;
    
    const httpPort = proxyConfig.httpPort || 80;
    const host = cfg.server.server.host || '0.0.0.0';
    
    // 启动HTTP代理服务器
    this.proxyServer.listen(httpPort, host);
    await BotUtil.promiseEvent(this.proxyServer, "listening").catch(() => { });
    
    BotUtil.makeLog('info', `✓ HTTP代理服务器监听在 ${host}:${httpPort}`, '代理');
    
    // 启动HTTPS代理服务器（如果有）
    if (this.proxyHttpsServer) {
      const httpsPort = proxyConfig.httpsPort || 443;
      this.proxyHttpsServer.listen(httpsPort, host);
      await BotUtil.promiseEvent(this.proxyHttpsServer, "listening").catch(() => { });
      
      BotUtil.makeLog('info', `✓ HTTPS代理服务器监听在 ${host}:${httpsPort}`, '代理');
    }
    
    await this._displayProxyInfo();
  }

  /**
   * 显示代理信息
   */
  async _displayProxyInfo() {
    console.log(chalk.cyan('\n╔════════════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan('║') + chalk.yellow.bold('                  反向代理服务器配置信息                    ') + chalk.cyan('║'));
    console.log(chalk.cyan('╚════════════════════════════════════════════════════════════╝\n'));
    
    console.log(chalk.cyan('▶ 代理域名：'));
    
    const proxyConfig = cfg.server.proxy;
    const domains = proxyConfig?.domains || [];
    
    for (const domainConfig of domains) {
      const protocol = domainConfig.ssl?.enabled ? 'https' : 'http';
      const port = protocol === 'https' ? 
        (proxyConfig.httpsPort || 443) : 
        (proxyConfig.httpPort || 80);
      const displayPort = (port === 80 && protocol === 'http') || 
                          (port === 443 && protocol === 'https') ? '' : `:${port}`;
      
      console.log(chalk.yellow(`    ${domainConfig.domain}：`));
      console.log(`      ${chalk.cyan('•')} 访问地址：${chalk.white(`${protocol}://${domainConfig.domain}${displayPort}`)}`);
      
      if (domainConfig.target) {
        console.log(`      ${chalk.cyan('•')} 代理目标：${chalk.gray(domainConfig.target)}`);
      } else {
        console.log(`      ${chalk.cyan('•')} 代理目标：${chalk.gray(`本地服务端口 ${this.actualPort}`)}`);
      }
      
      if (domainConfig.staticRoot) {
        console.log(`      ${chalk.cyan('•')} 静态目录：${chalk.gray(domainConfig.staticRoot)}`);
      }
      
      if (domainConfig.rewritePath) {
        console.log(`      ${chalk.cyan('•')} 路径重写：${chalk.gray(`${domainConfig.rewritePath.from} → ${domainConfig.rewritePath.to}`)}`);
      }
    }
    
    console.log(chalk.yellow('\n▶ 本地服务：'));
    console.log(`    ${chalk.cyan('•')} HTTP：${chalk.white(`http://localhost:${this.actualPort}`)}`);
    if (this.actualHttpsPort) {
      console.log(`    ${chalk.cyan('•')} HTTPS：${chalk.white(`https://localhost:${this.actualHttpsPort}`)}`);
    }
    
    const authConfig = cfg.server.auth || {};
    if (authConfig.apiKey?.enabled !== false) {
      console.log(chalk.yellow('\n▶ API密钥：'));
      console.log(`    ${chalk.cyan('•')} ${chalk.white(this.apiKey)}`);
      console.log(chalk.gray(`    使用 X-API-Key 请求头进行认证`));
    }
    
    if (authConfig.whitelist?.length) {
      console.log(chalk.yellow('\n▶ 白名单路径：'));
      authConfig.whitelist.forEach(path => {
        console.log(`    ${chalk.cyan('•')} ${chalk.white(path)}`);
      });
      console.log('\n');
    }
  }

  /**
   * 显示访问地址
   */
  async _displayAccessUrls(protocol, port) {
    const addresses = [`${protocol}://localhost:${port}`];
    
    const ipInfo = await this.getLocalIpAddress();
    
    console.log(chalk.cyan('\n▶ 访问地址：'));
    
    if (ipInfo.local.length > 0) {
      console.log(chalk.yellow('  本地网络：'));
      ipInfo.local.forEach(info => {
        const url = `${protocol}://${info.ip}:${port}`;
        const label = info.primary ? chalk.green(' ★') : '';
        const interfaceInfo = chalk.gray(` [${info.interface}]`);
        console.log(`    ${chalk.cyan('•')} ${chalk.white(url)}${interfaceInfo}${label}`);
        addresses.push(url);
      });
    }
    
    if (ipInfo.public && cfg.server?.misc?.detectPublicIP !== false) {
      console.log(chalk.yellow('\n  公网访问：'));
      const publicUrl = `${protocol}://${ipInfo.public}:${port}`;
      console.log(`    ${chalk.cyan('•')} ${chalk.white(publicUrl)}`);
    }
    
    if (cfg.server.server.url) {
      console.log(chalk.yellow('\n  配置域名：'));
      const configUrl = cfg.server.server.url.startsWith('http') ? 
        cfg.server.server.url : 
        `${protocol}://${cfg.server.server.url}`;
      console.log(`    ${chalk.cyan('•')} ${chalk.white(`${configUrl}:${port}`)}`);
    }
    
    const authConfig = cfg.server.auth || {};
    if (authConfig.apiKey?.enabled !== false) {
      console.log(chalk.yellow('\n  API密钥：'));
      console.log(`    ${chalk.cyan('•')} ${chalk.white(this.apiKey)}`);
      console.log(chalk.gray(`    使用 X-API-Key 请求头`));
    }
    
    if (authConfig.whitelist?.length) {
      console.log(chalk.yellow('\n  白名单路径：'));
      authConfig.whitelist.forEach(path => {
        console.log(`    ${chalk.cyan('•')} ${chalk.white(path)}`);
      });
    }
  }

  /**
   * 加载HTTPS服务器
   * 支持HTTP/2和现代TLS配置
   */
  async httpsLoad() {
    const httpsConfig = cfg.server.https;
    
    if (!httpsConfig.enabled) {
      return;
    }
    
    let httpsOptions = {};
    
    if (httpsConfig?.certificate) {
      const cert = httpsConfig.certificate;
      
      if (!cert.key || !cert.cert) {
        throw new Error("HTTPS已启用但未配置证书");
      }
      
      if (!fsSync.existsSync(cert.key)) {
        throw new Error(`HTTPS密钥文件不存在：${cert.key}`);
      }
      
      if (!fsSync.existsSync(cert.cert)) {
        throw new Error(`HTTPS证书文件不存在：${cert.cert}`);
      }
      
      httpsOptions = {
        key: await fs.readFile(cert.key),
        cert: await fs.readFile(cert.cert),
        allowHTTP1: true
      };
      
      if (cert.ca && fsSync.existsSync(cert.ca)) {
        httpsOptions.ca = await fs.readFile(cert.ca);
      }
    }
    
    const tlsConfig = httpsConfig?.tls || {};
    
    if (tlsConfig.minVersion) {
      httpsOptions.minVersion = tlsConfig.minVersion;
    } else {
      httpsOptions.minVersion = 'TLSv1.2';
    }
    
    if (tlsConfig.maxVersion) {
      httpsOptions.maxVersion = tlsConfig.maxVersion;
    }
    
    if (tlsConfig.ciphers) {
      httpsOptions.ciphers = tlsConfig.ciphers;
    } else {
      httpsOptions.ciphers = [
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-ECDSA-CHACHA20-POLY1305',
        'ECDHE-RSA-CHACHA20-POLY1305'
      ].join(':');
    }
    
    httpsOptions.honorCipherOrder = true;
    httpsOptions.secureProtocol = 'TLSv1_2_method';
    
    if (tlsConfig.http2 === true) {
      try {
        const http2 = await import('http2');
        const { createSecureServer } = http2;
        
        httpsOptions.allowHTTP1 = true;
        this.httpsServer = createSecureServer(httpsOptions, this.express)
          .on("error", err => this._handleServerError(err, true))
          .on("upgrade", this.wsConnect.bind(this));
        
        BotUtil.makeLog("info", "✓ HTTPS服务器已启动（HTTP/2支持）", '服务器');
      } catch (err) {
        BotUtil.makeLog("warn", `HTTP/2不可用，回退到HTTP/1.1: ${err.message}`, '服务器');
        this.httpsServer = https.createServer(httpsOptions, this.express)
          .on("error", err => this._handleServerError(err, true))
          .on("upgrade", this.wsConnect.bind(this));
      }
    } else {
      this.httpsServer = https.createServer(httpsOptions, this.express)
        .on("error", err => this._handleServerError(err, true))
        .on("upgrade", this.wsConnect.bind(this));
    }
    
    await this.serverLoad(true);
    
    if (tlsConfig.http2 !== true) {
      BotUtil.makeLog("info", "✓ HTTPS服务器已启动", '服务器');
    }
  }

  /**
   * 设置最终处理器
   * 按照nginx风格：先处理API 404，再处理静态文件404
   */
  _setupFinalHandlers() {
    // API路由404处理（在ApiLoader.register之后，但先于全局404）
    // 这个已经在ApiLoader中处理了，这里作为兜底
    
    // 全局404处理（最后匹配）
    this.express.use((req, res) => {
      // 如果响应已发送，直接返回
      if (res.headersSent) {
        return;
      }
      
      // API请求返回JSON格式404
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({
          success: false,
          error: '未找到',
          message: 'API endpoint not found',
          path: req.originalUrl,
          timestamp: Date.now()
        });
      }
      
      // 静态文件请求返回HTML或重定向
      let defaultRoute = cfg.server.misc.defaultRoute || '/';
      if (req.domainConfig?.defaultRoute) {
        defaultRoute = req.domainConfig.defaultRoute;
      }
      
      if (req.accepts('html')) {
        const staticRoot = req.staticRoot || path.join(process.cwd(), 'www');
        const custom404Path = path.join(staticRoot, '404.html');
        
        if (fsSync.existsSync(custom404Path)) {
          res.status(404).sendFile(custom404Path);
        } else {
          res.redirect(defaultRoute);
        }
      } else {
        res.status(404).json({
          error: '未找到',
          path: req.path,
          timestamp: Date.now()
        });
      }
    });
    
    // 全局错误处理（捕获所有未处理的错误）
    this.express.use((err, req, res, next) => {
      // 如果响应已发送，传递给下一个错误处理器或直接返回
      if (res.headersSent) {
        return next(err);
      }
      
      const isApiRequest = req.path.startsWith('/api/');
      
      BotUtil.makeLog('error', `请求错误 [${req.requestId || 'unknown'}]: ${err.message}`, '服务器', err);
      
      if (isApiRequest) {
        res.status(err.status || 500).json({
          success: false,
          error: '内部服务器错误',
          message: process.env.NODE_ENV === 'production' ?
            '发生了一个错误' : err.message,
          requestId: req.requestId,
          timestamp: Date.now()
        });
      } else {
        res.status(err.status || 500).json({
          error: '内部服务器错误',
          message: process.env.NODE_ENV === 'production' ?
            '发生了一个错误' : err.message,
          timestamp: Date.now()
        });
      }
    });
  }

  /**
   * 关闭服务器
   */
  async closeServer() {
    BotUtil.makeLog('info', '⏳ 正在关闭服务器...', '服务器');
    
    const servers = [
      this.server,
      this.httpsServer,
      this.proxyServer,
      this.proxyHttpsServer
    ].filter(Boolean);
    
    await Promise.all(servers.map(server =>
      new Promise(resolve => server.close(resolve))
    ));
    
    await BotUtil.sleep(2000);
    await this.redisExit();
    
    BotUtil.makeLog('info', '✓ 服务器已关闭', '服务器');
  }

  /**
   * 获取服务器URL
   */
  getServerUrl() {
    if (this.proxyEnabled && cfg.server.proxy.domains[0]) {
      const domain = cfg.server.proxy.domains[0];
      const protocol = domain.ssl?.enabled ? 'https' : 'http';
      return `${protocol}://${domain.domain}`;
    }
    
      const protocol = cfg.server.https.enabled ? 'https' : 'http';
    const port = protocol === 'https' ? this.actualHttpsPort : this.actualPort;
      const host = cfg.server.server.url || 'localhost';
    
    const needPort = (protocol === 'http' && port !== 80) ||
                     (protocol === 'https' && port !== 443);
    
    return `${protocol}://${host}${needPort ? ':' + port : ''}`;
  }

  /**
   * 获取本地IP地址
   */
  async getLocalIpAddress() {
    const cacheKey = 'local_ip_addresses';
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;
    
    const result = {
      local: [],
      public: null,
      primary: null
    };
    
    try {
      const interfaces = os.networkInterfaces();
      
      for (const [name, ifaces] of Object.entries(interfaces)) {
        if (name.toLowerCase().includes('lo')) continue;
        
        for (const iface of ifaces) {
          if (iface.family !== 'IPv4' || iface.internal) continue;
          
          result.local.push({
            ip: iface.address,
            interface: name,
            mac: iface.mac,
            virtual: this._isVirtualInterface(name, iface.mac)
          });
        }
      }
      
      try {
        result.primary = await this._getIpByUdp();
        const existingItem = result.local.find(item => item.ip === result.primary);
        if (existingItem) {
          existingItem.primary = true;
        }
      } catch { }
      
      if (cfg.server.misc.detectPublicIP !== false) {
        result.public = await this._getPublicIP();
      }
      
      this._cache.set(cacheKey, result);
      return result;
      
    } catch (err) {
      BotUtil.makeLog("debug", `获取IP地址失败：${err.message}`, '服务器');
      return result;
    }
  }

  /**
   * 检查是否为虚拟网卡
   */
  _isVirtualInterface(name, mac) {
    const virtualPatterns = [
      /^(docker|br-|veth|virbr|vnet)/i,
      /^(vmnet|vmware)/i,
      /^(vboxnet|virtualbox)/i
    ];
    
    return virtualPatterns.some(p => p.test(name));
  }

  /**
   * 通过UDP获取IP
   */
  async _getIpByUdp() {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('UDP超时'));
      }, 3000);
      
      try {
        socket.connect(80, '223.5.5.5', () => {
          clearTimeout(timeout);
          const address = socket.address();
          socket.close();
          resolve(address.address);
        });
      } catch (err) {
        clearTimeout(timeout);
        socket.close();
        reject(err);
      }
    });
  }

  /**
   * 获取公网IP
   */
  async _getPublicIP() {
    const apis = [
      { url: 'https://api.ipify.org?format=json', field: 'ip' },
      { url: 'https://api.myip.la/json', field: 'ip' }
    ];
    
    for (const api of apis) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        
        const response = await fetch(api.url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        clearTimeout(timeout);
        
        if (response.ok) {
          const data = await response.json();
          const ip = data[api.field];
          if (ip && this._isValidIP(ip)) return ip;
        }
      } catch {
        continue;
      }
    }
    
    return null;
  }

  /**
   * 验证IP地址格式
   */
  _isValidIP(ip) {
    if (!ip) return false;
    
    const ipv4Regex = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
    return ipv4Regex.test(ip);
  }

  /**
   * 主运行函数
   */
  async run(options = {}) {
    const { port } = options;
    
    const proxyConfig = cfg.server.proxy;
    this.proxyEnabled = proxyConfig?.enabled === true;
    
    // 设置端口
    this.actualPort = port || 2537;
    this.actualHttpsPort = this.actualPort + 1;
    
    if (this.proxyEnabled) {
      this.httpPort = proxyConfig.httpPort || 80;
      this.httpsPort = proxyConfig.httpsPort || 443;
    } else {
      this.httpPort = this.actualPort;
      this.httpsPort = this.actualHttpsPort;
    }
    
    console.log(chalk.cyan('╔════════════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan('║') + chalk.yellow.bold('               葵子正在初始化http服务器...                  ') + chalk.cyan('║'));
    console.log(chalk.cyan('╚════════════════════════════════════════════════════════════╝'));
    
    if (this.proxyEnabled) {
      BotUtil.makeLog('info', '⚡ 反向代理模式已启用', '服务器');
      BotUtil.makeLog('info', `服务端口：${this.actualPort} (HTTP), ${this.actualHttpsPort} (HTTPS)`, '服务器');
      BotUtil.makeLog('info', `代理端口：${this.httpPort} (HTTP), ${this.httpsPort} (HTTPS)`, '服务器');
      
      await this._initProxyApp();
    } else {
      BotUtil.makeLog('info', `端口：${this.httpPort} (HTTP), ${this.httpsPort} (HTTPS)`, '服务器');
    }
    
    // 阶段1: 初始化基础服务（必须顺序执行）
    await Packageloader();
    await this.generateApiKey();
    
    // 阶段2: 并行加载配置和模块（无依赖关系，可并行）
    const ConfigLoader = (await import('./commonconfig/loader.js')).default;
    
    const [configResult, streamResult, pluginsResult, apiResult] = await Promise.allSettled([
      ConfigLoader.load(),
      StreamLoader.load(),
      PluginsLoader.load(),
      ApiLoader.load()
    ]);
    
    // 处理加载结果
    if (configResult.status === 'fulfilled') {
      global.ConfigManager = ConfigLoader;
      // 确保 cfg 在 global 中可用，供 ConfigBase 使用
      if (!global.cfg && typeof cfg !== 'undefined') {
        global.cfg = cfg;
      }
    } else {
      BotUtil.makeLog('error', `配置加载失败: ${configResult.reason?.message}`, '服务器');
    }
    
    if (streamResult.status === 'rejected') {
      BotUtil.makeLog('error', `工作流加载失败: ${streamResult.reason?.message}`, '服务器');
    }
    
    if (pluginsResult.status === 'rejected') {
      BotUtil.makeLog('error', `插件加载失败: ${pluginsResult.reason?.message}`, '服务器');
    }
    
    if (apiResult.status === 'rejected') {
      BotUtil.makeLog('error', `API加载失败: ${apiResult.reason?.message}`, '服务器');
    }
    
    // 阶段3: 初始化中间件和路由（依赖配置）
    this._initializeMiddlewareAndRoutes();
    
    // 阶段4: 注册API（依赖中间件）
    await ApiLoader.register(this.express, this);
    
    this._setupFinalHandlers();
    
    // 启动主服务
    const originalHttpPort = this.httpPort;
    const originalHttpsPort = this.httpsPort;
    
    if (this.proxyEnabled) {
      this.httpPort = this.actualPort;
      this.httpsPort = this.actualHttpsPort;
    }
    
    await this.serverLoad(false);
    
    if (cfg.server.https.enabled) {
      await this.httpsLoad();
    }
    
    // 启动代理服务器
    if (this.proxyEnabled) {
      this.httpPort = originalHttpPort;
      this.httpsPort = originalHttpsPort;
      await this.startProxyServers();
    }
    
    await ListenerLoader.load();
    await ApiLoader.watch(true);
    
    if (Object.keys(this.wsf).length > 0) {
      BotUtil.makeLog("info", `⚡ WebSocket服务：${this.getServerUrl().replace(/^http/, "ws")}/ [${Object.keys(this.wsf).join(', ')}]`, '服务器');
    }
    
    this.emit("online", {
      bot: this,
      timestamp: Date.now(),
      url: this.getServerUrl(),
      uptime: process.uptime(),
      apis: ApiLoader.getApiList(),
      proxyEnabled: this.proxyEnabled
    });
  }

  prepareEvent(data) {
    if (!this.bots[data.self_id]) return;
    
    if (!data.bot) {
      Object.defineProperty(data, "bot", {
        value: this.bots[data.self_id]
      });
    }
    
    if (data.user_id) {
      if (!data.friend) {
        Object.defineProperty(data, "friend", {
          value: data.bot.pickFriend(data.user_id)
        });
      }
      data.sender ||= { user_id: data.user_id };
      data.sender.nickname ||= data.friend?.nickname;
    }
    
    if (data.group_id) {
      if (!data.group) {
        Object.defineProperty(data, "group", {
          value: data.bot.pickGroup(data.group_id)
        });
      }
      data.group_name ||= data.group?.name;
    }
    
    if (data.group && data.user_id) {
      if (!data.member) {
        Object.defineProperty(data, "member", {
          value: data.group.pickMember(data.user_id)
        });
      }
      data.sender.nickname ||= data.member?.nickname;
      data.sender.card ||= data.member?.card;
    }
    
    if (data.bot.adapter?.id) data.adapter_id = data.bot.adapter.id;
    if (data.bot.adapter?.name) data.adapter_name = data.bot.adapter.name;
    
    this._extendEventMethods(data);
  }

  _extendEventMethods(data) {
    for (const target of [data.friend, data.group, data.member]) {
      if (!target || typeof target !== "object") continue;
      
      target.sendFile ??= (file, name) =>
        target.sendMsg(segment.file(file, name));
      target.makeForwardMsg ??= this.makeForwardMsg;
      target.sendForwardMsg ??= msg =>
        this.sendForwardMsg(msg => target.sendMsg(msg), msg);
      target.getInfo ??= () => target.info || target;
    }
    
    if (!data.reply) {
      data.reply = data.group?.sendMsg?.bind(data.group) ||
        data.friend?.sendMsg?.bind(data.friend);
    }
  }

  em(name = "", data = {}) {
    this.prepareEvent(data);
    
    while (name) {
      this.emit(name, data);
      const lastDot = name.lastIndexOf(".");
      if (lastDot === -1) break;
      name = name.slice(0, lastDot);
    }
  }

  getFriendArray() {
    const array = []
    for (const bot_id of this.uin)
      for (const [id, i] of this.bots[bot_id].fl || []) array.push({ ...i, bot_id })
    return array
  }

  getFriendList() {
    const array = []
    for (const bot_id of this.uin) array.push(...(this.bots[bot_id].fl?.keys() || []))
    return array
  }

  getFriendMap() {
    const map = new Map()
    for (const bot_id of this.uin)
      for (const [id, i] of this.bots[bot_id].fl || []) map.set(id, { ...i, bot_id })
    return map
  }
  
  get fl() {
    return this.getFriendMap()
  }

  getGroupArray() {
    const array = []
    for (const bot_id of this.uin)
      for (const [id, i] of this.bots[bot_id].gl || []) array.push({ ...i, bot_id })
    return array
  }

  getGroupList() {
    const array = []
    for (const bot_id of this.uin) array.push(...(this.bots[bot_id].gl?.keys() || []))
    return array
  }

  getGroupMap() {
    const map = new Map()
    for (const bot_id of this.uin)
      for (const [id, i] of this.bots[bot_id].gl || []) map.set(id, { ...i, bot_id })
    return map
  }
  
  get gl() {
    return this.getGroupMap()
  }
  
  get gml() {
    const map = new Map()
    for (const bot_id of this.uin)
      for (const [id, i] of this.bots[bot_id].gml || [])
        map.set(id, Object.assign(new Map(i), { bot_id }))
    return map
  }

  pickFriend(user_id, strict) {
    user_id = Number(user_id) || user_id;
    
    const mainBot = this.bots[this.uin];
    if (mainBot?.fl?.has(user_id)) {
      return mainBot.pickFriend(user_id);
    }
    
    const friend = this.fl.get(user_id);
    if (friend) {
      return this.bots[friend.bot_id].pickFriend(user_id);
    }
    
    if (strict) return false;
    
    BotUtil.makeLog("trace", `用户 ${user_id} 不存在，使用随机Bot ${this.uin.toJSON()}`, '服务器');
    return this.bots[this.uin].pickFriend(user_id);
  }

  get pickUser() {
    return this.pickFriend;
  }

  pickGroup(group_id, strict) {
    group_id = Number(group_id) || group_id;
    
    const mainBot = this.bots[this.uin];
    if (mainBot?.gl?.has(group_id)) {
      return mainBot.pickGroup(group_id);
    }
    
    const group = this.gl.get(group_id);
    if (group) {
      return this.bots[group.bot_id].pickGroup(group_id);
    }
    
    if (strict) return false;
    
    BotUtil.makeLog("trace", `群组 ${group_id} 不存在，使用随机Bot ${this.uin.toJSON()}`, '服务器');
    return this.bots[this.uin].pickGroup(group_id);
  }

  pickMember(group_id, user_id) {
    return this.pickGroup(group_id).pickMember(user_id);
  }

  async sendFriendMsg(bot_id, user_id, ...args) {
    if (!bot_id) {
      return this.pickFriend(user_id).sendMsg(...args);
    }
    
    if (this.uin.includes(bot_id) && this.bots[bot_id]) {
      return this.bots[bot_id].pickFriend(user_id).sendMsg(...args);
    }
    
    return new Promise((resolve, reject) => {
      const listener = data => {
        resolve(data.bot.pickFriend(user_id).sendMsg(...args));
        clearTimeout(timeout);
      };
      
      const timeout = setTimeout(() => {
        reject(Object.assign(Error("等待Bot上线超时"),
          { bot_id, user_id, args }));
        this.off(`connect.${bot_id}`, listener);
      }, 300000);
      
      this.once(`connect.${bot_id}`, listener);
    });
  }

  async sendGroupMsg(bot_id, group_id, ...args) {
    if (!bot_id) {
      return this.pickGroup(group_id).sendMsg(...args);
    }
    
    if (this.uin.includes(bot_id) && this.bots[bot_id]) {
      return this.bots[bot_id].pickGroup(group_id).sendMsg(...args);
    }
    
    return new Promise((resolve, reject) => {
      const listener = data => {
        resolve(data.bot.pickGroup(group_id).sendMsg(...args));
        clearTimeout(timeout);
      };
      
      const timeout = setTimeout(() => {
        reject(Object.assign(Error("等待Bot上线超时"),
          { bot_id, group_id, args }));
        this.off(`connect.${bot_id}`, listener);
      }, 300000);
      
      this.once(`connect.${bot_id}`, listener);
    });
  }

  async sendMasterMsg(msg, sleep = 5000) {
    const masterQQs = cfg.masterQQ;
    if (!masterQQs?.length) {
      throw new Error("未配置主人QQ");
    }
    
    const results = {};
    
    for (let i = 0; i < masterQQs.length; i++) {
      const user_id = masterQQs[i];
      
      try {
        const friend = this.pickFriend(user_id);
        if (friend?.sendMsg) {
          results[user_id] = await friend.sendMsg(msg);
          BotUtil.makeLog("debug", `已发送消息给主人 ${user_id}`, '服务器');
        } else {
          results[user_id] = { error: "没有可用的Bot" };
          BotUtil.makeLog("warn", `无法向主人 ${user_id} 发送消息`, '服务器');
        }
        
        if (sleep && i < masterQQs.length - 1) {
          await BotUtil.sleep(sleep);
        }
      } catch (err) {
        results[user_id] = { error: err.message };
        BotUtil.makeLog("error", `向主人 ${user_id} 发送消息失败：${err.message}`, '服务器');
      }
    }
    
    return results;
  }

  makeForwardMsg(msg) {
    return { type: "node", data: msg };
  }
  
  makeForwardArray(msg = [], node = {}) {
    return this.makeForwardMsg((Array.isArray(msg) ? msg : [msg]).map(message => ({ ...node, message })));
  }

  async sendForwardMsg(send, msg) {
    const messages = Array.isArray(msg) ? msg : [msg];
    return Promise.all(messages.map(({ message }) => send(message)));
  }

  async redisExit() {
    if (!(typeof redis === 'object' && redis.process)) return false;
    
    const process = redis.process;
    delete redis.process;
    
    await BotUtil.sleep(5000, redis.save().catch(() => { }));
    return process.kill();
  }

  async fileToUrl(file, opts = {}) {
    return await BotUtil.fileToUrl(file, opts);
  }
}