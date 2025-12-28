/**
 * HTTP业务层工具模块
 * 提供重定向、CDN、反向代理增强等功能的统一实现
 * 
 * @module http-business
 * @description 使用Node.js 24.12新特性优化，提供完整的HTTP业务层能力
 */

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
 */
export class CDNManager {
  constructor(config = {}) {
    this.config = config.cdn || {};
    this.enabled = this.config.enabled === true;
    this.cdnDomain = this.config.domain || '';
    this.staticPrefix = this.config.staticPrefix || '/static';
    this.cacheControl = this.config.cacheControl || {};
  }

  /**
   * 检查是否为CDN回源请求
   * @param {Object} req - Express请求对象
   * @returns {boolean}
   */
  isCDNRequest(req) {
    if (!this.enabled) return false;
    
    const cdnHeaders = [
      'x-cdn-request',
      'x-forwarded-for', // 可能有CDN代理
      'cf-connecting-ip', // Cloudflare
      'x-real-ip' // Nginx代理
    ];
    
    return cdnHeaders.some(header => req.headers[header.toLowerCase()]);
  }

  /**
   * 设置CDN相关响应头
   * @param {Object} res - Express响应对象
   * @param {string} filePath - 文件路径
   */
  setCDNHeaders(res, filePath) {
    if (!this.enabled || res.headersSent) return;

    const ext = this._getFileExtension(filePath);
    const cacheMaxAge = this._getCacheMaxAge(ext);
    
    if (cacheMaxAge > 0) {
      res.setHeader('Cache-Control', `public, max-age=${cacheMaxAge}, immutable`);
      res.setHeader('CDN-Cache-Control', `public, max-age=${cacheMaxAge}`);
    }

    if (this.cdnDomain) {
      res.setHeader('X-CDN-Domain', this.cdnDomain);
    }
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
 */
export class ProxyManager {
  constructor(config = {}) {
    this.config = config.proxy || {};
    this.upstreams = new Map();
    this.healthChecks = new Map();
    this._initUpstreams();
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
          failCount: 0
        }]);
      } else if (Array.isArray(domainConfig.target)) {
        this.upstreams.set(domainConfig.domain, domainConfig.target.map(upstream => ({
          url: typeof upstream === 'string' ? upstream : upstream.url,
          weight: upstream.weight || 1,
          healthy: true,
          failCount: 0,
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
   * 执行健康检查
   */
  async _performHealthChecks() {
    for (const [domain, upstreams] of this.upstreams.entries()) {
      for (const upstream of upstreams) {
        try {
          const healthUrl = upstream.healthUrl || `${upstream.url}/health`;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          
          const response = await fetch(healthUrl, {
            signal: controller.signal,
            method: 'GET'
          });
          
          clearTimeout(timeout);
          
          upstream.healthy = response.ok;
          upstream.failCount = 0;
        } catch (err) {
          upstream.failCount++;
          upstream.healthy = upstream.failCount < (this.config.healthCheck?.maxFailures || 3);
        }
      }
    }
  }

  /**
   * 选择上游服务器（负载均衡）
   * @param {string} domain - 域名
   * @param {string} algorithm - 算法: 'round-robin', 'weighted', 'least-connections'
   * @returns {Object|null} 选中的上游服务器配置
   */
  selectUpstream(domain, algorithm = 'round-robin') {
    const upstreams = this.upstreams.get(domain);
    if (!upstreams || upstreams.length === 0) return null;

    const healthyUpstreams = upstreams.filter(u => u.healthy);
    if (healthyUpstreams.length === 0) {
      return upstreams[0];
    }

    switch (algorithm) {
      case 'weighted':
        return this._selectWeighted(healthyUpstreams);
      
      case 'least-connections':
        return this._selectLeastConnections(healthyUpstreams);
      
      case 'round-robin':
      default:
        return this._selectRoundRobin(healthyUpstreams, domain);
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
    if (!this._roundRobinIndex) {
      this._roundRobinIndex = new Map();
    }
    
    const currentIndex = this._roundRobinIndex.get(key) || 0;
    const selected = upstreams[currentIndex % upstreams.length];
    this._roundRobinIndex.set(key, currentIndex + 1);
    
    return selected;
  }

  /**
   * 标记上游服务器失败
   */
  markUpstreamFailure(domain, upstreamUrl) {
    const upstreams = this.upstreams.get(domain);
    if (!upstreams) return;

    const upstream = upstreams.find(u => u.url === upstreamUrl);
    if (upstream) {
      upstream.failCount++;
      upstream.healthy = upstream.failCount < (this.config.healthCheck?.maxFailures || 3);
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

