import './bootstrap-globals.js';
import path from 'path';
import fs from 'node:fs/promises';
import * as fsSync from 'fs';
import { EventEmitter } from "events";
import express from "express";
import http from "node:http";
import https from "node:https";
import dgram from 'node:dgram';
import { WebSocketServer } from "ws";
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import os from 'node:os';
import chalk from 'chalk';
import { createProxyMiddleware } from 'http-proxy-middleware';

import PluginLoader from "#infrastructure/plugins/loader.js";
import ListenerLoader from "#infrastructure/listener/loader.js";
import HttpApiLoader from "#infrastructure/http/loader.js";
import bootstrapRuntimePackages from "#infrastructure/config/loader.js";
import CommonConfigRegistry from "#infrastructure/commonconfig/loader.js";
import AiStreamLoader from "#infrastructure/ai-workflow/loader.js";
import RuntimeUtil from '#utils/runtime-util.js';
import { setRuntimeGlobal, getRuntimeGlobal } from '#utils/runtime-globals.js';
import runtimeConfig from '#infrastructure/config/config.js';
import {
  callSubserver as callSubserverApi,
  fetchSubserverToPath as fetchSubserverToPathApi,
  formatSubserverError,
  getSubserverConfig,
  isSubserverConnectionError
} from '#utils/subserver-client.js';
import { resolveSubserverFileUpstream } from '#utils/subserver-file-proxy.js';
import paths from '#utils/paths.js';
import { errorHandler, ErrorCodes } from '#utils/error-handler.js';
import HTTPBusinessLayer from '#utils/http-business.js';
import FrontendLauncher from '#infrastructure/frontend/launcher.js';
import { HttpResponse } from '#utils/http-utils.js';
import { InputValidator } from '#utils/input-validator.js';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import * as runtimeAuth from '#infrastructure/http/runtime-auth.js';
import * as runtimeWs from '#infrastructure/http/runtime-ws.js';
import * as runtimeListen from '#infrastructure/http/runtime-listen.js';
import * as runtimeProxy from '#infrastructure/http/runtime-proxy.js';

// 静态资源扩展名，用于基础放行（非鉴权）
const AUTH_STATIC_EXT_REGEX = /\.(html|css|js|json|png|jpg|jpeg|gif|svg|webp|ico|mp4|webm|mp3|wav|pdf|zip|woff|woff2|ttf|otf)$/i;

/**
 * AgentRuntime主类
 * 
 * 系统的核心类，负责HTTP服务器、WebSocket、插件管理、配置管理等。
 * 继承自EventEmitter，支持事件驱动架构。
 * 
 * @class AgentRuntime
 * @extends EventEmitter
 * @example
 * // 仅入口允许（start.js / debug.js）；Core 业务用裸名 AgentRuntime
 * import AgentRuntime from './agent-runtime.js';
 * const runtime = new AgentRuntime();
 * await runtime.run({ port: 8086 });
 * runtime.on('online', ({ url }) => console.log(url));
 */
export default class AgentRuntime extends EventEmitter {
  _wsConnections = new Map();
  _rateLimiters = new Map();
  proxyMiddlewares = new Map();
  domainConfigs = new Map();
  sslContexts = new Map();
  bots = {};
  tasker = [];

  /**
   * AgentRuntime构造函数
   * 
   * 初始化AgentRuntime实例，设置Express应用、WebSocket服务器、配置等。
   * 自动初始化HTTP服务器、生成API密钥、设置信号处理等。
   */
  constructor() {
    super();
    
    // 核心属性初始化
    this.stat = { start_time: Date.now() / 1000 };
    this.bot = this;
    this.uin = this._createUinManager();
    
    // Express应用和服务器
    this.express = Object.assign(express(), { skip_auth: [], quiet: [] });
    this.server = null;
    this.httpsServer = null;
    this.multipartUpload = null;
    
    // WebSocket 服务器配置：尽量全部由 server.yaml 驱动（保留默认值）
    const wsConfig = runtimeConfig.server?.websocket || {};
    const perMessageDeflateCfg = wsConfig?.perMessageDeflate || {};
    const perMessageDeflateEnabled = perMessageDeflateCfg?.enabled !== false;
    const perMessageDeflate = perMessageDeflateEnabled ? {
      zlibDeflateOptions: {
        chunkSize: Number(perMessageDeflateCfg?.zlibDeflateOptions?.chunkSize) || 1024,
        memLevel: Number(perMessageDeflateCfg?.zlibDeflateOptions?.memLevel) || 7,
        level: Number(perMessageDeflateCfg?.zlibDeflateOptions?.level) || 3
      },
      zlibInflateOptions: {
        chunkSize: Number(perMessageDeflateCfg?.zlibInflateOptions?.chunkSize) || (10 * 1024)
      },
      clientNoContextTakeover: perMessageDeflateCfg?.clientNoContextTakeover !== false,
      serverNoContextTakeover: perMessageDeflateCfg?.serverNoContextTakeover !== false,
      serverMaxWindowBits: Number(perMessageDeflateCfg?.serverMaxWindowBits) || 10,
      concurrencyLimit: Number(perMessageDeflateCfg?.concurrencyLimit) || 10,
      threshold: Number(perMessageDeflateCfg?.threshold) || 1024
    } : false;
    
    const maxPayload = Number(wsConfig?.maxPayload);
    const maxPayloadBytes = Number.isFinite(maxPayload) && maxPayload > 0
      ? maxPayload
      : (100 * 1024 * 1024); // 100MB
    
    this.wss = new WebSocketServer({ 
      noServer: true,
      perMessageDeflate,
      maxPayload: maxPayloadBytes,
      clientTracking: wsConfig?.clientTracking !== false
    });
    this.wsf = Object.create(null);
    this.fs = Object.create(null);
    
    // WebSocket连接管理
    this._wsHeartbeatInterval = null;
    
    // 配置属性
    this.apiKey = '';
    const cacheTtl = Number(runtimeConfig.server?.misc?.cache?.ttlMs);
    this._cache = RuntimeUtil.getMap('core_cache', { ttl: (Number.isFinite(cacheTtl) && cacheTtl > 0) ? cacheTtl : 60000, autoClean: true });
    this._authWhitelistCache = { ref: null, rules: [] };
    this.httpPort = null;
    this.httpsPort = null;
    this.actualPort = null;
    this.actualHttpsPort = null;
    const configuredUrl = this._getConfiguredServerUrl();
    this.url = configuredUrl;
    
    // 反向代理相关
    this.proxyEnabled = false;
    this.proxyApp = null;
    this.proxyServer = null;
    this.proxyHttpsServer = null;
    
    // HTTP业务层初始化（企业级网络服务核心）
    // 注意：此时runtimeConfig.server可能还未加载，会在run()方法中重新初始化
    this.httpBusiness = new HTTPBusinessLayer(runtimeConfig.server || {});
    
    // 基类挂载：将HTTP业务层方法挂载到AgentRuntime实例，方便直接调用
    this._mountHttpBusinessMethods();
    
    this.HttpApiLoader = HttpApiLoader;
    this._initHttpServer();
    this._initSubServer();
    
    // 安全规则的编译缓存（避免每个请求重复解析）
    this._compiledHiddenFileMatchers = null;
    
    return this._createProxy();
  }

