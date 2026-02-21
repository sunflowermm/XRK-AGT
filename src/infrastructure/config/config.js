import YAML from 'yaml';
import fs from 'fs';
import chokidar from 'chokidar';
import path from 'path';
import paths from '#utils/paths.js';
import BotUtil from '#utils/botutil.js';
import { GLOBAL_CONFIGS, SERVER_CONFIGS } from './config-constants.js';

const LOG_TAG = 'Config';

/**
 * 配置管理类
 * 配置结构：
 * - 全局配置：存储在 server_bots/ 根目录
 * - 服务器配置：存储在 server_bots/{port}/
 */
class Cfg {
  constructor() {
    this.config = {};
    this._port = null;
    this.watcher = {};
    this._renderer = null;

    this.PATHS = {
      DEFAULT_CONFIG: paths.configDefault,
      SERVER_BOTS: paths.dataServerBots,
      RENDERERS: paths.renderers
    };
    
    this.GLOBAL_CONFIGS = GLOBAL_CONFIGS;
    this.SERVER_CONFIGS = SERVER_CONFIGS;
    
    const portIndex = process.argv.indexOf('server');
    if (portIndex !== -1 && process.argv[portIndex + 1]) {
      this._port = parseInt(process.argv[portIndex + 1]);
    }

    this.ensureGlobalConfigDir();
  }

  getGlobalConfigDir() {
    return this.PATHS.SERVER_BOTS;
  }

  getConfigDir() {
    if (!this._port || isNaN(this._port)) return null;
    return path.join(this.PATHS.SERVER_BOTS, String(this._port));
  }

  ensureGlobalConfigDir() {
    fs.mkdirSync(this.getGlobalConfigDir(), { recursive: true });
    try {
      const defaultFiles = fs.readdirSync(this.PATHS.DEFAULT_CONFIG);
      for (const file of defaultFiles) {
        const configName = path.basename(file, '.yaml');
        if (this.GLOBAL_CONFIGS.includes(configName)) {
          const targetPath = path.join(this.getGlobalConfigDir(), file);
          if (!fs.existsSync(targetPath)) {
            fs.copyFileSync(path.join(this.PATHS.DEFAULT_CONFIG, file), targetPath);
          }
        }
      }
    } catch {}
  }

  getGlobalConfig(name) {
    const key = `global.${name}`;
    if (this.config[key]) return this.config[key];
    
    const file = path.join(this.getGlobalConfigDir(), `${name}.yaml`);
    const defaultFile = path.join(this.PATHS.DEFAULT_CONFIG, `${name}.yaml`);
    
    const watchFile = fs.existsSync(file) ? file : (fs.existsSync(defaultFile) ? defaultFile : null);
    let config = {};
    
    if (watchFile) {
      try {
        config = YAML.parse(fs.readFileSync(watchFile, 'utf8'));
        this.watch(watchFile, name, key);
      } catch (error) {
        BotUtil.makeLog('error', `[配置解析失败][${watchFile}] ${error?.message || error}`, LOG_TAG, true);
      }
    }
    
    return this.config[key] = config;
  }

  getServerConfig(name) {
    if (this.GLOBAL_CONFIGS.includes(name)) {
      BotUtil.makeLog('warn', `[配置警告] ${name} 是全局配置，应使用 getGlobalConfig() 或 cfg.${name} 访问`, LOG_TAG);
      return {};
    }
    
    const key = `server.${this._port}.${name}`;
    if (this.config[key]) return this.config[key];
    
    const configDir = this.getConfigDir();
    if (!configDir) {
      const defaultFile = path.join(this.PATHS.DEFAULT_CONFIG, `${name}.yaml`);
      try {
        return fs.existsSync(defaultFile) ? YAML.parse(fs.readFileSync(defaultFile, 'utf8')) : {};
      } catch {
        return {};
      }
    }
    
    const file = path.join(configDir, `${name}.yaml`);
    const defaultFile = path.join(this.PATHS.DEFAULT_CONFIG, `${name}.yaml`);
    let config = {};

    if (fs.existsSync(file)) {
      try {
        config = YAML.parse(fs.readFileSync(file, 'utf8'));
        this.watch(file, name, key);
      } catch (error) {
        BotUtil.makeLog('error', `[服务器配置解析失败][${file}] ${error?.message || error}`, LOG_TAG, true);
      }
    } else if (fs.existsSync(defaultFile)) {
      try {
        config = YAML.parse(fs.readFileSync(defaultFile, 'utf8'));
        BotUtil.makeLog('warn', `[配置提示] ${name}.yaml 不存在，使用默认配置`, LOG_TAG);
      } catch (error) {
        BotUtil.makeLog('error', `[默认配置读取失败][${name}] ${error?.message || error}`, LOG_TAG, true);
      }
    }
    
    return this.config[key] = config;
  }

  getConfig(name) {
    return this.GLOBAL_CONFIGS.includes(name) 
      ? this.getGlobalConfig(name) 
      : this.getServerConfig(name);
  }

  get agt() { return this.getGlobalConfig('agt'); }
  get device() { return this.getGlobalConfig('device'); }
  get monitor() { return this.getGlobalConfig('monitor'); }
  get notice() { return this.getGlobalConfig('notice'); }
  get mongodb() { return this.getGlobalConfig('mongodb'); }
  get redis() { return this.getGlobalConfig('redis'); }
  get aistream() { return this.getGlobalConfig('aistream'); }

  get server() { return this.getServerConfig('server'); }
  get chatbot() { return this.getServerConfig('chatbot'); }
  get group() { return this.getServerConfig('group'); }

