import path from 'path';
import { fileURLToPath } from 'url';

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
  
  // sub-directories
  coreAdapter: path.join(_core, 'adapter'),
  coreHttp: path.join(_core, 'http'),
  coreEvents: path.join(_core, 'events'),
  coreStream: path.join(_core, 'stream'),
  coreCommonConfig: path.join(_core, 'commonconfig'),
  
  configDefault: path.join(_config, 'default_config'),
  
  dataServerBots: path.join(_data, 'server_bots'),
  dataModels: path.join(_data, 'models'),

  /**
   * 确保核心目录结构存在
   * - logs: 日志
   * - data: 插件与系统配置/数据
   * - resources: 插件与渲染静态资源
   * - trash: 临时文件（截图、缓存等）
   */
  async ensureBaseDirs(fsPromises) {
    const fs = fsPromises || await import('fs/promises').then(m => m.default || m);
    const dirs = [
      _logs,
      _config,
      _data,
      path.join(_data, 'importsJson'),
      path.join(_data, 'server_bots'),
      _resources,
      _trash,
      path.join(_trash, 'screenshot')
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch {
        // 目录创建失败不应中断主流程，交由上层日志处理
      }
    }
  }
};
