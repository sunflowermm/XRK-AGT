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

  static #getAppMode(json) {
    const raw = json?.mode ? String(json.mode).toLowerCase() : 'auto';
    if (raw === 'dev' || raw === 'prod' || raw === 'auto') return raw;
    return 'auto';
  }

  static #normalizeCommandSpec(spec, fallbackCwd) {
    if (!spec || typeof spec !== 'object') return null;
    const command = spec.command && String(spec.command).trim();
    if (!command) return null;
    const args = Array.isArray(spec.args) ? spec.args.map(a => String(a)) : [];
    const cwd = spec.cwd ? path.resolve(paths.root, String(spec.cwd)) : fallbackCwd;
    const env = (spec.env && typeof spec.env === 'object') ? spec.env : {};
    return { command, args, cwd, env };
  }

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

    for (const cfgApp of configs) {
      this.#registerApp(cfgApp);
      this.#startApp(cfgApp);
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

        const mode = this.#getAppMode(json);
        const isProd = mode === 'prod' || (mode === 'auto' && json && (json.prod || json.build));
        if (json && json.devOnly === true && isProd) {
          BotUtil.makeLog('info', `跳过 devOnly 前端工程（生产模式不启动）: ${file}`, 'Frontend');
          continue;
        }
        if (json && Array.isArray(json.modes) && json.modes.length > 0) {
          const modes = json.modes.map(m => String(m).toLowerCase());
          const required = isProd ? 'prod' : 'dev';
          if (!modes.includes(required)) {
            BotUtil.makeLog('info', `跳过 modes 不匹配的前端工程(${required}): ${file}`, 'Frontend');
            continue;
          }
        }

        const dir = path.dirname(file);
        const relFromCore = path
          .relative(paths.core, dir)
          .replace(/\\/g, '/');

        const coreName = relFromCore.split('/')[0] || '';
        const id = String(json.id || path.basename(dir));

        const port = Number(json.port);
        const defaultCommand = json.command && String(json.command).trim();

        // 生产环境可选：使用 prod 段覆盖 command/args/port（dev 仍用顶层）
        const prodSpec = this.#normalizeCommandSpec(json.prod, dir);
        const devSpec = this.#normalizeCommandSpec({ command: defaultCommand, args: json.args }, dir);
        const runSpec = isProd && prodSpec ? prodSpec : devSpec;

        // 可选：生产环境启动前 build
        const buildSpec = this.#normalizeCommandSpec(json.build, dir);
        const buildOnStart = json.buildOnStart !== false; // 默认 true（当提供 build 段时）

        if (!runSpec || !Number.isFinite(port) || port <= 0) {
          BotUtil.makeLog(
            'warn',
            `sign.json 缺少必要字段(${isProd ? 'command/port 或 prod.command/port' : 'command/port'}): ${file}`,
            'Frontend'
          );
          continue;
        }

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
          mode,
          cwd,
          command: runSpec.command,
          args: runSpec.args,
          port,
          publicPath,
          // 开发入口挂载路径（由 sign.json 决定）
          mountPath,
          env,
          autoRestart,
          // 生产环境可选：build + prod 启动声明（不影响开发态）
          build: buildSpec ? { ...buildSpec, env: { ...env, ...buildSpec.env } } : null,
          buildOnStart,
          prod: prodSpec ? { ...prodSpec, env: { ...env, ...prodSpec.env } } : null
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
  static #registerApp(config) {
    if (this.#apps.has(config.id)) return;
    this.#apps.set(config.id, {
      config,
      process: undefined,
      status: 'queued',
      restarts: 0,
      startedAt: Date.now()
    });
  }

  static #startApp(config) {
    const appInfo = this.#apps.get(config.id);
    if (!appInfo) return;

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

    const isProd = config.mode === 'prod' || (config.mode === 'auto' && (config.prod || config.build));
    const runCmd = (isProd && config.prod?.command) ? config.prod.command : config.command;
    const runArgs = (isProd && Array.isArray(config.prod?.args)) ? config.prod.args : (config.args || []);
    const runCwd = (isProd && config.prod?.cwd) ? config.prod.cwd : config.cwd;
    const runEnv = (isProd && config.prod?.env) ? { ...childEnv, ...config.prod.env } : childEnv;

    const buildCmd = isProd && config.build?.command ? config.build.command : null;
    const buildArgs = isProd && Array.isArray(config.build?.args) ? config.build.args : [];
    const buildCwd = isProd && config.build?.cwd ? config.build.cwd : config.cwd;
    const buildEnv = isProd && config.build?.env ? { ...childEnv, ...config.build.env } : childEnv;
    const shouldBuild = Boolean(buildCmd) && config.buildOnStart !== false;

    const baseInfo = `${config.id} (${runCmd} ${runArgs.join(' ')}) @ ${runCwd}`;
    const targetUrl = `http://127.0.0.1:${config.port}`;

    BotUtil.makeLog(
      'info',
      `启动前端项目: ${baseInfo} -> ${targetUrl}${config.publicPath}`,
      'Frontend'
    );

    const spawnChild = (cmd, args, cwd, env, label) => {
      const shellFlag = process.platform === 'win32' && !/[\\/]/.test(cmd);
      const child = spawn(cmd, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: shellFlag
      });
      child.__xrk_label = label;
      return child;
    };

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

    const wireChild = (child, kind) => {
      if (child.stdout) child.stdout.on('data', (data) => handleOutput(data, `${kind}:stdout`));
      if (child.stderr) child.stderr.on('data', (data) => handleOutput(data, `${kind}:stderr`));
      child.on('error', (err) => {
        appInfo.status = 'error';
        BotUtil.makeLog('error', `前端项目进程错误: ${config.id} - ${err.message}`, 'Frontend');
      });
    };

    const startRuntime = () => {
      appInfo.status = 'starting';
      const child = spawnChild(runCmd, runArgs, runCwd, runEnv, 'runtime');
      appInfo.process = child;
      wireChild(child, 'runtime');

      child.on('exit', (code, signal) => {
        appInfo.status = 'stopped';
        const reason = code !== null ? `退出码=${code}` : `信号=${signal || 'unknown'}`;
        BotUtil.makeLog(code === 0 ? 'info' : 'warn', `前端项目已退出: ${config.id} (${reason})`, 'Frontend');

        if (!config.autoRestart) return;
        if (appInfo.restarts >= 3) {
          BotUtil.makeLog('warn', `前端项目重启次数已达上限，停止重启: ${config.id}`, 'Frontend');
          return;
        }

        appInfo.restarts += 1;
        const delay = 1000 * appInfo.restarts;
        BotUtil.makeLog('info', `准备重启前端项目(${appInfo.restarts}): ${config.id}, ${delay}ms 后`, 'Frontend');
        setTimeout(() => startRuntime(), delay);
      });
    };

    if (shouldBuild) {
      appInfo.status = 'building';
      BotUtil.makeLog('info', `生产环境后台构建前端: ${config.id} (${buildCmd} ${buildArgs.join(' ')})`, 'Frontend');
      const buildChild = spawnChild(buildCmd, buildArgs, buildCwd, buildEnv, 'build');
      appInfo.buildProcess = buildChild;
      wireChild(buildChild, 'build');
      buildChild.on('exit', (code) => {
        appInfo.buildProcess = undefined;
        if (code !== 0) {
          appInfo.status = 'error';
          BotUtil.makeLog('error', `前端构建失败，跳过启动: ${config.id} (退出码=${code})`, 'Frontend');
          return;
        }
        BotUtil.makeLog('info', `前端构建完成，准备启动: ${config.id}`, 'Frontend');
        startRuntime();
      });
      return;
    }

    startRuntime();
  }
}

export default FrontendLauncher;

