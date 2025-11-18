import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const _root = path.resolve(__dirname, '../../');
const _src = path.join(_root, 'src');
const _core = path.join(_root, 'core');
const _config = path.join(_root, 'config');
const _data = path.join(_root, 'data');
const _www = path.join(_root, 'www');
const _logs = path.join(_root, 'logs');
const _renderers = path.join(_src, 'renderers');
const _temp = path.join(_root, 'temp');

export default {
  root: _root,
  src: _src,
  core: _core,
  config: _config,
  data: _data,
  www: _www,
  logs: _logs,
  renderers: _renderers,
  temp: _temp,
  
  // sub-directories
  coreAdapter: path.join(_core, 'adapter'),
  coreHttp: path.join(_core, 'http'),
  coreEvents: path.join(_core, 'events'),
  coreStream: path.join(_core, 'stream'),
  coreCommonConfig: path.join(_core, 'commonconfig'),
  
  configDefault: path.join(_config, 'default_config'),
  
  dataServerBots: path.join(_data, 'server_bots'),
  dataModels: path.join(_data, 'models'),
};
