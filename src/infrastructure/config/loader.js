import cfg from "./config.js"
import chalk from "chalk";
import setLog from "#infrastructure/log.js";
import { initDatabases, closeDatabases } from "#infrastructure/database/index.js";
import SystemMonitor from "#modules/systemmonitor.js";

const CONFIG = {
  PROCESS_TITLE: "XRK-AGT",
  SIGNAL_TIME_THRESHOLD: 3000,
  TIMEZONE: "Asia/Shanghai",
  /** 单次 SIGINT 优雅关闭后退出码，供 start.js 自动重启 */
  EXIT_RESTART: 1,
  /** 连续 SIGINT 退出码，供 start.js 停止重启并返回菜单 */
  EXIT_STOP: 0,
};

const NETWORK_ERROR_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'];

/** @type {Promise<{success: boolean, mode: string}> | null} */
let packageloaderPromise = null;

class ProcessManager {
  constructor() {
    this.lastSignal = null;
    this.lastSignalTime = 0;
  }

  async updateTitle() {
    const currentQQ = global.selectedQQ || process.argv.find(arg => /^\d+$/.test(arg));
    process.title = currentQQ === "server" ? `${CONFIG.PROCESS_TITLE}@Server` : CONFIG.PROCESS_TITLE;
  }

  async restart() {
    logger.mark(chalk.yellow("重启中..."));
    await this.cleanup();
    if (Bot?.exit) {
      await Bot.exit().catch(() => {});
    }
    process.exit(1);
  }

  isNetworkError(error) {
    return error && NETWORK_ERROR_CODES.includes(error.code);
  }

  setupSignalHandlers() {
    if (global.__xrkSignalHandlersReady) return;
    global.__xrkSignalHandlersReady = true;

    const handleSignal = async (signal) => {
      const currentTime = Date.now();
      const isDoubleTap = signal === this.lastSignal &&
        currentTime - this.lastSignalTime < CONFIG.SIGNAL_TIME_THRESHOLD;

      if (isDoubleTap) {
        logger.mark(chalk.yellow(`检测到连续两次${signal}信号，返回菜单`));
        process.exit(CONFIG.EXIT_STOP);
        return;
      }

      this.lastSignal = signal;
      this.lastSignalTime = currentTime;
      logger.mark(chalk.yellow(`接收到${signal}信号，正在优雅关闭（再次发送将返回菜单）...`));

      try {
        if (global.Bot?.closeServer) {
          await global.Bot.closeServer();
        } else if (global.Bot?.exit) {
          await global.Bot.exit().catch(() => {});
        }
      } catch (err) {
        logger.error(`优雅关闭失败: ${err.message}`);
      }

      try {
        if (global.logger?.shutdown) {
          await global.logger.shutdown();
        }
      } catch {}

      await this.cleanup();
      process.exit(CONFIG.EXIT_RESTART);
    };

    ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(signal => {
      process.on(signal, () => {
        handleSignal(signal).catch((err) => {
          logger.error(`信号处理失败: ${err.message}`);
          process.exit(1);
        });
      });
    });
  }

  setupErrorHandlers() {
    if (global.__xrkErrorHandlersReady) return;
    global.__xrkErrorHandlersReady = true;

    process.on("uncaughtException", async (error) => {
      logger.error(`未捕获异常: ${error.message}`);
      if (this.isNetworkError(error)) {
        logger.error(chalk.red(`网络错误(${error.code})，准备重启`));
        await this.restart();
      }
    });

    process.on("unhandledRejection", async (error) => {
      logger.error(`未处理Promise: ${error.message}`);
      if (this.isNetworkError(error)) {
        logger.error(chalk.red(`网络Promise错误(${error.code})，准备重启`));
        await this.restart();
      }
    });

    process.on("exit", (code) => {
      logger.mark(chalk.magenta(`XRK-AGT 已停止，退出码: ${code}`));
    });
  }

  async cleanup() {
    try {
      SystemMonitor.getInstance()?.stop?.();
    } catch {}
    try {
      await closeDatabases();
    } catch {
      // 忽略关闭错误
    }
  }
}

class InitManager {
  constructor() {
    this.processManager = new ProcessManager();
    this.systemMonitor = SystemMonitor.getInstance();
  }

  setupEnvironment() {
    process.env.TZ = CONFIG.TIMEZONE;
    this.processManager.setupErrorHandlers();
    this.processManager.setupSignalHandlers();
  }

  async startMonitoring() {
    const monitorConfig = cfg.monitor;
    
    if (!monitorConfig?.enabled) {
      logger.debug('系统监控未启用');
      return;
    }

    // 延迟启动监控，确保日志播完后再开始第一次检查
    // 使用setTimeout确保在下一个事件循环中启动
    setTimeout(async () => {
      try {
        await this.systemMonitor.start(monitorConfig);
        logger.debug('系统监控已启动');
      } catch (error) {
        logger.error(`系统监控启动失败: ${error.message}`);
      }
    }, 100);

    this.systemMonitor.on('critical', async ({ type }) => {
      logger.error(`系统资源严重不足: ${type}`);
      if (monitorConfig.optimize?.autoRestart) {
        logger.error('将在5秒后重启...');
        setTimeout(() => this.processManager.restart(), 5000);
      }
    });
  }

  async init() {
    await setLog();
    cfg.warmupConfigs?.();
    logger.mark(chalk.cyan("XRK-AGT 初始化中..."));

    this.setupEnvironment();
    // 初始化数据库（MongoDB和Redis）
    await initDatabases();
    cfg.enableWatching?.();
    await this.processManager.updateTitle();
    await this.startMonitoring();
    
    logger.mark(chalk.green(`XRK-AGT 初始化完成`));

    return { success: true, mode: "server" };
  }
}

export default async function Packageloader() {
  if (packageloaderPromise) return packageloaderPromise;

  packageloaderPromise = (async () => {
    const initManager = new InitManager();
    return await initManager.init();
  })();

  try {
    return await packageloaderPromise;
  } catch (error) {
    packageloaderPromise = null;
    throw error;
  }
}