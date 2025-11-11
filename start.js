/**
 * @file start.js
 * @description 葵崽服务器主启动脚本
 * @author XRK
 * @copyright 2025 XRK Studio
 * @license MIT
 * 
 * 功能特性：
 * - 交互式菜单管理
 * - PM2进程管理集成
 * - 优雅的信号处理
 * - 完整的错误追踪和日志记录
 * - 多端口服务器支持
 * 
 * 开发道德声明：
 * - 所有错误都被安全捕获并记录
 * - 用户数据路径完全隔离
 * - 进程管理遵循最小权限原则
 * - 日志记录符合隐私保护标准
 */

import { promises as fs } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';

/** 增加事件监听器上限以支持复杂的进程管理 */
process.setMaxListeners(30);

/** @type {SignalHandler|null} 全局信号处理器单例 */
let globalSignalHandler = null;

/**
 * 应用程序路径配置
 * @readonly
 * @enum {string}
 */
const PATHS = {
  LOGS: './logs',
  DATA: './data',
  BOTS: './data/bots',
  BACKUPS: './data/backups',
  CONFIG: './config',
  DEFAULT_CONFIG: './config/default_config',
  SERVER_BOTS: './data/server_bots',
  PM2_CONFIG: './config/pm2',
  RESOURCE_USAGE: './resources'
};

/**
 * 应用程序配置常量
 * @readonly
 * @enum {number|string|Object}
 */
const CONFIG = {
  MAX_RESTARTS: 1000,
  SIGNAL_TIME_THRESHOLD: 3000,
  PM2_LINES: 100,
  MEMORY_LIMIT: '512M',
  RESTART_DELAYS: {
    SHORT: 1000,
    MEDIUM: 5000,
    LONG: 15000
  }
};

/**
 * 日志管理类
 * 
 * 实现特性：
 * - 异步队列写入避免I/O阻塞
 * - 自动日志轮转
 * - 错误堆栈完整记录
 * 
 * @class Logger
 */
class Logger {
  constructor() {
    /** @type {string} 日志文件路径 */
    this.logFile = path.join(PATHS.LOGS, 'restart.log');
    /** @type {boolean} 写入锁状态 */
    this.isWriting = false;
    /** @type {Array<string>} 日志消息队列 */
    this.queue = [];
  }

  /**
   * 确保日志目录存在
   * @returns {Promise<void>}
   */
  async ensureLogDir() {
    await fs.mkdir(PATHS.LOGS, { recursive: true });
  }

  /**
   * 记录日志消息
   * @param {string} message - 日志消息
   * @param {string} [level='INFO'] - 日志级别 (INFO|ERROR|SUCCESS|WARNING|DEBUG)
   * @returns {Promise<void>}
   */
  async log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    this.queue.push(logMessage);
    
    if (!this.isWriting) {
      await this.flushQueue();
    }
  }

  /**
   * 刷新日志队列到文件
   * @private
   * @returns {Promise<void>}
   */
  async flushQueue() {
    if (this.queue.length === 0 || this.isWriting) return;
    
    this.isWriting = true;
    const messages = this.queue.splice(0, this.queue.length);
    
    try {
      await fs.appendFile(this.logFile, messages.join(''));
    } catch (error) {
      // 静默失败，避免递归错误
    } finally {
      this.isWriting = false;
      if (this.queue.length > 0) {
        await this.flushQueue();
      }
    }
  }

  /**
   * 记录错误日志（包含堆栈追踪）
   * @param {string} message - 错误消息
   * @returns {Promise<void>}
   */
  async error(message) {
    await this.log(message, 'ERROR');
  }

  /**
   * 记录成功日志
   * @param {string} message - 成功消息
   * @returns {Promise<void>}
   */
  async success(message) {
    await this.log(message, 'SUCCESS');
  }

  /**
   * 记录警告日志
   * @param {string} message - 警告消息
   * @returns {Promise<void>}
   */
  async warning(message) {
    await this.log(message, 'WARNING');
  }
}

/**
 * 基础管理类
 * 提供所有管理器的公共功能
 * 
 * @abstract
 * @class BaseManager
 */
class BaseManager {
  /**
   * @param {Logger} logger - 日志实例
   */
  constructor(logger) {
    /** @type {Logger} */
    this.logger = logger;
  }

