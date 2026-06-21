import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import paths from '#utils/paths.js';
import { statDirs, statFiles } from '#utils/core-fs.js';

const require = createRequire(import.meta.url);
const { findSystemBrowser } = require('./system-browser.cjs');

const DEFAULT_PLAYWRIGHT_DOWNLOAD_HOST = 'https://npmmirror.com/mirrors/playwright';
const DEPS_READY_MARKER = '.xrk-deps-ready';

/** @returns {Record<string, string>} */
export function getBrowserDownloadEnv() {
  const env = {
    PUPPETEER_SKIP_DOWNLOAD: process.env.PUPPETEER_SKIP_DOWNLOAD ?? 'true'
  };
  if (process.env.PLAYWRIGHT_DOWNLOAD_HOST === undefined) {
    env.PLAYWRIGHT_DOWNLOAD_HOST = DEFAULT_PLAYWRIGHT_DOWNLOAD_HOST;
  }
  return env;
}

function depsReadyMarkerPath(nodeModulesPath) {
  return path.join(nodeModulesPath, DEPS_READY_MARKER);
}

function isDepsInstallComplete(nodeModulesPath) {
  return statFiles([depsReadyMarkerPath(nodeModulesPath)])[0];
}

async function markDepsInstallComplete(nodeModulesPath) {
  await fs.mkdir(nodeModulesPath, { recursive: true });
  await fs.writeFile(depsReadyMarkerPath(nodeModulesPath), `${Date.now()}\n`);
}

export function spawnCommand(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: 'inherit',
      env: { ...process.env, ...getBrowserDownloadEnv(), ...extraEnv }
    });
    child.on('error', (err) => reject(err.code === 'ENOENT'
      ? new Error(`${command} 未安装或不在 PATH 中${command === 'pnpm' ? '，请执行: npm install -g pnpm' : ''}`)
      : err));
    child.on('close', (code, signal) => {
      if (signal === 'SIGINT' || code === 130) {
        reject(new Error(`${command} 安装已中断（Ctrl+C），请重新运行 pnpm install`));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} 退出码 ${code ?? 'unknown'}`));
    });
  });
}

export function spawnPnpmInstall(cwd) {
  return spawnCommand('pnpm', ['install'], cwd, { CI: 'true' });
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
 * @returns {Promise<{
 *   playwrightInstalled: boolean,
 *   browserInstalled: boolean,
 *   executablePath: string | null,
 *   systemBrowserPath: string | null,
 *   needsBrowserReminder: boolean
 * }>}
 */
export async function getBrowserStatus(rootDir = process.cwd()) {
  const systemBrowserPath = findSystemBrowser();
  const nodeModulesPath = path.join(rootDir, 'node_modules');

  if (!isPackageInstalled('playwright', nodeModulesPath, rootDir)) {
    return {
      playwrightInstalled: false,
      browserInstalled: false,
      executablePath: null,
      systemBrowserPath,
      needsBrowserReminder: !systemBrowserPath
    };
  }

  try {
    const { chromium } = await import('playwright');
    const executablePath = chromium.executablePath();
    const browserInstalled = fsSync.existsSync(executablePath);
    const canLaunch = !!(systemBrowserPath || browserInstalled);
    return {
      playwrightInstalled: true,
      browserInstalled,
      executablePath,
      systemBrowserPath,
      needsBrowserReminder: !canLaunch
    };
  } catch {
    return {
      playwrightInstalled: false,
      browserInstalled: false,
      executablePath: null,
      systemBrowserPath,
      needsBrowserReminder: !systemBrowserPath
    };
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

  async installDependencies(missingDeps, cwd = process.cwd(), { resume = false } = {}) {
    const prefix = cwd !== process.cwd() ? `[${path.basename(cwd)}] ` : '';
    if (resume) {
      await this.logger.warning(`${prefix}上次依赖安装未完成（可能因 Ctrl+C 中断），重新执行 pnpm install...`);
    } else {
      await this.logger.warning(`${prefix}发现 ${missingDeps.length} 个缺失依赖，使用 pnpm 安装...`);
    }
    await spawnPnpmInstall(cwd);
    await markDepsInstallComplete(path.join(cwd, 'node_modules'));
    await this.logger.success(`${prefix}依赖安装完成`);
  }

  async checkAndInstall(packageJsonPath, nodeModulesPath) {
    const packageRoot = path.dirname(packageJsonPath);
    const pkg = await this.parsePackageJson(packageJsonPath);
    const depNames = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    if (depNames.length === 0) return;
    const missing = getMissingDependencies(depNames, nodeModulesPath, packageRoot);
    const complete = isDepsInstallComplete(nodeModulesPath);
    if (missing.length > 0) {
      await this.installDependencies(missing, packageRoot);
    } else if (!complete) {
      await this.installDependencies(depNames, packageRoot, { resume: true });
    }
  }

  _checkInstallSafe(packageJsonPath, nodeModulesPath, rootDir) {
    const label = path.relative(rootDir, path.dirname(packageJsonPath)) || packageJsonPath;
    return this.checkAndInstall(packageJsonPath, nodeModulesPath)
      .catch((e) => this.logger.warning(`${label}: ${e.message}`));
  }

  async ensurePluginDependencies(rootDir = process.cwd()) {
    const coreDirs = await paths.getCoreDirs();
    await Promise.all(coreDirs.map(async (dir) => {
      const pkgPath = path.join(dir, 'package.json');
      if (!statFiles([pkgPath])[0]) return;
      await this._checkInstallSafe(pkgPath, path.join(dir, 'node_modules'), rootDir);
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
        tasks.push(this._checkInstallSafe(pkgPath, path.join(dir, 'node_modules'), rootDir));
      }
    }
    await Promise.all(tasks);
  }
}
