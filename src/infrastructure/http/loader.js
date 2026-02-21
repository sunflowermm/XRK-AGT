import path from 'path';
import { fileURLToPath } from 'url';
import HttpApi from './http.js';
import BotUtil from '#utils/botutil.js';
import cfg from '#infrastructure/config/config.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import paths from '#utils/paths.js';
import { validateApiInstance, getApiPriority } from './utils/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * API加载器类
 * 负责加载、管理和调度所有API模块
 */
class ApiLoader {
  constructor() {
    /** 所有API实例 */
    this.apis = new Map();
    
    /** 按优先级排序的API列表 */
    this.priority = [];
    
    /** API文件监视器 */
    this.watcher = {};
    
    /** 加载状态 */
    this.loaded = false;
    
    /** Express应用实例 */
    this.app = null;
    
    /** Bot实例 */
    this.bot = null;
  }
  
  /**
   * 加载所有API模块
   * @returns {Promise<Map>} API集合
   */
  async load() {
    const startTime = Date.now();
    BotUtil.makeLog('info', '开始加载API模块...', 'ApiLoader');
    
    // 获取所有 core 目录下的 http 目录
    const apiDirs = await paths.getCoreSubDirs('http');
    
    // 加载每个API目录
    for (const apiDir of apiDirs) {
      const files = await this.getApiFiles(apiDir);
      for (const file of files) {
        await this.loadApi(file);
      }
    }
    
    // 按优先级排序
    this.sortByPriority();
    
    this.loaded = true;
    const loadTime = Date.now() - startTime;
    BotUtil.makeLog('info', `API模块加载完成: ${this.apis.size}个, 耗时${loadTime}ms`, 'ApiLoader');
    
    return this.apis;
  }
  
  /**
   * 获取API文件列表
   * @param {string} dir - 目录路径
   * @returns {Promise<Array>} 文件路径数组
   */
  async getApiFiles(dir) {
    const { FileLoader } = await import('#utils/file-loader.js');
    return FileLoader.readFiles(dir, {
      ext: '.js',
      recursive: true,
      ignore: ['.', '_']
    });
  }
  
  /**
   * 计算API的key（从文件路径）
   * @param {string} filePath - 文件路径
   * @returns {Promise<string>} API key
   */
  async getApiKey(filePath) {
    const coreDirs = await paths.getCoreDirs();
    const normalizedPath = path.normalize(filePath);
    
    for (const coreDir of coreDirs) {
      const normalizedCoreDir = path.normalize(coreDir);
      if (normalizedPath.startsWith(normalizedCoreDir)) {
        const relativePath = path.relative(normalizedCoreDir, normalizedPath);
        return relativePath.replace(/\\/g, '/').replace(/\.js$/, '');
      }
    }
    
    // 如果找不到对应的 core 目录，使用文件名作为 key
    return path.basename(filePath, '.js');
  }

