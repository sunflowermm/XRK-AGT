import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import paths from '#utils/paths.js';
import { statDirs, statFiles } from '#utils/core-fs.js';

export function spawnCommand(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv }
    });
    child.on('error', (err) => reject(err.code === 'ENOENT'
      ? new Error(`${command} 未安装或不在 PATH 中${command === 'pnpm' ? '，请执行: npm install -g pnpm' : ''}`)
      : err));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} 退出码 ${code}`))));
  });
}

export function spawnPnpmInstall(cwd) {
  return spawnCommand('pnpm', ['install'], cwd, {
    CI: 'true',
    PUPPETEER_SKIP_DOWNLOAD: process.env.PUPPETEER_SKIP_DOWNLOAD ?? 'true'
  });
}

/** @param {string} depName @param {string} nodeModulesPath @param {string} packageRoot */
export function isPackageInstalled(depName, nodeModulesPath, packageRoot) {
  const segments = depName.split('/');
  const directPath = path.join(nodeModulesPath, ...segments);
  try {
    const stat = fsSync.lstatSync(directPath);
    if ((stat.isDirectory() || stat.isSymbolicLink()) && fsSync.existsSync(path.join(directPath, 'package.json'))) {
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    createRequire(path.join(packageRoot, 'package.json')).resolve(`${depName}/package.json`);
    return true;
  } catch {
    return false;
  }
}

export function getMissingDependencies(depNames, nodeModulesPath, packageRoot) {
  if (!statDirs([nodeModulesPath])[0]) return depNames;
  return depNames.filter((dep) => !isPackageInstalled(dep, nodeModulesPath, packageRoot));
}

/**
 * @returns {Promise<{ playwrightInstalled: boolean, browserInstalled: boolean, executablePath: string | null }>}
 */
export async function getPlaywrightChromiumStatus(rootDir = process.cwd()) {
  const nodeModulesPath = path.join(rootDir, 'node_modules');
  if (!isPackageInstalled('playwright', nodeModulesPath, rootDir)) {
    return { playwrightInstalled: false, browserInstalled: false, executablePath: null };
  }
  try {
    const { chromium } = await import('playwright');
    const executablePath = chromium.executablePath();
    return {
      playwrightInstalled: true,
      browserInstalled: fsSync.existsSync(executablePath),
      executablePath
    };
  } catch {
    return { playwrightInstalled: false, browserInstalled: false, executablePath: null };
  }
}

export function installPlaywrightChromium(rootDir = process.cwd()) {
  return spawnCommand('pnpm', ['exec', 'playwright', 'install', 'chromium'], rootDir);
}

export class DependencyManager {
  constructor(logger) {
    this.logger = logger;
  }

  async parsePackageJson(packageJsonPath) {
    return JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
  }

  async installDependencies(missingDeps, cwd = process.cwd()) {
    const prefix = cwd !== process.cwd() ? `[${path.basename(cwd)}] ` : '';
    await this.logger.warning(`${prefix}发现 ${missingDeps.length} 个缺失依赖，使用 pnpm 安装...`);
    await spawnPnpmInstall(cwd);
    await this.logger.success(`${prefix}依赖安装完成`);
  }

  async checkAndInstall(packageJsonPath, nodeModulesPath) {
    const packageRoot = path.dirname(packageJsonPath);
    const pkg = await this.parsePackageJson(packageJsonPath);
    const depNames = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    if (depNames.length === 0) return;
    const missing = getMissingDependencies(depNames, nodeModulesPath, packageRoot);
    if (missing.length > 0) await this.installDependencies(missing, packageRoot);
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
