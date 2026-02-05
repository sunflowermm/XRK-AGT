/**
 * HTTP业务层工具模块
 * 提供重定向、CDN、反向代理增强等功能的统一实现
 * 
 * @module http-business
 * @description 使用Node.js 24.12新特性优化，提供完整的HTTP业务层能力
 */

import crypto from 'node:crypto';

const URLPatternClass = globalThis.URLPattern || null;

/**
 * 重定向管理器
 * 支持多种重定向类型：301(永久), 302(临时), 307(临时保持方法), 308(永久保持方法)
 */
export class RedirectManager {
  constructor(config = {}) {
    this.rules = [];
    this.config = config;
    this._compileRules();
  }

  /**
   * 编译重定向规则（使用Node.js 24.12 URLPattern API）
   */
  _compileRules() {
    const redirectConfig = this.config.redirects || [];
    
    for (const rule of redirectConfig) {
      try {
        let pattern;
        if (URLPatternClass) {
          pattern = new URLPatternClass({ 
            pathname: rule.from,
            ...(rule.hostname && { hostname: rule.hostname })
          });
        } else {
          pattern = {
            pathname: rule.from,
            test: (url) => {
              const pathname = url.pathname || '';
              if (rule.from.endsWith('*')) {
                const prefix = rule.from.slice(0, -1);
                return pathname.startsWith(prefix);
              }
              const regex = new RegExp('^' + rule.from.replace(/\*/g, '.*') + '$');
              return pathname === rule.from || regex.test(pathname);
            }
          };
        }
        
        this.rules.push({
          pattern,
          to: rule.to,
          status: rule.status || 301,
          preserveQuery: rule.preserveQuery !== false,
          preservePath: rule.preservePath !== false,
          condition: rule.condition ? new Function('req', 'return ' + rule.condition) : null
        });
      } catch (err) {
        console.warn(`[重定向] 规则编译失败: ${rule.from} -> ${rule.to}`, err.message);
      }
    }
    
    this.rules.sort((a, b) => {
      const aSpecificity = this._getPatternSpecificity(a.pattern);
      const bSpecificity = this._getPatternSpecificity(b.pattern);
      return bSpecificity - aSpecificity;
    });
  }

  /**
   * 获取模式的特异性（用于优先级排序）
   */
  _getPatternSpecificity(pattern) {
    // 简单实现：路径越具体（越少通配符），优先级越高
    const pathname = pattern.pathname || '';
    const wildcards = (pathname.match(/\*/g) || []).length;
    return 100 - wildcards * 10;
  }

  /**
   * 检查并执行重定向
   * @param {Object} req - Express请求对象
   * @param {Object} res - Express响应对象
   * @returns {boolean} 是否执行了重定向
   */
  check(req, res) {
    if (res.headersSent) return false;

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    
    for (const rule of this.rules) {
      try {
        if (rule.condition && !rule.condition(req)) {
          continue;
        }

        let match;
        if (typeof rule.pattern.test === 'function') {
          match = rule.pattern.test({
            pathname: url.pathname,
            hostname: url.hostname
          });
        } else {
          match = url.pathname === rule.pattern.pathname || 
                  (rule.pattern.pathname.endsWith('*') && 
                   url.pathname.startsWith(rule.pattern.pathname.slice(0, -1)));
        }

        if (!match) continue;

        let targetUrl = rule.to;
        
        if (targetUrl.includes('$')) {
          targetUrl = url.pathname.replace(rule.pattern.pathname, targetUrl);
        }

        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          const protocol = req.protocol || 'http';
          const host = req.headers.host || 'localhost';
          targetUrl = `${protocol}://${host}${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`;
        }

        if (rule.preserveQuery && url.search) {
          const targetUrlObj = new URL(targetUrl);
          url.searchParams.forEach((value, key) => {
            targetUrlObj.searchParams.append(key, value);
          });
          targetUrl = targetUrlObj.toString();
        }

        res.redirect(rule.status, targetUrl);
        return true;
      } catch (err) {
        console.warn(`[重定向] 执行失败: ${rule.from} -> ${rule.to}`, err.message);
      }
    }

