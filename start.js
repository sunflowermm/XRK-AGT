import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import paths from './src/utils/paths.js';

// 修复 Windows UTF-8 编码问题
if (process.platform === 'win32') {
  try {
    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');
    spawnSync('chcp', ['65001'], { stdio: 'ignore', shell: false });
  } catch {
    // 忽略错误
  }
}

process.setMaxListeners(30);
let globalSignalHandler = null;

const PATHS = {
  LOGS: './logs',
  DEFAULT_CONFIG: './config/default_config',
  SERVER_BOTS: './data/server_bots'
};
const PM2_TMP_PREFIX = path.join(os.tmpdir(), 'xrk-agt-pm2-');

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

const JSON_SPACE = 2;

async function writeFileIfChanged(filePath, content) {
  try {
    const existing = await fs.readFile(filePath, typeof content === 'string' ? 'utf8' : undefined);
    if (existing === content) {
      return false;
    }
  } catch {}

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return true;
}

async function copyFileIfMissing(source, target) {
  try {
    await fs.access(target);
    return false;
  } catch {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    return true;
  }
}

class Logger {
  constructor() {
    this.logFile = path.join(PATHS.LOGS, 'restart.log');
    this.isWriting = false;
    this.queue = [];
  }

  async log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    this.queue.push(logMessage);
    
    if (!this.isWriting) {
      await this.flushQueue();
    }
  }

  async flushQueue() {
    if (this.queue.length === 0 || this.isWriting) return;
    
    this.isWriting = true;
    const BATCH_SIZE = 100;
    const messages = this.queue.splice(0, BATCH_SIZE);
    
    try {
      await fs.appendFile(this.logFile, messages.join(''));
    } catch {} finally {
      this.isWriting = false;
      if (this.queue.length > 0) {
        setImmediate(() => this.flushQueue());
      }
    }
  }

  async error(message) {
    await this.log(message, 'ERROR');
  }

  async success(message) {
    await this.log(message, 'SUCCESS');
  }

  async warning(message) {
    await this.log(message, 'WARNING');
  }
}

class BaseManager {
  constructor(logger) {
    this.logger = logger;
  }
}

class DependencyChecker extends BaseManager {
  async check() {
    const results = await Promise.all([
      this.checkBinary('pm2', ['--version'], 'PM2'),
      this.checkBinary('pnpm', ['--version'], 'pnpm', true),
      this.checkNodeVersion()
    ]);

    // 只记录到日志文件，不输出到控制台
    if (results.includes(false)) {
      await this.logger.warning('检测到缺失或异常的依赖，请根据提示安装后再试。');
    }
  }

  async checkBinary(cmd, args, label, optional = false) {
    // 使用 spawnSync 配合参数数组，避免 DEP0190 警告
    // 在 Windows 上会自动处理 .cmd/.bat 文件
    const result = spawnSync(cmd, args, { encoding: 'utf8', shell: false, stdio: 'ignore' });
    const ok = result.status === 0;
    if (!ok) {
      const level = optional ? 'warning' : 'error';
      // 只记录到日志文件，不输出到控制台
      await this.logger[level](`${label} 未检测到，请确认已全局安装并可在当前终端访问`);
    }
    return ok || optional;
  }

  async checkNodeVersion() {
    const major = parseInt(process.versions.node.split('.')[0], 10);
    const ok = Number.isFinite(major) && major >= 18;
    if (!ok) {
      await this.logger.warning(`当前 Node.js 版本过低 (${process.versions.node})，建议 >= 18.x`);
    }
    return ok;
  }
}

class PM2Manager extends BaseManager {
  getPM2Path() {
    return process.platform === 'win32' 
      ? 'pm2' 
      : path.join(process.cwd(), 'node_modules', 'pm2', 'bin', 'pm2');
  }

  getProcessName(port) {
    return `XRK-MultiBot-Server-${port}`;
  }