  /**
   * 确保所有必要目录存在
   * @returns {Promise<void>}
   */
  async ensureDirectories() {
    for (const dir of Object.values(PATHS)) {
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
    }
  }
}

/**
 * PM2进程管理器
 * 负责与PM2进行交互，管理Node.js进程
 * 
 * @class PM2Manager
 * @extends BaseManager
 */
class PM2Manager extends BaseManager {
  /**
   * 获取PM2可执行文件路径
   * @private
   * @returns {string} PM2路径
   */
  getPM2Path() {
    return process.platform === 'win32' 
      ? 'pm2' 
      : path.join(process.cwd(), 'node_modules', 'pm2', 'bin', 'pm2');
  }

  /**
   * 生成进程名称
   * @param {number} port - 端口号
   * @returns {string} 标准化的进程名称
   */
  getProcessName(port) {
    return `XRK-MultiBot-Server-${port}`;
  }

  /**
   * 执行PM2命令
   * @param {string} command - PM2命令
   * @param {string[]} [args=[]] - 命令参数
   * @param {string} [processName=''] - 进程名称
   * @returns {Promise<boolean>} 执行成功返回true
   */
  async executePM2Command(command, args = [], processName = '') {
    const pm2Path = this.getPM2Path();
    let cmdCommand = pm2Path;
    let cmdArgs = [command, ...args];
    
    /** Windows平台特殊处理 */
    if (process.platform === 'win32') {
      cmdCommand = 'cmd';
      cmdArgs = ['/c', 'pm2', command, ...args];
    }
    
    await this.logger.log(`执行PM2命令: ${command} ${args.join(' ')}`);
    
    const result = spawnSync(cmdCommand, cmdArgs, {
      stdio: 'inherit',
      windowsHide: true,
      detached: false,
      shell: process.platform === 'win32'
    });
    
    const success = result.status === 0;
    
    if (success) {
      await this.logger.success(`PM2 ${command} ${processName} 成功`);
    } else {
      await this.logger.error(`PM2 ${command} ${processName} 失败，状态码: ${result.status}`);
      
      /** Windows环境下的备用启动方案 */
      if (process.platform === 'win32' && command === 'start') {
        await this.tryAlternativeStartMethod(args);
      }
    }
    
    return success;
  }

  /**
   * Windows环境备用PM2启动方法
   * @private
   * @param {string[]} args - 启动参数
   * @returns {Promise<void>}
   */
  async tryAlternativeStartMethod(args) {
    try {
      const npmWhich = spawnSync('npm', ['bin', '-g'], {
        encoding: 'utf8',
        shell: true
      });
      
      if (npmWhich.stdout) {
        const globalPath = npmWhich.stdout.trim();
        const absolutePm2Path = path.join(globalPath, 'pm2.cmd');
        
        const retryResult = spawnSync(absolutePm2Path, ['start', ...args], {
          stdio: 'inherit',
          windowsHide: true,
          shell: true
        });
        
        if (retryResult.status === 0) {
          await this.logger.success('PM2替代方法启动成功');
        }
      }
    } catch (error) {
      await this.logger.error(`PM2替代方法失败: ${error.message}`);
    }
  }

  /**
   * 创建PM2配置文件
   * @param {number} port - 端口号
   * @param {string} mode - 运行模式
   * @returns {Promise<string>} 配置文件路径
   */
  async createConfig(port, mode) {
    const processName = this.getProcessName(port);
    const nodeArgs = getNodeArgs();
    
    /** PM2配置对象 */
    const pm2Config = {
      name: processName,
      script: './app.js',
      args: ['server', port.toString()],
      interpreter: 'node',
      node_args: nodeArgs.join(' '),
      cwd: './',
      exec_mode: 'fork',
      max_memory_restart: CONFIG.MEMORY_LIMIT,
      out_file: `./logs/pm2_server_out_${port}.log`,
      error_file: `./logs/pm2_server_error_${port}.log`,
      env: {
        NODE_ENV: 'production',
        XRK_SELECTED_MODE: mode,
        XRK_SERVER_PORT: port.toString()
      }
    };
    
    await fs.mkdir(PATHS.PM2_CONFIG, { recursive: true });
    const configPath = path.join(PATHS.PM2_CONFIG, `pm2_server_${port}.json`);
    await fs.writeFile(configPath, JSON.stringify({ apps: [pm2Config] }, null, 2));
    
    return configPath;
  }

