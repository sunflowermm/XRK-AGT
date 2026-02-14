import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import paths from '#utils/paths.js';

function spawnSync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

function createBootstrapLogger(logFile) {
  const colors = { INFO: '\x1b[36m', SUCCESS: '\x1b[32m', WARNING: '\x1b[33m', ERROR: '\x1b[31m', RESET: '\x1b[0m' };
  async function write(message, level = 'INFO') {
    const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
    try {
      await fs.mkdir(path.dirname(logFile), { recursive: true });
      await fs.appendFile(logFile, line, 'utf8');
    } catch {}
    console.log(`${colors[level] || ''}${message}${colors.RESET}`);
  }
  return {
    log: (msg) => write(msg, 'INFO'),
    success: (msg) => write(msg, 'SUCCESS'),
    warning: (msg) => write(msg, 'WARNING'),
    error: (msg) => write(msg, 'ERROR')
  };
}


class DependencyManager {
  constructor(logger) {
    this.logger = logger;
  }

  async parsePackageJson(packageJsonPath) {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    return JSON.parse(content);
  }

  async getMissingDependencies(depNames, nodeModulesPath) {
    const results = await Promise.all(
      depNames.map(async dep => {
        try {
          const st = await fs.stat(path.join(nodeModulesPath, dep));
          return st.isDirectory();
        } catch { return false; }
      })
    );
    return depNames.filter((_, i) => !results[i]);
  }

  async installDependencies(missingDeps, cwd = process.cwd()) {
    const prefix = cwd !== process.cwd() ? `[${path.basename(cwd)}] ` : '';
    await this.logger.warning(`${prefix}发现 ${missingDeps.length} 个缺失依赖，使用 pnpm 安装...`);
    await this.logger.log(`${prefix}正在安装依赖，若出现 DEP0190 警告可忽略，请稍候...`);
    try {
      await spawnSync('pnpm', ['install'], {
        cwd,
        shell: true,
        env: { ...process.env, CI: 'true' }
      });
      await this.logger.success(`${prefix}依赖安装完成`);
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error('pnpm 未安装或不在 PATH 中，请执行: npm install -g pnpm');
      throw new Error(`依赖安装失败: ${e.message}`);
    }
  }

  async checkAndInstall(packageJsonPath, nodeModulesPath) {
    const pkg = await this.parsePackageJson(packageJsonPath);
    const depNames = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
    if (depNames.length === 0) return;
    const missing = await this.getMissingDependencies(depNames, nodeModulesPath);
    if (missing.length > 0) await this.installDependencies(missing, path.dirname(packageJsonPath));
  }

  async ensurePluginDependencies(rootDir = process.cwd()) {
    const baseDir = path.join(rootDir, 'core');
    let entries;
    try { entries = await fs.readdir(baseDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(baseDir, entry.name);
      const pkgPath = path.join(dir, 'package.json');
      try { await fs.access(pkgPath); } catch { continue; }
      try {
        await this.checkAndInstall(pkgPath, path.join(dir, 'node_modules'));
      } catch (e) {
        await this.logger.warning(`${path.relative(rootDir, dir)}: ${e.message}`);
      }
    }
  }
}

async function validateEnvironment() {
  const [major, minor] = process.version.slice(1).split('.').map(Number);
  if (major < 18 || (major === 18 && minor < 14)) {
    throw new Error(`Node.js 需 v18.14.0+，当前: ${process.version}`);
  }
  await paths.ensureBaseDirs(fs);
}

class Bootstrap {
  constructor() {
    this.logger = createBootstrapLogger(path.join('./logs', 'bootstrap.log'));
    this.dependencyManager = new DependencyManager(this.logger);
  }

  async loadDynamicImports(packageJsonPath) {
    const importsDir = path.join(process.cwd(), 'data', 'importsJson');
    try { await fs.access(importsDir); } catch { return; }
    const files = (await fs.readdir(importsDir)).filter(f => f.endsWith('.json'));
    if (!files.length) return;
    const merged = Object.assign({}, ...await Promise.all(
      files.map(async (f) => {
        try {
          const data = JSON.parse(await fs.readFile(path.join(importsDir, f), 'utf-8'));
          return (data.imports && typeof data.imports === 'object') ? data.imports : {};
        } catch { return {}; }
      })
    ));
    if (!Object.keys(merged).length) return;
    const pkg = await this.dependencyManager.parsePackageJson(packageJsonPath);
    pkg.imports = { ...(pkg.imports || {}), ...merged };
    await fs.writeFile(packageJsonPath, JSON.stringify(pkg, null, 2));
  }

  async initialize() {
    await validateEnvironment();
    const root = process.cwd();
    await this.dependencyManager.checkAndInstall(path.join(root, 'package.json'), path.join(root, 'node_modules'));
    await this.dependencyManager.ensurePluginDependencies(root);
    await this.loadDynamicImports(path.join(root, 'package.json'));
  }

  async run() {
    try {
      await this.initialize();
      await new Promise(r => setImmediate(r));
      await import('./start.js');
    } catch (e) {
      await this.logger.error(`引导失败: ${e.stack || e.message}`);
      await this.logger.log('\n可尝试: pnpm install');
      process.exit(1);
    }
  }
}

const bootstrap = new Bootstrap();

process.on('uncaughtException', (err) => {
  bootstrap.logger.error(`未捕获的异常: ${err?.stack || err?.message || err}`).then(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  bootstrap.logger.error(`未处理的 Promise 拒绝: ${reason?.stack || reason?.message || reason}`);
});

bootstrap.run();

export default Bootstrap;