  get volcengine_llm() { return this.getServerConfig('volcengine_llm'); }
  get xiaomimimo_llm() { return this.getServerConfig('xiaomimimo_llm'); }
  get openai_llm() { return this.getServerConfig('openai_llm'); }
  get openai_compat_llm() { return this.getServerConfig('openai_compat_llm'); }
  get gemini_llm() { return this.getServerConfig('gemini_llm'); }
  get anthropic_llm() { return this.getServerConfig('anthropic_llm'); }
  get azure_openai_llm() { return this.getServerConfig('azure_openai_llm'); }
  get volcengine_asr() { return this.getServerConfig('volcengine_asr'); }
  get volcengine_tts() { return this.getServerConfig('volcengine_tts'); }

  get masterQQ() {
    const masterQQ = this.chatbot?.master?.qq || [];
    const list = Array.isArray(masterQQ) ? masterQQ : [masterQQ];
    return list.map(qq => {
      if (typeof qq === 'number') return qq;
      if (typeof qq === 'string' && /^\d+$/.test(qq)) return Number(qq);
      return qq;
    });
  }

  get master() {
    const masters = {};
    if (Bot.uin) {
      const masterList = this.masterQQ.map(qq => String(qq));
      Bot.uin.forEach(botUin => {
        masters[botUin] = masterList;
      });
    }
    return masters;
  }

  getGroup(groupId = '') {
    const config = this.group || {};
    const defaultCfg = config.default || {};
    const groupCfg = groupId ? config[String(groupId)] : null;
    return groupCfg ? { ...defaultCfg, ...groupCfg } : defaultCfg;
  }

  getRendererConfig(type) {
    const defaultFile = path.join(this.PATHS.RENDERERS, type, 'config_default.yaml');
    if (!this._port) {
      try {
        const out = fs.existsSync(defaultFile) ? YAML.parse(fs.readFileSync(defaultFile, 'utf8')) : {};
        BotUtil.makeLog('debug', `[渲染器] port 未设置，仅用默认配置: ${type}`, LOG_TAG);
        return out;
      } catch {
        return {};
      }
    }
    const key = `renderer.${this._port}.${type}`;
    if (this.config[key]) return this.config[key];
    const serverDir = path.join(this.getConfigDir(), 'renderers', type);
    const serverFile = path.join(serverDir, 'config.yaml');
    let config = {};
    if (fs.existsSync(defaultFile)) {
      try {
        config = YAML.parse(fs.readFileSync(defaultFile, 'utf8'));
      } catch (e) {
        BotUtil.makeLog('error', `[渲染器] 默认配置解析失败 [${type}] ${e?.message || e}`, LOG_TAG, true);
      }
    }
    if (fs.existsSync(serverFile)) {
      try {
        config = { ...config, ...YAML.parse(fs.readFileSync(serverFile, 'utf8')) };
        this.watch(serverFile, `renderer.${type}`, key);
        BotUtil.makeLog('debug', `[渲染器] 已合并 ${type} 服务器配置: ${serverFile}`, LOG_TAG);
      } catch (e) {
        BotUtil.makeLog('error', `[渲染器] 服务器配置解析失败 [${type}] ${serverFile} ${e?.message || e}`, LOG_TAG, true);
      }
    } else {
      BotUtil.makeLog('debug', `[渲染器] 无服务器覆盖: ${serverFile}`, LOG_TAG);
    }
    return this.config[key] = config;
  }

  get renderer() {
    if (this._renderer) return this._renderer;
    return this._renderer = {
      puppeteer: this.getRendererConfig('puppeteer'),
      playwright: this.getRendererConfig('playwright')
    };
  }

  get port() {
    return this._port;
  }

  get package() {
    if (this._package) return this._package;
    return this._package = JSON.parse(fs.readFileSync(path.join(paths.root, 'package.json'), 'utf8'));
  }

  setConfig(name, data) {
    const isGlobal = this.GLOBAL_CONFIGS.includes(name);
    const configDir = isGlobal ? this.getGlobalConfigDir() : this.getConfigDir();
    if (!configDir) {
      BotUtil.makeLog('error', '[配置保存失败] 无效的端口号', LOG_TAG);
      return false;
    }

    const file = path.join(configDir, `${name}.yaml`);
    const key = isGlobal ? `global.${name}` : `server.${this._port}.${name}`;
    const configType = isGlobal ? '全局' : '服务器';

    try {
      this.config[key] = data;
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(file, YAML.stringify(data), 'utf8');
      BotUtil.makeLog('mark', `[保存${configType}配置文件][${name}]`, LOG_TAG);
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `[${configType}配置保存失败][${name}] ${error?.message || error}`, LOG_TAG, true);
      return false;
    }
  }

  watch(file, name, key) {
    if (this.watcher[key]) return;

    const watcher = chokidar.watch(file, {
      persistent: true,
      ignoreInitial: true
    });

    watcher.on('change', () => {
      delete this.config[key];
      BotUtil.makeLog('mark', `[修改配置文件][${name}]`, LOG_TAG);
      this[`change_${name}`]?.();
    });

    this.watcher[key] = watcher;
  }

  async change_agt() {
    try {
      const log = await import('#infrastructure/log.js');
      log.default();
    } catch (error) {
      BotUtil.makeLog('error', `[AGT配置变更处理失败] ${error?.message || error}`, LOG_TAG, true);
    }
  }

  destroy() {
    Object.values(this.watcher).forEach(watcher => watcher?.close());
    this.watcher = {};
    this.config = {};
  }
}

export default new Cfg();
