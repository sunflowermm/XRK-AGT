import path from 'node:path';
import HttpApi from './http.js';
import BotUtil from '#utils/botutil.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import paths from '#utils/paths.js';
import { validateApiInstance, getApiPriority } from './utils/helpers.js';
import { FileLoader } from '#utils/file-loader.js';
import { HotReloadBase } from '#utils/hot-reload-base.js';
import { API_REGISTER_BATCH_SIZE, LOADER_BATCH_SIZE } from '#utils/loader-constants.js';

class ApiLoader {
  apis = new Map();
  priority = [];
  watcher = {};
  loaded = false;
  app = null;
  bot = null;
  _coreDirsCache = null;

  async load() {
    const startTime = Date.now();
    BotUtil.makeLog('info', '开始加载API模块...', 'ApiLoader');

    const allFiles = await FileLoader.getCoreSubDirFiles('http', {
      ext: '.js',
      recursive: true
    });

    this._coreDirsCache = await paths.getCoreDirs();
    await FileLoader.forEachBatch(allFiles, LOADER_BATCH_SIZE, (file) => this.loadApi(file));
    this._coreDirsCache = null;

    this.sortByPriority();
    this.loaded = true;
    BotUtil.makeLog('info', `API模块加载完成: ${this.apis.size}个, 耗时${Date.now() - startTime}ms`, 'ApiLoader');
    return this.apis;
  }

  async getApiKey(filePath) {
    const coreDirs = this._coreDirsCache ?? await paths.getCoreDirs();
    const normalizedPath = path.normalize(filePath);

    for (const coreDir of coreDirs) {
      const normalizedCoreDir = path.normalize(coreDir);
      if (normalizedPath.startsWith(normalizedCoreDir)) {
        return path.relative(normalizedCoreDir, normalizedPath).replace(/\\/g, '/').replace(/\.js$/, '');
      }
    }
    return path.basename(filePath, '.js');
  }

