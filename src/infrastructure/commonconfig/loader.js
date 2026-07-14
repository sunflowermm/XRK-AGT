import path from 'node:path';
import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';
import { findInCoreSubDirs, resolveQualifiedCoreModuleKey } from '#utils/core-fs.js';
import { FileLoader } from '#utils/file-loader.js';
import { HotReloadBase } from '#utils/hot-reload-base.js';
import { LOADER_BATCH_SIZE } from '#utils/loader-constants.js';

class ConfigLoader {
  configs = new Map();
  loaded = false;
  _hotReload = null;
  _configDirsCache = null;

  async load() {
    const startTime = Date.now();
    BotUtil.makeLog('info', '开始加载配置管理器...', 'ConfigLoader');

    const allFiles = await FileLoader.getCoreSubDirFiles('commonconfig', {
      ext: '.js',
      recursive: false
    });

    this._configDirsCache = await paths.getCoreSubDirs('commonconfig');
    await FileLoader.forEachBatch(allFiles, LOADER_BATCH_SIZE, (file) => this._loadConfig(file));
    this._configDirsCache = null;

    this.loaded = true;
    BotUtil.makeLog(
      'info',
      `配置管理器加载完成: ${this.configs.size}个, 耗时${Date.now() - startTime}ms`,
      'ConfigLoader'
    );
    return this.configs;
  }

  _configKey(filePath) {
    const dirs = this._configDirsCache ?? [];
    return resolveQualifiedCoreModuleKey(filePath, dirs, 'commonconfig');
  }

  async _loadConfig(filePath) {
    try {
      const dirs = this._configDirsCache ?? await paths.getCoreSubDirs('commonconfig');
      const key = resolveQualifiedCoreModuleKey(filePath, dirs, 'commonconfig');
      const module = await FileLoader.importFresh(filePath);
      if (!module.default) {
        BotUtil.makeLog('warn', `无效的配置模块: ${key}`, 'ConfigLoader');
        return false;
      }

      const configInstance = typeof module.default === 'function'
        ? new module.default()
        : module.default;

      configInstance.key = key;
      configInstance.filePath = filePath;
      this.configs.set(key, configInstance);
      // 短名别名：仅在未占用时写入，便于 ConfigManager.get('ai_config')
      const shortName = path.basename(filePath, '.js');
      if (!this.configs.has(shortName)) {
        this.configs.set(shortName, configInstance);
      }
      BotUtil.makeLog('debug', `加载配置: ${configInstance.displayName ?? key}`, 'ConfigLoader');
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `加载配置失败: ${filePath} - ${error.message}`, 'ConfigLoader', error);
      return false;
    }
  }

  /**
   * @param {string} name 短名（ai_config）或限定名（system-Core/ai_config）
   */
  get(name) {
    if (!name) return null;
    if (this.configs.has(name)) return this.configs.get(name);
    if (!String(name).includes('/')) {
      const sys = this.configs.get(`system-Core/${name}`);
      if (sys) return sys;
      for (const [key, inst] of this.configs) {
        if (String(key).endsWith(`/${name}`)) return inst;
      }
    }
    return null;
  }

  getAll() {
    return this.configs;
  }

  getList() {
    const seen = new Set();
    return [...this.configs.entries()]
      .filter(([key, config]) => {
        if (!key.includes('/')) return false;
        if (seen.has(config)) return false;
        seen.add(config);
        return typeof config.getStructure === 'function';
      })
      .map(([, config]) => config.getStructure());
  }

  async reload(name) {
    const configPath = findInCoreSubDirs(await paths.getCoreSubDirs('commonconfig'), name.includes('/') ? path.basename(name) : name);
    if (!configPath) {
      BotUtil.makeLog('error', `配置重载失败: ${name} 文件不存在`, 'ConfigLoader');
      return false;
    }
    return this.reloadFile(configPath);
  }

  /** 按监视器报告的绝对路径重载（避免 basename 歧义） */
  async reloadFile(configPath) {
    const ok = await this._loadConfig(configPath);
    if (ok) {
      const key = resolveQualifiedCoreModuleKey(
        configPath,
        await paths.getCoreSubDirs('commonconfig'),
        'commonconfig'
      );
      this.configs.get(key)?.clearCache?.();
      BotUtil.makeLog('info', `配置已重载: ${key}`, 'ConfigLoader');
    }
    return ok;
  }

  clearAllCache() {
    const seen = new Set();
    for (const config of this.configs.values()) {
      if (seen.has(config)) continue;
      seen.add(config);
      config.clearCache?.();
    }
  }

  async watch(enable = true) {
    if (!enable) {
      await this._hotReload?.stop();
      this._hotReload = null;
      return;
    }
    if (this._hotReload?.watcher) return;

    try {
      const hotReload = new HotReloadBase({ loggerName: 'ConfigLoader' });
      const configDirs = await paths.getCoreSubDirs('commonconfig');
      if (configDirs.length === 0) return;

      const started = await hotReload.watch(true, {
        dirs: configDirs,
        onAdd: (filePath) => this._loadConfig(filePath),
        onChange: (filePath) => this.reloadFile(filePath),
        onUnlink: (filePath) => {
          const key = resolveQualifiedCoreModuleKey(filePath, configDirs, 'commonconfig');
          const shortName = path.basename(filePath, '.js');
          const inst = this.configs.get(key);
          this.configs.delete(key);
          if (inst && this.configs.get(shortName) === inst) this.configs.delete(shortName);
        }
      });
      if (started) this._hotReload = hotReload;
    } catch (error) {
      BotUtil.makeLog('error', '启动 CommonConfig 文件监视失败', 'ConfigLoader', error);
    }
  }
}

export default new ConfigLoader();