  async executePM2Command(command, args = [], processName = '') {
    const pm2Path = this.getPM2Path();
    let cmdCommand = pm2Path;
    let cmdArgs = [command, ...args];
    
    if (process.platform === 'win32') {
      cmdCommand = 'cmd';
      cmdArgs = ['/c', 'pm2', command, ...args];
    }
    
    await this.logger.log(`执行PM2命令: ${command} ${args.join(' ')}`);
    
    // 使用参数数组传递，避免 DEP0190 警告
    // Windows 上已通过 cmd /c 处理，无需额外启用 shell
    const result = spawnSync(cmdCommand, cmdArgs, {
      stdio: 'inherit',
      windowsHide: true,
      detached: false,
      shell: false
    });
    
    const success = result.status === 0;
    
    if (success) {
      await this.logger.success(`PM2 ${command} ${processName} 成功`);
    } else {
      await this.logger.error(`PM2 ${command} ${processName} 失败，状态码: ${result.status}`);
      
      if (process.platform === 'win32' && command === 'start') {
        await this.tryAlternativeStartMethod(args);
      }
    }
    
    return success;
  }

  async tryAlternativeStartMethod(args) {
    try {
      // 使用参数数组传递，避免 DEP0190 警告
      const npmWhich = spawnSync('npm', ['bin', '-g'], {
        encoding: 'utf8',
        shell: false
      });
      
      if (npmWhich.stdout) {
        const globalPath = npmWhich.stdout.trim();
        const absolutePm2Path = path.join(globalPath, 'pm2.cmd');
        
        // 使用参数数组传递，避免 DEP0190 警告
        const retryResult = spawnSync(absolutePm2Path, ['start', ...args], {
          stdio: 'inherit',
          windowsHide: true,
          shell: false
        });
        
        if (retryResult.status === 0) {
          await this.logger.success('PM2替代方法启动成功');
        }
      }
    } catch (error) {
      await this.logger.error(`PM2替代方法失败: ${error.message}`);
    }
  }

  async createConfig(port, mode) {
    const processName = this.getProcessName(port);
    const nodeArgs = getNodeArgs();
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
    
    const pm2Dir = await fs.mkdtemp(PM2_TMP_PREFIX);
    const configPath = path.join(pm2Dir, `pm2_server_${port}.json`);
    const payload = JSON.stringify({ apps: [pm2Config] }, null, JSON_SPACE);
    await writeFileIfChanged(configPath, payload);
    
    const cleanup = async () => {
      try {
        await fs.rm(pm2Dir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup failures */
      }
    };

    return { configPath, cleanup };
  }

  async executePortCommand(action, port) {
    const processName = this.getProcessName(port);
    const commandMap = {
      start: async () => {
        const { configPath, cleanup } = await this.createConfig(port, 'server');
        const ok = await this.executePM2Command('start', [configPath], processName);
        await cleanup();
        return ok;
      },
      logs: () => this.executePM2Command('logs', [processName, '--lines', CONFIG.PM2_LINES.toString()], processName),
      stop: () => this.executePM2Command('stop', [processName], processName),
      restart: () => this.executePM2Command('restart', [processName], processName)
    };
    
    return commandMap[action]?.() || false;
  }
}

class ServerManager extends BaseManager {
  constructor(logger, pm2Manager) {
    super(logger);
    this.pm2Manager = pm2Manager;
    
    if (!globalSignalHandler) {
      globalSignalHandler = new SignalHandler(logger);
    }
    this.signalHandler = globalSignalHandler;
  }

  getPortDir(port) {
    return path.join(PATHS.SERVER_BOTS, String(port));
  }

  async ensurePortConfig(port) {
    const portDir = this.getPortDir(port);
    await fs.mkdir(portDir, { recursive: true });
    await this.copyDefaultConfigs(portDir);
    return portDir;
  }

  async removePortConfig(port) {
    const portDir = this.getPortDir(port);

    try {
      await fs.rm(portDir, { recursive: true, force: true });
      await this.logger.warning(`端口 ${port} 的配置目录已删除`);
      return true;
    } catch (error) {
      await this.logger.error(`删除端口配置失败: ${error.message}\n${error.stack}`);
      return false;
    }
  }

