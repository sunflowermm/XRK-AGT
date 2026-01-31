import cfg from "./config.js"
import chalk from "chalk";
import setLog from "#infrastructure/log.js";
import redisInit, { closeRedis } from "#infrastructure/redis.js";
import mongodbInit from "#infrastructure/mongodb.js";
import SystemMonitor from "#modules/systemmonitor.js";

const CONFIG = {
  PROCESS_TITLE: "XRK-AGT",
  SIGNAL_TIME_THRESHOLD: 3000,
  TIMEZONE: "Asia/Shanghai"
};

const NETWORK_ERROR_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'];

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
    const handleSignal = async (signal) => {
      const currentTime = Date.now();
      
      if (signal === this.lastSignal && currentTime - this.lastSignalTime < CONFIG.SIGNAL_TIME_THRESHOLD) {
        logger.mark(chalk.yellow(`检测到连续两次${signal}信号，程序退出`));
        await this.cleanup();
        process.exit(0);
      } else {
        this.lastSignal = signal;
        this.lastSignalTime = currentTime;
        logger.mark(chalk.yellow(`接收到${signal}信号，程序重启`));
        await this.restart();
      }
    };

    ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(signal => {
      process.removeAllListeners(signal);
      process.on(signal, () => handleSignal(signal));
    });
  }

  setupErrorHandlers() {
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

    process.on("exit", async (code) => {
      await this.cleanup();
      logger.mark(chalk.magenta(`XRK-AGT 已停止，退出码: ${code}`));
    });
  }

  async cleanup() {
    try {
      if (global.redis) {
        await closeRedis();
      }
    } catch (error) {
      // 忽略关闭错误
    }
    
    try {
      if (global.mongodb) {
        await global.mongodb.close();
      }
    } catch (error) {
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

    this.systemMonitor.on('critical', async ({ type, status }) => {
      logger.error(`系统资源严重不足: ${type}`);
      if (monitorConfig.optimize?.autoRestart) {
        logger.error('将在5秒后重启...');
        setTimeout(() => this.processManager.restart(), 5000);
      }
    });
  }

  async init() {
    await setLog();
    logger.mark(chalk.cyan("XRK-AGT 初始化中..."));

    this.setupEnvironment();
    // 同时启动 Redis 和 MongoDB
    await Promise.all([
      redisInit(),
      mongodbInit()
    ]);
    await this.processManager.updateTitle();
    await this.startMonitoring();
    
    logger.mark(chalk.green(`XRK-AGT 初始化完成`));

    return { success: true, mode: "server" };
  }
}

export default async function Packageloader() {
  const initManager = new InitManager();
  return await initManager.init();
}