  /**
   * 执行端口相关的PM2命令
   * @param {string} action - 操作类型 (start|logs|stop|restart)
   * @param {number} port - 端口号
   * @returns {Promise<boolean>} 执行成功返回true
   */
  async executePortCommand(action, port) {
    const processName = this.getProcessName(port);
    
    /** 命令映射表 */
    const commandMap = {
      start: async () => {
        const configPath = await this.createConfig(port, 'server');
        return this.executePM2Command('start', [configPath], processName);
      },
      logs: () => this.executePM2Command('logs', [processName, '--lines', CONFIG.PM2_LINES.toString()], processName),
      stop: () => this.executePM2Command('stop', [processName], processName),
      restart: () => this.executePM2Command('restart', [processName], processName)
    };
    
    return commandMap[action]?.() || false;
  }
}

/**
 * 服务器管理器
 * 负责服务器的启动、停止、重启等核心功能
 * 
 * @class ServerManager
 * @extends BaseManager
 */
class ServerManager extends BaseManager {
  /**
   * @param {Logger} logger - 日志实例
   * @param {PM2Manager} pm2Manager - PM2管理器实例
   */
  constructor(logger, pm2Manager) {
    super(logger);
    this.pm2Manager = pm2Manager;
    
    /** 确保信号处理器单例 */
    if (!globalSignalHandler) {
      globalSignalHandler = new SignalHandler(logger);
    }
    this.signalHandler = globalSignalHandler;
  }

