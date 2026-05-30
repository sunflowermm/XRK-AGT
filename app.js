import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import paths from '#utils/paths.js';
import { statDirs } from '#utils/core-fs.js';
import { createSimpleLogger } from '#infrastructure/log.js';

function spawnSync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
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
    const targets = depNames.map((dep) => path.join(nodeModulesPath, dep));
    const exists = await statDirs(targets);
    return depNames.filter((_, i) => !exists[i]);
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
    const coreDirs = await paths.getCoreDirs();
    const tasks = coreDirs.map(async (dir) => {
      const pkgPath = path.join(dir, 'package.json');
      try { await fs.access(pkgPath); } catch { return; }
      try {
        await this.checkAndInstall(pkgPath, path.join(dir, 'node_modules'));
      } catch (e) {
        await this.logger.warning(`${path.relative(rootDir, dir)}: ${e.message}`);
      }
    });
    await Promise.all(tasks);
  }

  /**
   * 检查所有 core/*-Core 下 www 根目录及一层子目录的前端依赖
   * 规则：
   * - 仅当同一目录下同时存在 package.json 和 sign.json 时，视为独立前端项目
   * - 自动执行依赖检查与按需安装（与主工程、插件保持一致流程）
   */
  async ensureFrontendDependencies(rootDir = process.cwd()) {
    const coreDirs = await paths.getCoreDirs();
    const installTasks = [];

    for (const coreDir of coreDirs) {
      const wwwDir = path.join(coreDir, 'www');

      let wwwStat;
      try {
        wwwStat = await fs.stat(wwwDir);
      } catch {
        continue;
      }
      if (!wwwStat.isDirectory()) continue;

      const candidateDirs = [wwwDir];
      try {
        const subEntries = await fs.readdir(wwwDir, { withFileTypes: true });
        for (const sub of subEntries) {
          if (sub.isDirectory()) {
            candidateDirs.push(path.join(wwwDir, sub.name));
          }
        }
      } catch {}

      for (const dir of candidateDirs) {
        const pkgPath = path.join(dir, 'package.json');
        const signPath = path.join(dir, 'sign.json');

        installTasks.push((async () => {
          let hasPkg = false;
          let hasSign = false;
          try {
            await fs.access(pkgPath);
            hasPkg = true;
          } catch {}
          try {
            await fs.access(signPath);
            hasSign = true;
          } catch {}
          if (!hasPkg || !hasSign) return;

          try {
            await this.checkAndInstall(pkgPath, path.join(dir, 'node_modules'));
          } catch (e) {
            const rel = path.relative(rootDir, dir) || dir;
            await this.logger.warning(`${rel}: ${e.message}`);
          }
        })());
      }
    }

    await Promise.all(installTasks);
  }
}

async function validateEnvironment() {
  const [major, minor = 0, patch = 0] = process.version.slice(1).split('.').map(Number);
  const meetsRecommended =
    major > 24 || (major === 24 && minor >= 12);
  const meetsMinimum = major > 18 || (major === 18 && minor >= 14);
  if (!meetsRecommended && !meetsMinimum) {
    throw new Error(`Node.js 需 v24.13+（推荐）或 v18.14+，当前: ${process.version}`);
  }
  await paths.ensureBaseDirs(fs);
  await paths.warmupCoreLayout();
}

class Bootstrap {
  constructor() {
    this.logger = createSimpleLogger(path.join('./logs', 'bootstrap.log'));
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
    const nextImports = { ...(pkg.imports || {}), ...merged };
    if (JSON.stringify(pkg.imports || {}) === JSON.stringify(nextImports)) return;
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
      const skipBootstrap =
        process.argv[2] === 'server' && process.env.XRK_SKIP_BOOTSTRAP === '1';
      if (!skipBootstrap) {
        await this.initialize();
      }
      process.env.XRK_FROM_APP = '1';
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

bootstrap.run();

export default Bootstrap;