  async loadApi(filePath) {
    try {
      const key = await this.getApiKey(filePath);
      if (this.apis.has(key)) await this.unloadApi(key);

      const module = await import(`file://${filePath}?t=${Date.now()}`);
      if (!module.default) {
        const namedExports = Object.keys(module).filter((k) => k !== 'default');
        if (namedExports.length > 0) {
          BotUtil.makeLog('debug', `跳过非 API 文件: ${key}`, 'ApiLoader');
          return false;
        }
        BotUtil.makeLog('warn', `无效 API 模块: ${key}`, 'ApiLoader');
        return false;
      }

      let apiInstance;
      if (typeof module.default === 'function') {
        apiInstance = new module.default();
      } else if (typeof module.default === 'object') {
        apiInstance = new HttpApi(module.default);
      } else {
        BotUtil.makeLog('warn', `无效 API 模块: ${key}`, 'ApiLoader');
        return false;
      }

      validateApiInstance(apiInstance, key);
      if (typeof apiInstance.getInfo !== 'function') {
        apiInstance.getInfo = function () {
          return {
            name: this.name,
            dsc: this.dsc,
            priority: getApiPriority(this),
            routes: this.routes.length,
            enable: this.enable !== false,
            createTime: this.createTime ?? Date.now()
          };
        };
      }

      apiInstance.key = key;
      apiInstance.filePath = filePath;
      this.apis.set(key, apiInstance);
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `加载API失败: ${filePath} - ${error.message}`, 'ApiLoader', error);
      return false;
    }
  }

  async unloadApi(key) {
    const api = this.apis.get(key);
    if (!api) return;

    if (typeof api.stop === 'function') {
      try {
        await api.stop();
      } catch (error) {
        BotUtil.makeLog('warn', `卸载 API stop 失败: ${api.name} - ${error.message}`, 'ApiLoader');
      }
    }

    this._removeWsHandlersByOwner(key);
    this.apis.delete(key);
    BotUtil.makeLog('debug', `卸载API: ${api.name}`, 'ApiLoader');
  }

  _removeWsHandlersByOwner(ownerKey) {
    if (!this.bot?.wsf) return;
    for (const [wsPath, handlers] of Object.entries(this.bot.wsf)) {
      if (!Array.isArray(handlers)) continue;
      const filtered = handlers.filter((fn) => fn.__ownerKey !== ownerKey);
      if (filtered.length > 0) this.bot.wsf[wsPath] = filtered;
      else delete this.bot.wsf[wsPath];
    }
  }

  sortByPriority() {
    this.priority = [...this.apis.values()]
      .filter((api) => api.enable !== false)
      .sort((a, b) => getApiPriority(b) - getApiPriority(a));
  }

  async _initApi(api) {
    if (this.app && this.bot && typeof api.init === 'function') {
      await api.init(this.app, this.bot);
    }
  }

  async _reloadFromFile(key, filePath) {
    await this.unloadApi(key);
    await this.loadApi(filePath);
    this.sortByPriority();
    await this._initApi(this.apis.get(key));
  }

  async register(app, bot) {
    this.app = app;
    this.bot = bot;

    app.use((req, res, next) => {
      req.bot = bot;
      req.apiLoader = this;
      next();
    });

    let totalRoutes = 0;
    let totalWS = 0;
    let enabledCount = 0;

    const registerOne = async (api) => {
      try {
        const routeCount = api.routes.length;
        const wsCount = api.wsHandlers ? Object.keys(api.wsHandlers).length : 0;
        await this._initApi(api);

        if (routeCount > 0 || wsCount > 0) {
          if (getAistreamConfigOptional().global?.debug) {
            BotUtil.makeLog('debug', `注册API: ${api.name} (路由: ${routeCount}, WS: ${wsCount})`, 'ApiLoader');
          }
          return { routeCount, wsCount, enabled: true };
        }
        return { routeCount: 0, wsCount: 0, enabled: false };
      } catch (error) {
        BotUtil.makeLog('error', `注册API失败: ${api.name} - ${error.message}`, 'ApiLoader', error);
        return { routeCount: 0, wsCount: 0, enabled: false };
      }
    };

    const results = await FileLoader.mapInBatches(this.priority, API_REGISTER_BATCH_SIZE, registerOne);
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value.enabled) continue;
      totalRoutes += result.value.routeCount;
      totalWS += result.value.wsCount;
      enabledCount++;
    }

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

  async changeApi(key) {
    const api = this.apis.get(key);
    if (!api?.filePath) {
      BotUtil.makeLog('warn', `API不存在: ${key}`, 'ApiLoader');
      const apiDirs = await paths.getCoreSubDirs('http');
      for (const apiDir of apiDirs) {
        const files = await FileLoader.readFiles(apiDir, { ext: '.js', recursive: true });
        const file = files.find((f) => {
          const fileKey = path.relative(apiDir, f).replace(/\\/g, '/').replace(/\.js$/, '');
          return fileKey === key || path.basename(f, '.js') === key;
        });
        if (file) {
          await this._reloadFromFile(key, file);
          return true;
        }
      }
      return false;
    }

    try {
      BotUtil.makeLog('info', `重载API: ${api.name}`, 'ApiLoader');
      await this._reloadFromFile(key, api.filePath);
      BotUtil.makeLog('info', `API重载成功: ${api.name}`, 'ApiLoader');
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `API重载失败: ${api.name}`, 'ApiLoader', error);
      return false;
    }
  }

  getApiList() {
    return [...this.apis.values()].map((api) => api.getInfo());
  }

  getApi(key) {
    return this.apis.get(key) ?? null;
  }

  async watch(enable = true) {
    if (!enable) {
      for (const watcher of Object.values(this.watcher)) {
        watcher?.close();
      }
      this.watcher = {};
      return;
    }

    const hotReload = new HotReloadBase({ loggerName: 'ApiLoader' });
    const apiDirs = await paths.getCoreSubDirs('http');
    if (apiDirs.length === 0) return;

    await hotReload.watch(true, {
      dirs: apiDirs,
      onAdd: async (filePath) => {
        const key = await this.getApiKey(filePath);
        await this.loadApi(filePath);
        this.sortByPriority();
        await this._initApi(this.apis.get(key));
      },
      onChange: async (filePath) => {
        await this.changeApi(await this.getApiKey(filePath));
      },
      onUnlink: async (filePath) => {
        await this.unloadApi(await this.getApiKey(filePath));
        this.sortByPriority();
      }
    });

    this.watcher.api = hotReload.watcher;
  }
}

export default new ApiLoader();
