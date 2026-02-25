import path from 'path';
import { spawn } from 'child_process';
import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';
import cfg from '#infrastructure/config/config.js';

/**
 * FrontendLauncher
 * 
 * 自动扫描 core/*-Core/www 下的 sign.json，
 * 启动前端开发服务，并为 HTTP 层提供配置数据。
 */
class FrontendLauncher {
  /** @type {Map<string, { config: any, process?: import('child_process').ChildProcess, status: string, restarts: number, startedAt?: number }>} */
  static #apps = new Map();

  static #initialized = false;
  static #initializing = null;

  /**
   * 初始化并启动所有前端项目（幂等）
   */
  static async init() {
    if (this.#initialized) return this.#apps;
    if (this.#initializing) return this.#initializing;

    this.#initializing = this.#doInit()
      .catch(err => {
        BotUtil.makeLog('error', `前端项目初始化失败: ${err.message}`, 'Frontend');
        return this.#apps;
      })
      .finally(() => {
        this.#initialized = true;
        this.#initializing = null;
      });

    return this.#initializing;
  }

  /**
   * 获取已发现的前端项目（不会重复扫描）
   */
  static async getApps() {
    await this.init();
    return this.#apps;
  }

  /**
   * 内部真正初始化逻辑
   * @private
   */
  static async #doInit() {
    const startTime = Date.now();

    const configs = await this.#discoverConfigs();
    if (configs.length === 0) {
      BotUtil.makeLog('info', '未发现启用的 sign.json 前端项目，跳过启动', 'Frontend');
      return this.#apps;
    }

    BotUtil.makeLog(
      'info',
      `发现前端项目 ${configs.length} 个，开始启动...`,
      'Frontend'
    );

    for (const cfg of configs) {
      this.#startApp(cfg);
    }

    const used = BotUtil.getTimeDiff(startTime);
    BotUtil.makeLog(
      'info',
      `前端项目启动完成: ${this.#apps.size} 个, 耗时 ${used}`,
      'Frontend'
    );

    return this.#apps;
  }

  /**
   * 扫描所有 core/*-Core/www 下的 sign.json
   * @private
   * @returns {Promise<Array<object>>}
   */
  static async #discoverConfigs() {
    const pattern = path.posix.join('core', '*-Core', 'www', '**', 'sign.json');
    const files = await BotUtil.glob(pattern, {
      absolute: true,
      ignore: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/out/**'
      ]
    });

    if (!files || files.length === 0) {
      return [];
    }

    const configs = [];

    for (const file of files) {
      try {
        const raw = await BotUtil.readFile(file, 'utf8');
        const json = JSON.parse(raw);

        if (json && json.enabled === false) {
          BotUtil.makeLog('debug', `跳过禁用的前端 sign.json: ${file}`, 'Frontend');
          continue;
        }

        const dir = path.dirname(file);
        const relFromCore = path
          .relative(paths.core, dir)
          .replace(/\\/g, '/');

        const coreName = relFromCore.split('/')[0] || '';
        const id = String(json.id || path.basename(dir));

        const port = Number(json.port);
        const command = json.command && String(json.command).trim();

        if (!command || !Number.isFinite(port) || port <= 0) {
          BotUtil.makeLog(
            'warn',
            `sign.json 缺少必要字段(command/port): ${file}`,
            'Frontend'
          );
          continue;
        }

        const args = Array.isArray(json.args)
          ? json.args.map(a => String(a))
          : [];

        const cwd = json.cwd
          ? path.resolve(paths.root, json.cwd)
          : dir;

        const publicPath = (json.publicPath && String(json.publicPath).trim()) ||
          (coreName
            ? `/core/${coreName}/${id}`
            : `/${id}`);

        const proxyCfg = json.proxy && typeof json.proxy === 'object' ? json.proxy : {};
        const mountPath = proxyCfg.mount && String(proxyCfg.mount).trim()
          ? String(proxyCfg.mount).trim()
          : `/${id}`;

        const env = (json.env && typeof json.env === 'object')
          ? json.env
          : {};

        const autoRestart = json.autoRestart !== false;

        const config = {
          id,
          name: json.name || id,
          description: json.description || '',
          coreName,
          signFile: file,
          cwd,
          command,
          args,
          port,
          publicPath,
          // 开发入口挂载路径（由 sign.json 决定）
          mountPath,
          env,
          autoRestart
        };

        configs.push(config);
      } catch (err) {
        BotUtil.makeLog(
          'warn',
          `解析 sign.json 失败: ${file} - ${err.message}`,
          'Frontend'
        );
      }
    }

    return configs;
  }

  /**
   * 启动单个前端项目
   * @private
   * @param {object} config
   */
  static #startApp(config) {
    if (this.#apps.has(config.id)) {
      return;
    }

    // 主服务信息，用于透传给前端（通过 Vite 的 import.meta.env 访问）
    const mainPort = cfg.port || 8086;
    const mainOrigin = cfg.server?.server?.url || `http://127.0.0.1:${mainPort}`;

    const childEnv = {
      ...process.env,
      ...config.env,
      PORT: String(config.port),
      // 提供给 React / Vite 的运行时环境变量（仅 VITE_* 会暴露到浏览器）
      VITE_XRK_MAIN_ORIGIN: mainOrigin,
      // 公开前端可感知的挂载路径（由 sign.json 的 proxy.mount 或 id 决定）
      VITE_XRK_PUBLIC_PATH: config.mountPath || config.publicPath || '/',
      VITE_XRK_CORE_NAME: config.coreName || '',
      VITE_XRK_APP_ID: config.id
    };

    const cmd = config.command;
    const args = config.args || [];

    const useShell = process.platform === 'win32' &&
      !/[\\/]/.test(cmd); // 让 npm/pnpm/yarn 在 Windows 下通过 shell 解析

    const child = spawn(cmd, args, {
      cwd: config.cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell
    });

    const appInfo = {
      config,
      process: child,
      status: 'starting',
      restarts: 0,
      startedAt: Date.now()
    };

    this.#apps.set(config.id, appInfo);

    const baseInfo = `${config.id} (${cmd} ${args.join(' ')}) @ ${config.cwd}`;
    const targetUrl = `http://127.0.0.1:${config.port}`;

    BotUtil.makeLog(
      'info',
      `启动前端项目: ${baseInfo} -> ${targetUrl}${config.publicPath}`,
      'Frontend'
    );

    const handleOutput = (data, stream) => {
      const text = data?.toString?.() || '';
      if (!text) return;

      // 避免刷屏，只取前 400 字符
      const trimmed = text.length > 400
        ? `${text.slice(0, 400)}...`
        : text;

      BotUtil.makeLog(
        'debug',
        `[${config.id}] ${stream}: ${trimmed}`,
        'Frontend'
      );
    };

    if (child.stdout) {
      child.stdout.on('data', (data) => handleOutput(data, 'stdout'));
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => handleOutput(data, 'stderr'));
    }

    child.on('error', (err) => {
      appInfo.status = 'error';
      BotUtil.makeLog(
        'error',
        `前端项目进程错误: ${config.id} - ${err.message}`,
        'Frontend'
      );
    });

    child.on('exit', (code, signal) => {
      appInfo.status = 'stopped';

      const reason = code !== null
        ? `退出码=${code}`
        : `信号=${signal || 'unknown'}`;

      BotUtil.makeLog(
        code === 0 ? 'info' : 'warn',
        `前端项目已退出: ${config.id} (${reason})`,
        'Frontend'
      );

      // 根据配置决定是否自动重启
      if (!config.autoRestart) {
        return;
      }

      // 简单的重启保护，避免疯狂重启
      if (appInfo.restarts >= 3) {
        BotUtil.makeLog(
          'warn',
          `前端项目重启次数已达上限，停止重启: ${config.id}`,
          'Frontend'
        );
        return;
      }

      appInfo.restarts += 1;
      const delay = 1000 * appInfo.restarts;

      BotUtil.makeLog(
        'info',
        `准备重启前端项目(${appInfo.restarts}): ${config.id}, ${delay}ms 后`,
        'Frontend'
      );

      setTimeout(() => {
        this.#apps.delete(config.id);
        this.#startApp(config);
      }, delay);
    });
  }
}

export default FrontendLauncher;

