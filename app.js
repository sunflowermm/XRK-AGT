import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import paths from '#utils/paths.js';
import { statDirs, statFiles } from '#utils/core-fs.js';
import { createSimpleLogger } from '#infrastructure/log.js';

function spawnPnpm(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['install'], {
      cwd,
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, CI: 'true' }
    });
    child.on('error', (err) => reject(err.code === 'ENOENT'
      ? new Error('pnpm 未安装或不在 PATH 中，请执行: npm install -g pnpm')
      : err));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pnpm install 退出码 ${code}`))));
  });
}

class DependencyManager {
  constructor(logger) {
    this.logger = logger;
  }

  async parsePackageJson(packageJsonPath) {
    return JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
  }

  async getMissingDependencies(depNames, nodeModulesPath) {
    const exists = statDirs(depNames.map((dep) => path.join(nodeModulesPath, dep)));
    return depNames.filter((_, i) => !exists[i]);
  }

  async installDependencies(missingDeps, cwd = process.cwd()) {
    const prefix = cwd !== process.cwd() ? `[${path.basename(cwd)}] ` : '';
    await this.logger.warning(`${prefix}发现 ${missingDeps.length} 个缺失依赖，使用 pnpm 安装...`);
    await spawnPnpm(cwd);
    await this.logger.success(`${prefix}依赖安装完成`);
  }

  async checkAndInstall(packageJsonPath, nodeModulesPath) {
    const pkg = await this.parsePackageJson(packageJsonPath);
    const depNames = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    if (depNames.length === 0) return;
    const missing = await this.getMissingDependencies(depNames, nodeModulesPath);
    if (missing.length > 0) await this.installDependencies(missing, path.dirname(packageJsonPath));
  }

  async ensurePluginDependencies(rootDir = process.cwd()) {
    const coreDirs = await paths.getCoreDirs();
    await Promise.all(coreDirs.map(async (dir) => {
      const pkgPath = path.join(dir, 'package.json');
      if (!statFiles([pkgPath])[0]) return;
      await this.checkAndInstall(pkgPath, path.join(dir, 'node_modules'))
        .catch((e) => this.logger.warning(`${path.relative(rootDir, dir)}: ${e.message}`));
    }));
  }

  async ensureFrontendDependencies(rootDir = process.cwd()) {
    const tasks = [];
    for (const coreDir of await paths.getCoreDirs()) {
      const wwwDir = path.join(coreDir, 'www');
      if (!statDirs([wwwDir])[0]) continue;

      const entries = await fs.readdir(wwwDir, { withFileTypes: true });
      const subDirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(wwwDir, e.name));

      for (const dir of [wwwDir, ...subDirs]) {
        const pkgPath = path.join(dir, 'package.json');
        const signPath = path.join(dir, 'sign.json');
        if (!statFiles([pkgPath, signPath]).every(Boolean)) continue;

        tasks.push(
          this.checkAndInstall(pkgPath, path.join(dir, 'node_modules'))
            .catch((e) => this.logger.warning(`${path.relative(rootDir, dir) || dir}: ${e.message}`))
        );
      }
    }
    await Promise.all(tasks);
  }
}

async function validateEnvironment() {
  const [major, minor = 0] = process.version.slice(1).split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 12)) {
    throw new Error(`Node.js 需 >= v24.12.0，当前: ${process.version}`);
  }
  await paths.ensureBaseDirs();
  await paths.warmupCoreLayout();
}

class Bootstrap {
  constructor() {
    this.logger = createSimpleLogger(path.join('./logs', 'bootstrap.log'));
    this.dependencyManager = new DependencyManager(this.logger);
  }

  async loadDynamicImports(packageJsonPath) {
    const importsDir = path.join(process.cwd(), 'data', 'importsJson');
    if (!statDirs([importsDir])[0]) return;

    const files = (await fs.readdir(importsDir)).filter((f) => f.endsWith('.json'));
    if (files.length === 0) return;

    const merged = Object.assign({}, ...(await Promise.all(
      files.map(async (f) => {
        const data = JSON.parse(await fs.readFile(path.join(importsDir, f), 'utf-8'));
        return data.imports ?? {};
      })
    )));
    if (Object.keys(merged).length === 0) return;

    const pkg = await this.dependencyManager.parsePackageJson(packageJsonPath);
    const nextImports = { ...pkg.imports, ...merged };
    if (JSON.stringify(pkg.imports) === JSON.stringify(nextImports)) return;
    pkg.imports = nextImports;
    await fs.writeFile(packageJsonPath, JSON.stringify(pkg, null, 2));
  }

  async initialize() {
    await validateEnvironment();
    const root = process.cwd();
    await Promise.all([
      this.dependencyManager.checkAndInstall(path.join(root, 'package.json'), path.join(root, 'node_modules')),
      this.dependencyManager.ensurePluginDependencies(root)
    ]);
    if (process.env.XRK_SKIP_FRONTEND_BOOTSTRAP !== '1') {
      await this.dependencyManager.ensureFrontendDependencies(root);
    }
    await this.loadDynamicImports(path.join(root, 'package.json'));
  }

  async run() {
    try {
      const skipBootstrap = process.argv[2] === 'server' && process.env.XRK_SKIP_BOOTSTRAP === '1';
      if (!skipBootstrap) await this.initialize();
      process.env.XRK_FROM_APP = '1';
      await new Promise((r) => setImmediate(r));
      await import('./start.js');
    } catch (e) {
      await this.logger.error(`引导失败: ${e.stack ?? e.message}`);
      await this.logger.log('\n可尝试: pnpm install');
      process.exit(1);
    }
  }
}

const bootstrap = new Bootstrap();
bootstrap.run();

export default Bootstrap;