    return false;
  }
}

/**
 * CDN管理器
 * 处理CDN回源、缓存控制、CDN头部等
 * 支持主流CDN：Cloudflare、阿里云CDN、腾讯云CDN、AWS CloudFront等
 */
export class CDNManager {
  constructor(config = {}) {
    this.config = config.cdn || {};
    this.enabled = this.config.enabled === true;
    this.cdnDomain = this.config.domain || '';
    this.staticPrefix = this.config.staticPrefix || '/static';
    this.cacheControl = this.config.cacheControl || {};
    
    // CDN识别模式（主流CDN头部）
    this.cdnPatterns = {
      cloudflare: ['cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-ipcountry'],
      aliyun: ['ali-swift-stat-host', 'ali-swift-stat-path', 'x-oss-request-id'],
      tencent: ['x-qcloud-cdn', 'x-qcloud-request-id'],
      aws: ['x-amz-cf-id', 'x-amzn-trace-id', 'cloudfront-viewer-country'],
      baidu: ['x-bce-request-id', 'x-bce-date'],
      qiniu: ['x-qiniu-request-id'],
      ucloud: ['x-ucloud-request-id'],
      general: ['x-cdn-request', 'x-forwarded-for', 'x-real-ip', 'x-forwarded-proto']
    };
  }

  /**
   * 检查是否为CDN回源请求
   * @param {Object} req - Express请求对象
   * @returns {Object|null} CDN信息对象，包含类型和IP
   */
  isCDNRequest(req) {
    if (!this.enabled) return null;
    
    const headers = req.headers || {};
    const lowerHeaders = {};
    Object.keys(headers).forEach(k => {
      lowerHeaders[k.toLowerCase()] = headers[k];
    });
    
    // 检测CDN类型
    for (const [cdnType, patterns] of Object.entries(this.cdnPatterns)) {
      for (const pattern of patterns) {
        if (lowerHeaders[pattern.toLowerCase()]) {
          const clientIP = this._extractClientIP(req, cdnType);
          return {
            type: cdnType,
            ip: clientIP,
            headers: lowerHeaders
          };
        }
      }
    }
    
    return null;
  }

