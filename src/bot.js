import path from 'path';
import fs from 'node:fs/promises';
import * as fsSync from 'fs';
import { EventEmitter } from "events";
import express from "express";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import dgram from 'node:dgram';
import { WebSocketServer } from "ws";
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import os from 'node:os';
import chalk from 'chalk';
import { createProxyMiddleware } from 'http-proxy-middleware';

import PluginsLoader from "#infrastructure/plugins/loader.js";
import ListenerLoader from "#infrastructure/listener/loader.js";
import ApiLoader from "#infrastructure/http/loader.js";
import Packageloader from "#infrastructure/config/loader.js";
import StreamLoader from "#infrastructure/aistream/loader.js";
import BotUtil from '#utils/botutil.js';
import cfg from '#infrastructure/config/config.js';
import paths from '#utils/paths.js';
import { errorHandler, ErrorCodes } from '#utils/error-handler.js';
import HTTPBusinessLayer from '#utils/http-business.js';

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
    // Tasker 列表（原 adapter 列表）
    this.tasker = [];
    this.uin = this._createUinManager();
    
    // Express应用和服务器
    this.express = Object.assign(express(), { skip_auth: [], quiet: [] });
    this.server = null;
    this.httpsServer = null;
    this.wss = new WebSocketServer({ 
      noServer: true,
      perMessageDeflate: {
        zlibDeflateOptions: {
          chunkSize: 1024,
          memLevel: 7,
          level: 3
        },
        zlibInflateOptions: {
          chunkSize: 10 * 1024
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
        threshold: 1024
      },
      maxPayload: 100 * 1024 * 1024, // 100MB
      clientTracking: true
    });
    this.wsf = Object.create(null);
    this.fs = Object.create(null);
    
    // WebSocket连接管理
    this._wsConnections = new Map(); // 连接池
    this._wsHeartbeatInterval = null;
    
    // 配置属性
    this.apiKey = '';
    this._cache = BotUtil.getMap('core_cache', { ttl: 60000, autoClean: true });
    this._rateLimiters = new Map();
    this.httpPort = null;
    this.httpsPort = null;
    this.actualPort = null;
    this.actualHttpsPort = null;
    const configuredUrl = typeof cfg.server?.server?.url === 'string' ? cfg.server.server.url.trim() : '';
    this.url = configuredUrl;
    
    // 反向代理相关
    this.proxyEnabled = false;
    this.proxyApp = null;
    this.proxyServer = null;
    this.proxyHttpsServer = null;
    this.proxyMiddlewares = new Map();
    this.domainConfigs = new Map();
    this.sslContexts = new Map();
    
    this.httpBusiness = new HTTPBusinessLayer(cfg.server);
    
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

    // 使用Node.js 24.12 Error.isError()进行可靠的错误类型判断
    if (Error.isError ? Error.isError(message) : message instanceof Error) {
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

    BotUtil.makeLog('error', chalk.red(`✗ ${logMessage}${logDetails}`), type);

    if (error.stack && cfg.debug) {
      BotUtil.makeLog('debug', chalk.gray(error.stack), type);
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
    errorHandler.handle(
      err,
      { context: isHttps ? 'HTTPS服务器' : 'HTTP服务器', code: ErrorCodes.SYSTEM_ERROR },
      true
    );
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
          // debug: 路径重写是技术细节
          BotUtil.makeLog('debug', `路径重写：${req.path} → ${newPath}`, '代理');
        }
      }
      
      if (domainConfig.target) {
        const upstream = this.httpBusiness.selectProxyUpstream(
          hostname,
          domainConfig.loadBalance || 'round-robin'
        );
        
        const targetUrl = upstream?.url || domainConfig.target;
        
        let middleware = this.proxyMiddlewares.get(`${domainConfig.domain}-${targetUrl}`);
        if (!middleware) {
          const configWithUpstream = { ...domainConfig, target: targetUrl };
          middleware = this._createProxyMiddleware(configWithUpstream);
          this.proxyMiddlewares.set(`${domainConfig.domain}-${targetUrl}`, middleware);
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
          errorHandler.handle(
            err,
            { context: 'proxy', hostname, code: ErrorCodes.NETWORK_ERROR },
            true
          );
          BotUtil.makeLog('error', `代理错误 [${hostname}]: ${err.message}`, '代理');
          
          this.httpBusiness.markProxyFailure(hostname, `http://127.0.0.1:${targetPort}`);
          
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
      
      // 优化 CA 证书加载
      let caCert = undefined;
      if (cert.ca) {
        try {
          if (fsSync.statSync(cert.ca).isFile()) {
            caCert = await fs.readFile(cert.ca);
            BotUtil.makeLog('debug', `已加载CA证书：${cert.ca}`, '代理');
          }
        } catch (error) {
          BotUtil.makeLog('debug', `CA证书文件不存在或无法访问：${cert.ca}，跳过`, '代理');
        }
      }
      
      const context = tls.createSecureContext({
        key: await fs.readFile(cert.key),
        cert: await fs.readFile(cert.cert),
        ca: caCert,
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
          
          if (domainConfig.target) {
            this.httpBusiness.markProxyFailure(domainConfig.domain, domainConfig.target);
          }
          
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
  async _initializeMiddlewareAndRoutes() {
    // ========== 第一阶段：全局中间件（所有请求） ==========
    // 1. 请求追踪和基础信息
    this.express.use((req, res, next) => {
      req.startTime = Date.now();
      req.requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      next();
    });
    
    // 2. 压缩中间件（优先处理，减少传输，支持brotli）
    if (cfg.server.compression.enabled !== false) {
      // 使用标准compression中间件，Node.js 24+原生支持brotli（自动选择）
      this.express.use(compression({
        filter: (req, res) => {
          // 跳过压缩的情况
          if (req.headers['x-no-compression']) return false;
          
          // API请求：只压缩JSON和文本
          if (req.path.startsWith('/api/')) {
            const contentType = res.getHeader('content-type') || '';
            return compression.filter(req, res) && 
                   (contentType.includes('json') || contentType.includes('text'));
          }
          
          // 静态文件：使用标准过滤
          return compression.filter(req, res);
        },
        level: cfg.server.compression.level || 6,
        threshold: cfg.server.compression.threshold || 1024
        // Node.js 24+ 的compression中间件会自动检测客户端支持的编码
        // 如果客户端支持brotli，会自动使用brotli（更好的压缩比）
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
    
    this.express.use((req, res, next) => {
      if (this.httpBusiness.handleRedirect(req, res)) {
        return;
      }
      next();
    });
    
    // ========== 第三阶段：精确路由匹配（优先级最高） ==========
    // 系统路由（精确匹配，无需认证）
    this.express.get('/status', this._statusHandler.bind(this));
    this.express.get('/health', this._healthHandler.bind(this));
    this.express.get('/metrics', this._metricsHandler.bind(this)); // 性能指标
    this.express.get('/robots.txt', this._handleRobotsTxt.bind(this));
    this.express.get('/favicon.ico', this._handleFavicon.bind(this));
    
    // ========== 第四阶段：前缀路由匹配 ==========
    // 文件服务路由（/File前缀）
    this.express.use('/File', this._fileHandler.bind(this));
    
    // ========== 第五阶段：认证中间件（API和受保护资源） ==========
    // 认证中间件（对需要认证的路径生效）
    this.express.use(this._authMiddleware.bind(this));
    
    // ========== 第六阶段：UI Cookie设置（同源前端） ==========
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

    // ========== 第七阶段：数据目录静态服务（media/uploads） ==========
    // 将 /media 和 /uploads 映射到 data 目录，而不是 www 目录
    this._setupDataStaticServing();
    
    // ========== 第八阶段：静态文件服务（最后匹配） ==========
    // 注意：静态文件服务应该在API路由之后，避免拦截API请求
    // API路由在ApiLoader.register中注册，会通过优先级确保在静态文件服务之前
    // 静态文件服务已经添加了 /api/ 路径跳过逻辑，确保不会拦截API请求
    await this._setupStaticServing();
  }

  /**
   * 配置CORS跨域
   * 适配最新HTTP生态，支持预检请求和凭证传递
   */
  _setupCors() {
    const corsConfig = cfg.server.cors;
    if (corsConfig.enabled === false) return;
    
    this.express.use((req, res, next) => {
      if (this._checkHeadersSent(res, next)) return;
      
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
          config.headers?.join(', ') || 'Content-Type, Authorization, X-API-Key, X-User-Email, X-Requested-With');
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
        config.headers?.join(', ') || 'Content-Type, Authorization, X-API-Key, X-User-Email, X-Requested-With');
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
   * 数据目录静态服务配置
   * 将 /media 和 /uploads 路由映射到 data 目录
   * 注意：这些路由在静态文件服务之前注册，使用 fallthrough: false 避免冲突
   */
  _setupDataStaticServing() {
    // 统一的静态文件选项
    const staticOptions = {
      dotfiles: 'deny',
      fallthrough: false, // 不继续到下一个中间件，避免与 www 静态服务冲突
      maxAge: '1h',
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        if (!res.headersSent) {
          this._setStaticHeaders(res, filePath);
        }
      }
    };
    
    // /media 路由映射到 data/media
    const mediaDir = path.join(paths.data, 'media');
    this.express.use('/media', (req, res, next) => {
      if (this._checkHeadersSent(res, next)) return;
      express.static(mediaDir, staticOptions)(req, res, next);
    });
    
    // /uploads 路由映射到 data/uploads
    const uploadsDir = path.join(paths.data, 'uploads');
    this.express.use('/uploads', (req, res, next) => {
      if (this._checkHeadersSent(res, next)) return;
      express.static(uploadsDir, staticOptions)(req, res, next);
    });
  }

  /**
   * 创建静态文件服务选项
   * @returns {Object} express.static 选项
   */
  _createStaticOptions() {
    return {
      index: cfg.server.static.index || ['index.html', 'index.htm'],
      dotfiles: 'deny',
      extensions: cfg.server.static.extensions || false,
      fallthrough: true,
      maxAge: cfg.server.static.cacheTime || '1d',
      etag: true,
      lastModified: true,
      immutable: cfg.server.static.immutable !== false,
      setHeaders: (res, filePath) => {
        if (!res.headersSent) {
          this._setStaticHeaders(res, filePath);
        }
      }
    };
  }

  /**
   * 静态文件服务配置
   * 使用条件中间件，只处理非API请求
   */
  async _setupStaticServing() {
    // 目录索引（仅对静态文件）
    this.express.use((req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      if (this._checkHeadersSent(res, next)) return;
      this._directoryIndexMiddleware(req, res, next);
    });
    
    // 静态文件安全中间件（已优化，跳过API）
    this.express.use(this._staticSecurityMiddleware.bind(this));
    
    // 挂载所有 core/*/www 目录及其子目录
    const coreDirs = await paths.getCoreDirs();
    const staticOptions = this._createStaticOptions();
    const mountedPaths = new Set(); // 用于检测路径冲突
    
    for (const coreDir of coreDirs) {
      const wwwDir = path.join(coreDir, 'www');
      const coreName = path.basename(coreDir);
      
      // 检查 www 目录是否存在
      try {
        const stat = fsSync.statSync(wwwDir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }
      
      // 挂载 core/*/www 到 /core/{coreName}/*
      const coreMountPath = `/core/${coreName}`;
      if (!mountedPaths.has(coreMountPath)) {
        this.express.use(coreMountPath, express.static(wwwDir, staticOptions));
        mountedPaths.add(coreMountPath);
        BotUtil.makeLog('info', `挂载静态资源: ${coreMountPath} -> ${wwwDir}`, 'Bot');
      }
      
      // 扫描 www 下的子目录，挂载到根路径（避免冲突）
      try {
        const entries = fsSync.readdirSync(wwwDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subDirName = entry.name;
            const subDirPath = path.join(wwwDir, subDirName);
            const mountPath = `/${subDirName}`;
            
            // 检查路径冲突（排除已保留的路径）
            const reservedPaths = ['api', 'core', 'media', 'uploads', 'File'];
            if (reservedPaths.includes(subDirName)) {
              BotUtil.makeLog('warn', `跳过保留路径: ${mountPath} (core: ${coreName})`, 'Bot');
              continue;
            }
            
            if (mountedPaths.has(mountPath)) {
              BotUtil.makeLog('warn', `路径冲突，跳过: ${mountPath} (core: ${coreName})，已被其他core占用`, 'Bot');
              continue;
            }
            
            this.express.use(mountPath, express.static(subDirPath, staticOptions));
            mountedPaths.add(mountPath);
            BotUtil.makeLog('info', `挂载子目录: ${mountPath} -> ${subDirPath} (core: ${coreName})`, 'Bot');
          }
        }
      } catch (error) {
        BotUtil.makeLog('debug', `扫描 www 子目录失败: ${wwwDir} - ${error.message}`, 'Bot');
      }
    }
    
    // 主 www 目录静态文件服务（根路径）
    this.express.use((req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      
      if (this._checkHeadersSent(res, next)) return;
      
      const staticRoot = req.staticRoot || paths.www;
      
      // 确保目录存在（recursive: true 会自动处理已存在的情况）
      fsSync.mkdirSync(staticRoot, { recursive: true });
      
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
    
    const staticRoot = req.staticRoot || paths.www;
    const dirPath = path.join(staticRoot, req.path);
    
    // 使用 try-catch 优化性能，避免重复的 existsSync 检查
    try {
      const stat = fsSync.statSync(dirPath);
      if (stat.isDirectory()) {
        const indexFiles = cfg.server.static.index || ['index.html', 'index.htm'];
        
        for (const indexFile of indexFiles) {
          const indexPath = path.join(dirPath, indexFile);
          try {
            if (fsSync.statSync(indexPath).isFile()) {
              const redirectUrl = req.path + '/';
              BotUtil.makeLog('debug', `目录重定向：${req.path} → ${redirectUrl}`, '服务器');
              if (!res.headersSent) {
                return res.redirect(301, redirectUrl);
              }
              return;
            }
          } catch {
            // 文件不存在，继续检查下一个
            continue;
          }
        }
      }
    } catch {
      // 目录不存在，继续下一个中间件
    }
    
    next();
  }

  _setStaticHeaders(res, filePath) {
    if (this._checkHeadersSent(res)) return;
    
    this.httpBusiness.handleCDN({ headers: {} }, res, filePath);
    
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
      '.avif': 'image/avif',
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
    if (this._checkHeadersSent(res)) return;
    
    if (mimeTypes[ext]) {
      res.setHeader('Content-Type', mimeTypes[ext]);
    }
    
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    const cacheConfig = cfg.server.static.cache || {};
    const immutableExts = ['.css', '.js', '.woff', '.woff2', '.ttf', '.otf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'];
    
    // 优化缓存策略：HTML不缓存，静态资源长期缓存
    if (['.html', '.htm'].includes(ext)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
    } else if (immutableExts.includes(ext)) {
      // 静态资源使用长期缓存 + immutable
      const maxAge = cacheConfig.static || 31536000; // 默认1年
      res.setHeader('Cache-Control', `public, max-age=${maxAge}, immutable`);
    } else if (['.json'].includes(ext)) {
      res.setHeader('Cache-Control', `public, max-age=${cacheConfig.static || 3600}`);
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico'].includes(ext)) {
      res.setHeader('Cache-Control', `public, max-age=${cacheConfig.images || 604800}`);
    }
  }

  /**
   * 静态文件安全中间件
   * nginx风格：只处理静态文件，不拦截API路由
   * 重要：必须跳过所有 /api/ 开头的路径，确保API路由优先
   */
  _staticSecurityMiddleware(req, res, next) {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    
    if (this._checkHeadersSent(res, next)) return;
    
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
    if (this._checkHeadersSent(res)) return;
    
    const staticRoot = req.staticRoot || paths.www;
    const faviconPath = path.join(staticRoot, 'favicon.ico');
    
    // 使用 try-catch 优化性能
    try {
      if (fsSync.statSync(faviconPath).isFile()) {
        if (!res.headersSent) {
          res.set({
            'Content-Type': 'image/x-icon',
            'Cache-Control': 'public, max-age=604800'
          });
          return res.sendFile(faviconPath);
        }
        return;
      }
    } catch {
      // 文件不存在，返回 204
    }
    
    if (!res.headersSent) {
      res.status(204).end();
    }
  }

  /**
   * 处理robots.txt请求
   */
  async _handleRobotsTxt(req, res) {
    if (this._checkHeadersSent(res)) return;
    
    const staticRoot = req.staticRoot || paths.www;
    const robotsPath = path.join(staticRoot, 'robots.txt');
    
    // 使用 try-catch 优化性能
    try {
      if (fsSync.statSync(robotsPath).isFile()) {
        if (!res.headersSent) {
          res.set({
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=86400'
          });
          return res.sendFile(robotsPath);
        }
        return;
      }
    } catch {
      // 文件不存在，使用默认内容
    }
    
    const defaultRobots = `User-agent: *
Disallow: /api/
Disallow: /config/
Disallow: /data/
Disallow: /lib/
Disallow: /plugins/
Disallow: /trash/
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
    const botMap = this.bots;
    const isBotEntry = (prop, value) => {
      if (Reflect.has(this, prop)) return false;
      if (typeof prop !== 'string') return false;
      if (!value || typeof value !== 'object') return false;
      return Boolean(
        value.tasker ||
        value.tasker_type ||
        value.self_id ||
        value.uin
      );
    };

    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (prop === Symbol.toStringTag) return 'Bot';
        // 1. 优先返回 Bot 自身属性
        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }

        // 2. 其次返回已注册的子 Bot 实例
        if (prop in botMap) {
          return botMap[prop];
        }

        // 3. 最后透明代理到 BotUtil 的静态方法/属性（仅限自有属性，避免 Function 原型污染）
        if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(BotUtil, prop)) {
          const utilValue = BotUtil[prop];
          if (utilValue !== undefined) {
            return typeof utilValue === 'function'
              ? utilValue.bind(BotUtil)
              : utilValue;
          }
        }

        return undefined;
      },
      set: (target, prop, value, receiver) => {
        if (isBotEntry(prop, value)) {
          botMap[prop] = value;
          return true;
        }
        return Reflect.set(target, prop, value, receiver);
      },
      has: (target, prop) => {
        if (Reflect.has(target, prop)) return true;
        if (prop in botMap) return true;
        if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(BotUtil, prop)) {
          return true;
        }
        return false;
      },
      ownKeys: (target) => {
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor: (target, prop) => {
        if (Reflect.has(target, prop)) {
          return Reflect.getOwnPropertyDescriptor(target, prop);
        }
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
    
    const apiKeyPath = path.join(paths.root,
      apiKeyConfig.file || 'config/server_config/api_key.json');
    
    // 使用 try-catch 优化性能，避免重复的 existsSync 检查
    try {
      if (fsSync.statSync(apiKeyPath).isFile()) {
        const keyData = JSON.parse(await fs.readFile(apiKeyPath, 'utf8'));
        this.apiKey = keyData.key;
        BotUtil.apiKey = this.apiKey;
        BotUtil.makeLog('debug', '从文件加载API密钥', '服务器');
        return this.apiKey;
      }
    } catch {
      // 文件不存在，生成新密钥
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
    if (this._checkHeadersSent(res, next)) return;
    
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
    
    // ========== 白名单匹配（使用 Node.js 24 全局 URLPattern API） ==========
    let isWhitelisted = false;
    
    for (const whitelistPath of whitelist) {
      try {
        // 精确匹配（最高优先级）
        if (whitelistPath === req.path) {
          isWhitelisted = true;
          break;
        }
        
        // 使用 URLPattern 进行模式匹配（Node.js 24+ 全局可用）
        let pattern;
        if (whitelistPath.endsWith('*')) {
          // 前缀匹配：将 * 转换为 URLPattern 语法
          const prefix = whitelistPath.slice(0, -1);
          pattern = new URLPattern({ pathname: `${prefix}*` });
        } else if (whitelistPath.endsWith('/')) {
          // 目录匹配
          pattern = new URLPattern({ pathname: `${whitelistPath}*` });
        } else {
          // 精确匹配
          pattern = new URLPattern({ pathname: whitelistPath });
        }
        
        if (pattern.test({ pathname: req.path })) {
          isWhitelisted = true;
          break;
        }
      } catch {
        // 降级到传统匹配方式（兼容性）
        if (whitelistPath.endsWith('*')) {
          const prefix = whitelistPath.slice(0, -1);
          if (req.path.startsWith(prefix)) {
            isWhitelisted = true;
            break;
          }
        } else if (whitelistPath.endsWith('/') && req.path.startsWith(whitelistPath)) {
          isWhitelisted = true;
          break;
        }
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
   * 检查响应是否已发送（辅助方法，减少重复代码）
   * @param {Object} res - Express响应对象
   * @param {Function} [next] - Express next函数（可选）
   * @param {Error} [err] - 错误对象（可选，用于错误处理器）
   * @returns {boolean} 如果响应已发送返回true
   */
  _checkHeadersSent(res, next, err) {
    if (res.headersSent) {
      if (next) {
        if (err) {
          return next(err);
        }
        return next();
      }
      return true;
    }
    return false;
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
    if (this._checkHeadersSent(res)) return;
    
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
    if (this._checkHeadersSent(res)) return;
    
    res.json({
      status: '健康',
      uptime: process.uptime(),
      timestamp: Date.now()
    });
  }

  /**
   * 性能指标处理器
   * 提供详细的性能监控数据
   */
  _metricsHandler(req, res) {
    if (this._checkHeadersSent(res)) return;
    
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const wsStats = this.getWebSocketStats();
    
    const metrics = {
      timestamp: Date.now(),
      uptime: process.uptime(),
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      websocket: wsStats,
      server: {
        httpPort: this.httpPort,
        httpsPort: this.httpsPort,
        actualPort: this.actualPort,
        actualHttpsPort: this.actualHttpsPort,
        proxyEnabled: this.proxyEnabled
      },
      platform: {
        node: process.version,
        platform: process.platform,
        arch: process.arch
      }
    };
    
    res.type('json').send(JSON.stringify(metrics, null, 2));
  }

  /**
   * 文件处理器
   */
  _fileHandler(req, res) {
    if (this._checkHeadersSent(res)) return;
    
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
   * 启动WebSocket心跳检测
   * 定期检查连接状态，清理死连接
   */
  _startWebSocketHeartbeat() {
    if (this._wsHeartbeatInterval) return; // 已启动
    
    const interval = cfg.server.websocket?.heartbeatInterval || 30000; // 30秒
    const timeout = cfg.server.websocket?.heartbeatTimeout || 60000; // 60秒超时
    
    this._wsHeartbeatInterval = setInterval(() => {
      const now = Date.now();
      const deadConnections = [];
      
      for (const [id, conn] of this._wsConnections.entries()) {
        // 检查连接是否超时
        if (now - conn.lastPing > timeout) {
          deadConnections.push(id);
          try {
            conn.terminate();
          } catch (err) {
            // 忽略已关闭的连接
          }
          continue;
        }
        
        // 发送ping
        if (conn.readyState === conn.OPEN) {
          try {
            conn.isAlive = false;
            conn.ping();
          } catch (err) {
            deadConnections.push(id);
          }
        } else {
          deadConnections.push(id);
        }
      }
      
      // 清理死连接
      for (const id of deadConnections) {
        this._wsConnections.delete(id);
      }
      
      if (deadConnections.length > 0) {
        BotUtil.makeLog("debug", `清理 ${deadConnections.length} 个WebSocket死连接`, '服务器');
      }
    }, interval);
  }

  /**
   * 停止WebSocket心跳检测
   */
  _stopWebSocketHeartbeat() {
    if (this._wsHeartbeatInterval) {
      clearInterval(this._wsHeartbeatInterval);
      this._wsHeartbeatInterval = null;
    }
  }

  /**
   * 获取WebSocket连接统计
   */
  getWebSocketStats() {
    const stats = {
      total: this._wsConnections.size,
      byPath: {},
      oldest: null,
      newest: null
    };
    
    let oldestTime = Infinity;
    let newestTime = 0;
    
    for (const [id, conn] of this._wsConnections.entries()) {
      const path = conn.path || 'unknown';
      stats.byPath[path] = (stats.byPath[path] || 0) + 1;
      
      if (conn.connectedAt) {
        if (conn.connectedAt < oldestTime) {
          oldestTime = conn.connectedAt;
          stats.oldest = { id, path, connectedAt: conn.connectedAt };
        }
        if (conn.connectedAt > newestTime) {
          newestTime = conn.connectedAt;
          stats.newest = { id, path, connectedAt: conn.connectedAt };
        }
      }
    }
    
    return stats;
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
    
    // 检查WebSocket路径是否在白名单中（使用 Node.js 24 URLPattern API）
    const path = req.url.split("?")[0]; // 去除查询参数
    const isWhitelisted = whitelist.some(whitelistPath => {
      if (whitelistPath === path) return true;
      try {
        // 使用 URLPattern 进行模式匹配（Node.js 24+ 全局可用）
        let pattern;
        if (whitelistPath.endsWith('*')) {
          const prefix = whitelistPath.slice(0, -1);
          pattern = new URLPattern({ pathname: `${prefix}*` });
        } else {
          pattern = new URLPattern({ pathname: whitelistPath });
        }
        return pattern.test({ pathname: path });
      } catch {
        // 降级到传统匹配方式（兼容性）
        if (whitelistPath.endsWith('*')) {
          return path.startsWith(whitelistPath.slice(0, -1));
        }
        return false;
      }
    });
    
    // 如果不在白名单且不是本地连接，则需要认证
    if (!isWhitelisted && !this._isLocalConnection(req.socket.remoteAddress)) {
      if (authConfig.apiKey?.enabled !== false && !this._checkApiAuthorization(req)) {
        BotUtil.makeLog("error", `WebSocket认证失败：${req.url}`, '服务器');
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        return socket.destroy();
      }
    }
    
    // 解析WebSocket路径（去除查询参数和开头的斜杠）
    const pathWithoutQuery = req.url.split("?")[0];
    const wsPath = pathWithoutQuery.startsWith('/') ? pathWithoutQuery.slice(1) : pathWithoutQuery;
    
    if (!wsPath || !(wsPath in this.wsf)) {
      BotUtil.makeLog("warn", `WebSocket路径未找到: ${req.url} (解析为: ${wsPath}), 可用路径: ${Object.keys(this.wsf).join(', ')}`, '服务器');
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      return socket.destroy();
    }
    
    BotUtil.makeLog("debug", `WebSocket路径匹配: ${req.url} -> ${wsPath}`, '服务器');
    
    this.wss.handleUpgrade(req, socket, head, conn => {
      const connectionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      conn.id = connectionId;
      conn.path = wsPath;
      conn.remoteAddress = req.socket.remoteAddress;
      conn.connectedAt = Date.now();
      conn.lastPing = Date.now();
      conn.isAlive = true;
      
      // 添加到连接池
      this._wsConnections.set(connectionId, conn);
      
      BotUtil.makeLog("debug", `WebSocket连接建立：${req.url} [${connectionId}]`, '服务器');
      
      // 心跳检测
      conn.on("pong", () => {
        conn.isAlive = true;
        conn.lastPing = Date.now();
      });
      
      // 错误处理（使用 Node.js 24 Error.isError() 优化）
      conn.on("error", err => {
        // 使用 Error.isError() 进行可靠的错误类型判断（Node.js 24+）
        const errorMsg = Error.isError(err) ? err.message : String(err);
        BotUtil.makeLog("error", `WebSocket错误 [${connectionId}]: ${errorMsg}`, '服务器');
        this._wsConnections.delete(connectionId);
      });
      
      // 连接关闭处理
      conn.on("close", (code, reason) => {
        BotUtil.makeLog("debug", `WebSocket断开：${req.url} [${connectionId}] 代码: ${code}`, '服务器');
        this._wsConnections.delete(connectionId);
      });
      
      // 消息处理（增强，使用 Node.js 24 Error.isError()）
      conn.on("message", (msg, isBinary) => {
        try {
          conn.lastPing = Date.now(); // 更新活跃时间
          const logMsg = Buffer.isBuffer(msg) && msg.length > 1024 ?
            `[二进制消息，长度：${msg.length}]` : BotUtil.String(msg);
          BotUtil.makeLog("trace", `WS消息 [${connectionId}]: ${logMsg}`, '服务器');
        } catch (err) {
          // 使用 Error.isError() 进行可靠的错误类型判断（Node.js 24+）
          const errorMsg = Error.isError(err) ? err.message : String(err);
          BotUtil.makeLog("error", `WebSocket消息处理错误 [${connectionId}]: ${errorMsg}`, '服务器');
        }
      });
      
      // 增强的发送方法（带错误恢复）
      conn.sendMsg = (msg, options = {}) => {
        try {
          if (conn.readyState !== conn.OPEN) {
            BotUtil.makeLog("warn", `WebSocket未就绪，无法发送 [${connectionId}]`, '服务器');
            return false;
          }
          
          if (!Buffer.isBuffer(msg)) {
            msg = Buffer.from(typeof msg === 'string' ? msg : JSON.stringify(msg));
          }
          
          const logMsg = msg.length > 1024 ? `[二进制消息，长度：${msg.length}]` : BotUtil.String(msg);
          BotUtil.makeLog("trace", `WS发送 [${connectionId}]: ${logMsg}`, '服务器');
          
          return conn.send(msg, options);
        } catch (err) {
          // 使用 Error.isError() 进行可靠的错误类型判断（Node.js 24+）
          const errorMsg = Error.isError(err) ? err.message : String(err);
          BotUtil.makeLog("error", `WebSocket发送错误 [${connectionId}]: ${errorMsg}`, '服务器');
          this._wsConnections.delete(connectionId);
          return false;
        }
      };
      
      // 启动心跳检测
      this._startWebSocketHeartbeat();
      
      // 调用注册的处理器
      try {
        for (const handler of this.wsf[wsPath]) {
          handler(conn, req, socket, head);
        }
      } catch (err) {
        // 使用 Error.isError() 进行可靠的错误类型判断（Node.js 24+）
        const errorMsg = Error.isError(err) ? err.message : String(err);
        BotUtil.makeLog("error", `WebSocket处理器错误 [${connectionId}]: ${errorMsg}`, '服务器');
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
      this.actualHttpsPort = serverInfo.port;
    } else {
      this.httpPort = serverInfo.port;
      this.actualPort = serverInfo.port;
    }
    
    const protocol = isHttps ? 'https' : 'http';
    const serverType = isHttps ? 'HTTPS' : 'HTTP';
    
    // 启动信息在汇总中显示，这里只记录日志
    BotUtil.makeLog("info", `✓ ${serverType}服务器监听在 ${host}:${serverInfo.port}`, '服务器');
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
    console.log('\n');
  }

  /**
   * 显示访问地址
   */
  async _displayAccessUrls(protocol, port) {
    const ipInfo = await this.getLocalIpAddress();
    
    console.log(chalk.cyan('\n▶ 访问地址：'));
    
    if (ipInfo.local.length > 0) {
      console.log(chalk.yellow('  本地网络：'));
      ipInfo.local.forEach(info => {
        const url = `${protocol}://${info.ip}:${port}`;
        const label = info.primary ? chalk.green(' ★') : '';
        const interfaceInfo = chalk.gray(` [${info.interface}]`);
        console.log(`    ${chalk.cyan('•')} ${chalk.white(url)}${interfaceInfo}${label}`);
      });
    }
    
    if (ipInfo.public && cfg.server?.misc?.detectPublicIP !== false) {
      console.log(chalk.yellow('\n  公网访问：'));
      const publicUrl = `${protocol}://${ipInfo.public}:${port}`;
      console.log(`    ${chalk.cyan('•')} ${chalk.white(publicUrl)}`);
    }
    
    const configuredUrl = typeof cfg.server?.server?.url === 'string' ? cfg.server.server.url.trim() : '';
    if (configuredUrl) {
      console.log(chalk.yellow('\n  配置域名：'));
      
      // 只在用户明确配置时显示，并避免重复端口
      let normalizedUrl = configuredUrl;
      if (!/^https?:\/\//i.test(normalizedUrl)) {
        normalizedUrl = `${protocol}://${normalizedUrl}`;
      }
      
      let displayUrl = normalizedUrl.replace(/\/$/, '');
      try {
        const parsed = new URL(normalizedUrl);
        if (!parsed.port) {
          parsed.port = String(port);
        }
        displayUrl = parsed.origin + parsed.pathname.replace(/\/$/, '');
      } catch {
        const hasPort = /:[0-9]+$/.test(normalizedUrl.split('://')[1] || '');
        if (!hasPort) {
          displayUrl = `${normalizedUrl}:${port}`;
        }
      }
      
      console.log(`    ${chalk.cyan('•')} ${chalk.white(displayUrl)}`);
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
      
      // 使用 try-catch 优化性能，提供更详细的错误信息
      try {
        const keyStat = fsSync.statSync(cert.key);
        if (!keyStat.isFile()) {
          throw new Error(`HTTPS密钥路径不是文件：${cert.key}`);
        }
      } catch (error) {
        throw new Error(`HTTPS密钥文件不存在或无法访问：${cert.key} - ${error.message}`);
      }
      
      try {
        const certStat = fsSync.statSync(cert.cert);
        if (!certStat.isFile()) {
          throw new Error(`HTTPS证书路径不是文件：${cert.cert}`);
        }
      } catch (error) {
        throw new Error(`HTTPS证书文件不存在或无法访问：${cert.cert} - ${error.message}`);
      }
      
      httpsOptions = {
        key: await fs.readFile(cert.key),
        cert: await fs.readFile(cert.cert),
        allowHTTP1: true
      };
      
      // 优化 CA 证书加载
      if (cert.ca) {
        try {
          if (fsSync.statSync(cert.ca).isFile()) {
            httpsOptions.ca = await fs.readFile(cert.ca);
            BotUtil.makeLog('debug', `已加载CA证书：${cert.ca}`, '服务器');
          }
        } catch (error) {
          BotUtil.makeLog('debug', `CA证书文件不存在或无法访问：${cert.ca}，跳过`, '服务器');
        }
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
      if (this._checkHeadersSent(res)) return;
      
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
        const staticRoot = req.staticRoot || paths.www;
        const custom404Path = path.join(staticRoot, '404.html');
        
        // 使用 try-catch 优化性能
        try {
          if (fsSync.statSync(custom404Path).isFile()) {
            res.status(404).sendFile(custom404Path);
            return;
          }
        } catch {
          // 文件不存在，重定向到默认路由
        }
        res.redirect(defaultRoute);
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
      if (this._checkHeadersSent(res, next, err)) return;
      
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
    
    // 停止WebSocket心跳检测
    this._stopWebSocketHeartbeat();
    
    // 关闭所有WebSocket连接
    for (const [id, conn] of this._wsConnections.entries()) {
      try {
        conn.terminate();
      } catch (err) {
        // 忽略已关闭的连接
      }
    }
    this._wsConnections.clear();
    
    const servers = [
      this.server,
      this.httpsServer,
      this.proxyServer,
      this.proxyHttpsServer
    ].filter(Boolean);
    
    // 停止定时清理任务
    if (this._trashTimer) {
      clearInterval(this._trashTimer);
      this._trashTimer = null;
    }

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
    const configuredUrl = typeof cfg.server?.server?.url === 'string' ? cfg.server.server.url.trim() : '';
    let host = configuredUrl || '127.0.0.1';
    
    // 移除host中可能包含的协议前缀
    host = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
    
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
   * 获取公网IP（跨平台兼容）
   */
  async _getPublicIP() {
    // 使用多个API服务，提高成功率
    const apis = [
      'https://ifconfig.me/ip',
      'https://api.ipify.org',
      'https://icanhazip.com',
      'https://ipinfo.io/ip'
    ];
    
    // 尝试每个API，直到成功
    for (const apiUrl of apis) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        
        const response = await fetch(apiUrl, {
          signal: controller.signal,
          headers: { 
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'text/plain, */*'
          }
        });
        
        clearTimeout(timeout);
        
        if (response.ok) {
          const text = await response.text();
          const ip = text.trim();
          
          if (ip && this._isValidIP(ip)) {
            return ip;
          }
        }
      } catch (error) {
        // 继续尝试下一个API
        continue;
      }
    }
    
    BotUtil.makeLog('debug', '获取公网IP失败，所有API均不可用', '服务器');
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
    const startTime = Date.now();
    
    // 初始化配置
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
    
    if (this.proxyEnabled) {
      await this._initProxyApp();
    }
    
    // 初始化基础服务（顺序执行）
    await Packageloader();
    
    // 并行加载配置和模块（异步，避免日志交叉）
    const ConfigLoader = (await import('./infrastructure/commonconfig/loader.js')).default;
    
    const [configResult, streamResult, pluginsResult, apiResult] = await Promise.allSettled([
      ConfigLoader.load(),
      StreamLoader.load(),
      PluginsLoader.load(),
      ApiLoader.load()
    ]);
    
    // 处理加载结果（统一处理，避免重复日志）
    if (configResult.status === 'fulfilled') {
      global.ConfigManager = ConfigLoader;
      global.cfg = cfg;
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
    
    // 初始化中间件和路由
    await this._initializeMiddlewareAndRoutes();
    
    // 注册API
    await ApiLoader.register(this.express, this);
    this._setupFinalHandlers();
    
    // 启动HTTP/HTTPS服务器
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
    
    // 加载监听事件和Tasker
    await ListenerLoader.load(this);
    
    // 启动文件监视
    await ApiLoader.watch(true);
    
    // 启动完成 - 显示完整启动信息
    const loadTime = Date.now() - startTime;
    await this._displayStartupSummary(loadTime, startTime);
    
    this.emit("online", {
      bot: this,
      timestamp: Date.now(),
      url: this.getServerUrl(),
      uptime: process.uptime(),
      apis: ApiLoader.getApiList(),
      proxyEnabled: this.proxyEnabled
    });

    // 启动 trash 目录定时清理（仅清理一定时间之前的临时文件）
    this._startTrashCleaner();
  }

  /**
   * 显示启动汇总信息
   * 包含服务器配置、性能指标、服务状态等
   */
  async _displayStartupSummary(loadTime, startTime) {
    const memUsage = process.memoryUsage();
    const memMB = (size) => `${(size / 1024 / 1024).toFixed(2)}MB`;
    
    console.log(chalk.cyan('\n' + '═'.repeat(60)));
    console.log(chalk.cyan('║') + chalk.bold('  XRK-AGT 启动完成') + ' '.repeat(40) + chalk.cyan('║'));
    console.log(chalk.cyan('═'.repeat(60)));
    
    // 启动时间统计
    console.log(chalk.yellow('\n▶ 启动统计：'));
    console.log(`    ${chalk.cyan('•')} 总耗时：${chalk.white(`${loadTime}ms`)}`);
    console.log(`    ${chalk.cyan('•')} 启动时间：${chalk.white(new Date(startTime).toLocaleString('zh-CN'))}`);
    console.log(`    ${chalk.cyan('•')} 运行时长：${chalk.white(`${process.uptime().toFixed(2)}s`)}`);
    
    // 服务器信息
    console.log(chalk.yellow('\n▶ 服务器信息：'));
    console.log(`    ${chalk.cyan('•')} HTTP端口：${chalk.white(this.actualPort)}`);
    if (this.actualHttpsPort) {
      console.log(`    ${chalk.cyan('•')} HTTPS端口：${chalk.white(this.actualHttpsPort)}`);
    }
    console.log(`    ${chalk.cyan('•')} 服务器地址：${chalk.white(this.getServerUrl())}`);
    if (this.proxyEnabled) {
      console.log(`    ${chalk.cyan('•')} 反向代理：${chalk.green('已启用')} (${this.domainConfigs.size}个域名)`);
    }
    
    // WebSocket信息
    const wsPaths = Object.keys(this.wsf);
    if (wsPaths.length > 0) {
      console.log(chalk.yellow('\n▶ WebSocket服务：'));
      console.log(`    ${chalk.cyan('•')} 服务地址：${chalk.white(this.getServerUrl().replace(/^http/, "ws"))}`);
      console.log(`    ${chalk.cyan('•')} 连接路径：${chalk.white(wsPaths.length + '个')} ${chalk.gray(`[${wsPaths.join(', ')}]`)}`);
    }
    
    // 性能指标
    console.log(chalk.yellow('\n▶ 性能指标：'));
    console.log(`    ${chalk.cyan('•')} 内存使用：${chalk.white(memMB(memUsage.heapUsed))} / ${chalk.white(memMB(memUsage.heapTotal))}`);
    console.log(`    ${chalk.cyan('•')} RSS内存：${chalk.white(memMB(memUsage.rss))}`);
    console.log(`    ${chalk.cyan('•')} 外部内存：${chalk.white(memMB(memUsage.external))}`);
    const cpuInfo = os.cpus();
    console.log(`    ${chalk.cyan('•')} CPU核心：${chalk.white(cpuInfo.length + '核')}`);
    console.log(`    ${chalk.cyan('•')} 平台：${chalk.white(`${process.platform} ${process.arch}`)}`);
    console.log(`    ${chalk.cyan('•')} Node.js：${chalk.white(process.version)}`);
    
    // 服务器配置
    console.log(chalk.yellow('\n▶ 服务器配置：'));
    const compressionEnabled = cfg.server.compression?.enabled !== false;
    console.log(`    ${chalk.cyan('•')} 压缩：${compressionEnabled ? chalk.green('已启用') : chalk.gray('已禁用')} ${compressionEnabled ? chalk.gray(`(级别: ${cfg.server.compression?.level || 6})`) : ''}`);
    
    const helmetEnabled = cfg.server.security?.helmet?.enabled !== false;
    console.log(`    ${chalk.cyan('•')} 安全头：${helmetEnabled ? chalk.green('已启用') : chalk.gray('已禁用')}`);
    
    const corsEnabled = cfg.server.cors?.enabled !== false;
    console.log(`    ${chalk.cyan('•')} CORS：${corsEnabled ? chalk.green('已启用') : chalk.gray('已禁用')}`);
    
    const rateLimitEnabled = cfg.server.rateLimit?.enabled !== false;
    console.log(`    ${chalk.cyan('•')} 速率限制：${rateLimitEnabled ? chalk.green('已启用') : chalk.gray('已禁用')}`);
    
    const httpsEnabled = cfg.server.https?.enabled === true;
    console.log(`    ${chalk.cyan('•')} HTTPS：${httpsEnabled ? chalk.green('已启用') : chalk.gray('已禁用')}`);
    if (httpsEnabled && cfg.server.https?.tls?.http2 === true) {
      console.log(`    ${chalk.cyan('•')} HTTP/2：${chalk.green('已启用')}`);
    }
    
    // API统计
    const apiList = ApiLoader.getApiList();
    const totalRoutes = apiList.reduce((sum, api) => sum + (api.routes || 0), 0);
    const totalWS = apiList.reduce((sum, api) => sum + (api.ws || 0), 0);
    // 从Bot实例获取实际WebSocket路径数量（更准确）
    const actualWSPaths = Object.keys(this.wsf || {}).length;
    console.log(chalk.yellow('\n▶ API统计：'));
    console.log(`    ${chalk.cyan('•')} API模块：${chalk.white(apiList.length + '个')}`);
    console.log(`    ${chalk.cyan('•')} HTTP路由：${chalk.white(totalRoutes + '个')}`);
    console.log(`    ${chalk.cyan('•')} WebSocket路由：${chalk.white(actualWSPaths + '个')} ${actualWSPaths !== totalWS ? chalk.gray(`(API统计: ${totalWS})`) : ''}`);
    
    // 认证信息
    const authConfig = cfg.server.auth || {};
    if (authConfig.apiKey?.enabled !== false) {
      console.log(chalk.yellow('\n▶ 认证配置：'));
      console.log(`    ${chalk.cyan('•')} API密钥：${chalk.white(this.apiKey)}`);
      console.log(chalk.gray(`    使用 X-API-Key 请求头进行认证`));
      
      if (authConfig.whitelist?.length) {
        console.log(`    ${chalk.cyan('•')} 白名单路径：${chalk.white(authConfig.whitelist.length + '个')}`);
        authConfig.whitelist.forEach(path => {
          console.log(`      ${chalk.gray('•')} ${chalk.gray(path)}`);
        });
      }
    }
    
    // 访问地址
    await this._displayAccessUrls('http', this.actualPort);
    
    console.log(chalk.cyan('\n' + '═'.repeat(60) + '\n'));
    
    // 简化的日志输出（用于日志文件）
    BotUtil.makeLog('info', `智能体启动完成 (耗时: ${loadTime}ms)`, '服务器');
    if (wsPaths.length > 0) {
      BotUtil.makeLog("info", `⚡ WebSocket服务：${this.getServerUrl().replace(/^http/, "ws")}/ [${wsPaths.join(', ')}]`, '服务器');
    }
  }

  /**
   * 启动 trash 定时清理任务
   * - 默认每 60 分钟清理一次
   * - 仅删除超过一定保留时间的文件/目录（默认 24 小时）
   * - 保留白名单文件（.gitignore, instruct.txt 等）
   */
  _startTrashCleaner() {
    const miscCfg = cfg.server?.misc || {};
    const intervalMinutes = Number(miscCfg.trashCleanupIntervalMinutes) || 60;
    const maxAgeHours = Number(miscCfg.trashMaxAgeHours) || 24;

    const intervalMs = Math.max(intervalMinutes, 5) * 60 * 1000;
    const maxAgeMs = Math.max(maxAgeHours, 1) * 60 * 60 * 1000;

    const runCleanup = async () => {
      try {
        await this._clearTrashOnce(maxAgeMs);
      } catch (err) {
        BotUtil.makeLog('debug', `trash 清理失败: ${err.message}`, '服务器');
      }
    };

    runCleanup();
    this._trashTimer = setInterval(runCleanup, intervalMs);
  }

  /**
   * 执行一次 trash 清理
   * @param {number} maxAgeMs - 保留时长，早于该时间的文件会被删除
   */
  async _clearTrashOnce(maxAgeMs) {
    const trashRoot = paths.trash;
    if (!trashRoot) return;

    // 白名单：需要永久保留的文件/目录
    const preserveList = new Set(['.gitignore', 'instruct.txt']);

    let entries;
    try {
      entries = await fs.readdir(trashRoot, { withFileTypes: true });
    } catch {
      return;
    }

    const now = Date.now();
    const tasks = entries
      .filter(entry => !preserveList.has(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(trashRoot, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          if (now - stat.mtimeMs < maxAgeMs) return;

          await (entry.isDirectory() 
            ? fs.rm(fullPath, { recursive: true, force: true })
            : fs.unlink(fullPath));
        } catch {
          // 忽略删除失败
        }
      });

    await Promise.allSettled(tasks);
  }

  /**
   * 准备事件对象（通用逻辑）
   * 只处理所有Tasker通用的属性，Tasker特定逻辑由插件通过accept方法处理
   * 
   * @param {Object} data - 事件数据对象
   */
  prepareEvent(data) {
    // 确保bot对象存在
    if (!data.bot && data.self_id && this.bots[data.self_id]) {
      Object.defineProperty(data, "bot", {
        value: this.bots[data.self_id],
        writable: false,
        configurable: false
      });
    }
    
    // 设置 tasker 信息（所有 tasker 通用）
    if (data.bot?.tasker?.id) {
      data.tasker_id = data.bot.tasker.id;
    }
    if (data.bot?.tasker?.name) {
      data.tasker_name = data.bot.tasker.name;
    }
    
    // 初始化基础sender对象（如果不存在）
    if (data.user_id && !data.sender) {
      data.sender = { user_id: data.user_id };
    }
    
    // 扩展事件方法（通用方法）
    this._extendEventMethods(data);
  }

  /**
   * 扩展事件方法（通用方法）
   * 为事件对象添加通用的辅助方法
   * @param {Object} data - 事件数据对象
   */
  _extendEventMethods(data) {
    if (!data.reply && data.bot?.sendMsg) {
      const botInstance = data.bot;
      const selfId = data.self_id;
      data.reply = async (msg = '', quote = false, extraData = {}) => {
        if (!msg) return false;
        try {
          return await botInstance.sendMsg(msg, quote, extraData);
        } catch (error) {
          BotUtil.makeLog('error', `回复消息失败: ${error.message}`, selfId);
          return false;
        }
      };
    }
    
    if (!data.getRoutes) {
      data.getRoutes = (options = {}) => this.getRouteList(options);
    }
  }

  /**
   * 获取已注册的HTTP路由列表
   * @param {Object} options
   * @param {boolean} [options.flat=true] - 是否返回扁平数组
   * @returns {Array} 路由列表
   */
  getRouteList({ flat = true } = {}) {
    if (!ApiLoader?.apis) return [];
    
    const apiEntries = ApiLoader.priority?.length
      ? ApiLoader.priority
      : Array.from(ApiLoader.apis.values());
    
    const result = apiEntries.map(api => {
      const apiName = api?.name || api?.key || 'undefined';
      const apiDesc = api?.dsc || apiName;
      const routes = Array.isArray(api?.routes) ? api.routes : [];
      
      return {
        api: apiName,
        dsc: apiDesc,
        routes: routes
          .filter(r => r?.path && r?.method)
          .map(r => ({
            api: apiName,
            method: String(r.method || '').toUpperCase(),
            path: r.path,
            name: r.name || r.id || '',
            desc: r.dsc || r.title || r.description || apiDesc
          }))
      };
    });
    
    if (!flat) return result;
    return result.flatMap(item => item.routes);
  }

  /**
   * 触发事件
   * @param {string} name - 事件名
   * @param {Object} data - 事件数据
   * @param {boolean} asJson - 是否等待stdin输出并返回JSON结果
   * @param {Object} options - 可选配置
   * @param {number} [options.timeout=5000] - 等待输出超时时间
   * @returns {Promise<*>|void}
   */
  async em(name = "", data = {}, asJson = false, options = {}) {
    this.prepareEvent(data);
    
    if (!asJson) {
      this._cascadeEmit(name, data);
      return;
    }
    
    const timeout = Number(options.timeout) || 5000;
    return await this._emitAndCollect(name, data, timeout);
  }
  
  /**
   * em 的简写形式，支持收集stdin输出
   * @param {string} name - 事件名
   * @param {Object} data - 事件数据
   * @param {boolean} asJson - 是否等待stdin输出并返回JSON结果
   * @param {Object} options - 可选配置
   */
  async e(name = "", data = {}, asJson = false, options = {}) {
    return this.em(name, data, asJson, options);
  }
  
  /**
   * 供HTTP层调用的stdin命令封装
   * @param {string|Array|Object} command - 要执行的命令或消息
   * @param {Object} options
   * @param {Object} [options.user_info={}] - 用户信息
   * @param {number} [options.timeout=5000] - 等待输出超时时间
   * @returns {Promise<Object>} 命令结果或stdin输出
   */
  async callStdin(command, { user_info = {}, timeout = 5000 } = {}) {
    const stdinHandler = global.stdinHandler;
    
    if (!stdinHandler?.processCommand) {
      throw this.makeError('stdin handler not initialized', 'StdinUnavailable');
    }
    
    const waitOutput = this._waitForStdinOutput(timeout);
    const result = await stdinHandler.processCommand(command, {
      ...user_info,
      tasker: user_info.tasker || 'api'
    });
    
    const output = await waitOutput;
    return output || result;
  }
  
  /**
   * 通过stdin执行命令的封装别名，方便HTTP层调用
   * @param {string|Array|Object} command - 要执行的命令或消息
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 结果
   */
  async runCommand(command, options = {}) {
    return this.callStdin(command, options);
  }
  
  /**
   * 获取已注册路由的扁平/分组列表
   * @param {Object} options
   * @returns {Array}
   */
  getRoutes(options = {}) {
    return this.getRouteList(options);
  }
  
  /**
   * 直接调用已注册的HTTP路由（内部快捷调用，无需额外HTTP客户端）
   * @param {string} routePath - 路由路径，如 /api/status
   * @param {Object} options
   * @param {string} [options.method='GET'] - HTTP方法
   * @param {Object} [options.query] - 查询参数
   * @param {any} [options.body] - 请求体（自动JSON序列化）
   * @param {Object} [options.headers] - 额外请求头
   * @param {string} [options.baseUrl] - 自定义基础URL，默认当前服务URL
   * @param {number} [options.timeout=5000] - 超时毫秒
   * @returns {Promise<Object>} 响应结果
   */
  async callRoute(routePath, {
    method = 'GET',
    query = {},
    body,
    headers = {},
    baseUrl,
    timeout = 5000
  } = {}) {
    if (!routePath) {
      throw this.makeError('routePath is required', 'RouteError');
    }
    
    const fetchFn = globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      throw this.makeError('fetch is not available in current runtime', 'RouteError');
    }
    
    const url = new URL(routePath, baseUrl || this.getServerUrl());
    if (query && typeof query === 'object') {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.append(k, v);
      }
    }
    
    const controller = typeof AbortController === 'function'
      ? new AbortController()
      : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeout)
      : null;
    
    const options = {
      method: String(method || 'GET').toUpperCase(),
      headers: { ...headers }
    };
    if (controller) options.signal = controller.signal;
    
    const needBody = !['GET', 'HEAD'].includes(options.method);
    if (needBody && body !== undefined) {
      if (typeof body === 'string' || body instanceof Blob || body instanceof ArrayBuffer) {
        options.body = body;
      } else if (body instanceof URLSearchParams || body instanceof FormData) {
        options.body = body;
      } else {
        options.body = JSON.stringify(body);
        if (!options.headers['Content-Type'] && !options.headers['content-type']) {
          options.headers['Content-Type'] = 'application/json';
        }
      }
    }
    
    try {
      const response = await fetchFn(url, options);
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      
      return {
        ok: response.ok,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        data,
        raw: text
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  
  _cascadeEmit(name, data) {
    while (name) {
      this.emit(name, data);
      const lastDot = name.lastIndexOf(".");
      if (lastDot === -1) break;
      name = name.slice(0, lastDot);
    }
  }
  
  async _emitAndCollect(name, data, timeout = 5000) {
    const waitOutput = this._waitForStdinOutput(timeout);
    this._cascadeEmit(name, data);
    return await waitOutput;
  }
  
  _waitForStdinOutput(timeout = 5000) {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeout);
      
      const handler = (payload) => {
        cleanup();
        resolve(payload);
      };
      
      const cleanup = () => {
        clearTimeout(timer);
        this.off('stdin.output', handler);
      };
      
      this.once('stdin.output', handler);
    });
  }

  /**
   * 发送消息给主人（通用函数）
   * 支持OneBot（通过pickFriend）和其他适配器
   */
  async sendMasterMsg(msg, sleep = 5000) {
    const masterQQs = cfg.masterQQ;
    const results = {};
    
    for (let i = 0; i < masterQQs.length; i++) {
      const user_id = masterQQs[i];
      const pickFn = this.pickFriend || this.pickUser;
      const friend = pickFn.call(this, user_id);
      results[user_id] = await friend.sendMsg(msg);
      BotUtil.makeLog("debug", `已发送消息给主人 ${user_id}`, '服务器');
      
      i < masterQQs.length - 1 && await BotUtil.sleep(sleep);
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