  async getAvailablePorts() {
    try {
      const files = await fs.readdir(PATHS.SERVER_BOTS);
      const ports = [];
      
      for (const file of files) {
        const port = parseInt(file, 10);
        !isNaN(port) && port > 0 && port < 65536 && ports.push(port);
      }
      
      return ports.sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  async addNewPort() {
    const { port } = await inquirer.prompt([{
      type: 'input',
      name: 'port',
      message: chalk.bold('请输入新的服务器端口号:'),
      validate: (input) => {
        const portNum = parseInt(input);
        return !isNaN(portNum) && portNum > 0 && portNum < 65536
          ? true
          : chalk.red('请输入有效的端口号 (1-65535)');
      }
    }]);
    
    const portNum = parseInt(port);
    await this.ensurePortConfig(portNum);
    
    return portNum;
  }

  async copyDefaultConfigs(targetDir) {
    try {
      const defaultConfigFiles = await fs.readdir(PATHS.DEFAULT_CONFIG);
      const created = [];
      
      for (const file of defaultConfigFiles) {
        if (file.endsWith('.yaml') && file !== 'qq.yaml') {
          const sourcePath = path.join(PATHS.DEFAULT_CONFIG, file);
          const targetPath = path.join(targetDir, file);
          const copied = await copyFileIfMissing(sourcePath, targetPath);
          if (copied) created.push(file);
        }
      }
      
      const suffix = created.length ? ` (新建: ${created.join(', ')})` : '';
      await this.logger.success(`配置文件已就绪: ${targetDir}${suffix}`);
    } catch (error) {
      await this.logger.error(`创建配置文件失败: ${error.message}\n${error.stack}`);
    }
  }

  async startServerMode(port) {
    await this.logger.log(`启动葵子服务器，端口: ${port}`);
    global.selectedMode = 'server';
    await this.ensurePortConfig(port);
    
    try {
      const originalArgv = [...process.argv];
      process.argv = [originalArgv[0], originalArgv[1], 'server', port.toString()];
      
      const { default: BotClass } = await import('./src/bot.js');
      
      if (global.Bot) {
        delete global.Bot;
      }
      
      global.Bot = new BotClass();
      await global.Bot.run({ port });
      
      process.argv = originalArgv;
    } catch (error) {
      await this.logger.error(`服务器模式启动失败: ${error.message}\n${error.stack}`);
      throw error;
    }
  }

  async startWithAutoRestart(port) {
    global.selectedMode = 'server';
    await this.ensurePortConfig(port);
    
    if (!this.signalHandler.isSetup) {
      this.signalHandler.setup();
    }
    
    let restartCount = 0;
    const startTime = Date.now();
    
    while (restartCount < CONFIG.MAX_RESTARTS) {
      await this.logger.log(`启动进程 (尝试 ${restartCount + 1}/${CONFIG.MAX_RESTARTS})`);
      
      const exitCode = await this.runServerProcess(port);
      await this.logger.log(`进程退出，状态码: ${exitCode}`);
      
      if (exitCode === 0 || exitCode === 255) {
        await this.logger.log('正常退出');
        return;
      }
      
      const waitTime = this.calculateRestartDelay(Date.now() - startTime, restartCount);
      await this.logger.warning(`将在 ${waitTime / 1000} 秒后重启`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      restartCount++;
    }
    
    await this.logger.error(`达到最大重启次数 (${CONFIG.MAX_RESTARTS})，停止重启`);
  }

  async runServerProcess(port) {
    const nodeArgs = getNodeArgs();
    const entryScript = path.join(process.cwd(), 'start.js');
    const startArgs = [...nodeArgs, entryScript, 'server', port.toString()];
    
    const cleanEnv = {
      ...process.env,
      XRK_SELECTED_MODE: 'server',
      XRK_SERVER_PORT: port.toString()
    };
    
    const result = spawnSync(process.argv[0], startArgs, {
      stdio: 'inherit',
      windowsHide: true,
      env: cleanEnv,
      detached: false
    });
    
    return result.status || 0;
  }

  calculateRestartDelay(runTime, restartCount) {
    if (runTime < 10000 && restartCount > 2) {
      return restartCount > 5 ? CONFIG.RESTART_DELAYS.LONG : CONFIG.RESTART_DELAYS.MEDIUM;
    }
    return CONFIG.RESTART_DELAYS.SHORT;
  }

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

class SignalHandler {
  constructor(logger) {
    this.logger = logger;
    this.lastSignal = null;
    this.lastSignalTime = 0;
    this.isSetup = false;
    this.handlers = {};
  }

  setup() {
    if (this.isSetup) return;
    
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
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
    
    signals.forEach(signal => {
      this.handlers[signal] = createHandler(signal);
      process.on(signal, this.handlers[signal]);
    });
    
    this.isSetup = true;
  }

  async cleanup() {
    if (!this.isSetup) return;
    
    Object.keys(this.handlers).forEach(signal => {
      process.removeListener(signal, this.handlers[signal]);
      delete this.handlers[signal];
    });
    
    this.isSetup = false;
    await this.logger.log('信号处理器已清理');
  }

  shouldExit(signal, currentTime) {
    return signal === this.lastSignal && 
           currentTime - this.lastSignalTime < CONFIG.SIGNAL_TIME_THRESHOLD;
  }
}

class MenuManager {
  constructor(serverManager, pm2Manager) {
    this.serverManager = serverManager;
    this.pm2Manager = pm2Manager;
  }

  async run() {
    console.log(chalk.cyan.bold('\n╔═══════════════════════════════════════╗'));
    console.log(chalk.cyan.bold('║       葵子多端口服务器管理系统        ║'));
    console.log(chalk.cyan.bold('╚═══════════════════════════════════════╝\n'));
    
    let shouldExit = false;
    
    while (!shouldExit) {
      try {
        const selected = await this.showMainMenu();
        shouldExit = await this.handleMenuAction(selected);
      } catch (error) {
        if (error.isTtyError) {
          console.error(chalk.red('无法在当前环境中渲染菜单'));
          break;
        }
        const errorMsg = error.stack || error.message || String(error);
        console.error(chalk.red('\n菜单操作出错:'));
        console.error(chalk.red(errorMsg));
        await this.serverManager.logger.error(`菜单操作出错: ${errorMsg}`);
      }
    }
  }

  async showMainMenu() {
    const availablePorts = await this.serverManager.getAvailablePorts();
    
    const choices = [
      ...availablePorts.map(port => ({
        name: chalk.green(`> 启动服务器 (端口: ${port})`),
        value: { action: 'start_server', port },
        short: `启动端口 ${port}`
      })),
      { 
        name: chalk.blue('+ 添加新端口'), 
        value: { action: 'add_port' },
        short: '添加新端口'
      },
      { 
        name: chalk.yellow('- 删除端口配置'), 
        value: { action: 'delete_port_config' },
        short: '删除端口配置'
      },
      { 
        name: chalk.cyan('* PM2管理'), 
        value: { action: 'pm2_menu' },
        short: 'PM2管理'
      },
      new inquirer.Separator(chalk.gray('─────────────────────────────')),
      { 
        name: chalk.red('X 退出'), 
        value: { action: 'exit' },
        short: '退出'
      }
    ];
    
    if (choices.length === 0) {
      choices.unshift({ 
        name: chalk.blue('+ 添加新端口'), 
        value: { action: 'add_port' },
        short: '添加新端口'
      });
    }
    
    const { selected } = await inquirer.prompt([{
      type: 'list',
      name: 'selected',
      message: chalk.bold('请选择操作:'),
      choices,
      pageSize: Math.min(choices.length, 10)
    }]);
    
    return selected;
  }

  async handleMenuAction(selected) {
    switch (selected.action) {
      case 'start_server':
        await this.serverManager.startWithAutoRestart(selected.port);
        break;
        
      case 'add_port':
        await this.handleAddPort();
        break;

      case 'delete_port_config':
        await this.handleDeletePortConfig();
        break;
        
      case 'pm2_menu':
        await this.showPM2Menu();
        break;
        
      case 'exit':
        console.log(chalk.cyan.bold('\n╔═══════════════════════════════════════╗'));
        console.log(chalk.cyan.bold('║                再见！                 ║'));
        console.log(chalk.cyan.bold('╚═══════════════════════════════════════╝\n'));
        if (globalSignalHandler) {
          await globalSignalHandler.cleanup();
        }
        return true;
    }
    
    return false;
  }

  async handleAddPort() {
    const newPort = await this.serverManager.addNewPort();
    
    if (newPort) {
      console.log(chalk.green.bold(`+ 端口 ${newPort} 已添加`));
      
      const { startNow } = await inquirer.prompt([{
        type: 'confirm',
        name: 'startNow',
        message: chalk.bold(`是否立即启动端口 ${newPort} 的服务器?`),
        default: true
      }]);
      
      if (startNow) {
        await this.serverManager.startWithAutoRestart(newPort);
      }
    }
  }

  async handleDeletePortConfig() {
    const ports = await this.serverManager.getAvailablePorts();
    if (ports.length === 0) {
      console.log(chalk.yellow('! 没有可删除的端口配置'));
      return;
    }

    const port = await this.selectPort(ports, 'delete');
    if (!port) return;

    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: chalk.bold.yellow(`确定删除端口 ${port} 的配置目录及相关PM2配置文件吗？`),
      default: false
    }]);

    if (confirm) {
      await this.serverManager.removePortConfig(port);
    }
  }

  async showPM2Menu() {
    const availablePorts = await this.serverManager.getAvailablePorts();
    
    if (availablePorts.length === 0) {
      console.log(chalk.yellow('! 没有可用的服务器端口'));
      return;
    }
    
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: chalk.bold('PM2管理:'),
      choices: [
        { name: chalk.green('> 启动服务器'), value: 'start', short: '启动服务器' },
        { name: chalk.blue('? 查看日志'), value: 'logs', short: '查看日志' },
        { name: chalk.yellow('- 停止进程'), value: 'stop', short: '停止进程' },
        { name: chalk.cyan('* 重启进程'), value: 'restart', short: '重启进程' },
        new inquirer.Separator(chalk.gray('─────────────────────────────')),
        { name: chalk.gray('< 返回主菜单'), value: 'back', short: '返回主菜单' }
      ],
      pageSize: 10
    }]);
    