  _initSubServer() {
    /** 可选扩展：业务 Core 调用子服务 apis/ 时使用，见 #utils/subserver-client.js */
    this.callSubserver = async (requestPath, options = {}) => {
      try {
        return await callSubserverApi(requestPath, options);
      } catch (error) {
        const cause = error.cause ? ` cause=${error.cause?.message ?? error.cause}` : '';
        RuntimeUtil.makeLog('debug', `子服务端调用失败 [${requestPath}]: ${error.message}${cause}`, 'AgentRuntime');
        throw error;
      }
    };
    this.fetchSubserverToPath = async (requestPath, options = {}) => {
      try {
        return await fetchSubserverToPathApi(requestPath, options);
      } catch (error) {
        const cause = error.cause ? ` cause=${error.cause?.message ?? error.cause}` : '';
        RuntimeUtil.makeLog('debug', `子服务端文件拉取失败 [${requestPath}]: ${error.message}${cause}`, 'AgentRuntime');
        throw error;
      }
    };
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

    if (Error.isError(message)) {
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

    error.source = 'AgentRuntime';
    const logMessage = `${type}: ${error.message}`;
    const logDetails = Object.keys(details).length > 0 ?
      chalk.gray(` Details: ${JSON.stringify(details)}`) : '';

    RuntimeUtil.makeLog('error', chalk.red(`✗ ${logMessage}${logDetails}`), type);

    if (error.stack && runtimeConfig.debug) {
      RuntimeUtil.makeLog('debug', chalk.gray(error.stack), type);
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
    // HTTP服务器配置：优先读取 server.yaml（performance.keepAlive / performance.httpServer）
    const perfCfg = runtimeConfig.server?.performance || {};
    const keepAliveCfg = perfCfg?.keepAlive || {};
    const httpServerCfg = perfCfg?.httpServer || {};
    
    const keepAliveEnabled = keepAliveCfg?.enabled !== false;
    const keepAliveInitialDelay = Number(keepAliveCfg?.initialDelay) || 1000;
    const socketTimeout = Number(httpServerCfg?.socketTimeout) || Number(keepAliveCfg?.timeout) || 120000;
    const serverTimeout = Number(httpServerCfg?.serverTimeout) || Number(keepAliveCfg?.timeout) || 120000;
    const headersTimeout = Number(httpServerCfg?.headersTimeout) || 60000;
    const maxHeadersCount = Number(httpServerCfg?.maxHeadersCount) || 2000;
    const maxRequestsPerSocket = Number(httpServerCfg?.maxRequestsPerSocket);

    // HTTP服务器配置（优化性能）
    const serverOptions = {
      keepAlive: keepAliveEnabled,
      keepAliveInitialDelay,
      maxHeadersCount,
      maxRequestsPerSocket: Number.isFinite(maxRequestsPerSocket) ? maxRequestsPerSocket : 0, // 0 = 无限制（适合长连接）
      timeout: serverTimeout,
      headersTimeout
    };
    
    this.server = http.createServer(serverOptions, this.express)
      .on("error", err => this._handleServerError(err, false))
      .on("upgrade", this.wsConnect.bind(this))
      .on("connection", (socket) => {
        // 设置socket超时
        socket.setTimeout(socketTimeout);
        socket.setKeepAlive(keepAliveEnabled, keepAliveInitialDelay);
      });
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
    RuntimeUtil.makeLog("error", err, isHttps ? "HTTPS服务器" : "HTTP服务器");
  }

  /**
   * 初始化代理应用和服务器
   */
  async _initProxyApp() {
    return runtimeProxy.initProxyApp(this);
  }

  /**
   * 加载域名SSL证书
   */
  async _loadDomainCertificates() {
    return runtimeProxy.loadDomainCertificates(this);
  }

  /**
   * 创建HTTPS代理服务器
   * 支持HTTP/2和SNI多域名
   */
  async _createHttpsProxyServer() {
    return runtimeProxy.createHttpsProxyServer(this);
  }

  /**
   * 创建代理选项（统一方法）
   * @param {Object} domainConfig - 域名配置
   * @returns {Object} 代理选项
   */
  _createProxyOptions(domainConfig) {
    return runtimeProxy.createProxyOptions(this, domainConfig);
  }

  /**
   * 创建域名专用代理中间件
   * @param {Object} domainConfig - 域名配置
   * @returns {Function} 代理中间件
   */
  _createProxyMiddleware(domainConfig) {
    return runtimeProxy.createDomainProxyMiddleware(this, domainConfig);
  }

  /**
   * 处理代理请求（统一入口）
   * @param {Object} req - Express请求对象
   * @param {Object} res - Express响应对象
   * @param {Function} next - Express next函数
   * @param {Object} domainConfig - 域名配置
   * @param {string} hostname - 主机名
   * @param {string} targetUrl - 目标URL
   */
  _handleProxyRequest(req, res, next, domainConfig, hostname, targetUrl) {
    return runtimeProxy.handleProxyRequest(this, req, res, next, domainConfig, hostname, targetUrl);
  }

  /**
   * 获取或创建代理中间件（带缓存）
   * @param {Object} domainConfig - 域名配置
   * @param {string} targetUrl - 目标URL
   * @returns {Function} 代理中间件
   */
  _getOrCreateProxyMiddleware(domainConfig, targetUrl) {
    return runtimeProxy.getOrCreateProxyMiddleware(this, domainConfig, targetUrl);
  }

  /**
   * 管理代理连接数（统一方法）
   * @param {string} domain - 域名
   * @param {string} targetUrl - 目标URL
   * @param {string} operation - 操作：'increment' 或 'decrement'
   */
  _manageProxyConnection(domain, targetUrl, operation) {
    return runtimeProxy.manageProxyConnection(this, domain, targetUrl, operation);
  }

  /**
   * 处理代理请求开始（统一回调）
   * @param {Object} proxyReq - 代理请求对象
   * @param {Object} req - Express请求对象
   * @param {Object} domainConfig - 域名配置
   */
  _handleProxyRequestStart(proxyReq, req, domainConfig) {
    return runtimeProxy.handleProxyRequestStart(this, proxyReq, req, domainConfig);
  }

  /**
   * 处理代理响应（统一回调）
   * @param {Object} proxyRes - 代理响应对象
   * @param {Object} req - Express请求对象
   * @param {Object} res - Express响应对象
   * @param {Object} domainConfig - 域名配置
   */
  _handleProxyResponse(proxyRes, req, res, domainConfig) {
    return runtimeProxy.handleProxyResponse(this, proxyRes, req, res, domainConfig);
  }

  /**
   * 处理代理错误（统一回调）
   * @param {Error} err - 错误对象
   * @param {Object} req - Express请求对象
   * @param {Object} res - Express响应对象
   * @param {Object} domainConfig - 域名配置
   */
  _handleProxyError(err, req, res, domainConfig) {
    return runtimeProxy.handleProxyError(this, err, req, res, domainConfig);
  }

  /**
   * 查找域名配置（支持通配符）
   */
  _findDomainConfig(hostname) {
    return runtimeProxy.findDomainConfig(this, hostname);
  }

  /**
   * 查找通配符SSL证书
   */
  _findWildcardContext(servername) {
    return runtimeProxy.findWildcardContext(this, servername);
  }

  /**
   * 挂载 HTTP 业务层方法到 AgentRuntime 实例（文档：docs/runtime-surface.md）
   */
  _mountHttpBusinessMethods() {
    // 挂载代理管理器方法
    if (this.httpBusiness?.proxyManager) {
      this.selectProxyUpstream = (domain, algorithm, clientIP) => {
        return this.httpBusiness.proxyManager.selectUpstream(domain, algorithm, clientIP);
      };
      
      this.getProxyStats = () => {
        return this.httpBusiness.proxyManager.getStats();
      };
    }
    
    // 挂载CDN管理器方法
    if (this.httpBusiness?.cdnManager) {
      this.isCDNRequest = (req) => {
        return this.httpBusiness.cdnManager.isCDNRequest(req);
      };
      
      this.setCDNHeaders = (res, filePath, req) => {
        return this.httpBusiness.cdnManager.setCDNHeaders(res, filePath, req);
      };
    }
    
    // 挂载重定向管理器方法
    if (this.httpBusiness?.redirectManager) {
      this.handleRedirect = (req, res) => {
        return this.httpBusiness.redirectManager.check(req, res);
      };
    }
  }

  /**
   * 重新初始化HTTP业务层（配置加载后调用）
   */
  _reinitHttpBusiness() {
    const serverCfg = runtimeConfig.server || {};
    const sig = JSON.stringify(serverCfg);
    if (this._httpBusinessCfgSig === sig && this.httpBusiness) return;
    this._httpBusinessCfgSig = sig;
    this.httpBusiness = new HTTPBusinessLayer(serverCfg);
    this._mountHttpBusinessMethods();
  }

  /**
   * 提取客户端真实IP（考虑CDN和代理）
   * @param {Object} req - Express请求对象
   * @returns {string} 客户端IP
   */
  _extractClientIP(req) {
    return runtimeProxy.extractClientIP(this, req);
  }

  /**
   * 初始化中间件和路由
   * 按照nginx风格的路由匹配顺序：精确匹配 > 前缀匹配 > 正则匹配 > 默认
   */
  async _initializeMiddlewareAndRoutes() {
    // 预先获取前端挂载前缀，用于后续跳过业务重定向（sign.json + FrontendLauncher）
    let frontendMountPrefixes = [];
    try {
      const apps = await FrontendLauncher.discover();
      if (apps && apps.size > 0) {
        frontendMountPrefixes = Array.from(apps.values())
          .map(app => app && app.config)
          .filter(Boolean)
          .map(cfgApp => {
            const mountPath = (cfgApp.mountPath && String(cfgApp.mountPath).trim()) || `/${cfgApp.id}`;
            return mountPath;
          });
      }
    } catch {
      frontendMountPrefixes = [];
    }

    // ========== 第一阶段：全局中间件（所有请求） ==========
    // 1. 请求追踪和基础信息
    this.express.use((req, res, next) => {
      req.startTime = Date.now();
      req.requestId = `${Date.now()}-${RuntimeUtil.shortId()}`;
      next();
    });
    
    // 2. 压缩中间件（优先处理，减少传输，支持brotli）
    if (runtimeConfig.server.compression.enabled !== false) {
      // 使用标准 compression 中间件，统一对可压缩内容启用 gzip/br 等，避免对 API/静态做差别待遇
      this.express.use(compression({
        filter: (req, res) => {
          // 显式禁止压缩的请求
          if (req.headers['x-no-compression']) return false;
          return compression.filter(req, res);
        },
        level: runtimeConfig.server.compression.level || 6,
        threshold: runtimeConfig.server.compression.threshold || 1024
      }));
    }
    
    // 3. 安全头部（在所有响应前设置）
    if (runtimeConfig.server.security.helmet.enabled !== false) {
      const useHttps = runtimeConfig.server?.https?.enabled === true;
      this.express.use(helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        // COOP 仅在 HTTPS 时启用，否则非 localhost 会报 "untrustworthy origin" 并被忽略
        crossOriginOpenerPolicy: useHttps ? { policy: 'same-origin-allow-popups' } : false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        hsts: runtimeConfig.server.security.hsts.enabled === true ? {
          maxAge: runtimeConfig.server.security.hsts.maxAge || 31536000,
          includeSubDomains: runtimeConfig.server.security.hsts.includeSubDomains !== false,
          preload: runtimeConfig.server.security.hsts.preload === true
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

    // 为业务层注入统一 multipart 上传器与限额配置
    this.express.use((req, res, next) => {
      req.multipartUpload = this.multipartUpload;
      req.createMultipartUploader = (options = {}) => this._createMultipartUploader(options);
      req.serverLimits = runtimeConfig.server?.limits || {};
      next();
    });
    
    this.express.use((req, res, next) => {
      const baseSkipPrefixes = ['/api/', '/media/', '/uploads/', '/File', '/core/', '/subserver-file'];
      if (!req.path || req.path === '/') return next();
      const redirectSkipPrefixes = baseSkipPrefixes.concat(frontendMountPrefixes || []);
      if (redirectSkipPrefixes.some(p => req.path.startsWith(p))) {
        return next();
      }

      if (this.httpBusiness.handleRedirect(req, res)) {
        return;
      }
      next();
    });
    
    // ========== 第三阶段：精确路由匹配（优先级最高） ==========
    // 系统路由（精确匹配，无需认证）
    this.express.get('/status', this._statusHandler.bind(this));
    this.express.get('/health', this._healthHandler.bind(this));
    this.express.get('/subserver-file', this._subserverFileHandler.bind(this));
    this.express.get('/metrics', this._metricsHandler.bind(this)); // 性能指标
    this.express.get('/robots.txt', this._handleRobotsTxt.bind(this));
    this.express.get('/favicon.ico', this._handleFavicon.bind(this));

    // ========== 第四阶段：前缀路由匹配 ==========
    // 文件服务路由（/File前缀）
    this.express.use('/File', this._fileHandler.bind(this));
    
    // ========== 第五阶段：认证中间件（API和受保护资源） ==========
    // 认证中间件（对需要认证的路径生效）
    this.express.use(this._authMiddleware.bind(this));
    
    // ========== 第六阶段：数据目录静态服务（media/uploads） ==========
    // 将 /media 和 /uploads 映射到 data 目录，而不是 www 目录
    this._setupDataStaticServing();
    
    // ========== 第八阶段：静态文件服务（最后匹配） ==========
    // 注意：静态文件服务应该在API路由之后，避免拦截API请求
    // API路由在HttpApiLoader.register中注册，会通过优先级确保在静态文件服务之前
    // 静态文件服务已经添加了 /api/ 路径跳过逻辑，确保不会拦截API请求
    await this._setupStaticServing();
  }

  /**
   * 配置CORS跨域
   * 适配最新HTTP生态，支持预检请求和凭证传递
   */
  _setupCors() {
    const corsConfig = runtimeConfig.server.cors;
    if (corsConfig.enabled === false) return;
    
    this.express.use((req, res, next) => {
      if (this._checkHeadersSent(res, next)) return;
      
      const config = corsConfig || {};
      const allowedOrigins = config.origins || ['*'];
      const origin = req.headers.origin;
      const exposeHeaders = Array.isArray(config.exposeHeaders) && config.exposeHeaders.length
        ? config.exposeHeaders.join(', ')
        : 'X-Request-Id, X-Response-Time';
      
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
          exposeHeaders);
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
        exposeHeaders);
      
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
    if (runtimeConfig.server.logging.requests === false) return;
    
    this.express.use((req, res, next) => {
      const start = Date.now();
      
      // 设置请求ID（用于追踪）
      if (!req.requestId) {
        req.requestId = `${Date.now()}-${RuntimeUtil.shortId()}`;
      }
      
      // 在响应发送前设置头部
      if (!res.headersSent) {
        res.setHeader('X-Request-Id', req.requestId);
      }
      
      // 监听响应完成事件，记录日志
      res.once('finish', () => {
        const duration = Date.now() - start;
        
        const quietPaths = runtimeConfig.server.logging.quiet || [];
        if (!quietPaths.some(p => req.path.startsWith(p))) {
          const statusColor = res.statusCode < 400 ? 'green' :
                             res.statusCode < 500 ? 'yellow' : 'red';
          const method = chalk.cyan(req.method.padEnd(6));
          const status = chalk[statusColor](res.statusCode);
          const time = chalk.gray(`${duration}ms`.padStart(7));
          const path = chalk.white(req.path);
          const host = req.hostname ? chalk.gray(` [${req.hostname}]`) : '';
          const requestId = chalk.gray(` [${req.requestId}]`);
          
          RuntimeUtil.makeLog('debug', `${method} ${status} ${time} ${path}${host}${requestId}`, 'HTTP');
        }
      });
      
      // 拦截 writeHead 和 end 方法，在响应发送前设置响应时间头
      const originalWriteHead = res.writeHead;
      res.writeHead = function(...args) {
        const duration = Date.now() - start;
        if (!res.headersSent) {
          res.setHeader('X-Response-Time', `${duration}ms`);
        }
        return originalWriteHead.apply(this, args);
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
    const dataCacheTime = runtimeConfig.server?.static?.dataCacheTime || '1h';
    const staticOptions = {
      dotfiles: 'deny',
      fallthrough: false, // 不继续到下一个中间件，避免与 www 静态服务冲突
      maxAge: dataCacheTime,
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
      index: runtimeConfig.server.static.index || ['index.html', 'index.htm'],
      dotfiles: 'deny',
      extensions: runtimeConfig.server.static.extensions || false,
      fallthrough: true,
      maxAge: runtimeConfig.server.static.cacheTime || '1d',
      etag: true,
      lastModified: true,
      immutable: runtimeConfig.server.static.immutable !== false,
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
    // ========== 动态前端开发代理（sign.json 声明的 dev server） ==========
    try {
      const apps = await FrontendLauncher.start();
      if (apps && apps.size > 0) {
        const devApps = Array.from(apps.values()).filter(app => app && app.config);

        // 为每个前端项目注册入口代理：由 sign.json 的 proxy.mount 或 id 决定
        for (const appInfo of devApps) {
          const cfgApp = appInfo.config;
          const appId = cfgApp.id;
          const mountPath = (cfgApp.mountPath && String(cfgApp.mountPath).trim()) || `/${appId}`;
          const defaultPort = cfgApp.port;

          const mountPrefix = mountPath.endsWith('/')
            ? mountPath.slice(0, -1)
            : mountPath;

          const devProxy = createProxyMiddleware({
            target: `http://127.0.0.1:${defaultPort}`,
            router: () => {
              const port = FrontendLauncher.getRuntimePort(appId) ?? defaultPort;
              return `http://127.0.0.1:${port}`;
            },
            changeOrigin: true,
            ws: true,
            logLevel: 'warn',
            pathRewrite: (pathReq) => {
              if (!pathReq) return `${mountPrefix}/`;
              if (pathReq === '/') return `${mountPrefix}/`;
              if (pathReq.startsWith('/')) return `${mountPrefix}${pathReq}`;
              return `${mountPrefix}/${pathReq}`;
            }
          });

          this.express.use(mountPath, (req, res, next) => {
            RuntimeUtil.makeLog(
              'debug',
              `[前端入口] id=${appId} mount=${mountPath} ${req.method} ${req.originalUrl}`,
              'Frontend'
            );
            return devProxy(req, res, next);
          });

          RuntimeUtil.makeLog(
            'info',
            `注册前端开发入口: ${mountPath} -> http://127.0.0.1:${defaultPort}`,
            'Frontend'
          );
        }
      }
    } catch (e) {
      RuntimeUtil.makeLog('warn', `初始化前端开发代理失败: ${e.message}`, 'Frontend');
    }

    // ========== 目录索引与静态文件服务 ==========
    this.express.use((req, res, next) => {
      if (this._checkHeadersSent(res, next)) return;
      this._directoryIndexMiddleware(req, res, next);
    });
    
    // 静态文件安全中间件（已优化，跳过API）
    this.express.use(this._staticSecurityMiddleware.bind(this));
    
    const staticOptions = this._createStaticOptions();
    const { mountCoreWwwStatic } = await import('#infrastructure/http/mount-core-www.js');
    await mountCoreWwwStatic(this.express, staticOptions);

    this.express.use((req, res, next) => {
      if (this._checkHeadersSent(res, next)) return;
      
      const staticRoot = req.staticRoot || paths.www;
      
      // 确保目录存在（recursive: true 会自动处理已存在的情况）
      fsSync.mkdirSync(staticRoot, { recursive: true });
      
      express.static(staticRoot, staticOptions)(req, res, next);
    });
  }

  /**
   * 目录索引中间件
   * 仅对无扩展名且非 / 结尾的路径尝试做目录重定向
   */
  _directoryIndexMiddleware(req, res, next) {
    if (res.headersSent) return next();
    
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
        const indexFiles = runtimeConfig.server.static.index || ['index.html', 'index.htm'];
        
        for (const indexFile of indexFiles) {
          const indexPath = path.join(dirPath, indexFile);
          try {
            if (fsSync.statSync(indexPath).isFile()) {
              const redirectUrl = req.path + '/';
              RuntimeUtil.makeLog('debug', `目录重定向：${req.path} → ${redirectUrl}`, '服务器');
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
    
    const cacheConfig = runtimeConfig.server.static.cache || {};
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

  /** 静态文件安全中间件：对所有请求路径做规范化与隐藏规则校验（与鉴权解耦） */
  _staticSecurityMiddleware(req, res, next) {
    if (this._checkHeadersSent(res, next)) return;
    
    // req.path 始终是 URL 路径（/ 分隔），在 Windows 下使用 path.normalize 会引入反斜杠导致规则失效
    const normalizedPath = path.posix.normalize(req.path);
    
    if (normalizedPath.includes('..')) {
      return res.status(403).json({ error: '禁止访问' });
    }
    
    const isHidden = this._isHiddenStaticPath(normalizedPath);
    
    if (isHidden) {
      return res.status(404).json({ error: '未找到' });
    }
    
    next();
  }

  /**
   * 判断静态路径是否命中隐藏规则（server.yaml: security.hiddenFiles）
   * - 字符串规则：默认按“字面包含”匹配
   * - 看起来像正则的字符串（包含 \\ 或以 ^ 开头 / 以 $ 结尾等）：按正则匹配
   */
  _isHiddenStaticPath(normalizedPath) {
    if (!normalizedPath) return false;
    if (!this._compiledHiddenFileMatchers) {
      const raw = runtimeConfig.server?.security?.hiddenFiles;
      const patterns = (Array.isArray(raw) && raw.length)
        ? raw
        : ['^\\..*', '/\\.', 'node_modules', '\\.git'];
      
      const compiled = [];
      for (const p of patterns) {
        if (p instanceof RegExp) {
          compiled.push({ type: 'regex', value: p });
          continue;
        }
        if (typeof p !== 'string') continue;
        const s = p.trim();
        if (!s) continue;
        
        const looksLikeRegex = s.startsWith('^') || s.endsWith('$') || s.includes('\\') || s.includes('[') || s.includes('(') || s.includes('|') || s.includes('.*');
        if (looksLikeRegex) {
          try {
            compiled.push({ type: 'regex', value: new RegExp(s) });
            continue;
          } catch {
            // 回退到字面包含
          }
        }
        
        compiled.push({ type: 'includes', value: s });
      }
      
      this._compiledHiddenFileMatchers = compiled;
    }
    
    return this._compiledHiddenFileMatchers.some(m => {
      if (m.type === 'regex') return m.value.test(normalizedPath);
      if (m.type === 'includes') return normalizedPath.includes(m.value);
      return false;
    });
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
    
    const robotsCfg = runtimeConfig.server?.robots || {};
    if (robotsCfg?.enabled === false) {
      if (!res.headersSent) res.status(404).end();
      return;
    }
    
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
    
    const contentOverride = typeof robotsCfg?.content === 'string' ? robotsCfg.content : '';
    const disallow = Array.isArray(robotsCfg?.disallow) && robotsCfg.disallow.length
      ? robotsCfg.disallow
      : ['/api/', '/config/', '/data/', '/lib/', '/plugins/', '/trash/'];
    const allow = Array.isArray(robotsCfg?.allow) && robotsCfg.allow.length
      ? robotsCfg.allow
      : ['/'];
    const sitemapPath = (robotsCfg?.sitemapPath && String(robotsCfg.sitemapPath).trim()) || '/sitemap.xml';
    const autoSitemap = robotsCfg?.autoSitemap !== false;
    
    const sitemapUrl = `${this.getServerUrl().replace(/\/$/, '')}${sitemapPath.startsWith('/') ? sitemapPath : `/${sitemapPath}`}`;
    
    let defaultRobots = contentOverride || [
      'User-agent: *',
      ...disallow.map(p => `Disallow: ${p}`),
      ...allow.map(p => `Allow: ${p}`),
      ''
    ].join('\n');
    
    if (autoSitemap && !/^\s*Sitemap:/mi.test(defaultRobots)) {
      defaultRobots = `${defaultRobots}\nSitemap: ${sitemapUrl}`;
    }
    
    if (!res.headersSent) {
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.send(defaultRobots);
    }
  }

  /**
   * 速率限制配置
   */
  _setupRateLimiting() {
    const rateLimitConfig = runtimeConfig.server.rateLimit;
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
    const limits = runtimeConfig.server.limits || {};
    
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

    this.express.use(express.text({
      type: ['text/*', 'application/xml'],
      limit: limits.text || '10mb'
    }));

    // multipart 统一上传器（供业务 API 复用，统一限额）
    this._setupMultipartUploader();
  }

  _parseByteSize(value, fallback = 10 * 1024 * 1024) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
    if (typeof value !== 'string') return fallback;
    const s = value.trim().toLowerCase();
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m|gb|g|tb|t)?$/i);
    if (!m) return fallback;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    const unit = (m[2] || 'b').toLowerCase();
    const mul =
      unit === 'b' ? 1 :
      (unit === 'kb' || unit === 'k') ? 1024 :
      (unit === 'mb' || unit === 'm') ? 1024 ** 2 :
      (unit === 'gb' || unit === 'g') ? 1024 ** 3 :
      (unit === 'tb' || unit === 't') ? 1024 ** 4 :
      1;
    return Math.floor(n * mul);
  }

  _setupMultipartUploader() {
    this.multipartUpload = this._createMultipartUploader();
  }

  _getServerHost() {
    const host = runtimeConfig?.server?.server?.host;
    return (typeof host === 'string' && host.trim()) ? host.trim() : '0.0.0.0';
  }

  _getConfiguredServerUrl() {
    const configuredUrl = runtimeConfig?.server?.server?.url;
    return (typeof configuredUrl === 'string') ? configuredUrl.trim() : '';
  }

  _getProxyConfig() {
    return runtimeConfig?.server?.proxy || {};
  }

  _isHttpsEnabled() {
    return runtimeConfig?.server?.https?.enabled === true;
  }

  _createMultipartUploader(options = {}) {
    const limitsCfg = runtimeConfig.server.limits || {};
    const fileSize = this._parseByteSize(options.fileSize || limitsCfg.fileSize || '100mb', 100 * 1024 * 1024);
    const files = Number.isFinite(Number(options.files))
      ? Number(options.files)
      : (Number.isFinite(Number(limitsCfg.files)) ? Number(limitsCfg.files) : 8);

    const multerOptions = {
      limits: { fileSize, files }
    };
    if (options.storage) multerOptions.storage = options.storage;
    if (options.fileFilter) multerOptions.fileFilter = options.fileFilter;
    return multer(multerOptions);
  }


  /**
   * 创建 AgentRuntime 代理：AgentRuntime[self_id] → bots 映射；未命中时透传 RuntimeUtil 静态成员（文档：docs/runtime-surface.md）
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
        if (prop === Symbol.toStringTag) return 'AgentRuntime';
        // 1. 优先返回 AgentRuntime 自身属性
        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }

        // 2. 其次返回已注册的子 AgentRuntime 实例
        if (prop in botMap) {
          return botMap[prop];
        }

        // 3. 最后透明代理到 RuntimeUtil 的静态方法/属性（仅限自有属性，避免 Function 原型污染）
        if (typeof prop === 'string' && Object.hasOwn(RuntimeUtil, prop)) {
          const utilValue = RuntimeUtil[prop];
          return typeof utilValue === 'function'
            ? utilValue.bind(RuntimeUtil)
            : utilValue;
        }

      },
      set: (target, prop, value, receiver) => {
        if (isBotEntry(prop, value)) {
          botMap[prop] = value;
          return true;
        }
        return Reflect.set(target, prop, value, receiver);
      },
      has: (target, prop) => {
        return Reflect.has(target, prop) || 
               prop in botMap || 
               (typeof prop === 'string' && Object.hasOwn(RuntimeUtil, prop));
      },
      ownKeys: (target) => {
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor: (target, prop) => {
        if (Reflect.has(target, prop)) {
          return Reflect.getOwnPropertyDescriptor(target, prop);
        }
      }
    });
  }

  /**
   * 生成API密钥
   */
  async generateApiKey() {
    return runtimeAuth.generateApiKey(this);
  }

  _maskSensitive(value, keepStart = 6, keepEnd = 4) {
    return runtimeAuth.maskSensitive(value, keepStart, keepEnd);
  }

  /**
   * 认证中间件（HTTP）
   * 仅负责基础放行规则：静态资源
   * 具体业务鉴权（如 system-Core HTTP / 各 Core 自定义）由各自模块自行处理
   */
  _authMiddleware(req, res, next) {
    if (this._checkHeadersSent(res, next)) return;

    req.rid = `${req.ip}:${req.socket.remotePort}`;
    req.sid = `${req.protocol}://${req.hostname}:${req.socket.localPort}${req.originalUrl}`;

    if (AUTH_STATIC_EXT_REGEX.test(req.path)) {
      RuntimeUtil.makeLog('debug', `[Auth] 放行：静态资源 path=${req.path}`, '认证');
      return next();
    }

    next();
  }

  /**
   * 检查API授权
   * 当 server.auth.apiKey.enabled 为 true 时，必须提供有效密钥；密钥未加载或缺失时一律拒绝
   */
  checkApiAuthorization(req, options = {}) {
    return runtimeAuth.checkApiAuthorization(this, req, options);
  }

  _isApiWhitelistPath(requestPath) {
    return runtimeAuth.isApiWhitelistPath(this, requestPath);
  }

  _getAuthWhitelistRules() {
    return runtimeAuth.getAuthWhitelistRules(this);
  }

  /**
   * 归一化密钥候选值：转字符串、去空白、过滤空值
   */
  _normalizeApiKeyCandidate(value) {
    return runtimeAuth.normalizeApiKeyCandidate(value);
  }

  /**
   * 从 Authorization / Proxy-Authorization 提取密钥
   * 支持 Bearer/Token/ApiKey 三种常见方案；无方案时按裸 token 处理
   */
  _extractApiKeyFromAuthHeader(headerValue) {
    return runtimeAuth.extractApiKeyFromAuthHeader(headerValue);
  }

  /**
   * 从请求中提取 API Key（HTTP/WS 共用）
   */
  _extractApiKeyFromRequest(req) {
    return runtimeAuth.extractApiKeyFromRequest(req);
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
   * 获取路径的 WebSocket 处理器（兼容函数与对象结构）
   */
  _getWsHandlersForPath(wsPath) {
    return runtimeWs.getWsHandlersForPath(this, wsPath);
  }

  /**
   * 检查 WS 路径是否声明跳过系统级 API Key 鉴权
   */
  _isWsPathSkipAuth(wsPath) {
    return runtimeWs.isWsPathSkipAuth(this, wsPath);
  }

  /**
   * 是否要求当前 WS 连接进行系统级 API Key 鉴权
   */
  _shouldRequireWsApiAuth(wsPath) {
    return runtimeWs.shouldRequireWsApiAuth(this, wsPath);
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
        https: runtimeConfig.server?.https?.enabled || false,
        proxy: this.proxyEnabled,
        domains: this.proxyEnabled ? Array.from(this.domainConfigs.keys()) : []
      },
      auth: {
        apiKeyEnabled: runtimeConfig.server?.auth?.apiKey?.enabled !== false
      }
    };
    
    return HttpResponse.json(res, status);
  }

  /**
   * 健康检查处理器
   */
  _healthHandler(req, res) {
    if (this._checkHeadersSent(res)) return;

    return HttpResponse.json(res, {
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

    return HttpResponse.json(res, metrics);
  }

  /**
   * 子服务 data/ 文件直链：本地优先，缺失时按 data/<dir>/ 前缀代理到对应 runtime 的 /api/{group}/file
   */
  async _subserverFileHandler(req, res) {
    if (this._checkHeadersSent(res)) return;

    const rel = String(req.query.path || '').trim();
    if (!rel) {
      return HttpResponse.validationError(res, '缺少 path 参数');
    }

    let localPath;
    try {
      localPath = InputValidator.validatePath(rel, paths.root);
      InputValidator.assertPathUnderRoots(localPath, [paths.data]);
    } catch {
      return HttpResponse.validationError(res, '非法路径');
    }

    try {
      await fs.access(localPath);
      const stat = await fs.stat(localPath);
      if (!stat.isFile()) {
        return HttpResponse.notFound(res, '文件不存在');
      }

      const ext = path.extname(localPath).toLowerCase();
      const mime = ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(path.basename(localPath))}"`);
      return res.sendFile(localPath);
    } catch {
      /* 本地无文件时尝试从子服务流式代理 */
    }

    const upstream = resolveSubserverFileUpstream(rel);
    if (!upstream) {
      return HttpResponse.notFound(res, '文件不存在');
    }

    try {
      const response = await callSubserverApi(upstream.upstream, {
        method: 'GET',
        query: { path: rel },
        rawResponse: true,
        timeout: 600_000,
        runtime: upstream.runtime
      });

      const contentType = response.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      const contentDisposition = response.headers.get('content-disposition');
      if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);

      if (!response.body) {
        return HttpResponse.error(res, new Error('子服务端返回空响应'), 502, 'subserver-file');
      }

      res.status(response.status);
      await pipeline(Readable.fromWeb(response.body), res);
    } catch (error) {
      if (isSubserverConnectionError(error)) {
        const hint = formatSubserverError(error, getSubserverConfig(upstream.runtime));
        return HttpResponse.error(res, new Error(hint), 503, 'subserver-file');
      }
      return HttpResponse.notFound(res, '文件不存在');
    }
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
      
      RuntimeUtil.makeLog("debug", `文件发送：${file.name} (${RuntimeUtil.formatFileSize(file.buffer.length)})`, '服务器');
      
      res.send(file.buffer);
    }
  }

  /**
   * 启动WebSocket心跳检测
   * 定期检查连接状态，清理死连接
   */
  _startWebSocketHeartbeat() {
    return runtimeWs.startWebSocketHeartbeat(this);
  }

  /**
   * 停止WebSocket心跳检测
   */
  _stopWebSocketHeartbeat() {
    return runtimeWs.stopWebSocketHeartbeat(this);
  }

  /**
   * 获取WebSocket连接统计
   */
  getWebSocketStats() {
    return runtimeWs.getWebSocketStats(this);
  }

  /**
   * WebSocket连接处理
   * 所有 Tasker 暴露的 WS 路径（AgentRuntime.wsf）在此统一进行系统级鉴权：
   * - 其余连接若 server.auth.apiKey.enabled !== false，则必须通过 API Key 校验
   */
  wsConnect(req, socket, head) {
    return runtimeWs.wsConnect(this, req, socket, head);
  }

  /**
   * 处理端口已占用错误
   */
  async serverEADDRINUSE(err, isHttps) {
    return runtimeListen.serverEADDRINUSE(this, err, isHttps);
  }

  /**
   * 服务器加载完成
   */
  async serverLoad(isHttps) {
    return runtimeListen.serverLoad(this, isHttps);
  }

  /**
   * 启动代理服务器
   */
  async startProxyServers() {
    return runtimeProxy.startProxyServers(this);
  }

  /**
   * 显示代理信息
   */
  async _displayProxyInfo() {
    return runtimeProxy.displayProxyInfo(this);
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
    
    if (ipInfo.public && runtimeConfig.server?.misc?.detectPublicIP !== false) {
      console.log(chalk.yellow('\n  公网访问：'));
      const publicUrl = `${protocol}://${ipInfo.public}:${port}`;
      console.log(`    ${chalk.cyan('•')} ${chalk.white(publicUrl)}`);
    }
    
    const configuredUrl = this._getConfiguredServerUrl();
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
   * 统一加载SSL证书（避免重复代码）
   * @param {Object} certConfig - 证书配置对象
   * @param {string} context - 上下文名称（用于日志）
   * @returns {Promise<Object>} HTTPS选项对象
   */
  async _loadSSLCertificate(certConfig, context = '服务器') {
    return runtimeListen.loadSSLCertificate(certConfig, context);
  }

  /**
   * 加载HTTPS服务器
   * 支持HTTP/2和现代TLS配置
   */
  async httpsLoad() {
    return runtimeListen.httpsLoad(this);
  }

  /**
   * 设置最终处理器
   * 按照nginx风格：先处理API 404，再处理静态文件404
   */
  _setupFinalHandlers() {
    // API路由404处理（在HttpApiLoader.register之后，但先于全局404）
    // 这个已经在HttpApiLoader中处理了，这里作为兜底
    
    // 全局404处理（最后匹配，避免基于路径做“特殊待遇”）
    this.express.use((req, res) => {
      if (this._checkHeadersSent(res)) return;

      if (req.accepts('html')) {
        const staticRoot = req.staticRoot || paths.www;
        const custom404Path = path.join(staticRoot, '404.html');

        try {
          if (fsSync.statSync(custom404Path).isFile()) {
            res.status(404).sendFile(custom404Path);
            return;
          }
        } catch {
          // 文件不存在，继续走默认处理
        }

        res.status(404).send('404 Not Found');
      } else {
        res.status(404).json({
          error: '未找到',
          path: req.originalUrl || req.path,
          timestamp: Date.now()
        });
      }
    });
    
    // 全局错误处理（捕获所有未处理的错误）
    this.express.use((err, req, res, next) => {
      if (this._checkHeadersSent(res, next, err)) return;

      if (runtimeConfig.server?.logging?.errors !== false) {
        RuntimeUtil.makeLog('error', `请求错误 [${req.requestId || 'unknown'}]: ${err.message}`, '服务器', err);
      }

      if (err?.name === 'MulterError') {
        const code = err.code || 'MULTER_ERROR';
        if (code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            success: false,
            error: '上传文件过大',
            message: '文件大小超过限制',
            requestId: req.requestId,
            timestamp: Date.now()
          });
        }
        if (code === 'LIMIT_FILE_COUNT') {
          return res.status(413).json({
            success: false,
            error: '上传文件数量过多',
            message: '文件数量超过限制',
            requestId: req.requestId,
            timestamp: Date.now()
          });
        }
      }

      // 统一使用 JSON 结构返回错误，避免基于路径做特殊分支
      res.status(err.status || 500).json({
        success: false,
        error: '内部服务器错误',
        message: process.env.NODE_ENV === 'production'
          ? '发生了一个错误' : err.message,
        requestId: req.requestId,
        timestamp: Date.now()
      });
    });
  }

  /**
   * 关闭服务器
   * @param {{ fast?: boolean }} [options] fast 为 true 时跳过固定等待（用于 Ctrl+C 重启）
   */
  async closeServer(options = {}) {
    return runtimeListen.closeServer(this, options);
  }

  /**
   * 获取服务器URL
   */
  getServerUrl() {
    return runtimeListen.getServerUrl(this);
  }

  /**
   * 获取对外可访问的服务器 URL（用于 QQ 直链等）
   * 不回落到 127.0.0.1；无公网/代理配置时返回空字符串
   * @param {string} [override=''] - 业务覆盖 public_base_url
   */
  getPublicServerUrl(override = '') {
    const trimmed = typeof override === 'string' ? override.trim() : '';
    if (trimmed) {
      const withScheme = /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `${this._isHttpsEnabled() ? 'https' : 'http'}://${trimmed.replace(/^\/+/, '')}`;
      try {
        return new URL(withScheme).toString().replace(/\/+$/, '');
      } catch {
        return '';
      }
    }

    const proxyConfig = this._getProxyConfig();
    if (this.proxyEnabled && Array.isArray(proxyConfig.domains) && proxyConfig.domains[0]) {
      const domain = proxyConfig.domains[0];
      const protocol = domain.ssl?.enabled ? 'https' : 'http';
      return `${protocol}://${domain.domain}`.replace(/\/+$/, '');
    }

    const configuredUrl = this._getConfiguredServerUrl();
    if (configuredUrl) {
      const withScheme = /^https?:\/\//i.test(configuredUrl)
        ? configuredUrl
        : `${this._isHttpsEnabled() ? 'https' : 'http'}://${configuredUrl.replace(/^\/+/, '')}`;
      try {
        return new URL(withScheme).toString().replace(/\/+$/, '');
      } catch {
        return '';
      }
    }

    return '';
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
      
      if (runtimeConfig.server?.misc?.detectPublicIP !== false) {
        result.public = await this._getPublicIP();
      }
      
      this._cache.set(cacheKey, result);
      return result;
      
    } catch (err) {
      RuntimeUtil.makeLog("debug", `获取IP地址失败：${err.message}`, '服务器');
      return result;
    }
  }

  /**
   * 检查是否为虚拟网卡
   */
  _isVirtualInterface(name) {
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
      const udpCfg = runtimeConfig.server?.misc?.udpProbe || {};
      const probeHost = (udpCfg.host && String(udpCfg.host).trim()) || '223.5.5.5';
      const probePort = Number(udpCfg.port) || 80;
      const timeoutMs = Number(udpCfg.timeoutMs) || 3000;
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('UDP超时'));
      }, timeoutMs);
      
      try {
        socket.connect(probePort, probeHost, () => {
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
    // 使用多个API服务，提高成功率（可由 server.yaml 配置）
    const apis = (Array.isArray(runtimeConfig.server?.misc?.publicIpApis) && runtimeConfig.server.misc.publicIpApis.length)
      ? runtimeConfig.server.misc.publicIpApis
      : [
        'https://ifconfig.me/ip',
        'https://api.ipify.org',
        'https://icanhazip.com',
        'https://ipinfo.io/ip'
      ];
    const timeoutMs = Number(runtimeConfig.server?.misc?.publicIpTimeoutMs) || 3000;
    
    // 尝试每个API，直到成功
    for (const apiUrl of apis) {
      try {
        const response = await fetch(apiUrl, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'text/plain, */*'
          }
        });
        
        if (response.ok) {
          const text = await response.text();
          const ip = text.trim();
          
          if (ip && this._isValidIP(ip)) {
            return ip;
          }
        }
      } catch {
        // 继续尝试下一个API
        continue;
      }
    }
    
    RuntimeUtil.makeLog('debug', '获取公网IP失败，所有API均不可用', '服务器');
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
    const timings = {};
    const phase = async (name, fn) => {
      const t0 = Date.now();
      const result = await fn();
      timings[name] = Date.now() - t0;
      return result;
    };
    
    // 重新初始化HTTP业务层（确保使用最新配置）
    this._reinitHttpBusiness();
    
    // 初始化配置
    const proxyConfig = this._getProxyConfig();
    this.proxyEnabled = proxyConfig?.enabled === true;
    
    // 设置端口（优先级：参数 > 环境变量 > 默认值8080）
    this.actualPort = port || parseInt(process.env.XRK_SERVER_PORT, 10) || 8080;
    
    const httpsCfg = runtimeConfig.server?.https || {};
    const explicitHttpsPort = Number(httpsCfg.port);
    const httpsPortOffset = Number(httpsCfg.portOffset);
    this.actualHttpsPort = (Number.isFinite(explicitHttpsPort) && explicitHttpsPort > 0)
      ? explicitHttpsPort
      : (this.actualPort + (Number.isFinite(httpsPortOffset) ? httpsPortOffset : 1));
    
    if (this.proxyEnabled) {
      this.httpPort = proxyConfig.httpPort || 80;
      this.httpsPort = proxyConfig.httpsPort || 443;
    } else {
      this.httpPort = this.actualPort;
      this.httpsPort = this.actualHttpsPort;
    }
    
    if (this.proxyEnabled) {
      await phase('proxyInit', () => this._initProxyApp());
    }
    
    await phase('bootstrapPackages', () => bootstrapRuntimePackages());
    
    // XRK_SOFT_FAIL_STARTUP=1 时允许半开启动（仅排障）；默认 fail-fast，拒绝半死 listen
    const softFail = process.env.XRK_SOFT_FAIL_STARTUP === '1';

    // CommonConfig 先于 Plugins：AI 助手等 init 时需可读 CommonConfigRegistry
    try {
      await phase('commonConfig', () => CommonConfigRegistry.load());
      setRuntimeGlobal('CommonConfigRegistry', CommonConfigRegistry);
      setRuntimeGlobal('runtimeConfig', runtimeConfig);
    } catch (err) {
      RuntimeUtil.makeLog('error', `配置加载失败: ${err?.message}`, '服务器');
      if (!softFail) throw err;
    }

    const [streamResult, pluginsResult, apiResult] = await phase('loaders', () =>
      Promise.allSettled([
        AiStreamLoader.load(),
        PluginLoader.load(),
        HttpApiLoader.load()
      ])
    );

    const loaderFailures = [
      ['工作流', streamResult],
      ['插件', pluginsResult],
      ['API', apiResult]
    ].filter(([, r]) => r.status === 'rejected');

    for (const [label, result] of loaderFailures) {
      RuntimeUtil.makeLog('error', `${label}加载失败: ${result.reason?.message}`, '服务器');
    }
    if (loaderFailures.length && !softFail) {
      throw loaderFailures[0][1].reason;
    }

    const watchResults = await phase('watchSetup', () =>
      Promise.allSettled([
        CommonConfigRegistry.watch(true),
        AiStreamLoader.watch(true),
        PluginLoader.watch(true),
        HttpApiLoader.watch(true)
      ])
    );
    const watchLabels = ['配置', '工作流', '插件', 'API'];
    watchResults.forEach((result, i) => {
      if (result.status === 'rejected') {
        RuntimeUtil.makeLog('error', `${watchLabels[i]}热加载启动失败: ${result.reason?.message}`, '服务器');
      }
    });
    
    await phase('middleware', () => this._initializeMiddlewareAndRoutes());

    await phase('apiRegister', () => HttpApiLoader.register(this.express, this));
    this._setupFinalHandlers();

    await phase('apiKey', () => this.generateApiKey());

    // 启动HTTP/HTTPS服务器
    const originalHttpPort = this.httpPort;
    const originalHttpsPort = this.httpsPort;
    
    if (this.proxyEnabled) {
      this.httpPort = this.actualPort;
      this.httpsPort = this.actualHttpsPort;
    }
    
    await phase('httpListen', async () => {
      await this.serverLoad(false);
      if (this._isHttpsEnabled()) {
        await this.httpsLoad();
      }
    });
    
    if (this.proxyEnabled) {
      this.httpPort = originalHttpPort;
      this.httpsPort = originalHttpsPort;
      await phase('proxyListen', () => this.startProxyServers());
    }
    
    await phase('listener', () => ListenerLoader.load(this));
    
    const loadTime = Date.now() - startTime;
    runtimeConfig.enableWatching?.();
    await this._displayStartupSummary(loadTime, startTime, timings);
    
    this.emit("online", {
      bot: this,
      timestamp: Date.now(),
      url: this.getServerUrl(),
      uptime: process.uptime(),
      apis: HttpApiLoader.getApiList(),
      proxyEnabled: this.proxyEnabled
    });

    // 启动 trash 目录定时清理（仅清理一定时间之前的临时文件）
    this._startTrashCleaner();
  }

  /**
   * 显示启动汇总信息
   * 包含服务器配置、性能指标、服务状态等
   */
  async _displayStartupSummary(loadTime, startTime, timings = {}) {
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

    const phaseLabels = {
      proxyInit: '反向代理初始化',
      packageloader: 'bootstrapRuntimePackages',
      configLoader: '配置加载',
      loaders: 'Stream/Plugins/Api 并行加载',
      watchSetup: '热加载监视',
      middleware: '中间件与路由',
      apiRegister: 'API 注册',
      apiKey: 'API 密钥',
      httpListen: 'HTTP/HTTPS 监听',
      proxyListen: '代理监听',
      listener: '事件/Tasker'
    };
    const phaseEntries = Object.entries(timings)
      .filter(([, ms]) => Number.isFinite(ms))
      .sort((a, b) => b[1] - a[1]);
    if (phaseEntries.length > 0) {
      console.log(chalk.yellow('\n▶ 分阶段耗时：'));
      for (const [key, ms] of phaseEntries) {
        const label = phaseLabels[key] || key;
        console.log(`    ${chalk.cyan('•')} ${label}：${chalk.white(`${ms}ms`)}`);
      }
    }
    
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
    const compressionEnabled = runtimeConfig.server.compression?.enabled !== false;
    console.log(`    ${chalk.cyan('•')} 压缩：${compressionEnabled ? chalk.green('已启用') : chalk.gray('已禁用')} ${compressionEnabled ? chalk.gray(`(级别: ${runtimeConfig.server.compression?.level || 6})`) : ''}`);
    
    const helmetEnabled = runtimeConfig.server.security?.helmet?.enabled !== false;
    console.log(`    ${chalk.cyan('•')} 安全头：${helmetEnabled ? chalk.green('已启用') : chalk.gray('已禁用')}`);
    
    const corsEnabled = runtimeConfig.server.cors?.enabled !== false;
    console.log(`    ${chalk.cyan('•')} CORS：${corsEnabled ? chalk.green('已启用') : chalk.gray('已禁用')}`);
    
    const rateLimitEnabled = runtimeConfig.server.rateLimit?.enabled !== false;
    console.log(`    ${chalk.cyan('•')} 速率限制：${rateLimitEnabled ? chalk.green('已启用') : chalk.gray('已禁用')}`);
    
    const httpsEnabled = runtimeConfig.server.https?.enabled === true;
    console.log(`    ${chalk.cyan('•')} HTTPS：${httpsEnabled ? chalk.green('已启用') : chalk.gray('已禁用')}`);
    if (httpsEnabled && runtimeConfig.server.https?.tls?.http2 === true) {
      console.log(`    ${chalk.cyan('•')} HTTP/2：${chalk.green('已启用')}`);
    }
    
    // API统计
    const apiList = HttpApiLoader.getApiList();
    const totalRoutes = apiList.reduce((sum, api) => sum + (api.routes || 0), 0);
    const totalWS = apiList.reduce((sum, api) => sum + (api.ws || 0), 0);
    // 从AgentRuntime实例获取实际WebSocket路径数量（更准确）
    const actualWSPaths = Object.keys(this.wsf || {}).length;
    console.log(chalk.yellow('\n▶ API统计：'));
    console.log(`    ${chalk.cyan('•')} API模块：${chalk.white(apiList.length + '个')}`);
    console.log(`    ${chalk.cyan('•')} HTTP路由：${chalk.white(totalRoutes + '个')}`);
    console.log(`    ${chalk.cyan('•')} WebSocket路由：${chalk.white(actualWSPaths + '个')} ${actualWSPaths !== totalWS ? chalk.gray(`(API统计: ${totalWS})`) : ''}`);
    
    // 认证信息
    const authConfig = runtimeConfig.server.auth || {};
    if (authConfig.apiKey?.enabled !== false) {
      console.log(chalk.yellow('\n▶ 认证配置：'));
      console.log(`    ${chalk.cyan('•')} API密钥：${chalk.white(this._maskSensitive(this.apiKey))}`);
      console.log(chalk.gray(`    使用 X-API-Key 请求头进行认证`));
    }
    
    // 访问地址
    await this._displayAccessUrls('http', this.actualPort);
    
    console.log(chalk.cyan('\n' + '═'.repeat(60) + '\n'));
    
    // 简化的日志输出（用于日志文件）
    RuntimeUtil.makeLog('info', `智能体启动完成 (耗时: ${loadTime}ms)`, '服务器');
    if (wsPaths.length > 0) {
      RuntimeUtil.makeLog("info", `⚡ WebSocket服务：${this.getServerUrl().replace(/^http/, "ws")}/ [${wsPaths.join(', ')}]`, '服务器');
    }
  }

  /**
   * 启动 trash 定时清理任务
   * - 默认每 60 分钟清理一次
   * - 仅删除超过一定保留时间的文件/目录（默认 24 小时）
   * - 保留白名单文件（.gitignore, instruct.txt 等）
   */
  _startTrashCleaner() {
    const miscCfg = runtimeConfig.server?.misc || {};
    const intervalMinutes = Number(miscCfg.trashCleanupIntervalMinutes) || 60;
    const maxAgeHours = Number(miscCfg.trashMaxAgeHours) || 24;

    const intervalMs = Math.max(intervalMinutes, 5) * 60 * 1000;
    const maxAgeMs = Math.max(maxAgeHours, 1) * 60 * 60 * 1000;

    const runCleanup = async () => {
      try {
        await this._clearTrashOnce(maxAgeMs);
      } catch (err) {
        RuntimeUtil.makeLog('debug', `trash 清理失败: ${err.message}`, '服务器');
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
    const preserve = Array.isArray(runtimeConfig.server?.misc?.trashPreserve) && runtimeConfig.server.misc.trashPreserve.length
      ? runtimeConfig.server.misc.trashPreserve
      : ['.gitignore', 'instruct.txt'];
    const preserveList = new Set(preserve);

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
          RuntimeUtil.makeLog('error', `回复消息失败: ${error.message}`, selfId);
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
    if (!HttpApiLoader?.apis) return [];
    
    const apiEntries = HttpApiLoader.priority?.length
      ? HttpApiLoader.priority
      : Array.from(HttpApiLoader.apis.values());
    
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
            method: String(r.method ?? '').toUpperCase(),
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
    const stdinHandler = getRuntimeGlobal('stdinHandler');
    
    if (!stdinHandler?.processCommand) {
      throw this.makeError('stdin handler not initialized', 'StdinUnavailable');
    }

    const info = {
      ...user_info,
      tasker: user_info.tasker || 'api'
    }

    // 以“插件链路执行完成”为边界收集结果：由 PluginLoader.deal 在 finally 中回调 _onDone
    if (typeof stdinHandler.createEvent === 'function') {
      const event = stdinHandler.createEvent(command, info)

      const done = new Promise((resolve) => {
        event._onDone = resolve
      })

      this._cascadeEmit('stdin.message', event)

      const finishedEvent = await Promise.race([
        done,
        new Promise((resolve) => setTimeout(() => resolve(event), timeout))
      ])

      // 优先返回结构化的插件结果（如果插件调用了 pushResult）
      const results = Array.isArray(finishedEvent?._pluginResults) ? finishedEvent._pluginResults : []

      // 同时将 reply() 过程中发送的消息聚合回传，便于 API 调试直接显示
      const outputs = Array.isArray(finishedEvent?._replyOutputs) ? finishedEvent._replyOutputs : []
      const content = outputs.flat().filter(Boolean)

      if (results.length) {
        return {
          event_id: finishedEvent.event_id,
          results,
          output: {
            nickname: 'stdin',
            content,
            user_info: info
          }
        }
      }

      // 没有 pushResult 时，兼容旧行为：返回聚合后的 stdout（如果有），否则回退基础结果
      if (content.length) {
        return { nickname: 'stdin', content, user_info: info }
      }
    }

    // 兜底：走原始 stdin 命令处理器
    return await stdinHandler.processCommand(command, info)
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
        if (v === undefined) continue;
        url.searchParams.append(k, v);
      }
    }
    
    const options = {
      method: String(method || 'GET').toUpperCase(),
      headers: { ...headers },
      signal: AbortSignal.timeout(timeout)
    };
    
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
    // 兼容历史行为：对“普通 emit”只提供一个有限的收集能力
    // 若调用方希望严格按插件链路结束收集，请走 callStdin（或在事件对象上设置 _onDone）
    const outputs = []
    const handler = (payload) => outputs.push(payload)

    this.on('stdin.output', handler)
    try {
      this._cascadeEmit(name, data)
      await RuntimeUtil.sleep(timeout)

      if (!outputs.length) return null
      if (outputs.length === 1) return outputs[0]

      const base = outputs[outputs.length - 1] || {}
      const allContent = outputs.flatMap(o => Array.isArray(o?.content) ? o.content : [])
      return { ...base, content: allContent }
    } finally {
      this.off('stdin.output', handler)
    }
  }

  /**
   * 发送消息给主人（通用函数）
   * 支持OneBot（通过pickFriend）和其他适配器
   */
  async sendMasterMsg(msg, sleep = 5000) {
    const masterQQs = runtimeConfig.masterQQ;
    const results = {};
    
    for (const [i, user_id] of masterQQs.entries()) {
      const pickFn = this.pickFriend || this.pickUser;
      const friend = pickFn.call(this, user_id);
      results[user_id] = await friend.sendMsg(msg);
      RuntimeUtil.makeLog("debug", `已发送消息给主人 ${user_id}`, '服务器');
      
      if (i < masterQQs.length - 1) await RuntimeUtil.sleep(sleep);
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

  /**
   * 选择一个用于发送消息的 AgentRuntime 实例
   * - 优先使用显式传入的 botId
   * - 否则使用 this.uin[0] / 第一个已连接的 AgentRuntime
   */
  _getBotForSend(botId = null) {
    if (botId && this.bots && this.bots[botId]) {
      return this.bots[botId];
    }

    const candidateId = this.uin?.[0] || Object.keys(this.bots || {})[0];
    if (candidateId && this.bots && this.bots[candidateId]) {
      return this.bots[candidateId];
    }

    return null;
  }

  /**
   * 选取好友（兼容 OneBot / GSUID / QBQBot 等适配器）
   * - 当未指定 botId 时，自动选择一个可用的 AgentRuntime
   */
  pickFriend(user_id, botId = null) {
    const bot = this._getBotForSend(botId);
    if (!bot || typeof bot.pickFriend !== 'function') {
      throw new Error('当前没有可用的机器人，或不支持好友消息发送');
    }
    return bot.pickFriend(user_id);
  }

  /**
   * 选取群聊（兼容 OneBot / GSUID / QBQBot 等适配器）
   * - 当未指定 botId 时，自动选择一个可用的 AgentRuntime
   */
  pickGroup(group_id, botId = null) {
    const bot = this._getBotForSend(botId);
    if (!bot || typeof bot.pickGroup !== 'function') {
      throw new Error('当前没有可用的机器人，或不支持群消息发送');
    }
    return bot.pickGroup(group_id);
  }

  /**
   * 发送好友消息（供 HTTP 接口等统一调用）
   * @param {string} botId 机器人 UIN/self_id
   * @param {string|number} userId 好友 QQ / 用户 ID
   * @param {any} msg 消息内容（字符串或消息数组）
   * @returns {Promise<{message_id: string}>}
   */
  async sendFriendMsg(botId, userId, msg) {
    const bot = this._getBotForSend(botId);
    if (!bot) {
      throw new Error(`机器人不存在或未连接: ${botId || 'default'}`);
    }

    // 优先走各 tasker 提供的 sendFriendMsg 能力
    if (bot.tasker && typeof bot.tasker.sendFriendMsg === 'function') {
      const data = {
        self_id: bot.uin || bot.self_id || botId,
        bot,
        user_id: userId
      };
      return await bot.tasker.sendFriendMsg(data, msg);
    }

    // 兼容：通过 pickFriend().sendMsg 发送
    if (typeof bot.pickFriend === 'function') {
      const friend = bot.pickFriend(userId);
      if (friend && typeof friend.sendMsg === 'function') {
        return await friend.sendMsg(msg);
      }
    }

    throw new Error('当前机器人不支持好友消息发送');
  }

  /**
   * 发送群消息（供 HTTP 接口等统一调用）
   * @param {string} botId 机器人 UIN/self_id
   * @param {string|number} groupId 群号 / 目标 ID
   * @param {any} msg 消息内容（字符串或消息数组）
   * @returns {Promise<{message_id: string}>}
   */
  async sendGroupMsg(botId, groupId, msg) {
    const bot = this._getBotForSend(botId);
    if (!bot) {
      throw new Error(`机器人不存在或未连接: ${botId || 'default'}`);
    }

    // 优先走各 tasker 提供的 sendGroupMsg 能力
    if (bot.tasker && typeof bot.tasker.sendGroupMsg === 'function') {
      const data = {
        self_id: bot.uin || bot.self_id || botId,
        bot,
        group_id: groupId
      };
      return await bot.tasker.sendGroupMsg(data, msg);
    }

    // 兼容：通过 pickGroup().sendMsg 发送
    if (typeof bot.pickGroup === 'function') {
      const group = bot.pickGroup(groupId);
      if (group && typeof group.sendMsg === 'function') {
        return await group.sendMsg(msg);
      }
    }

    throw new Error('当前机器人不支持群消息发送');
  }

  async redisExit() {
    if (!(typeof redis === 'object' && redis.process)) return false;
    
    const process = redis.process;
    delete redis.process;
    
    await RuntimeUtil.sleep(5000);
    return process.kill();
  }

  async fileToUrl(file, opts = {}) {
    return await RuntimeUtil.fileToUrl(file, opts);
  }
}