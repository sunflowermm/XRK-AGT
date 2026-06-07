import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { discoverCoreSubDirs } from './core-fs.js';

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
  'stream',
  'tasker',
  'events'
];

function invalidateCoreCache() {
  _coreDirsCache = null;
  _coreSubDirsCache.clear();
  _warmupPromise = null;
}

async function getCoreDirs() {
  if (_coreDirsCache) return _coreDirsCache;

  const entries = await fs.readdir(_core, { withFileTypes: true });
  _coreDirsCache = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(_core, entry.name));
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
      const discovered = await discoverCoreSubDirs(_core, DEFAULT_LOADER_SUBDIRS);

      if (!_coreDirsCache) {
        const coreDirs = new Set();
        for (const dirs of Object.values(discovered)) {
          for (const subPath of dirs) {
            coreDirs.add(path.dirname(subPath));
          }
        }
        _coreDirsCache = coreDirs.size > 0 ? [...coreDirs].sort() : await getCoreDirs();
      }

      for (const name of DEFAULT_LOADER_SUBDIRS) {
        _coreSubDirsCache.set(name, discovered[name]);
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