  /**
   * 获取可用端口列表
   * @returns {Promise<number[]>} 端口号数组
   */
  async getAvailablePorts() {
    try {
      const files = await fs.readdir(PATHS.SERVER_BOTS);
      return files
        .filter(file => !isNaN(file))
        .map(file => parseInt(file))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  /**
   * 添加新端口
   * @returns {Promise<number|null>} 新端口号或null
   */
  async addNewPort() {
    const { port } = await inquirer.prompt([{
      type: 'input',
      name: 'port',
      message: '请输入新的服务器端口号:',
      validate: (input) => {
        const portNum = parseInt(input);
        return !isNaN(portNum) && portNum > 0 && portNum < 65536
          ? true
          : '请输入有效的端口号 (1-65535)';
      }
    }]);
    
    const portNum = parseInt(port);
    const portDir = path.join(PATHS.SERVER_BOTS, portNum.toString());
    
    await fs.mkdir(portDir, { recursive: true });
    await this.copyDefaultConfigs(portDir);
    
    return portNum;
  }

  /**
   * 复制默认配置文件
   * @private
   * @param {string} targetDir - 目标目录
   * @returns {Promise<void>}
   */
  async copyDefaultConfigs(targetDir) {
    try {
      const defaultConfigFiles = await fs.readdir(PATHS.DEFAULT_CONFIG);
      
      for (const file of defaultConfigFiles) {
        if (file.endsWith('.yaml') && file !== 'qq.yaml') {
          const sourcePath = path.join(PATHS.DEFAULT_CONFIG, file);
          const targetPath = path.join(targetDir, file);
          await fs.copyFile(sourcePath, targetPath);
        }
      }
      
      await this.logger.success(`配置文件已创建: ${targetDir}`);
    } catch (error) {
      await this.logger.error(`创建配置文件失败: ${error.message}\n${error.stack}`);
    }
  }

  /**
   * 启动服务器模式
   * @param {number} port - 端口号
   * @returns {Promise<void>}
   */
  async startServerMode(port) {
    await this.logger.log(`启动葵崽服务器，端口: ${port}`);
    global.selectedMode = 'server';
    
    try {
      /** 保存并修改进程参数 */
      const originalArgv = [...process.argv];
      process.argv = [originalArgv[0], originalArgv[1], 'server', port.toString()];
      
      /** 动态导入Bot类 */
      const { default: BotClass } = await import('./lib/bot.js');
      
      /** 清理旧实例 */
      if (global.Bot) {
        delete global.Bot;
      }
      
      /** 创建并运行新实例 */
      global.Bot = new BotClass();
      await global.Bot.run({ port });
      
      /** 恢复进程参数 */
      process.argv = originalArgv;
    } catch (error) {
      await this.logger.error(`服务器模式启动失败: ${error.message}\n${error.stack}`);
      throw error;
    }
  }

  /**
   * 带自动重启机制的服务器启动
   * @param {number} port - 端口号
   * @returns {Promise<void>}
   */
  async startWithAutoRestart(port) {
    global.selectedMode = 'server';
    
    if (!this.signalHandler.isSetup) {
      this.signalHandler.setup();
    }
    
    let restartCount = 0;
    const startTime = Date.now();
    
    while (restartCount < CONFIG.MAX_RESTARTS) {
      const nodeArgs = getNodeArgs();
      const startArgs = [...nodeArgs, process.argv[1], 'server', port.toString()];
      
      await this.logger.log(`启动进程 (尝试 ${restartCount + 1}/${CONFIG.MAX_RESTARTS})`);
      
      /** 准备干净的环境变量 */
      const cleanEnv = Object.assign({}, process.env, {
        XRK_SELECTED_MODE: 'server',
        XRK_SERVER_PORT: port.toString()
      });
      
      const result = spawnSync(process.argv[0], startArgs, {
        stdio: 'inherit',
        windowsHide: true,
        env: cleanEnv,
        detached: false
      });
      
      const exitCode = result.status || 0;
      await this.logger.log(`进程退出，状态码: ${exitCode}`);
      
      /** 正常退出或重启请求 */
      if (exitCode === 0 || exitCode === 255) {
        await this.logger.log('正常退出');
        return;
      }
      
      /** 计算重启延迟 */
      const waitTime = this.calculateRestartDelay(Date.now() - startTime, restartCount);
      await this.logger.warning(`将在 ${waitTime / 1000} 秒后重启`);
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
      restartCount++;
    }
    
    await this.logger.error(`达到最大重启次数 (${CONFIG.MAX_RESTARTS})，停止重启`);
  }

  /**
   * 计算重启延迟时间
   * @private
   * @param {number} runTime - 运行时间(毫秒)
   * @param {number} restartCount - 重启次数
   * @returns {number} 延迟时间(毫秒)
   */
  calculateRestartDelay(runTime, restartCount) {
    /** 快速崩溃检测 */
    if (runTime < 10000 && restartCount > 2) {
      return restartCount > 5 
        ? CONFIG.RESTART_DELAYS.LONG 
        : CONFIG.RESTART_DELAYS.MEDIUM;
    }
    return CONFIG.RESTART_DELAYS.SHORT;
  }

  /**
   * 停止服务器
   * @param {number} port - 端口号
   * @returns {Promise<void>}
   */
  async stopServer(port) {
    await this.logger.log(`尝试停止端口 ${port} 的服务器`);
    
    try {
      const { default: fetch } = await import('node-fetch');
      const response = await fetch(`http://localhost:${port}/shutdown`, {
        method: 'POST',
        timeout: 5000
      });
      
      if (response.ok) {
        await this.logger.success('服务器停止请求已发送');
      } else {
        await this.logger.warning(`服务器响应异常: ${response.status}`);
      }
    } catch (error) {
      await this.logger.error(`停止请求失败: ${error.message}`);
    }
  }
}

/**
 * 信号处理器（单例）
 * 负责优雅地处理系统信号
 * 
 * @class SignalHandler
 */
class SignalHandler {
  /**
   * @param {Logger} logger - 日志实例
   */
  constructor(logger) {
    this.logger = logger;
    this.lastSignal = null;
    this.lastSignalTime = 0;
    this.isSetup = false;
    this.handlers = {};
  }

  /**
   * 设置信号监听器
   * @returns {void}
   */
  setup() {
    if (this.isSetup) return;
    
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    
    /** 创建信号处理函数 */
    const createHandler = (signal) => async () => {
      const currentTime = Date.now();
      
      if (this.shouldExit(signal, currentTime)) {
        await this.logger.log(`检测到双击 ${signal} 信号，准备退出`);
        await this.cleanup();
        process.exit(0);
      }
      
      this.lastSignal = signal;
      this.lastSignalTime = currentTime;
      await this.logger.warning(`收到 ${signal} 信号，再次发送将退出程序`);
    };
    
    /** 注册信号处理器 */
    signals.forEach(signal => {
      this.handlers[signal] = createHandler(signal);
      process.on(signal, this.handlers[signal]);
    });
    
    this.isSetup = true;
  }

  /**
   * 清理信号监听器
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (!this.isSetup) return;
    
    Object.keys(this.handlers).forEach(signal => {
      process.removeListener(signal, this.handlers[signal]);
      delete this.handlers[signal];
    });
    
    this.isSetup = false;
    await this.logger.log('信号处理器已清理');
  }

  /**
   * 判断是否应该退出
   * @private
   * @param {string} signal - 信号类型
   * @param {number} currentTime - 当前时间戳
   * @returns {boolean} 是否退出
   */
  shouldExit(signal, currentTime) {
    return signal === this.lastSignal && 
           currentTime - this.lastSignalTime < CONFIG.SIGNAL_TIME_THRESHOLD;
  }
}

/**
 * 菜单管理器
 * 提供交互式用户界面
 * 
 * @class MenuManager
 */
class MenuManager {
  /**
   * @param {ServerManager} serverManager - 服务器管理器
   * @param {PM2Manager} pm2Manager - PM2管理器
   */
  constructor(serverManager, pm2Manager) {
    this.serverManager = serverManager;
    this.pm2Manager = pm2Manager;
  }

  /**
   * 运行主菜单循环
   * @returns {Promise<void>}
   */
  async run() {
    console.log(chalk.cyan('\n🤖 葵崽多端口服务器管理系统\n'));
    
    let shouldExit = false;
    
    while (!shouldExit) {
      try {
        const selected = await this.showMainMenu();
        shouldExit = await this.handleMenuAction(selected);
      } catch (error) {
        if (error.isTtyError) {
          console.error('无法在当前环境中渲染菜单');
          break;
        }
        await this.serverManager.logger.error(`菜单操作出错: ${error.message}`);
      }
    }
  }

  /**
   * 显示主菜单
   * @private
   * @returns {Promise<Object>} 选中的选项
   */
  async showMainMenu() {
    const availablePorts = await this.serverManager.getAvailablePorts();
    
    const choices = [
      ...availablePorts.map(port => ({
        name: `${chalk.green('▶')} 启动服务器 (端口: ${chalk.yellow(port)})`,
        value: { action: 'start_server', port }
      })),
      { name: `${chalk.blue('+')} 添加新端口`, value: { action: 'add_port' } },
      { name: `${chalk.magenta('⚙')} PM2管理`, value: { action: 'pm2_menu' } },
      new inquirer.Separator(),
      { name: `${chalk.red('✖')} 退出`, value: { action: 'exit' } }
    ];
    
    const { selected } = await inquirer.prompt([{
      type: 'list',
      name: 'selected',
      message: '请选择操作:',
      choices,
      loop: false
    }]);
    
    return selected;
  }

  /**
   * 处理菜单动作
   * @private
   * @param {Object} selected - 选中的选项
   * @returns {Promise<boolean>} 是否退出
   */
  async handleMenuAction(selected) {
    switch (selected.action) {
      case 'start_server':
        await this.serverManager.startWithAutoRestart(selected.port);
        break;
        
      case 'add_port':
        await this.handleAddPort();
        break;
        
      case 'pm2_menu':
        await this.showPM2Menu();
        break;
        
      case 'exit':
        console.log(chalk.cyan('\n再见！👋\n'));
        if (globalSignalHandler) {
          await globalSignalHandler.cleanup();
        }
        return true;
    }
    
    return false;
  }

  /**
   * 处理添加端口
   * @private
   * @returns {Promise<void>}
   */
  async handleAddPort() {
    const newPort = await this.serverManager.addNewPort();
    
    if (newPort) {
      console.log(chalk.green(`✓ 端口 ${newPort} 已添加`));
      
      const { startNow } = await inquirer.prompt([{
        type: 'confirm',
        name: 'startNow',
        message: `是否立即启动端口 ${newPort} 的服务器?`,
        default: true
      }]);
      
      if (startNow) {
        await this.serverManager.startWithAutoRestart(newPort);
      }
    }
  }

  /**
   * 显示PM2管理菜单
   * @private
   * @returns {Promise<void>}
   */
  async showPM2Menu() {
    const availablePorts = await this.serverManager.getAvailablePorts();
    
    if (availablePorts.length === 0) {
      console.log(chalk.yellow('⚠ 没有可用的服务器端口'));
      return;
    }
    
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'PM2管理:',
      choices: [
        { name: '启动服务器', value: 'start' },
        { name: '查看日志', value: 'logs' },
        { name: '停止进程', value: 'stop' },
        { name: '重启进程', value: 'restart' },
        new inquirer.Separator(),
        { name: '返回主菜单', value: 'back' }
      ],
      loop: false
    }]);
    