  /**
   * 提取真实客户端IP（考虑CDN代理）
   * @param {Object} req - Express请求对象
   * @param {string} cdnType - CDN类型
   * @returns {string} 客户端IP
   */
  _extractClientIP(req, cdnType) {
    const headers = req.headers || {};
    const lowerHeaders = {};
    Object.keys(headers).forEach(k => {
      lowerHeaders[k.toLowerCase()] = headers[k];
    });
    
    // 根据CDN类型提取IP
    switch (cdnType) {
      case 'cloudflare':
        return lowerHeaders['cf-connecting-ip'] || req.ip || req.connection?.remoteAddress || 'unknown';
      case 'aliyun':
        return lowerHeaders['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
      case 'tencent':
        return lowerHeaders['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
      case 'aws':
        return lowerHeaders['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
      default:
        // 通用提取：优先使用X-Forwarded-For，取第一个IP
        const forwardedFor = lowerHeaders['x-forwarded-for'];
        if (forwardedFor) {
          return forwardedFor.split(',')[0].trim();
        }
        return lowerHeaders['x-real-ip'] || req.ip || req.connection?.remoteAddress || 'unknown';
    }
  }

  /**
   * 设置CDN相关响应头
   * @param {Object} res - Express响应对象
   * @param {string} filePath - 文件路径
   * @param {Object} req - Express请求对象（可选，用于CDN类型检测）
   */
  setCDNHeaders(res, filePath, req = null) {
    if (!this.enabled || res.headersSent) return;

    const ext = this._getFileExtension(filePath);
    const cacheMaxAge = this._getCacheMaxAge(ext);
    
    // 标准缓存控制头
    if (cacheMaxAge > 0) {
      const cacheControl = this._buildCacheControl(ext, cacheMaxAge);
      res.setHeader('Cache-Control', cacheControl);
      
      // CDN特定缓存控制（部分CDN支持）
      if (req) {
        const cdnInfo = this.isCDNRequest(req);
        if (cdnInfo) {
          this._setCDNSpecificHeaders(res, cdnInfo.type, cacheMaxAge);
        }
      }
      
      // ETag支持（用于缓存验证）
      res.setHeader('ETag', this._generateETag(filePath));
    }

    // CDN域名标识
    if (this.cdnDomain) {
      res.setHeader('X-CDN-Domain', this.cdnDomain);
    }
    
    // 预加载提示（H2 Server Push）
    if (this._isCriticalAsset(filePath)) {
      res.setHeader('Link', `<${filePath}>; rel=preload; as=${this._getAssetType(ext)}`);
    }
  }

  /**
   * 构建Cache-Control头
   * @param {string} ext - 文件扩展名
   * @param {number} maxAge - 最大缓存时间（秒）
   * @returns {string} Cache-Control值
   */
  _buildCacheControl(ext, maxAge) {
    const directives = ['public'];
    
    // 静态资源使用immutable（浏览器不会重新验证）
    if (['css', 'js', 'woff', 'woff2', 'ttf', 'otf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) {
      directives.push('immutable');
    }
    
    directives.push(`max-age=${maxAge}`);
    
    // 添加stale-while-revalidate（允许在重新验证时使用过期缓存）
    if (maxAge > 3600) {
      directives.push(`stale-while-revalidate=${Math.min(maxAge / 2, 86400)}`);
    }
    
    return directives.join(', ');
  }

  /**
   * 设置CDN特定响应头
   * @param {Object} res - Express响应对象
   * @param {string} cdnType - CDN类型
   * @param {number} maxAge - 缓存时间
   */
  _setCDNSpecificHeaders(res, cdnType, maxAge) {
    switch (cdnType) {
      case 'cloudflare':
        // Cloudflare支持CDN-Cache-Control
        res.setHeader('CDN-Cache-Control', `public, max-age=${maxAge}`);
        break;
      case 'aliyun':
        // 阿里云CDN缓存控制
        res.setHeader('X-Cache-Control', `public, max-age=${maxAge}`);
        break;
      case 'tencent':
        // 腾讯云CDN缓存控制
        res.setHeader('X-QCloud-Cache-Control', `public, max-age=${maxAge}`);
        break;
    }
  }

  /**
   * 生成ETag（简单实现）
   * @param {string} filePath - 文件路径
   * @returns {string} ETag值
   */
  _generateETag(filePath) {
    // 简单实现：基于文件路径和修改时间
    // 实际应用中可以使用文件hash
    return `"${Buffer.from(filePath).toString('base64').slice(0, 16)}"`;
  }

  /**
   * 判断是否为关键资源（用于H2 Server Push）
   * @param {string} filePath - 文件路径
   * @returns {boolean}
   */
  _isCriticalAsset(filePath) {
    const criticalExts = ['.css', '.js', '.woff', '.woff2'];
    return criticalExts.some(ext => filePath.toLowerCase().endsWith(ext));
  }

  /**
   * 获取资源类型（用于H2 Server Push）
   * @param {string} ext - 文件扩展名
   * @returns {string} 资源类型
   */
  _getAssetType(ext) {
    if (['css'].includes(ext)) return 'style';
    if (['js'].includes(ext)) return 'script';
    if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) return 'font';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return 'image';
    return 'fetch';
  }

  /**
   * 获取文件的CDN URL
   * @param {string} filePath - 文件路径
   * @returns {string} CDN URL
   */
  getCDNUrl(filePath) {
    if (!this.enabled || !this.cdnDomain) {
      return filePath;
    }

    if (!filePath.startsWith(this.staticPrefix) && !this._isStaticAsset(filePath)) {
      return filePath;
    }

    const protocol = this.config.https ? 'https' : 'http';
    return `${protocol}://${this.cdnDomain}${filePath}`;
  }

  /**
   * 获取文件扩展名
   */
  _getFileExtension(filePath) {
    const match = filePath.match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : '';
  }

  /**
   * 判断是否为静态资源
   */
  _isStaticAsset(filePath) {
    const staticExts = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.woff', '.woff2', '.ttf', '.otf'];
    return staticExts.some(ext => filePath.toLowerCase().endsWith(ext));
  }

  /**
   * 获取缓存时间（秒）
   */
  _getCacheMaxAge(ext) {
    const config = this.cacheControl;
    
    if (['css', 'js', 'woff', 'woff2', 'ttf', 'otf'].includes(ext)) {
      return config.static || 31536000; // 1年
    }
    
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico'].includes(ext)) {
      return config.images || 604800; // 7天
    }
    
    return config.default || 3600; // 1小时
  }
}

/**
 * 反向代理增强管理器
 * 提供负载均衡、健康检查、故障转移等高级功能
 * 支持多种负载均衡算法：轮询、加权轮询、最少连接、IP Hash、一致性哈希
 */
export class ProxyManager {
  constructor(config = {}) {
    this.config = config.proxy || {};
    this.upstreams = new Map();
    this.healthChecks = new Map();
    this._roundRobinIndex = new Map();
    this._connectionCounts = new Map(); // 连接数统计
    this._responseTimes = new Map(); // 响应时间统计
    this._healthCheckCache = new Map(); // 健康检查结果缓存
    this._stats = {
      totalRequests: 0,
      totalFailures: 0,
      upstreamStats: new Map() // 每个上游服务器的统计
    };
    this._initUpstreams();
  }

  /**
   * 获取统计信息（企业级监控）
   * @returns {Object} 统计信息
   */
  getStats() {
    const stats = {
      totalRequests: this._stats.totalRequests,
      totalFailures: this._stats.totalFailures,
      successRate: this._stats.totalRequests > 0 
        ? ((this._stats.totalRequests - this._stats.totalFailures) / this._stats.totalRequests * 100).toFixed(2) + '%'
        : '0%',
      upstreams: []
    };

    for (const [domain, upstreams] of this.upstreams.entries()) {
      for (const upstream of upstreams) {
        const upstreamStat = this._stats.upstreamStats.get(`${domain}-${upstream.url}`) || {
          requests: 0,
          failures: 0,
          avgResponseTime: 0
        };
        
        stats.upstreams.push({
          domain,
          url: upstream.url,
          healthy: upstream.healthy,
          connections: upstream.connections || 0,
          responseTime: upstream.responseTime || 0,
          failCount: upstream.failCount || 0,
          lastCheck: upstream.lastCheck || 0,
          requests: upstreamStat.requests,
          failures: upstreamStat.failures,
          successRate: upstreamStat.requests > 0
            ? ((upstreamStat.requests - upstreamStat.failures) / upstreamStat.requests * 100).toFixed(2) + '%'
            : '0%',
          avgResponseTime: upstreamStat.avgResponseTime.toFixed(2) + 'ms'
        });
      }
    }

    return stats;
  }

  /**
   * 记录请求统计
   * @param {string} domain - 域名
   * @param {string} upstreamUrl - 上游服务器URL
   * @param {boolean} success - 是否成功
   * @param {number} responseTime - 响应时间（毫秒）
   */
  recordRequest(domain, upstreamUrl, success, responseTime = 0) {
    this._stats.totalRequests++;
    if (!success) {
      this._stats.totalFailures++;
    }

    const key = `${domain}-${upstreamUrl}`;
    const stat = this._stats.upstreamStats.get(key) || {
      requests: 0,
      failures: 0,
      totalResponseTime: 0,
      avgResponseTime: 0
    };

    stat.requests++;
    if (!success) {
      stat.failures++;
    }
    if (responseTime > 0) {
      stat.totalResponseTime += responseTime;
      stat.avgResponseTime = stat.totalResponseTime / stat.requests;
    }

    this._stats.upstreamStats.set(key, stat);
  }

  /**
   * 初始化上游服务器池
   */
  _initUpstreams() {
    const domains = this.config.domains || [];
    
    for (const domainConfig of domains) {
      if (!domainConfig.target || typeof domainConfig.target === 'string') {
        this.upstreams.set(domainConfig.domain, [{
          url: domainConfig.target,
          weight: 1,
          healthy: true,
          failCount: 0,
          connections: 0,
          responseTime: 0,
          lastCheck: Date.now(),
          healthUrl: domainConfig.healthUrl || `${domainConfig.target}/health`
        }]);
      } else if (Array.isArray(domainConfig.target)) {
        this.upstreams.set(domainConfig.domain, domainConfig.target.map(upstream => ({
          url: typeof upstream === 'string' ? upstream : upstream.url,
          weight: upstream.weight || 1,
          healthy: true,
          failCount: 0,
          connections: 0,
          responseTime: 0,
          lastCheck: Date.now(),
          healthUrl: upstream.healthUrl || `${typeof upstream === 'string' ? upstream : upstream.url}/health`,
          ...upstream
        })));
      }
    }

    if (this.config.healthCheck?.enabled) {
      this._startHealthChecks();
    }
  }

  /**
   * 启动健康检查
   */
  _startHealthChecks() {
    const interval = this.config.healthCheck.interval || 30000;
    setInterval(() => {
      this._performHealthChecks();
    }, interval);
  }

  /**
   * 执行健康检查（并行检查所有上游服务器）
   */
  async _performHealthChecks() {
    const checkPromises = [];
    
    for (const [domain, upstreams] of this.upstreams.entries()) {
      for (const upstream of upstreams) {
        checkPromises.push(this._checkUpstreamHealth(domain, upstream));
      }
    }
    
    // 并行执行所有健康检查
    await Promise.allSettled(checkPromises);
  }

  /**
   * 检查单个上游服务器健康状态
   * @param {string} domain - 域名
   * @param {Object} upstream - 上游服务器配置
   */
  async _checkUpstreamHealth(domain, upstream) {
    const cacheKey = `${domain}-${upstream.url}`;
    const cacheTime = this.config.healthCheck?.cacheTime || 5000; // 默认5秒缓存
    
    // 检查缓存
    const cached = this._healthCheckCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheTime) {
      upstream.healthy = cached.healthy;
      upstream.lastCheck = cached.timestamp;
      return;
    }
    
    const startTime = Date.now();
    
    try {
      const healthUrl = upstream.healthUrl || `${upstream.url}/health`;
      const timeout = this.config.healthCheck?.timeout || 5000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(healthUrl, {
        signal: controller.signal,
        method: 'GET',
        headers: {
          'User-Agent': 'XRK-AGT-HealthCheck/1.0'
        }
      });
      
      clearTimeout(timeoutId);
      
      const responseTime = Date.now() - startTime;
      upstream.responseTime = responseTime;
      upstream.healthy = response.ok;
      upstream.failCount = 0;
      upstream.lastCheck = Date.now();
      
      // 更新缓存
      this._healthCheckCache.set(cacheKey, {
        healthy: upstream.healthy,
        timestamp: upstream.lastCheck
      });
    } catch (err) {
      upstream.failCount++;
      upstream.healthy = upstream.failCount < (this.config.healthCheck?.maxFailures || 3);
      upstream.lastCheck = Date.now();
      upstream.responseTime = Date.now() - startTime;
      
      // 更新缓存
      this._healthCheckCache.set(cacheKey, {
        healthy: upstream.healthy,
        timestamp: upstream.lastCheck
      });
    }
  }

  /**
   * 选择上游服务器（负载均衡）
   * @param {string} domain - 域名
   * @param {string} algorithm - 算法: 'round-robin', 'weighted', 'least-connections', 'ip-hash', 'consistent-hash', 'least-response-time'
   * @param {string} clientIP - 客户端IP（用于IP Hash算法）
   * @returns {Object|null} 选中的上游服务器配置
   */
  selectUpstream(domain, algorithm = 'round-robin', clientIP = null) {
    const upstreams = this.upstreams.get(domain);
    if (!upstreams || upstreams.length === 0) return null;

    const healthyUpstreams = upstreams.filter(u => u.healthy);
    if (healthyUpstreams.length === 0) {
      // 所有服务器都不健康时，仍返回第一个（确保服务可用）
      return upstreams[0];
    }

    switch (algorithm) {
      case 'weighted':
        return this._selectWeighted(healthyUpstreams);
      
      case 'least-connections':
        return this._selectLeastConnections(healthyUpstreams);
      
      case 'ip-hash':
        return this._selectIPHash(healthyUpstreams, clientIP || '0.0.0.0');
      
      case 'consistent-hash':
        return this._selectConsistentHash(healthyUpstreams, clientIP || '0.0.0.0');
      
      case 'least-response-time':
        return this._selectLeastResponseTime(healthyUpstreams);
      
      case 'round-robin':
      default:
        return this._selectRoundRobin(healthyUpstreams, domain);
    }
  }

  /**
   * 增加连接数
   * @param {string} domain - 域名
   * @param {string} upstreamUrl - 上游服务器URL
   */
  incrementConnections(domain, upstreamUrl) {
    const upstreams = this.upstreams.get(domain);
    if (!upstreams) return;
    
    const upstream = upstreams.find(u => u.url === upstreamUrl);
    if (upstream) {
      upstream.connections = (upstream.connections || 0) + 1;
    }
  }

  /**
   * 减少连接数
   * @param {string} domain - 域名
   * @param {string} upstreamUrl - 上游服务器URL
   */
  decrementConnections(domain, upstreamUrl) {
    const upstreams = this.upstreams.get(domain);
    if (!upstreams) return;
    
    const upstream = upstreams.find(u => u.url === upstreamUrl);
    if (upstream && upstream.connections > 0) {
      upstream.connections--;
    }
  }

  /**
   * 加权轮询
   */
  _selectWeighted(upstreams) {
    const totalWeight = upstreams.reduce((sum, u) => sum + u.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const upstream of upstreams) {
      random -= upstream.weight;
      if (random <= 0) {
        return upstream;
      }
    }
    
    return upstreams[0];
  }

  /**
   * 最少连接
   */
  _selectLeastConnections(upstreams) {
    return upstreams.reduce((min, u) => {
      const connections = u.connections || 0;
      const minConnections = min.connections || 0;
      return connections < minConnections ? u : min;
    }, upstreams[0]);
  }

  /**
   * 轮询
   */
  _selectRoundRobin(upstreams, domain) {
    const key = `round-robin-${domain}`;
    const currentIndex = this._roundRobinIndex.get(key) || 0;
    const selected = upstreams[currentIndex % upstreams.length];
    this._roundRobinIndex.set(key, currentIndex + 1);
    
    return selected;
  }

  /**
   * IP Hash算法（基于客户端IP的哈希）
   * 相同IP总是路由到同一服务器，适合会话保持
   */
  _selectIPHash(upstreams, clientIP) {
    // 简单哈希函数
    let hash = 0;
    for (let i = 0; i < clientIP.length; i++) {
      hash = ((hash << 5) - hash) + clientIP.charCodeAt(i);
      hash = hash & hash; // 转换为32位整数
    }
    
    const index = Math.abs(hash) % upstreams.length;
    return upstreams[index];
  }

  /**
   * 一致性哈希算法（简化实现）
   * 当服务器列表变化时，最小化重新路由
   */
  _selectConsistentHash(upstreams, clientIP) {
    // 简化的一致性哈希：使用MD5哈希
    const hash = crypto.createHash('md5').update(clientIP).digest('hex');
    const hashInt = parseInt(hash.slice(0, 8), 16);
    
    const index = hashInt % upstreams.length;
    return upstreams[index];
  }

  /**
   * 最少响应时间算法
   * 选择响应时间最短的服务器
   */
  _selectLeastResponseTime(upstreams) {
    return upstreams.reduce((min, u) => {
      const responseTime = u.responseTime || Infinity;
      const minResponseTime = min.responseTime || Infinity;
      return responseTime < minResponseTime ? u : min;
    }, upstreams[0]);
  }

  /**
   * 标记上游服务器失败
   * @param {string} domain - 域名
   * @param {string} upstreamUrl - 上游服务器URL
   */
  markUpstreamFailure(domain, upstreamUrl) {
    const upstreams = this.upstreams.get(domain);
    if (!upstreams) return;

    const upstream = upstreams.find(u => u.url === upstreamUrl);
    if (upstream) {
      upstream.failCount++;
      const maxFailures = this.config.healthCheck?.maxFailures || 3;
      upstream.healthy = upstream.failCount < maxFailures;
      
      // 记录失败统计
      this.recordRequest(domain, upstreamUrl, false);
      
      // 如果标记为不健康，记录警告
      if (!upstream.healthy) {
        console.warn(`[ProxyManager] 上游服务器标记为不健康: ${domain} -> ${upstreamUrl} (失败次数: ${upstream.failCount})`);
      }
    }
  }

  /**
   * 标记上游服务器成功
   * @param {string} domain - 域名
   * @param {string} upstreamUrl - 上游服务器URL
   * @param {number} responseTime - 响应时间（毫秒）
   */
  markUpstreamSuccess(domain, upstreamUrl, responseTime = 0) {
    const upstreams = this.upstreams.get(domain);
    if (!upstreams) return;

    const upstream = upstreams.find(u => u.url === upstreamUrl);
    if (upstream) {
      // 记录成功统计
      this.recordRequest(domain, upstreamUrl, true, responseTime);
      
      // 如果之前不健康，现在恢复健康
      if (!upstream.healthy && upstream.failCount > 0) {
        upstream.failCount = 0;
        upstream.healthy = true;
        console.info(`[ProxyManager] 上游服务器恢复健康: ${domain} -> ${upstreamUrl}`);
      }
    }
  }
}

/**
 * HTTP业务层工具类
 * 统一管理重定向、CDN、反向代理等功能
 */
export class HTTPBusinessLayer {
  constructor(config = {}) {
    this.config = config;
    this.redirectManager = new RedirectManager(config);
    this.cdnManager = new CDNManager(config);
    this.proxyManager = new ProxyManager(config);
  }

  /**
   * 处理重定向
   */
  handleRedirect(req, res) {
    return this.redirectManager.check(req, res);
  }

  /**
   * 处理CDN相关逻辑
   */
  handleCDN(req, res, filePath) {
    this.cdnManager.setCDNHeaders(res, filePath);
    return this.cdnManager.getCDNUrl(filePath);
  }

  /**
   * 选择代理上游
   */
  selectProxyUpstream(domain, algorithm) {
    return this.proxyManager.selectUpstream(domain, algorithm);
  }

  /**
   * 标记代理失败
   */
  markProxyFailure(domain, upstreamUrl) {
    this.proxyManager.markUpstreamFailure(domain, upstreamUrl);
  }
}

export default HTTPBusinessLayer;

