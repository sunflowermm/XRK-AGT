import cfg from './config.js';
import chalk from 'chalk';
import setLog from '#infrastructure/log.js';
import { initDatabases, closeDatabases } from '#infrastructure/database/index.js';
import SystemMonitor from '#modules/systemmonitor.js';
import { normalizeError } from '#utils/normalize-error.js';
import { installProcessSignals, runShutdownHooks } from '#utils/process-signals.js';
import { getRuntimeGlobal, isShuttingDown, setShuttingDown, isProcessFlagSet, setProcessFlag } from '#utils/runtime-globals.js';

const CONFIG = {
  PROCESS_TITLE: 'XRK-AGT',
  TIMEZONE: 'Asia/Shanghai',
  EXIT_RESTART: 1,
  EXIT_STOP: 0
};

const NETWORK_ERROR_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'];
const EXPECTED_REJECTION_CODES = ['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME'];

let packageloaderPromise = null;

class ProcessManager {
  /** @type {import('#utils/process-signals.js').ProcessSignalController | null} */
  _signalController = null;
  _signalEpoch = 0;

  async updateTitle() {
    const currentQQ = global.selectedQQ ?? process.argv.find((arg) => /^\d+$/.test(arg));
    process.title = currentQQ === 'server' ? `${CONFIG.PROCESS_TITLE}@Server` : CONFIG.PROCESS_TITLE;
  }

  async restart() {
    if (isShuttingDown()) return;
    const epoch = ++this._signalEpoch;
    logger.mark(chalk.yellow('重启中...'));
    await this.cleanup();
    if (epoch !== this._signalEpoch) return;
    if (getRuntimeGlobal('Bot')) await getRuntimeGlobal('Bot').closeServer({ fast: true }).catch(() => {});
    if (epoch !== this._signalEpoch) return;
    process.exit(CONFIG.EXIT_RESTART);
  }

  isNetworkError(error) {
    return NETWORK_ERROR_CODES.includes(error.code);
  }

  async gracefulShutdown(exitCode) {
    this._signalEpoch += 1;
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

    this._signalController = installProcessSignals({
      mode: 'server',
      logger: {
        mark: (msg) => logger.mark(chalk.yellow(msg)),
        warning: (msg) => logger.mark(chalk.yellow(msg))
      },
      onRestart: () => this.restart(),
      onStop: () => this.gracefulShutdown(CONFIG.EXIT_STOP)
    });
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