    if (action === 'back') return;
    
    const port = await this.selectPort(availablePorts, action);
    if (port) {
      await this.pm2Manager.executePortCommand(action, port);
    }
  }

  async selectPort(availablePorts, action) {
    const actionMessages = {
      start: '选择要启动的端口:',
      logs: '查看哪个端口的日志?',
      stop: '停止哪个端口?',
      restart: '重启哪个端口?',
      delete: '选择要删除配置的端口:'
    };
    
    const choices = availablePorts.map(port => ({
      name: chalk.cyan(`端口 ${port}`),
      value: port,
      short: `端口 ${port}`
    }));
    
    if (action === 'start') {
      choices.push({ 
        name: chalk.blue('+ 添加新端口'), 
        value: 'add',
        short: '添加新端口'
      });
    }
    
    const { port } = await inquirer.prompt([{
      type: 'list',
      name: 'port',
      message: chalk.bold(actionMessages[action] || '请选择端口:'),
      choices,
      pageSize: Math.min(choices.length, 10)
    }]);
    
    if (port === 'add') {
      return await this.serverManager.addNewPort();
    }
    
    return port;
  }
}

function getNodeArgs() {
  const nodeArgs = [...process.execArgv];
  
  if (!nodeArgs.includes('--expose-gc')) {
    nodeArgs.push('--expose-gc');
  }
  
  if (!nodeArgs.includes('--no-warnings')) {
    nodeArgs.push('--no-warnings');
  }
  
  return nodeArgs;
}