  /**
   * 加载单个API文件
   * @param {string} filePath - 文件路径
   * @returns {Promise<boolean>} 是否成功
   */
  async loadApi(filePath) {
    try {
      const key = await this.getApiKey(filePath);
      
      // 如果已加载，先卸载
      if (this.apis.has(key)) {
        await this.unloadApi(key);
      }
      
      // 动态导入模块
      const fileUrl = `file://${filePath}?t=${Date.now()}`;
      const module = await import(fileUrl);
      
      // 跳过工具类文件（只有命名导出，没有default导出）
      // 例如：mcp-server.js 只导出 MCPServer 类，不是 HTTP API 模块
      if (!module.default) {
        // 检查是否有命名导出（可能是工具类）
        const namedExports = Object.keys(module).filter(k => k !== 'default');
        if (namedExports.length > 0) {
          BotUtil.makeLog('debug', `跳过工具类文件: ${key} (只有命名导出: ${namedExports.join(', ')})`, 'ApiLoader');
          return false;
        }
        BotUtil.makeLog('warn', `无效的API模块: ${key} (缺少default导出)`, 'ApiLoader');
        return false;
      }
      
      let apiInstance;
      
      // 支持类和对象两种导出方式
      if (typeof module.default === 'function') {
        // 检查是否是构造函数（类）
        apiInstance = new module.default();
      } else if (typeof module.default === 'object' && module.default !== null) {
        // 对象导出，转换为HttpApi实例
        apiInstance = new HttpApi(module.default);
      } else {
        BotUtil.makeLog('warn', `无效的API模块: ${key} (导出类型错误，类型: ${typeof module.default})`, 'ApiLoader');
        return false;
      }
      
      // 验证和标准化API实例
      if (!validateApiInstance(apiInstance, key)) {
        return false;
      }
      
      // 确保有getInfo方法
      if (typeof apiInstance.getInfo !== 'function') {
        apiInstance.getInfo = function() {
          return {
            name: this.name || key,
            dsc: this.dsc || '暂无描述',
            priority: getApiPriority(this),
            routes: this.routes ? this.routes.length : 0,
            enable: this.enable !== false,
            createTime: this.createTime || Date.now()
          };
        };
      }
      
      // 设置API的key和文件路径
      apiInstance.key = key;
      apiInstance.filePath = filePath;
      
      // 存储API实例
      this.apis.set(key, apiInstance);
      
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `加载API失败: ${filePath} - ${error.message}`, 'ApiLoader', error);
      return false;
    }
  }
  
  /**
   * 卸载API
   * @param {string} key - API键名
   */
  async unloadApi(key) {
    const api = this.apis.get(key);
    if (!api) return;
    
    // 调用停止方法
    if (typeof api.stop === 'function') {
      api.stop();
    }
    
    // 从集合中删除
    this.apis.delete(key);
    
    BotUtil.makeLog('debug', `卸载API: ${api.name || key}`, 'ApiLoader');
  }
  
  /**
   * 按优先级排序
   * 增强健壮性，防止 undefined 错误
   */
  sortByPriority() {
    this.priority = Array.from(this.apis.values())
      .filter(api => {
        // 严格验证：确保 api 存在且是对象
        if (!api || typeof api !== 'object') {
          BotUtil.makeLog('warn', '发现无效的API实例，已过滤', 'ApiLoader');
          return false;
        }
        // 检查是否启用
        return api.enable !== false;
      })
      .sort((a, b) => {
        // 双重安全检查，防止 undefined 错误
        if (!a || !b) {
          BotUtil.makeLog('warn', '排序时发现无效的API实例', 'ApiLoader');
          return 0;
        }
        // 使用工具函数安全获取优先级
        const priorityA = getApiPriority(a);
        const priorityB = getApiPriority(b);
        return priorityB - priorityA; // 降序：优先级高的在前
      });
  }
  
  /**
   * 注册所有API到Express应用
   * @param {Object} app - Express应用实例
   * @param {Object} bot - Bot实例
   */
  async register(app, bot) {
    this.app = app;
    this.bot = bot;
    
    // 全局中间件
    app.use((req, res, next) => {
      req.bot = bot;
      req.apiLoader = this;
      next();
    });
    
    let totalRoutes = 0;
    let totalWS = 0;
    let enabledCount = 0;
    
    // 按优先级顺序初始化API
    for (const api of this.priority) {
      if (!api || typeof api !== 'object') {
        BotUtil.makeLog('warn', `发现无效的API实例，已跳过`, 'ApiLoader');
        continue;
      }
      
      if (api.enable === false) continue;
      
      const apiName = api.name || api.key || 'unknown';
      
      try {
        const routeCount = api.routes ? api.routes.length : 0;
        const wsCount = api.wsHandlers ? Object.keys(api.wsHandlers).length : 0;
        
        if (typeof api.init === 'function') {
          await api.init(app, bot);
        }
        
        if (routeCount > 0 || wsCount > 0) {
          totalRoutes += routeCount;
          totalWS += wsCount;
          enabledCount++;
          
          if (getAistreamConfigOptional().global?.debug) {
            BotUtil.makeLog('debug', `注册API: ${apiName} (路由: ${routeCount}, WS: ${wsCount})`, 'ApiLoader');
          }
        }
      } catch (error) {
        BotUtil.makeLog('error', `注册API失败: ${apiName} - ${error.message}`, 'ApiLoader', error);
      }
    }
    
    // 404处理（排除代理路由，避免拦截 /api/god/*）
    app.use('/api/*', (req, res, next) => {
      if (req.path.startsWith('/api/god/')) return next();
      
      if (!res.headersSent) {
        res.status(404).json({
          success: false,
          message: 'API endpoint not found',
          path: req.originalUrl,
          timestamp: Date.now()
        });
      }
    });
    
    BotUtil.makeLog('info', `API路由注册完成: ${enabledCount}个模块, ${totalRoutes}个路由, ${totalWS}个WebSocket`, 'ApiLoader');
  }
  
  /**
   * 重载API
   * @param {string} key - API键名
   */
  async changeApi(key) {
    const api = this.apis.get(key);
    if (!api || !api.filePath) {
      BotUtil.makeLog('warn', `API不存在: ${key}`, 'ApiLoader');
      // 如果API不存在但文件存在，尝试直接加载
      const apiDirs = await paths.getCoreSubDirs('http');
      for (const apiDir of apiDirs) {
        const files = await this.getApiFiles(apiDir);
        const file = files.find(f => {
          const fileKey = path.relative(apiDir, f).replace(/\\/g, '/').replace(/\.js$/, '');
          return fileKey === key || path.basename(f, '.js') === key;
        });
        if (file) {
          BotUtil.makeLog('info', `尝试重新加载API: ${key}`, 'ApiLoader');
          await this.loadApi(file);
          this.sortByPriority();
          const newApi = this.apis.get(await this.getApiKey(file));
          if (newApi && this.app && this.bot && typeof newApi.init === 'function') {
            await newApi.init(this.app, this.bot);
          }
          return true;
        }
      }
      return false;
    }
    
    try {
      BotUtil.makeLog('info', `重载API: ${api.name || key}`, 'ApiLoader');
      
      // 保存文件路径
      const filePath = api.filePath;
      
      // 先卸载
      await this.unloadApi(key);
      
      // 重新加载文件
      await this.loadApi(filePath);
      
      // 重新排序
      this.sortByPriority();
      
      // 重新初始化
      const newApi = this.apis.get(key);
      if (newApi && this.app && this.bot && typeof newApi.init === 'function') {
        await newApi.init(this.app, this.bot);
      }
      
      BotUtil.makeLog('info', `API重载成功: ${api.name || key}`, 'ApiLoader');
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `API重载失败: ${api.name || key}`, 'ApiLoader', error);
      return false;
    }
  }
  
  /**
   * 获取API列表
   * @returns {Array} API信息数组
   */
  getApiList() {
    const apiList = [];
    
    for (const api of this.apis.values()) {
      if (!api) continue;
      
      try {
        // 确保api有getInfo方法
        if (typeof api.getInfo === 'function') {
          apiList.push(api.getInfo());
        } else {
          // 如果没有getInfo方法，构造一个基本信息
          apiList.push({
            name: api.name || api.key || 'undefined',
            dsc: api.dsc || '暂无描述',
            priority: api.priority || 100,
            routes: api.routes ? api.routes.length : 0,
            ws: api.ws ? Object.keys(api.ws).length : 0,
            enable: api.enable !== false,
            createTime: api.createTime || Date.now()
          });
        }
      } catch (error) {
        BotUtil.makeLog('error', `获取API信息失败: ${api.name || api.key || 'undefined'}`, 'ApiLoader', error);
      }
    }
    
    return apiList;
  }
  
  /**
   * 获取API实例
   * @param {string} key - API键名
   * @returns {Object|null} API实例
   */
  getApi(key) {
    return this.apis.get(key) || null;
  }
  
  /**
   * 启用文件监视
   * @param {boolean} enable - 是否启用
   */
  async watch(enable = true) {
    if (!enable) {
      // 停止所有监视器
      for (const watcher of Object.values(this.watcher)) {
        if (watcher && typeof watcher.close === 'function') {
          watcher.close()
        }
      }
      this.watcher = {}
      BotUtil.makeLog('debug', '文件监视已停止', 'ApiLoader')
      return
    }
    
    try {
      const { HotReloadBase } = await import('#utils/hot-reload-base.js')
      const hotReload = new HotReloadBase({ loggerName: 'ApiLoader' })
      
      const apiDirs = await paths.getCoreSubDirs('http')
      if (apiDirs.length === 0) {
        BotUtil.makeLog('debug', '未找到 http 目录，跳过文件监视', 'ApiLoader')
        return
      }

      await hotReload.watch(true, {
        dirs: apiDirs,
        onAdd: async (filePath) => {
          const fileName = path.basename(filePath)
          BotUtil.makeLog('debug', `检测到新文件: ${fileName}`, 'ApiLoader')
          const key = await this.getApiKey(filePath)
          await this.loadApi(filePath)
          this.sortByPriority()
          
          if (this.app && this.bot) {
            const api = this.apis.get(key)
            if (api && typeof api.init === 'function') {
              await api.init(this.app, this.bot)
            }
          }
        },
        onChange: async (filePath) => {
          const key = await this.getApiKey(filePath)
          BotUtil.makeLog('debug', `检测到文件变更: ${key}`, 'ApiLoader')
          await this.changeApi(key)
        },
        onUnlink: async (filePath) => {
          const key = await this.getApiKey(filePath)
          BotUtil.makeLog('debug', `检测到文件删除: ${key}`, 'ApiLoader')
          await this.unloadApi(key)
          this.sortByPriority()
        }
      })

      this.watcher.api = hotReload.watcher
      BotUtil.makeLog('debug', '文件监视已启动', 'ApiLoader')
    } catch (error) {
      BotUtil.makeLog('error', '启动文件监视失败', 'ApiLoader', error)
    }
  }
}

// 导出单例
export default new ApiLoader();