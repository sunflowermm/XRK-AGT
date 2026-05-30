import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const _root = path.resolve(__dirname, '../../');
const _src = path.join(_root, 'src');
const _core = path.join(_root, 'core');
const _config = path.join(_root, 'config');
const _data = path.join(_root, 'data');
const _trash = path.join(_root, 'trash');
const _resources = path.join(_root, 'resources');
const _www = path.join(_root, 'www');
const _logs = path.join(_root, 'logs');
const _renderers = path.join(_src, 'renderers');

const _baseDirs = [
  _logs,
  _config,
  _data,
  path.join(_data, 'server_bots'),
  path.join(_data, 'uploads'),
  path.join(_data, 'media'),
  path.join(_data, 'stdin'),
  _resources,
  _trash,
  path.join(_trash, 'screenshot'),
  path.join(_trash, 'html')
];

/** @type {string[] | null} */
let _coreDirsCache = null;
/** @type {Map<string, string[]>} */
const _coreSubDirsCache = new Map();

/**
 * 清除 core 目录缓存（热加载新增 core 时可调用）
 */
function invalidateCoreCache() {
  _coreDirsCache = null;
  _coreSubDirsCache.clear();
}

/**
 * 获取所有 core 目录
 * @returns {Promise<Array<string>>} core 目录路径数组
 */
async function getCoreDirs() {
  if (_coreDirsCache) return _coreDirsCache;

  try {
    const entries = await fs.readdir(_core, { withFileTypes: true });
    _coreDirsCache = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => path.join(_core, entry.name));
    return _coreDirsCache;
  } catch {
    _coreDirsCache = [];
    return _coreDirsCache;
  }
}

/**
 * 获取所有 core 中指定子目录的路径
 * @param {string} subDir - 子目录名（如 'plugin', 'tasker'）
 * @returns {Promise<Array<string>>} 子目录路径数组
 */
async function getCoreSubDirs(subDir) {
  if (_coreSubDirsCache.has(subDir)) {
    return _coreSubDirsCache.get(subDir);
  }

  const coreDirs = await getCoreDirs();
  const subDirs = [];

  for (const coreDir of coreDirs) {
    const subDirPath = path.join(coreDir, subDir);
    if (existsSync(subDirPath)) {
      subDirs.push(subDirPath);
    }
  }

  _coreSubDirsCache.set(subDir, subDirs);
  return subDirs;
}

export default {
  root: _root,
  src: _src,
  core: _core,
  config: _config,
  data: _data,
  trash: _trash,
  www: _www,
  logs: _logs,
  renderers: _renderers,
  resources: _resources,
  
  configDefault: path.join(_config, 'default_config'),
  
  dataServerBots: path.join(_data, 'server_bots'),
  dataModels: path.join(_data, 'models'),

  /**
   * 获取所有 core 目录
   */
  getCoreDirs,

  /**
   * 获取所有 core 中指定子目录的路径
   */
  getCoreSubDirs,

  /**
   * 清除 core 目录扫描缓存
   */
  invalidateCoreCache,

  /**
   * 确保核心目录结构存在
   * - logs: 日志
   * - data: 插件与系统配置/数据
   * - resources: 插件与渲染静态资源
   * - trash: 临时文件（截图、缓存等）
   */
  async ensureBaseDirs(fsPromises) {
    const fs = fsPromises || await import('fs/promises').then(m => m.default || m);
    await Promise.all(_baseDirs.map(async dir => {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch {
        // 目录创建失败不应中断主流程，交由上层日志处理
      }
    }));
  }
};
