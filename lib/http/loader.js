import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import HttpApi from './http.js';
import BotUtil from '../common/util.js';

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
    BotUtil.makeLog('mark', '开始加载API模块', 'ApiLoader');
    
    // API目录路径
    const apiDir = path.join(process.cwd(), 'plugins/api');
    
    try {
      // 确保目录存在
      await fs.mkdir(apiDir, { recursive: true });
      
      // 读取所有JS文件
      const files = await this.getApiFiles(apiDir);
      
      // 加载每个API文件
      for (const file of files) {
        await this.loadApi(file);
      }
      
      // 按优先级排序
      this.sortByPriority();
      
      this.loaded = true;
      const loadTime = Date.now() - startTime;
      BotUtil.makeLog('info', `加载完成，共${this.apis.size}个API，耗时${loadTime}ms`, 'ApiLoader');
      
      return this.apis;
    } catch (error) {
      BotUtil.makeLog('error', '加载失败', 'ApiLoader', error);
      throw error;
    }
  }
  
  /**
   * 获取API文件列表
   * @param {string} dir - 目录路径
   * @returns {Promise<Array>} 文件路径数组
   */
  async getApiFiles(dir) {
    const files = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // 递归读取子目录
          const subFiles = await this.getApiFiles(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          // 跳过以.或_开头的文件
          if (!entry.name.startsWith('.') && !entry.name.startsWith('_')) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      BotUtil.makeLog('error', `读取目录失败: ${dir}`, 'ApiLoader', error);
    }
    
    return files;
  }
  
  /**
   * 加载单个API文件
   * @param {string} filePath - 文件路径
   * @returns {Promise<boolean>} 是否成功
   */
  async loadApi(filePath) {
    try {
      // 获取相对路径作为key
      const key = path.relative(path.join(process.cwd(), 'plugins/api'), filePath)
        .replace(/\\/g, '/')
        .replace(/\.js$/, '');
      
      // 如果已加载，先卸载
      if (this.apis.has(key)) {
        await this.unloadApi(key);
      }
      
      // 动态导入模块
      const fileUrl = `file://${filePath}?t=${Date.now()}`;
      const module = await import(fileUrl);
      
      // 检查是否是有效的API模块
      if (!module.default) {
        BotUtil.makeLog('warn', `无效的API模块: ${key} (缺少default导出)`, 'ApiLoader');
        return false;
      }
      
      let apiInstance;
      
      // 支持类和对象两种导出方式
      if (typeof module.default === 'function') {
        // 检查是否是构造函数（类）
        try {
          apiInstance = new module.default();
        } catch (e) {
          // 如果不能实例化，可能是普通函数，跳过
          BotUtil.makeLog('warn', `无法实例化API模块: ${key}`, 'ApiLoader');
          return false;
        }
      } else if (typeof module.default === 'object' && module.default !== null) {
        // 对象导出，转换为HttpApi实例
        apiInstance = new HttpApi(module.default);
      } else {
        BotUtil.makeLog('warn', `无效的API模块: ${key} (导出类型错误)`, 'ApiLoader');
        return false;
      }
      
      // 验证API实例
      if (!apiInstance || typeof apiInstance !== 'object') {
        BotUtil.makeLog('warn', `API实例创建失败: ${key}`, 'ApiLoader');
        return false;
      }
      
      // 确保有getInfo方法
      if (typeof apiInstance.getInfo !== 'function') {
        // 如果没有getInfo方法，添加一个默认的
        apiInstance.getInfo = function() {
          return {
            name: this.name || key,
            dsc: this.dsc || '暂无描述',
            priority: this.priority || 100,
            routes: this.routes ? this.routes.length : 0,
            enable: this.enable !== false,
            createTime: this.createTime || Date.now()
          };
        };
      }
      
      // 设置API的key
      apiInstance.key = key;
      apiInstance.filePath = filePath;
      
      // 存储API实例
      this.apis.set(key, apiInstance);
      
      BotUtil.makeLog('debug', `加载API: ${apiInstance.name || key}`, 'ApiLoader');
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `加载API失败: ${filePath}`, 'ApiLoader', error);
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
   */
  sortByPriority() {
    this.priority = Array.from(this.apis.values())
      .filter(api => api && api.enable !== false)
      .sort((a, b) => (b.priority || 100) - (a.priority || 100));
  }
  
  /**
   * 注册所有API到Express应用
   * @param {Object} app - Express应用实例
   * @param {Object} bot - Bot实例
   */
  async register(app, bot) {
    this.app = app;
    this.bot = bot;
    
    BotUtil.makeLog('mark', '开始注册API路由', 'ApiLoader');
    
    // 全局中间件
    app.use((req, res, next) => {
      req.bot = bot;
      req.apiLoader = this;
      next();
    });
    
    // 按优先级顺序初始化API
    for (const api of this.priority) {
      try {
        if (!api || api.enable === false) continue;
        
        // 确保API有name属性
        const apiName = api.name || api.key || 'undefined';
        
        // 初始化API
        if (typeof api.init === 'function') {
          await api.init(app, bot);
        }
        
        BotUtil.makeLog('info', `注册API: ${apiName} (优先级: ${api.priority || 100})`, 'ApiLoader');
      } catch (error) {
        const apiName = api.name || api.key || 'undefined';
        BotUtil.makeLog('error', `注册API失败: ${apiName}`, 'ApiLoader', error);
      }
    }
    
    // 404处理
    app.use('/api/*', (req, res) => {
      res.status(404).json({
        success: false,
        message: 'API endpoint not found',
        path: req.originalUrl,
        timestamp: Date.now()
      });
    });
    
    BotUtil.makeLog('info', 'API注册完成', 'ApiLoader');
  }
  
  /**
   * 重载API
   * @param {string} key - API键名
   */
  async changeApi(key) {
    const api = this.apis.get(key);
    if (!api) {
      BotUtil.makeLog('warn', `API不存在: ${key}`, 'ApiLoader');
      return false;
    }
    
    try {
      BotUtil.makeLog('info', `重载API: ${api.name || key}`, 'ApiLoader');
      
      // 重新加载文件
      await this.loadApi(api.filePath);
      
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
          watcher.close();
        }
      }
      this.watcher = {};
      BotUtil.makeLog('info', '文件监视已停止', 'ApiLoader');
      return;
    }
    
    const apiDir = path.join(process.cwd(), 'plugins/api');
    
    try {
      const { watch } = await import('chokidar');
      
      this.watcher.api = watch(apiDir, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true
      });
      
      this.watcher.api
        .on('add', filePath => {
          BotUtil.makeLog('info', `检测到新文件: ${filePath}`, 'ApiLoader');
          this.loadApi(filePath).then(() => {
            this.sortByPriority();
            if (this.app && this.bot) {
              const key = path.relative(apiDir, filePath).replace(/\\/g, '/').replace(/\.js$/, '');
              const api = this.apis.get(key);
              if (api && typeof api.init === 'function') {
                api.init(this.app, this.bot);
              }
            }
          });
        })
        .on('change', filePath => {
          const key = path.relative(apiDir, filePath).replace(/\\/g, '/').replace(/\.js$/, '');
          BotUtil.makeLog('info', `检测到文件变更: ${key}`, 'ApiLoader');
          this.changeApi(key);
        })
        .on('unlink', filePath => {
          const key = path.relative(apiDir, filePath).replace(/\\/g, '/').replace(/\.js$/, '');
          BotUtil.makeLog('info', `检测到文件删除: ${key}`, 'ApiLoader');
          this.unloadApi(key);
          this.sortByPriority();
        });
      
      BotUtil.makeLog('info', '文件监视已启动', 'ApiLoader');
    } catch (error) {
      BotUtil.makeLog('error', '启动文件监视失败', 'ApiLoader', error);
    }
  }
}

// 导出单例
export default new ApiLoader();