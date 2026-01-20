import YAML from 'yaml';
import fs from 'fs';
import chokidar from 'chokidar';
import path from 'path';
import paths from '#utils/paths.js';

/**
 * 配置管理类
 * 配置结构：
 * - 全局配置（不随端口变化）：agt, device, monitor, notice, mongodb, redis, db, aistream
 *   存储位置：server_bots/ 根目录
 * - 服务器配置（随端口变化）：server, chatbot, group, 工厂配置
 *   存储位置：server_bots/{port}/
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
    
    // 全局配置列表（不随端口变化，存储在server_bots/根目录）
    this.GLOBAL_CONFIGS = ['agt', 'device', 'monitor', 'notice', 'mongodb', 'redis', 'db', 'aistream'];
    
    // 服务器配置列表（随端口变化，存储在server_bots/{port}/）
    this.SERVER_CONFIGS = ['server', 'chatbot', 'group'];
    
    const portIndex = process.argv.indexOf('server');
    if (portIndex !== -1 && process.argv[portIndex + 1]) {
      this._port = parseInt(process.argv[portIndex + 1]);
    }

    // 确保全局配置目录存在
    this.ensureGlobalConfigDir();

    if (this._port) {
      this.ensureServerConfigDir();
    }
  }

  /**
   * 获取全局配置目录路径（server_bots/根目录）
   */
  getGlobalConfigDir() {
    return this.PATHS.SERVER_BOTS;
  }

  /**
   * 获取服务器配置目录路径（server_bots/{port}/）
   */
  getConfigDir() {
    if (!this._port || isNaN(this._port)) return null;
    return path.join(this.PATHS.SERVER_BOTS, String(this._port));
  }

  /**
   * 确保全局配置目录存在，从默认配置复制
   */
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
    } catch {
      // 默认配置目录不存在，忽略
    }
  }

  /**
   * 确保服务器配置目录存在，从默认配置复制
   */
  ensureServerConfigDir() {
    if (!this._port) return;

    const serverConfigDir = this.getConfigDir();
    if (!serverConfigDir) return;

    fs.mkdirSync(serverConfigDir, { recursive: true });

    // 只在目录为空时复制默认配置
    try {
      if (fs.readdirSync(serverConfigDir).length > 0) return;
    } catch {
      // 目录不存在，继续复制
    }

    try {
      const defaultFiles = fs.readdirSync(this.PATHS.DEFAULT_CONFIG);
      for (const file of defaultFiles) {
        const configName = path.basename(file, '.yaml');
        if (this.SERVER_CONFIGS.includes(configName) || 
            configName.startsWith('gptgod_') ||
            configName.includes('volcengine_') || 
            configName.includes('xiaomimimo_')) {
        const targetPath = path.join(serverConfigDir, file);
        if (!fs.existsSync(targetPath)) {
            fs.copyFileSync(path.join(this.PATHS.DEFAULT_CONFIG, file), targetPath);
          }
        }
      }
    } catch {
      // 默认配置目录不存在，忽略
    }
  }

  /**
   * 获取全局配置（从server_bots/根目录读取）
   * @param {string} name - 配置名称
   */
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
        logger?.error(`[配置解析失败][${watchFile}]`, error);
      }
    }
    
    return this.config[key] = config;
  }

  /**
   * 获取服务器配置（从server_bots/{port}/读取）
   * @param {string} name - 配置名称
   */
  getServerConfig(name) {
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
        logger?.error(`[服务器配置解析失败][${file}]`, error);
        }
    } else if (fs.existsSync(defaultFile)) {
      try {
        config = YAML.parse(fs.readFileSync(defaultFile, 'utf8'));
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(file, YAML.stringify(config), 'utf8');
        this.watch(file, name, key);
          } catch (error) {
        logger?.error(`[默认配置复制失败][${name}]`, error);
          }
    }
    
    return this.config[key] = config;
  }

  /**
   * 通用配置获取方法（自动判断全局或服务器配置）
   * @param {string} name - 配置名称
   */
  getConfig(name) {
    return this.GLOBAL_CONFIGS.includes(name) 
      ? this.getGlobalConfig(name) 
      : this.getServerConfig(name);
  }

  // ========================================
  // 全局配置 getters
  // ========================================
  
  get agt() {
    return this.getGlobalConfig('agt');
  }

  get device() {
    return this.getGlobalConfig('device');
  }

  get monitor() {
    return this.getGlobalConfig('monitor');
  }

  get notice() {
    return this.getGlobalConfig('notice');
    }

  get mongodb() {
    return this.getGlobalConfig('mongodb');
  }

  get redis() {
    return this.getGlobalConfig('redis');
    }

  get db() {
    return this.getGlobalConfig('db');
  }

  get aistream() {
    return this.getGlobalConfig('aistream');
  }

  // ========================================
  // 服务器配置 getters
  // ========================================

  get server() {
    return this.getServerConfig('server');
  }

  get chatbot() {
    return this.getServerConfig('chatbot');
  }

  get group() {
    return this.getServerConfig('group');
  }

  // ========================================
  // 工厂配置 getters
  // ========================================
  
  get gptgod_llm() {
    return this.getServerConfig('gptgod_llm');
  }

  get gptgod_vision() {
    return this.getServerConfig('gptgod_vision');
  }
  
  get volcengine_llm() {
    return this.getServerConfig('volcengine_llm');
  }

  get volcengine_vision() {
    return this.getServerConfig('volcengine_vision');
  }

  get xiaomimimo_llm() {
    return this.getServerConfig('xiaomimimo_llm');
  }
  
  get volcengine_asr() {
    return this.getServerConfig('volcengine_asr');
  }
  
  get volcengine_tts() {
    return this.getServerConfig('volcengine_tts');
  }

  // ========================================
  // 便捷访问方法
  // ========================================

  /**
   * 获取主人QQ号列表
   */
  get masterQQ() {
    const masterQQ = this.chatbot?.master?.qq || [];
    const list = Array.isArray(masterQQ) ? masterQQ : [masterQQ];
    return list.map(qq => {
      if (typeof qq === 'number') return qq;
      if (typeof qq === 'string' && /^\d+$/.test(qq)) return Number(qq);
      return qq;
    });
  }

  /**
   * 获取主人映射对象
   * 返回 {bot_uin: [masterQQ数组]} 结构
   */
  get master() {
    const masters = {};
    if (typeof Bot !== 'undefined' && Bot.uin) {
      const masterList = this.masterQQ.map(qq => String(qq));
      Bot.uin.forEach(botUin => {
        masters[botUin] = masterList;
      });
    }
    return masters;
  }

  /**
   * 获取群组配置
   * @param {string|number} groupId - 群组ID
   */
  getGroup(groupId = '') {
    const config = this.group || {};
    const defaultCfg = config.default || {};
    const groupCfg = groupId ? config[String(groupId)] : null;
    return groupCfg ? { ...defaultCfg, ...groupCfg } : defaultCfg;
  }

  /**
   * 获取渲染器配置（服务器配置，存储在server_bots/{port}/renderers/{type}/config.yaml）
   * @param {string} type - 渲染器类型 (puppeteer, playwright)
   */
  getRendererConfig(type) {
    const defaultFile = path.join(this.PATHS.RENDERERS, type, 'config_default.yaml');
    
    if (!this._port) {
      try {
        return fs.existsSync(defaultFile) ? YAML.parse(fs.readFileSync(defaultFile, 'utf8')) : {};
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
      } catch (error) {
        logger?.error(`[渲染器默认配置解析失败][${type}]`, error);
      }
    }
    
    if (fs.existsSync(serverFile)) {
      try {
        config = { ...config, ...YAML.parse(fs.readFileSync(serverFile, 'utf8')) };
        this.watch(serverFile, `renderer.${type}`, key);
      } catch (error) {
        logger?.error(`[渲染器服务器配置解析失败][${type}]`, error);
      }
    } else if (Object.keys(config).length > 0) {
      try {
        fs.mkdirSync(serverDir, { recursive: true });
        fs.writeFileSync(serverFile, YAML.stringify(config), 'utf8');
        this.watch(serverFile, `renderer.${type}`, key);
        } catch (error) {
        logger?.error(`[渲染器配置创建失败][${type}]`, error);
      }
    }
    
    return this.config[key] = config;
  }

  /**
   * 获取所有渲染器配置（兼容旧代码）
   */
  get renderer() {
    if (this._renderer) return this._renderer;
    return this._renderer = {
      puppeteer: this.getRendererConfig('puppeteer'),
      playwright: this.getRendererConfig('playwright')
    };
  }

  /**
   * 获取当前端口号（只读）
   */
  get port() {
    return this._port;
  }

  /**
   * 获取package.json信息
   */
  get package() {
    if (this._package) return this._package;
    return this._package = JSON.parse(fs.readFileSync(path.join(paths.root, 'package.json'), 'utf8'));
  }

  // ========================================
  // 配置保存方法
  // ========================================

  /**
   * 设置并保存配置
   * @param {string} name - 配置名称
   * @param {object} data - 要保存的数据
   */
  setConfig(name, data) {
    const isGlobal = this.GLOBAL_CONFIGS.includes(name);
    const configDir = isGlobal ? this.getGlobalConfigDir() : this.getConfigDir();
    
    if (!configDir) {
      logger?.error('[配置保存失败] 无效的端口号');
      return false;
    }

    const file = path.join(configDir, `${name}.yaml`);
    const key = isGlobal ? `global.${name}` : `server.${this._port}.${name}`;
    const configType = isGlobal ? '全局' : '服务器';

    try {
      this.config[key] = data;
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(file, YAML.stringify(data), 'utf8');
      logger.mark(`[保存${configType}配置文件][${name}]`);
      return true;
    } catch (error) {
      logger.error(`[${configType}配置保存失败][${name}]`, error);
      return false;
    }
  }


  // ========================================
  // 配置文件监控
  // ========================================

  /**
   * 监控配置文件变化
   */
  watch(file, name, key) {
    if (this.watcher[key]) return;

    const watcher = chokidar.watch(file, {
      persistent: true,
      ignoreInitial: true
    });

    watcher.on('change', () => {
      delete this.config[key];
      logger.mark(`[修改配置文件][${name}]`);
      this[`change_${name}`]?.();
    });

    this.watcher[key] = watcher;
  }

  /**
   * AGT配置变更处理
   */
  async change_agt() {
    try {
      const log = await import('#infrastructure/log.js');
      log.default();
    } catch (error) {
      logger?.error('[AGT配置变更处理失败]', error);
    }
  }

  /**
   * 销毁所有文件监控器
   */
  destroy() {
    Object.values(this.watcher).forEach(watcher => watcher?.close());
    this.watcher = {};
    this.config = {};
  }
}

export default new Cfg();
