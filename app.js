import fs from 'fs/promises';
import path from 'path';
import paths from '#utils/paths.js';
import { statDirs, statFiles } from '#utils/core-fs.js';
import { createBootstrapLogger } from '#utils/bootstrap-logger.js';
import { DependencyManager } from '#utils/bootstrap-deps.js';

async function validateEnvironment() {
  const [major] = process.version.slice(1).split('.').map(Number);
  if (major < 26) {
    throw new Error(`Node.js 需 >= v26.0.0，当前: ${process.version}`);
  }
  await paths.ensureBaseDirs();
  await paths.warmupCoreLayout();
}

class Bootstrap {
  constructor() {
    this.logger = createBootstrapLogger(path.join('./logs', 'bootstrap.log'));
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
