import cfg from './config.js';
import chalk from 'chalk';
import setLog from '#infrastructure/log.js';
import { initDatabases, closeDatabases } from '#infrastructure/database/index.js';
import SystemMonitor from '#modules/systemmonitor.js';
import { normalizeError } from '#utils/normalize-error.js';
import {
  runShutdownHooks,
  handleDoubleTapSignal,
  SignalTapState,
  SERVER_SIGNALS,
  EXIT_RESTART,
  EXIT_STOP
} from '#utils/process-signals.js';
import { getRuntimeGlobal, isShuttingDown, setShuttingDown, isProcessFlagSet, setProcessFlag } from '#utils/runtime-globals.js';

const CONFIG = {
  PROCESS_TITLE: 'XRK-AGT',
  TIMEZONE: 'Asia/Shanghai'
};

const NETWORK_ERROR_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'];
const EXPECTED_REJECTION_CODES = ['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME'];

let packageloaderPromise = null;

class ProcessManager {
  tap = new SignalTapState();
  _restarting = false;

  async updateTitle() {
    const currentQQ = global.selectedQQ ?? process.argv.find((arg) => /^\d+$/.test(arg));
    process.title = currentQQ === 'server' ? `${CONFIG.PROCESS_TITLE}@Server` : CONFIG.PROCESS_TITLE;
  }

  async restart() {
    if (isShuttingDown() || this._restarting) return;
    this._restarting = true;
    logger.mark(chalk.yellow('重启中...'));
    await this.cleanup();
    if (getRuntimeGlobal('Bot')) {
      await getRuntimeGlobal('Bot').closeServer({ fast: true }).catch(() => {});
    }
    process.exit(EXIT_RESTART);
  }

  isNetworkError(error) {
    return NETWORK_ERROR_CODES.includes(error.code);
  }

  async gracefulShutdown(exitCode) {
    if (isShuttingDown()) return;
    setShuttingDown(true);
    logger.mark(chalk.yellow('正在关闭...'));
    const bot = getRuntimeGlobal('Bot');
    if (bot) {
      await bot.closeServer().catch((err) => logger.error(`关闭失败: ${err.message}`));
    } else {
      await getRuntimeGlobal('logger')?.shutdown?.().catch(() => {});
    }
    await this.cleanup();
    process.exit(exitCode);
  }

  setupSignalHandlers() {
    if (isProcessFlagSet('__xrkSignalHandlersReady')) return;
    setProcessFlag('__xrkSignalHandlersReady', true);

    const handleSignal = async (signal) => {
      if (this._restarting || isShuttingDown()) return;

      await handleDoubleTapSignal(signal, this.tap, {
        onHangup: async () => {
          logger.mark(chalk.yellow('终端断开，正在关闭…'));
          await this.gracefulShutdown(EXIT_STOP);
        },
        onTwice: async (sig) => {
          logger.mark(chalk.yellow(`检测到连续两次 ${sig}，返回菜单`));
          await this.gracefulShutdown(EXIT_STOP);
        },
        onOnce: async (sig) => {
          logger.mark(chalk.yellow(`接收到 ${sig}，正在重启`));
          try {
            await this.restart();
          } catch (err) {
            logger.error(`restart 异常: ${err?.message || err}`);
            process.exit(EXIT_RESTART);
          }
        }
      });
    };

    for (const signal of SERVER_SIGNALS) {
      process.removeAllListeners(signal);
      process.on(signal, () => {
        void handleSignal(signal);
      });
    }
  }

  setupErrorHandlers() {
    if (isProcessFlagSet('__xrkErrorHandlersReady')) return;
    setProcessFlag('__xrkErrorHandlersReady', true);

    const onNetworkFatal = async (reason, label) => {
      if (isShuttingDown()) return;
      const error = normalizeError(reason);
      if (EXPECTED_REJECTION_CODES.includes(error.code)) {
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
    await runShutdownHooks();
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
