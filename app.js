import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import paths from '#utils/paths.js';

function execAsync(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const { timeout, maxBuffer = 1024 * 1024 * 10, ...spawnOptions } = options;
    // 避免 DEP0190 警告：使用 shell 时，将命令和参数合并为字符串
    const shellCommand = args.length > 0 
      ? `${command} ${args.map(arg => {
          // 简单转义：如果包含空格或特殊字符，用引号包裹
          if (arg.includes(' ') || arg.includes('"') || arg.includes('&') || arg.includes('|')) {
            return `"${arg.replace(/"/g, '\\"')}"`;
          }
          return arg;
        }).join(' ')}`
      : command;
    
    const child = spawn(shellCommand, [], { 
      ...spawnOptions, 
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'] 
    });

    let stdout = '';
    let stderr = '';
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const killChild = () => {
      try {
        child.kill('SIGTERM');
      } catch {}
    };

    const createError = (message, code) => {
      const error = new Error(message);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      return error;
    };

    if (timeout) {
      timeoutId = setTimeout(() => {
        killChild();
        cleanup();
        reject(createError(`Command timed out after ${timeout}ms`, 'TIMEOUT'));
      }, timeout);
    }

    const checkBuffer = () => {
      if (stdout.length > maxBuffer || stderr.length > maxBuffer) {
        killChild();
        cleanup();
        reject(createError(`Command output exceeded maxBuffer size of ${maxBuffer} bytes`, 'MAXBUFFER'));
      }
    };

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
      checkBuffer();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
      checkBuffer();
    });

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });

    child.on('close', (code) => {
      cleanup();
      if (code !== 0) {
        reject(createError(`Command failed with exit code ${code}`, code));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

class BootstrapLogger {
  constructor() {
    this.logFile = path.join('./logs', 'bootstrap.log');
  }

  async log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    
    try {
      await fs.appendFile(this.logFile, logMessage);
      const colors = {
        INFO: '\x1b[36m',
        SUCCESS: '\x1b[32m',
        WARNING: '\x1b[33m',
        ERROR: '\x1b[31m'
      };
      console.log(`${colors[level] || ''}${message}\x1b[0m`);
    } catch (error) {
      console.error('日志写入失败:', error.message);
    }
  }

  async success(message) {
    await this.log(message, 'SUCCESS');
  }

  async warning(message) {
    await this.log(message, 'WARNING');
  }

  async error(message) {
    await this.log(message, 'ERROR');
  }
}

class DependencyManager {
  constructor(logger) {
    this.logger = logger;
  }

  async parsePackageJson(packageJsonPath) {
    try {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`无法读取package.json: ${error.message}`);
    }
  }

  async isDependencyInstalled(depName, nodeModulesPath) {
    try {
      const depPath = path.join(nodeModulesPath, depName);
      const stats = await fs.stat(depPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async getMissingDependencies(dependencies, nodeModulesPath) {
    const depNames = Object.keys(dependencies);
    const results = await Promise.all(
      depNames.map(dep => this.isDependencyInstalled(dep, nodeModulesPath))
    );
    return depNames.filter((_, i) => !results[i]);
  }

  async installDependencies(missingDeps) {
    await this.logger.warning(`发现 ${missingDeps.length} 个缺失的依赖`);
    await this.logger.log('使用 pnpm 安装依赖...');
    
    try {
      await execAsync('pnpm', ['install'], {
        maxBuffer: 1024 * 1024 * 10,
        timeout: 300000,
        env: { ...process.env, CI: 'true' }
      });
      await this.logger.success('依赖安装完成');
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('pnpm 未安装，请先安装: npm install -g pnpm');
      }
      throw new Error(`依赖安装失败: ${error.stderr || error.stdout || error.message}`);
    }
  }

  async checkAndInstall(config) {
    const { packageJsonPath, nodeModulesPath } = config;
    
    try {
      const packageJson = await this.parsePackageJson(packageJsonPath);
      const allDependencies = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {})
      };
      const missingDeps = await this.getMissingDependencies(allDependencies, nodeModulesPath);
      if (missingDeps.length > 0) {
        await this.installDependencies(missingDeps);
      }
    } catch (error) {
      await this.logger.error(`依赖检查失败: ${error.message}`);
      throw error;
    }
  }

  async ensurePluginDependencies(rootDir = process.cwd()) {
    const baseDirs = ['core', 'renderers'];
    const pluginDirs = [];

    for (const base of baseDirs) {
      const dir = path.join(rootDir, base);
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            pluginDirs.push(path.join(dir, entry.name));
          }
        }
      } catch {
        continue;
      }
    }

    for (const pluginDir of pluginDirs) {
      await this.checkPluginDependencies(pluginDir);
    }
  }

  async checkPluginDependencies(pluginDir) {
    const pkgPath = path.join(pluginDir, 'package.json');
    
    try {
      await fs.access(pkgPath);
    } catch {
      return; // 没有 package.json，跳过
    }

    let pkg;
    try {
      pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    } catch (e) {
      await this.logger.warning(`无法解析 package.json: ${pkgPath} (${e.message})`);
      return;
    }

    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const depNames = Object.keys(deps);
    if (depNames.length === 0) return;

    const nodeModulesPath = path.join(pluginDir, 'node_modules');
    const missing = await this.getMissingDependencies(
      Object.fromEntries(depNames.map(name => [name, ''])),
      nodeModulesPath
    );
    if (missing.length > 0) {
      await this.installPluginDependencies(pluginDir, missing);
    }
  }

  async installPluginDependencies(pluginDir, missing) {
    await this.logger.warning(`依赖缺失 [${pluginDir}]: ${missing.join(', ')}`);
    try {
      await this.logger.log(`安装依赖 (pnpm): ${pluginDir}`);
      await execAsync('pnpm', ['install'], {
        cwd: pluginDir,
        maxBuffer: 1024 * 1024 * 16,
        timeout: 10 * 60 * 1000,
        env: { ...process.env, CI: 'true' }
      });
      await this.logger.success(`依赖安装完成: ${pluginDir}`);
    } catch (err) {
      await this.logger.error(`依赖安装失败: ${pluginDir} (${err.message})`);
      throw err;
    }
  }
}

class EnvironmentValidator {
  constructor(logger) {
    this.logger = logger;
  }

  async checkNodeVersion() {
    const [major, minor] = process.version.slice(1).split('.').map(Number);
    if (major < 18 || (major === 18 && minor < 14)) {
      throw new Error(`Node.js版本过低: ${process.version}, 需要 v18.14.0 或更高版本`);
    }
  }

  async checkRequiredDirectories() {
    await paths.ensureBaseDirs(fs);
  }

  async validate() {
    await this.checkNodeVersion();
    await this.checkRequiredDirectories();
  }
}

class Bootstrap {
  constructor() {
    this.logger = new BootstrapLogger();
    this.dependencyManager = new DependencyManager(this.logger);
    this.environmentValidator = new EnvironmentValidator(this.logger);
  }

  async loadDynamicImports(packageJsonPath) {
    const importsDir = path.join(process.cwd(), 'data', 'importsJson');
    
    try {
      await fs.access(importsDir);
    } catch {
      return;
    }

    const files = await fs.readdir(importsDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    if (jsonFiles.length === 0) return;

    const importDataArray = await Promise.all(
      jsonFiles.map(async (file) => {
        const filePath = path.join(importsDir, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);
          return (data.imports && typeof data.imports === 'object') ? data.imports : {};
        } catch (e) {
          await this.logger.warning(`无法解析 imports 文件: ${filePath} (${e.message})`);
          return {};
        }
      })
    );

    const mergedImports = Object.assign({}, ...importDataArray);
    if (Object.keys(mergedImports).length === 0) return;

    const packageJson = await this.dependencyManager.parsePackageJson(packageJsonPath);
    packageJson.imports = { ...(packageJson.imports || {}), ...mergedImports };
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
  }

  async initialize() {
    await this.environmentValidator.validate();
    
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const nodeModulesPath = path.join(process.cwd(), 'node_modules');
    
    await this.dependencyManager.checkAndInstall({
      packageJsonPath,
      nodeModulesPath
    });

    await this.dependencyManager.ensurePluginDependencies(process.cwd());
    await this.loadDynamicImports(packageJsonPath);
  }

  async startMainApplication() {
    try {
      await import('./start.js');
    } catch (error) {
      await this.logger.error(`主程序启动失败: ${error.message}`);
      throw error;
    }
  }

  async run() {
    try {
      await this.initialize();
      await this.startMainApplication();
    } catch (error) {
      await this.logger.error(`引导失败: ${error.message}`);
      
      if (error.message.includes('pnpm 未安装')) {
        await this.logger.log('\n请先安装 pnpm: npm install -g pnpm');
      } else {
        await this.logger.log('\n请手动运行: pnpm install');
      }
      
      process.exit(1);
    }
  }
}

process.on('uncaughtException', async (error) => {
  const logger = new BootstrapLogger();
  await logger.error(`未捕获的异常: ${error.message}\n${error.stack}`);
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  const logger = new BootstrapLogger();
  const errorMessage = reason instanceof Error 
    ? `${reason.message}\n${reason.stack}` 
    : String(reason);
  await logger.error(`未处理的Promise拒绝: ${errorMessage}`);
  process.exit(1);
});

const bootstrap = new Bootstrap();
bootstrap.run();

export default Bootstrap;
