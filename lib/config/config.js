import YAML from 'yaml';
import fs from 'fs';
import chokidar from 'chokidar';
import path from 'path';

/**
 * 配置管理类
 * 处理服务器配置的加载和更新
 */
class Cfg {
  constructor() {
    this.config = {};
    this._port = null;
    this.watcher = {};
    this._renderer = null;

    this.PATHS = {
      DEFAULT_CONFIG: path.join('config', 'default_config'),
      SERVER_BOTS: path.join('data', 'server_bots'),
      RENDERERS: 'renderers'
    };
    const portIndex = process.argv.indexOf('server');
    if (portIndex !== -1 && process.argv[portIndex + 1]) {
      this._port = parseInt(process.argv[portIndex + 1]);
    }

    if (this._port) {
      this.ensureServerConfigDir();
    }
  }

  /**
   * 确保服务器配置目录存在
   * 如不存在则从默认配置复制
   */
  ensureServerConfigDir() {
    if (!this._port) return;

    const serverConfigDir = this.getConfigDir();

    if (!fs.existsSync(serverConfigDir)) {
      fs.mkdirSync(serverConfigDir, { recursive: true });

      const defaultConfigDir = this.PATHS.DEFAULT_CONFIG;
      const files = fs.readdirSync(defaultConfigDir)

      for (let file of files) {
        fs.copyFileSync(
          path.join(defaultConfigDir, file),
          path.join(serverConfigDir, file)
        );
      }
    }
  }

  /**
   * 获取当前配置目录路径
   */
  getConfigDir() {
    return path.join(this.PATHS.SERVER_BOTS, String(this._port));
  }

  /**
   * 获取机器人配置
   */
  get bot() {
    let bot = this.getConfig('bot');
    let defbot = this.getdefSet('bot');
    bot = { ...defbot, ...bot };

    bot.platform = 2;
    bot.data_dir = path.join(process.cwd(), 'data', 'server_bots', String(this._port));
    bot.server = bot.server || {};
    bot.server.port = this._port;

    return bot;
  }

  /**
   * 其他配置快捷获取
   */
  get other() {
    return this.getConfig('other');
  }

  get redis() {
    return this.getConfig('redis');
  }

  get renderer() {
    if (this._renderer) return this._renderer;

    this._renderer = {};
    const rendererTypes = ['playwright', 'puppeteer'];

    rendererTypes.forEach(type => {
      const defaultFile = path.join(this.PATHS.RENDERERS, type, 'config_default.yaml');
      const serverDir = this._port ? path.join(this.getConfigDir(), 'renderers', type) : null;
      const serverFile = serverDir ? path.join(serverDir, 'config.yaml') : null;

      let config = {};

      if (fs.existsSync(defaultFile)) {
        try {
          config = YAML.parse(fs.readFileSync(defaultFile, 'utf8'));
        } catch (error) {
          logger?.error?.(`[渲染器默认配置解析失败][${type}][${defaultFile}]`, error);
          config = {};
        }
      } else {
        config = {};
      }

      if (serverDir) {
        if (!fs.existsSync(serverDir)) {
          fs.mkdirSync(serverDir, { recursive: true });
        }

        if (fs.existsSync(serverFile)) {
          try {
            const serverCfg = YAML.parse(fs.readFileSync(serverFile, 'utf8'));
            config = { ...config, ...serverCfg };
          } catch (error) {
            logger?.error?.(`[渲染器服务器配置解析失败][${type}][${serverFile}]`, error);
          }
        } else {
          try {
            fs.writeFileSync(serverFile, YAML.stringify(config), 'utf8');
          } catch (error) {
            logger?.error?.(`[渲染器默认配置复制失败][${type}]`, error);
          }
        }
      }

      this._renderer[type] = config;

      if (serverFile && fs.existsSync(serverFile)) {
        const key = `renderer.${type}`;
        if (!this.watcher[key]) {
          const watcher = chokidar.watch(serverFile, {
            persistent: true,
            ignoreInitial: true
          });

          watcher.on('change', () => {
            delete this._renderer[type];
            this._renderer = null; // 强制重新加载

            if (typeof logger !== 'undefined') {
              logger.mark(`[修改渲染器配置文件][${type}]`);
            }
          });

          this.watcher[key] = watcher;
        }
      }
    });

    return this._renderer;
  }

  get notice() {
    return this.getConfig('notice');
  }

  get server() {
    return this.getConfig('server');
  }

  get device() {
    return this.getConfig('device');
  }

  get db() {
    return this.getConfig('db');
  }
  get monitor() {
    return this.getConfig('monitor');
  }
  /**
   * 获取主人QQ号
   */
  get masterQQ() {
    let masterQQ = this.getConfig('other').masterQQ || [];
    if (!Array.isArray(masterQQ)) {
      masterQQ = [masterQQ];
    }
    return masterQQ.map(qq => {
      if (typeof qq === 'number') {
        return qq;
      } else if (typeof qq === 'string') {
        if (/^\d+$/.test(qq)) {
          return Number(qq);
        } else {
          return qq;
        }
      } else {
        return qq;
      }
    });
  }