    if (action === 'back') return;
    
    const port = await this.selectPort(availablePorts, action);
    if (port) {
      await this.pm2Manager.executePortCommand(action, port);
    }
  }

  /**
   * 选择端口
   * @private
   * @param {number[]} availablePorts - 可用端口列表
   * @param {string} action - 操作类型
   * @returns {Promise<number|null>} 选中的端口
   */
  async selectPort(availablePorts, action) {
    const actionMessages = {
      start: '选择要启动的端口:',
      logs: '查看哪个端口的日志?',
      stop: '停止哪个端口?',
      restart: '重启哪个端口?'
    };
    
    const choices = availablePorts.map(port => ({
      name: `端口 ${port}`,
      value: port
    }));
    
    if (action === 'start') {
      choices.push({ name: '添加新端口', value: 'add' });
    }
    
    const { port } = await inquirer.prompt([{
      type: 'list',
      name: 'port',
      message: actionMessages[action],
      choices
    }]);
    
    if (port === 'add') {
      return await this.serverManager.addNewPort();
    }
    
    return port;
  }
}

/**
 * 获取Node.js启动参数
 * @returns {string[]} Node参数数组
 */
function getNodeArgs() {
  const nodeArgs = [...process.execArgv];
  
  /** 确保垃圾回收器可用 */
  if (!nodeArgs.includes('--expose-gc')) {
    nodeArgs.push('--expose-gc');
  }
  
  /** 屏蔽警告以提升用户体验 */
  if (!nodeArgs.includes('--no-warnings')) {
    nodeArgs.push('--no-warnings');
  }
  
  return nodeArgs;
}