process.on('uncaughtException', async (error) => {
  const logger = new Logger();
  const errorMsg = error.stack || `${error.message}\n${error.stack || ''}`;
  console.error('\n未捕获的异常:');
  console.error(errorMsg);
  await logger.error(`未捕获的异常: ${errorMsg}`);
  
  if (globalSignalHandler) {
    await globalSignalHandler.cleanup();
  }
  
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  const logger = new Logger();
  const errorMessage = reason instanceof Error 
    ? (reason.stack || `${reason.message}\n${reason.stack || ''}`)
    : String(reason);
  
  console.error('\n未处理的Promise拒绝:');
  console.error(errorMessage);
  await logger.error(`未处理的Promise拒绝: ${errorMessage}`);
});

process.on('exit', async () => {
  if (globalSignalHandler) {
    await globalSignalHandler.cleanup();
  }
});

async function main() {
  const logger = new Logger();
  const pm2Manager = new PM2Manager(logger);
  const serverManager = new ServerManager(logger, pm2Manager);
  const menuManager = new MenuManager(serverManager, pm2Manager);
  const dependencyChecker = new DependencyChecker(logger);
  
  await paths.ensureBaseDirs(fs);
  
  // 静默检查依赖，只记录到日志文件
  try {
    await dependencyChecker.check();
  } catch (error) {
    // 依赖检查失败时仍然继续，只记录错误
    await logger.error(`依赖检查失败: ${error.message}`);
  }
  
  const envPort = process.env.XRK_SERVER_PORT;
  const commandArg = process.argv[2];
  const portArg = process.argv[3] || envPort;
  
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
  
  // 显示菜单前清屏，确保界面干净
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[2J\x1b[H');
  }
  
  await menuManager.run();
  
  if (globalSignalHandler) {
    await globalSignalHandler.cleanup();
  }
}

export default main;

main().catch(async (error) => {
  const logger = new Logger();
  await logger.error(`启动失败: ${error.message}\n${error.stack}`);
  
  if (globalSignalHandler) {
    await globalSignalHandler.cleanup();
  }
  
  process.exit(1);
});