  /**
   * 获取主人映射对象，用于向后兼容
   * 返回 {bot_uin: [masterQQ数组]} 结构
   */
  get master() {
    const masters = {};
    const masterList = this.masterQQ;

    if (typeof Bot !== 'undefined' && Bot.uin && Array.isArray(Bot.uin)) {
      for (const botUin of Bot.uin) {
        masters[botUin] = masterList.map(qq => String(qq));
      }
    } else {
      const currentBotUin = this.bot.account?.uin || 'current_bot';
      masters[currentBotUin] = masterList.map(qq => String(qq));
    }

    return masters;
  }

  /**
   * 获取package.json信息
   */
  get package() {
    if (this._package) return this._package;
    this._package = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    return this._package;
  }
  get aistream() {
    return this.getConfig('aistream');
  }
  /**
   * 获取默认配置
   * @param {string} name - 配置名称
   */
  getdefSet(name) {
    const key = `default.${name}`;

    if (this.config[key]) return this.config[key];

    const file = path.join(this.PATHS.DEFAULT_CONFIG, `${name}.yaml`);

    if (fs.existsSync(file)) {
      try {
        this.config[key] = YAML.parse(fs.readFileSync(file, 'utf8'));
      } catch (error) {
        logger?.error?.(`[默认配置解析失败][${file}]`, error);
        this.config[key] = {};
      }
    } else {
      this.config[key] = {};
    }

    return this.config[key];
  }

  /**
   * 获取服务器配置
   * @param {string} name - 配置名称
   */
  getConfig(name) {
    const key = `server.${this._port}.${name}`;

    if (this.config[key]) return this.config[key];

    const file = path.join(this.getConfigDir(), `${name}.yaml`);

    if (fs.existsSync(file)) {
      try {
        this.config[key] = YAML.parse(fs.readFileSync(file, 'utf8'));
      } catch (error) {
        logger?.error?.(`[配置文件解析失败][${file}]`, error);
        this.config[key] = {};
      }
    } else {
      const defaultFile = path.join(this.PATHS.DEFAULT_CONFIG, `${name}.yaml`);

      if (fs.existsSync(defaultFile)) {
        try {
          const defaultConfig = YAML.parse(fs.readFileSync(defaultFile, 'utf8'));
          this.config[key] = defaultConfig;

          const dir = path.dirname(file);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(file, YAML.stringify(defaultConfig), 'utf8');
        } catch (error) {
          logger?.error?.(`[默认配置复制失败][${name}]`, error);
          this.config[key] = {};
        }
      } else {
        this.config[key] = {};
      }
    }

    this.watch(file, name, key);

    return this.config[key];
  }

  /**
   * 获取群组配置
   * @param {string|number} groupId - 群组ID
   * @param {string} [userID] - 用户ID（可选）
   */
  getGroup(groupId = '', userID = '') {
    groupId = String(groupId);

    let config = this.getConfig('group');
    let defCfg = this.getdefSet('group');

    if (groupId && config[groupId]) {
      return { ...defCfg.default, ...config.default, ...config[groupId] };
    }

    return { ...defCfg.default, ...config.default };
  }

  /**
   * 获取其他配置
   */
  getOther() {
    let def = this.getdefSet('other');
    let config = this.getConfig('other');
    return { ...def, ...config };
  }
  /**
   * 设置并保存配置
   * @param {string} name - 配置名称
   * @param {object} data - 要保存的数据
   */
  setConfig(name, data) {
    const key = `server.${this._port}.${name}`;
    const file = path.join(this.getConfigDir(), `${name}.yaml`);

    try {
      // 更新内存中的配置
      this.config[key] = data;

      // 确保目录存在
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入文件
      fs.writeFileSync(file, YAML.stringify(data), 'utf8');

      if (typeof logger !== 'undefined') {
        logger.mark(`[保存配置文件][${name}]`);
      }

      return true;
    } catch (error) {
      if (typeof logger !== 'undefined') {
        logger.error(`[配置保存失败][${name}]`, error);
      }
      return false;
    }
  }

  /**
   * 更新other配置
   * @param {object} data - 要更新的数据
   */
  setOther(data) {
    return this.setConfig('other', data);
  }

  /**
   * 更新group配置
   * @param {object} data - 要更新的数据
   */
  setGroup(data) {
    return this.setConfig('group', data);
  }
  /**
   * 获取通知配置
   */
  getNotice() {
    let def = this.getdefSet('notice');
    let config = this.getConfig('notice');
    return { ...def, ...config };
  }

  /**
   * 监控配置文件变化
   * @param {string} file - 文件路径
   * @param {string} name - 配置名称
   * @param {string} key - 缓存键
   */
  watch(file, name, key) {
    if (this.watcher[key]) return;

    const watcher = chokidar.watch(file, {
      persistent: true,
      ignoreInitial: true
    });

    watcher.on('change', () => {
      delete this.config[key];

      if (typeof logger !== 'undefined') {
        logger.mark(`[修改配置文件][${name}]`);
      }

      if (this[`change_${name}`]) {
        this[`change_${name}`]();
      }
    });

    this.watcher[key] = watcher;
  }

  /**
   * Bot配置变更处理
   */
  async change_bot() {
    try {
      let log = await import('./log.js');
      log.default();
    } catch (error) {
      logger?.error?.('[Bot配置变更处理失败]', error);
    }
  }

  /**
   * 销毁所有文件监控器
   */
  destroy() {
    for (const key in this.watcher) {
      if (this.watcher[key]) {
        this.watcher[key].close();
      }
    }
    this.watcher = {};
    this.config = {};
  }
}

export default new Cfg();