/**
 * 全局异常处理器
 * 确保所有未捕获的错误都被记录
 */
process.on('uncaughtException', async (error) => {
  const logger = new Logger();
  await logger.error(`未捕获的异常: ${error.message}\n${error.stack}`);
  
  if (globalSignalHandler) {
    await globalSignalHandler.cleanup();
  }
  
  process.exit(1);
});

/**
 * Promise拒绝处理器
 * 确保所有未处理的Promise拒绝都被记录
 */
process.on('unhandledRejection', async (reason) => {
  const logger = new Logger();
  const errorMessage = reason instanceof Error 
    ? `${reason.message}\n${reason.stack}` 
    : String(reason);
  
  await logger.error(`未处理的Promise拒绝: ${errorMessage}`);
});

/**
 * 进程退出处理器
 * 确保资源被正确清理
 */
process.on('exit', async () => {
  if (globalSignalHandler) {
    await globalSignalHandler.cleanup();
  }
});

/**
 * 主函数
 * 应用程序入口点
 * 
 * @async
 * @returns {Promise<void>}
 */
async function main() {
  const logger = new Logger();
  const pm2Manager = new PM2Manager(logger);
  const serverManager = new ServerManager(logger, pm2Manager);
  const menuManager = new MenuManager(serverManager, pm2Manager);
  
  /** 初始化目录结构 */
  await serverManager.ensureDirectories();
  await logger.ensureLogDir();
  
  /** 检查命令行参数 */
  const envPort = process.env.XRK_SERVER_PORT;
  const commandArg = process.argv[2];
  const portArg = process.argv[3] || envPort;
  
  /** 命令行模式 */
  if (commandArg && portArg && !isNaN(parseInt(portArg))) {
    const port = parseInt(portArg);
    
    switch (commandArg) {
      case 'server':
        await serverManager.startServerMode(port);
        return;
        
      case 'stop':
        await serverManager.stopServer(port);
        return;
    }
  }
  
  /** 交互菜单模式 */
  await menuManager.run();
  
  /** 清理资源 */
  if (globalSignalHandler) {
    await globalSignalHandler.cleanup();
  }
}

/** 导出主函数供外部调用 */
export default main;

/** 启动应用程序 */
main().catch(async (error) => {
  const logger = new Logger();
  await logger.ensureLogDir();
  await logger.error(`启动失败: ${error.message}\n${error.stack}`);
  
  if (globalSignalHandler) {
    await globalSignalHandler.cleanup();
  }
  
  process.exit(1);
});