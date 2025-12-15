/**
 * 配置管理API
 * 提供统一的配置文件读写接口
 */
import BotUtil from '../../src/utils/botutil.js';

const unauthorized = (res) => res.status(403).json({ success: false, message: 'Unauthorized' });
const ensureAuthorized = (req, res, Bot) => {
  if (Bot.checkApiAuthorization?.(req)) return true;
  unauthorized(res);
  return false;
};

const resolveConfigInstance = (name, keyPath) => {
  const config = global.ConfigManager.get(name);
  if (!config) return { error: `配置 ${name} 不存在` };

  if (name === 'system') {
    if (!keyPath) return { error: 'SystemConfig 需要提供 path（子配置名称）' };
    return { config: config.getConfigInstance(keyPath) };
  }

  return { config };
};

// 严格模式：不做任何回退或清洗，完全依赖 schema 校验与前端输入标准化
export default {
  name: 'config-manager',
  dsc: '配置管理API - 统一的配置文件读写接口',
  priority: 85,

  routes: [
    {
      method: 'GET',
      path: '/api/config/list',
      handler: async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        try {
          const configList = global.ConfigManager.getList();
          
          res.json({
            success: true,
            configs: configList,
            count: configList.length
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: '获取配置列表失败',
            error: error.message
          });
        }
      }
    },

    {
      method: 'GET',
      path: '/api/config/:name/structure',
      handler: async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        try {
          const { name } = req.params;
          const config = global.ConfigManager.get(name);

          if (!config) {
            return res.status(404).json({
              success: false,
              message: `配置 ${name} 不存在`
            });
          }

          const structure = config.getStructure();

          res.json({
            success: true,
            structure
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: '获取配置结构失败',
            error: error.message
          });
        }
      }
    },

    // 扁平化结构（用于减少前端嵌套操作）
    {
      method: 'GET',
      path: '/api/config/:name/flat-structure',
      handler: async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;
        try {
          const { name } = req.params;
          const { path: keyPath } = req.query || {};
          const { config, error } = resolveConfigInstance(name, keyPath);
          if (error) {
            return res.status(name === 'system' ? 400 : 404).json({ success: false, message: error });
          }
          const flat = config.getFlatSchema();
          res.json({ success: true, flat });
        } catch (error) {
          res.status(500).json({ success: false, message: '获取扁平结构失败', error: error.message });
        }
      }
    },

    // 扁平化数据（当前值）
    {
      method: 'GET',
      path: '/api/config/:name/flat',
      handler: async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;
        try {
          const { name } = req.params;
          const { path: keyPath } = req.query || {};
          const { config, error } = resolveConfigInstance(name, keyPath);
          if (error) {
            return res.status(name === 'system' ? 400 : 404).json({ success: false, message: error });
          }
          const data = await config.read();
          const flat = config.flattenData(data);
          res.json({ success: true, flat });
        } catch (error) {
          res.status(500).json({ success: false, message: '获取扁平数据失败', error: error.message });
        }
      }
    },

    // 批量扁平写入：一次提交多个 path=>value，后端展开/校验/写入
    {
      method: 'POST',
      path: '/api/config/:name/batch-set',
      handler: async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;
        try {
          const { name } = req.params;
          const { flat, path: keyPath, backup = true, validate = true } = req.body || {};
          if (!flat || typeof flat !== 'object') {
            return res.status(400).json({ success: false, message: '缺少 flat 对象' });
          }
          const { config, error } = resolveConfigInstance(name, keyPath);
          if (error) return res.status(name === 'system' ? 400 : 404).json({ success: false, message: error });

          const current = await config.read(false);
          const patchObj = config.expandFlatData(flat);
          // 使用内部深合并，保持其余字段不动
          const merged = config._deepMerge(current, patchObj);

          // 校验并写入
          const valid = await config.validate(merged);
          if (!valid.valid) {
            return res.status(400).json({ success: false, message: '校验失败', errors: valid.errors });
          }
          await config.write(merged, { backup, validate });
          res.json({ success: true, message: '批量写入成功' });
        } catch (error) {
          res.status(500).json({ success: false, message: '批量写入失败', error: error.message });
        }
      }
    },

    {
      method: 'GET',
      path: '/api/config/:name/read',
      handler: async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        let configName = null;
        try {
          configName = req.params?.name;
          const { path: keyPath } = req.query || {};

          if (!configName) {
            return res.status(400).json({
              success: false,
              message: '配置名称不能为空'
            });
          }

          if (!global.ConfigManager) {
            return res.status(503).json({
              success: false,
              message: '配置管理器未初始化'
            });
          }

          const config = global.ConfigManager.get(configName);

          if (!config) {
            return res.status(404).json({
              success: false,
              message: `配置 ${configName} 不存在`
            });
          }

          let data;
          if (keyPath) {
            // 如果有 keyPath，读取指定路径的配置值
            if (configName === 'system' && typeof config.read === 'function') {
              // SystemConfig 的特殊处理：keyPath 是子配置名称
              try {
                data = await config.read(keyPath);
              } catch (subError) {
                BotUtil.makeLog('error', `读取子配置失败 [${configName}/${keyPath}]: ${subError.message}`, 'ConfigAPI', subError);
                throw subError;
              }
            } else if (typeof config.get === 'function') {
              // 普通配置：使用 get 方法读取指定路径的值
            data = await config.get(keyPath);
            } else {
              throw new Error('配置对象不支持 get 方法');
            }
          } else {
            // 没有 keyPath，读取完整配置
            if (configName === 'system' && typeof config.read === 'function') {
              // SystemConfig 的特殊处理：无参数时返回配置列表
              try {
                data = await config.read();
              } catch (error) {
                BotUtil.makeLog('error', `读取 system 配置列表失败: ${error.message}`, 'ConfigAPI', error);
                throw error;
              }
            } else if (typeof config.read === 'function') {
              // 普通配置：读取完整配置
            data = await config.read();
            } else {
              throw new Error('配置对象不支持 read 方法');
            }
          }

          res.json({
            success: true,
            data
          });
        } catch (error) {
          const errorName = configName || 'unknown';
          BotUtil.makeLog('error', `读取配置失败 [${errorName}]: ${error.message}`, 'ConfigAPI', error);
          res.status(500).json({
            success: false,
            message: '读取配置失败',
            error: error.message,
            configName: errorName,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
          });
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/write',
      handler: async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        let configName = null;
        try {
          configName = req.params?.name;
          const { data, path: keyPath, backup = true, validate = true } = req.body || {};

          BotUtil.makeLog('info', `收到配置写入请求 [${configName}] path: ${keyPath || 'none'}`, 'ConfigAPI');

          if (!configName) {
            return res.status(400).json({
              success: false,
              message: '配置名称不能为空'
            });
          }

          if (!global.ConfigManager) {
            BotUtil.makeLog('error', '配置管理器未初始化', 'ConfigAPI');
            return res.status(503).json({
              success: false,
              message: '配置管理器未初始化'
            });
          }

          const config = global.ConfigManager.get(configName);

          if (!config) {
            BotUtil.makeLog('error', `配置不存在: ${configName}`, 'ConfigAPI');
            return res.status(404).json({
              success: false,
              message: `配置 ${configName} 不存在`
            });
          }

          // 验证数据
          if (data === undefined || data === null) {
            BotUtil.makeLog('warn', `配置数据为空 [${configName}]`, 'ConfigAPI');
          }

          // 严格模式：前端负责标准化，后端仅校验与写入
          let result;
          if (keyPath) {
            // 如果有 keyPath，使用 set 方法设置指定路径的值
            if (configName === 'system' && typeof config.write === 'function') {
              // SystemConfig 的特殊处理：keyPath 是子配置名称
              try {
                BotUtil.makeLog('info', `写入 SystemConfig 子配置 [${configName}/${keyPath}]`, 'ConfigAPI');
                result = await config.write(keyPath, data, { backup, validate });
                BotUtil.makeLog('info', `SystemConfig 子配置写入成功 [${configName}/${keyPath}]`, 'ConfigAPI');
              } catch (subError) {
                BotUtil.makeLog('error', `写入子配置失败 [${configName}/${keyPath}]: ${subError.message}`, 'ConfigAPI', subError);
                throw subError;
              }
            } else if (typeof config.set === 'function') {
              BotUtil.makeLog('info', `使用 set 方法写入配置路径 [${configName}/${keyPath}]`, 'ConfigAPI');
              result = await config.set(keyPath, data, { backup, validate });
            } else {
              throw new Error('配置对象不支持 set 方法');
            }
          } else {
            // 没有 keyPath，写入完整配置
            if (configName === 'system') {
              throw new Error('SystemConfig 需要指定子配置名称（使用 path 参数）');
            } else if (typeof config.write === 'function') {
              BotUtil.makeLog('info', `写入完整配置 [${configName}]`, 'ConfigAPI');
              result = await config.write(data, { backup, validate });
              BotUtil.makeLog('info', `配置写入成功 [${configName}]`, 'ConfigAPI');
            } else {
              throw new Error('配置对象不支持 write 方法');
            }
          }

          res.json({
            success: result,
            message: '配置已保存'
          });
        } catch (error) {
          const errorName = configName || req.params?.name || 'unknown';
          BotUtil.makeLog('error', `写入配置失败 [${errorName}]: ${error.message}`, 'ConfigAPI', error);
          res.status(500).json({
            success: false,
            message: '写入配置失败',
            error: error.message,
            configName: errorName,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
          });
        }
      }
    },


    {
      method: 'POST',
      path: '/api/config/:name/validate',
      handler: async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        try {
          const { name } = req.params;
          const { data } = req.body;

          const config = global.ConfigManager.get(name);

          if (!config) {
            return res.status(404).json({
              success: false,
              message: `配置 ${name} 不存在`
            });
          }

          const validation = await config.validate(data);

          res.json({
            success: true,
            validation
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: '验证失败',
            error: error.message
          });
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/backup',
      handler: async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        try {
          const { name } = req.params;
          const config = global.ConfigManager.get(name);

          if (!config) {
            return res.status(404).json({
              success: false,
              message: `配置 ${name} 不存在`
            });
          }

          const backupPath = await config.backup();

          res.json({
            success: true,
            backupPath,
            message: '配置已备份'
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: '备份失败',
            error: error.message
          });
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/reset',
      handler: async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        try {
          const { name } = req.params;
          const { backup = true } = req.body;

          const config = global.ConfigManager.get(name);

          if (!config) {
            return res.status(404).json({
              success: false,
              message: `配置 ${name} 不存在`
            });
          }

          const result = await config.reset({ backup });

          res.json({
            success: result,
            message: '配置已重置为默认值'
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: '重置失败',
            error: error.message
          });
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/clear-cache',
      handler: async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        try {
          global.ConfigManager.clearAllCache();

          res.json({
            success: true,
            message: '已清除所有配置缓存'
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: '清除缓存失败',
            error: error.message
          });
        }
      }
    }
  ]
};