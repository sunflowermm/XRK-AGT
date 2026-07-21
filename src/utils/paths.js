import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { discoverAllCoreSubDirs } from './core-fs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  path.join(_data, 'ai-workspace'),
  path.join(_data, 'ai-workspace', 'default'),
  path.join(_data, 'stdin'),
  _resources,
  _trash,
  path.join(_trash, 'screenshot'),
  path.join(_trash, 'html')
];

let _coreDirsCache = null;
const _coreSubDirsCache = new Map();
let _warmupPromise = null;

const DEFAULT_LOADER_SUBDIRS = [
  'plugin',
  'http',
  'commonconfig',
  'workflow',
  'tasker',
  'events'
];

/** 子服 apis/<group>/core/ 与主仓 core 同结构，主服 Loader 一并扫描 */
const SUBSERVER_PLUGIN_CORE_SUBDIRS = [
  'plugin',
  'http',
  'commonconfig',
  'workflow',
  'tasker',
  'events'
];

function invalidateCoreCache() {
  _coreDirsCache = null;
  _coreSubDirsCache.clear();
  _warmupPromise = null;
}

/**
 * 列举 `core/` 下全部 Core 目录（含仅有 www、无 plugin/http 的产品 Core）。
 * 勿用 Loader 子目录反推列表，否则会漏挂静态前端。
 */
async function listAllCoreDirs() {
  const entries = await fs.readdir(_core, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(_core, entry.name))
    .sort();
}

async function getCoreDirs() {
  if (_coreDirsCache) return _coreDirsCache;
  _coreDirsCache = await listAllCoreDirs();
  return _coreDirsCache;
}

async function getCoreSubDirs(subDir) {
  if (!_coreSubDirsCache.has(subDir)) {
    await warmupCoreLayout([subDir]);
  }
  return _coreSubDirsCache.get(subDir);
}

async function warmupCoreLayout(subDirNames = DEFAULT_LOADER_SUBDIRS) {
  const pending = subDirNames.filter((name) => !_coreSubDirsCache.has(name));
  if (pending.length === 0) return;

  if (!_warmupPromise) {
    _warmupPromise = (async () => {
      // Core 全量列表与 Loader 子目录扫描解耦：先保证 getCoreDirs 完整
      if (!_coreDirsCache) {
        _coreDirsCache = await listAllCoreDirs();
      }

      const discovered = await discoverAllCoreSubDirs(
        _root,
        _core,
        DEFAULT_LOADER_SUBDIRS,
        SUBSERVER_PLUGIN_CORE_SUBDIRS
      );

      for (const name of DEFAULT_LOADER_SUBDIRS) {
        _coreSubDirsCache.set(name, discovered[name] ?? []);
      }
    })();
  }

  await _warmupPromise;

  for (const name of pending) {
    if (!_coreSubDirsCache.has(name)) {
      _coreSubDirsCache.set(name, []);
    }
  }
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
  dataAiWorkspace: path.join(_data, 'ai-workspace'),

  getCoreDirs,
  getCoreSubDirs,
  warmupCoreLayout,
  invalidateCoreCache,

  async ensureBaseDirs() {
    await Promise.all(_baseDirs.map((dir) => fs.mkdir(dir, { recursive: true })));
  }
};
