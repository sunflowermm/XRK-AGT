import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import paths from '#utils/paths.js';

function execAsync(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const { timeout, maxBuffer, ...spawnOptions } = options;
    const maxBufferSize = maxBuffer || 1024 * 1024 * 10;

    const child = spawn(command, args, {
      ...spawnOptions,
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

    if (timeout) {
      timeoutId = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {}
        cleanup();
        const error = new Error(`Command timed out after ${timeout}ms`);
        error.code = 'TIMEOUT';
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }, timeout);
    }

    const checkBuffer = () => {
      if (stdout.length > maxBufferSize || stderr.length > maxBufferSize) {
        try {
          child.kill('SIGTERM');
        } catch {}
        cleanup();
        const error = new Error(`Command output exceeded maxBuffer size of ${maxBufferSize} bytes`);
        error.code = 'MAXBUFFER';
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
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
        const error = new Error(`Command failed with exit code ${code}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
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

  async ensureLogDir() {
    await fs.mkdir('./logs', { recursive: true });
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
    const depNames = Object.keys(dependencies).filter(dep => dep !== 'md5' && dep !== 'oicq');
    const results = await Promise.all(
      depNames.map(dep => this.isDependencyInstalled(dep, nodeModulesPath))
    );
    return depNames.filter((_, i) => !results[i]);
  }

  async installDependencies(missingDeps) {
    await this.logger.warning(`发现 ${missingDeps.length} 个缺失的依赖`);
    await this.logger.log(`缺失的依赖: ${missingDeps.join(', ')}`);
    await this.logger.log('使用 pnpm 安装依赖...');
    
    try {
      const { stdout, stderr } = await execAsync('pnpm', ['install'], {
        maxBuffer: 1024 * 1024 * 10,
        timeout: 300000
      });
      
      if (stderr && !stderr.includes('warning')) {
        await this.logger.warning(`安装警告: ${stderr}`);
      }
      await this.logger.success('依赖安装完成');
    } catch (error) {
      throw new Error(`依赖安装失败: ${error.message}`);
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
    const pluginGlobs = ['core', 'renderers'];
    const dirs = [];

    await Promise.all(
      pluginGlobs.map(async (base) => {
        const dir = path.join(rootDir, base);
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          entries.forEach(d => d.isDirectory() && dirs.push(path.join(dir, d.name)));
        } catch {}
      })
    );

    await Promise.all(
      dirs.map(async (d) => {
        const pkgPath = path.join(d, 'package.json');
        const nodeModulesPath = path.join(d, 'node_modules');
        
        try {
          await fs.access(pkgPath);
        } catch {
          return;
        }

        let pkg;
        try {
          pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
        } catch (e) {
          await this.logger.warning(`插件 package.json 无法解析: ${pkgPath} (${e.message})`);
          return;
        }

        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const depNames = Object.keys(deps);
        if (depNames.length === 0) return;

        const results = await Promise.all(
          depNames.map(async (dep) => {
            try {
              const p = path.join(nodeModulesPath, dep);
              const s = await fs.stat(p);
              return s.isDirectory();
            } catch {
              return false;
            }
          })
        );
        const missing = depNames.filter((_, i) => !results[i]);

        if (missing.length > 0) {
          await this.logger.warning(`插件依赖缺失 [${d}]: ${missing.join(', ')}`);
          try {
            await this.logger.log(`为插件安装依赖 (pnpm): ${d}`);
            await execAsync('pnpm', ['install'], {
              cwd: d,
              maxBuffer: 1024 * 1024 * 16,
              timeout: 10 * 60 * 1000
            });
            await this.logger.success(`插件依赖安装完成: ${d}`);
          } catch (err) {
            await this.logger.error(`插件依赖安装失败: ${d} (${err.message})`);
            throw err;
          }
        }
      })
    );
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
      await this.logger.log('importsJson目录不存在，跳过动态imports加载');
      return;
    }

    const files = await fs.readdir(importsDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));

    if (jsonFiles.length === 0) {
      return;
    }

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

    if (Object.keys(mergedImports).length === 0) {
      return;
    }

    const packageJson = await this.dependencyManager.parsePackageJson(packageJsonPath);
    packageJson.imports = { ...(packageJson.imports || {}), ...mergedImports };
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
  }

  async initialize() {
    await this.logger.ensureLogDir();
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
      await this.logger.log('\n故障排除建议:');
      await this.logger.log('1. 确保Node.js版本 >= 18.14.0');
      await this.logger.log('2. 手动运行: pnpm install');
      await this.logger.log('3. 检查网络连接');
      await this.logger.log('4. 查看日志文件: ./logs/bootstrap.log');
      
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
