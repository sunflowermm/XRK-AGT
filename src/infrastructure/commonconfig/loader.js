import path from 'node:path';
import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';
import { findInCoreSubDirs } from '#utils/core-fs.js';
import { FileLoader } from '#utils/file-loader.js';
import { HotReloadBase } from '#utils/hot-reload-base.js';
import { LOADER_BATCH_SIZE } from '#utils/loader-constants.js';
import { callSubserver } from '#utils/subserver-client.js';
import SubserverConfigProxy from './subserver-config-proxy.js';

class ConfigLoader {
  configs = new Map();
  loaded = false;
  _hotReload = null;

  async load() {
    const startTime = Date.now();
    BotUtil.makeLog('info', '开始加载配置管理器...', 'ConfigLoader');

    const allFiles = await FileLoader.getCoreSubDirFiles('commonconfig', {
      ext: '.js',
      recursive: false
    });

    await FileLoader.forEachBatch(allFiles, LOADER_BATCH_SIZE, (file) => this._loadConfig(file));

    await this.registerFromSubserver();

    this.loaded = true;
    BotUtil.makeLog(
      'info',
      `配置管理器加载完成: ${this.configs.size}个, 耗时${Date.now() - startTime}ms`,
      'ConfigLoader'
    );
    return this.configs;
  }

  /** 拉取子服已注册插件配置，注入控制台（业务 schema 仅在子服维护） */
  async registerFromSubserver() {
    let items = [];
    try {
      const res = await callSubserver('/api/system/commonconfig/list', {
        method: 'GET',
        timeout: 8000
      });
      items = Array.isArray(res?.configs) ? res.configs : [];
    } catch (error) {
      BotUtil.makeLog(
        'debug',
        `子服 CommonConfig 未接入（子服未启动或无可配置插件）: ${error.message}`,
        'ConfigLoader'
      );
      return;
    }

    for (const item of items) {
      const group = item.group;
      if (!group) continue;
      try {
        const structureRes = await callSubserver(`/api/${group}/config/structure`, {
          method: 'GET',
          runtime: item.runtime,
          timeout: 8000
        });
        const structure = structureRes?.structure;
        if (!structure?.name) continue;

        if (this.configs.has(structure.name)) {
          BotUtil.makeLog(
            'warn',
            `子服配置 ${structure.name} 与本地 CommonConfig 重名，跳过代理`,
            'ConfigLoader'
          );
          continue;
        }

        this.configs.set(
          structure.name,
          new SubserverConfigProxy({
            ...structure,
            runtime: item.runtime,
            group
          })
        );
        BotUtil.makeLog(
          'debug',
          `代理子服配置: ${structure.displayName ?? structure.name} (${item.runtime}/${group})`,
          'ConfigLoader'
        );
      } catch (error) {
        BotUtil.makeLog(
          'warn',
          `子服配置 ${group} 结构拉取失败: ${error.message}`,
          'ConfigLoader'
        );
      }
    }
  }

  async _loadConfig(filePath) {
    try {
      const key = path.basename(filePath, '.js');
      const module = await FileLoader.importFresh(filePath);
      if (!module.default) {
        BotUtil.makeLog('warn', `无效的配置模块: ${key}`, 'ConfigLoader');
        return false;
      }

      const configInstance = typeof module.default === 'function'
        ? new module.default()
        : module.default;

      this.configs.set(key, configInstance);
      BotUtil.makeLog('debug', `加载配置: ${configInstance.displayName ?? key}`, 'ConfigLoader');
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `加载配置失败: ${filePath} - ${error.message}`, 'ConfigLoader', error);
      return false;
    }
  }

  get(name) {
    return this.configs.get(name) ?? null;
  }

  getAll() {
    return this.configs;
  }

  getList() {
    return [...this.configs.values()]
      .filter((config) => typeof config.getStructure === 'function')
      .map((config) => config.getStructure());
  }

  async reload(name) {
    const configPath = findInCoreSubDirs(await paths.getCoreSubDirs('commonconfig'), name);
    if (!configPath) {
      BotUtil.makeLog('error', `配置重载失败: ${name} 文件不存在`, 'ConfigLoader');
      return false;
    }
    await this._loadConfig(configPath);
    BotUtil.makeLog('info', `配置已重载: ${name}`, 'ConfigLoader');
    return true;
  }

  clearAllCache() {
    for (const config of this.configs.values()) {
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
        onChange: (filePath) => this.reload(hotReload.getFileKey(filePath)),
        onUnlink: (filePath) => this.configs.delete(hotReload.getFileKey(filePath))
      });
      if (started) this._hotReload = hotReload;
    } catch (error) {
      BotUtil.makeLog('error', '启动 CommonConfig 文件监视失败', 'ConfigLoader', error);
    }
  }
}

export default new ConfigLoader();
