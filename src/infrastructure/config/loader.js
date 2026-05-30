import cfg from './config.js';
import chalk from 'chalk';
import setLog from '#infrastructure/log.js';
import { initDatabases, closeDatabases } from '#infrastructure/database/index.js';
import SystemMonitor from '#modules/systemmonitor.js';
import { normalizeError } from '#utils/normalize-error.js';

const CONFIG = {
  PROCESS_TITLE: 'XRK-AGT',
  SIGNAL_TIME_THRESHOLD: 3000,
  TIMEZONE: 'Asia/Shanghai',
  EXIT_RESTART: 1,
  EXIT_STOP: 0
};

const NETWORK_ERROR_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'];
/** DNS/解析类失败：记录为 warn，不触发重启 */
const EXPECTED_REJECTION_CODES = ['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME'];

let packageloaderPromise = null;

class ProcessManager {
  lastSignal = null;
  lastSignalTime = 0;

  async updateTitle() {
    const currentQQ = global.selectedQQ ?? process.argv.find((arg) => /^\d+$/.test(arg));
    process.title = currentQQ === 'server' ? `${CONFIG.PROCESS_TITLE}@Server` : CONFIG.PROCESS_TITLE;
  }

  async restart() {
    logger.mark(chalk.yellow('重启中...'));
    await this.cleanup();
    if (global.Bot) await global.Bot.closeServer().catch(() => {});
    process.exit(CONFIG.EXIT_RESTART);
  }

  isNetworkError(error) {
    return NETWORK_ERROR_CODES.includes(error.code);
  }

  async gracefulShutdown(exitCode) {
    if (global.Bot) {
      await global.Bot.closeServer().catch((err) => logger.error(`关闭失败: ${err.message}`));
    } else {
      await global.logger.shutdown().catch(() => {});
    }
    await this.cleanup();
    process.exit(exitCode);
  }

  async handleSignal(signal) {
    const now = Date.now();
    const isDoubleTap = signal === this.lastSignal &&
      now - this.lastSignalTime < CONFIG.SIGNAL_TIME_THRESHOLD;

    if (isDoubleTap) {
      logger.mark(chalk.yellow(`检测到连续两次${signal}信号，返回菜单`));
      await this.gracefulShutdown(CONFIG.EXIT_STOP);
      return;
    }

    this.lastSignal = signal;
    this.lastSignalTime = now;
    logger.mark(chalk.yellow(`接收到${signal}信号，正在关闭（再次发送将返回菜单）...`));
    await this.gracefulShutdown(CONFIG.EXIT_RESTART);
  }

  setupSignalHandlers() {
    if (global.__xrkSignalHandlersReady) return;
    global.__xrkSignalHandlersReady = true;

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.on(signal, () => {
        this.handleSignal(signal).catch((err) => {
          logger.error(`信号处理失败: ${err.message}`);
          process.exit(CONFIG.EXIT_RESTART);
        });
      });
    }
  }

  setupErrorHandlers() {
    if (global.__xrkErrorHandlersReady) return;
    global.__xrkErrorHandlersReady = true;

    const onNetworkFatal = async (reason, label) => {
      const error = normalizeError(reason);
      const isExpected = EXPECTED_REJECTION_CODES.includes(error.code);
      if (isExpected) {
        logger.warn(`${label}: ${error.message} (${error.code})`);
        return;
      }
      logger.error(`${label}: ${error.message}`);
      if (!this.isNetworkError(error)) return;
      logger.error(chalk.red(`网络错误(${error.code})，准备重启`));
      await this.restart();
    };

    process.on('uncaughtException', (error) => onNetworkFatal(error, '未捕获异常'));
    process.on('unhandledRejection', (reason) => onNetworkFatal(reason, '未处理Promise'));
    process.on('exit', (code) => {
      logger.mark(chalk.magenta(`XRK-AGT 已停止，退出码: ${code}`));
    });
  }

  async cleanup() {
    SystemMonitor.getInstance().stop();
    await closeDatabases().catch(() => {});
  }
}

class InitManager {
  processManager = new ProcessManager();
  systemMonitor = SystemMonitor.getInstance();

  setupEnvironment() {
    process.env.TZ = CONFIG.TIMEZONE;
    this.processManager.setupErrorHandlers();
    this.processManager.setupSignalHandlers();
  }

  async startMonitoring() {
    const monitorConfig = cfg.monitor;
    if (!monitorConfig.enabled) return;

    setTimeout(() => {
      this.systemMonitor.start(monitorConfig).catch((error) => {
        logger.error(`系统监控启动失败: ${error.message}`);
      });
    }, 100);

    this.systemMonitor.on('critical', ({ type }) => {
      logger.error(`系统资源严重不足: ${type}`);
      if (monitorConfig.optimize.autoRestart) {
        logger.error('将在5秒后重启...');
        setTimeout(() => this.processManager.restart(), 5000);
      }
    });
  }

  async init() {
    await setLog();
    cfg.warmupConfigs();
    logger.mark(chalk.cyan('XRK-AGT 初始化中...'));

    this.setupEnvironment();
    await initDatabases();
    cfg.enableWatching();
    await this.processManager.updateTitle();
    await this.startMonitoring();

    logger.mark(chalk.green('XRK-AGT 初始化完成'));
    return { success: true, mode: 'server' };
  }
}

export default async function Packageloader() {
  if (!packageloaderPromise) {
    packageloaderPromise = new InitManager().init().catch((error) => {
      packageloaderPromise = null;
      throw error;
    });
  }
  return packageloaderPromise;
}
