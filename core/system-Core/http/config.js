/**
 * 配置管理API
 * 提供统一的配置文件读写接口
 */
import BotUtil from '#utils/botutil.js';
import { HttpResponse } from '#utils/http-utils.js';

// 鉴权由 src/bot.js 的 _authMiddleware 统一处理，/api/* 请求到达前已校验
const getConfig = (name) => global.ConfigManager?.get(name);
const resolveConfigInstance = (name, keyPath) => {
  const config = getConfig(name);
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
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        let configList = (global.ConfigManager?.getList?.() || []);
        // 确保 system 配置排在第一位，其余按名称排序，提升前端展示的一致性
        configList = configList.slice().sort((a, b) => {
          if (a.name === 'system') return -1;
          if (b.name === 'system') return 1;
          const an = (a.displayName || a.name || '').toLowerCase();
          const bn = (b.displayName || b.name || '').toLowerCase();
          return an.localeCompare(bn, 'zh-CN');
        });
        HttpResponse.success(res, {
          configs: configList,
          count: configList.length
        });
      }, 'config.list')
    },

    {
      method: 'GET',
      path: '/api/config/:name/structure',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const { name } = req.params;
        const config = getConfig(name);
        if (!config) return HttpResponse.notFound(res, `配置 ${name} 不存在`);
        const structure = config.getStructure();
        HttpResponse.success(res, { structure });
      }, 'config.structure')
    },

    // 扁平化结构（用于减少前端嵌套操作）
    {
      method: 'GET',
      path: '/api/config/:name/flat-structure',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const { name } = req.params;
        const { path: keyPath } = req.query || {};
        const { config, error } = resolveConfigInstance(name, keyPath);
        if (error) return HttpResponse.error(res, new Error(error), name === 'system' ? 400 : 404, 'config.flat-structure');
        const flat = config.getFlatSchema();
        HttpResponse.success(res, { flat });
      }, 'config.flat-structure')
    },

    // 扁平化数据（当前值）
    {
      method: 'GET',
      path: '/api/config/:name/flat',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const { name } = req.params;
        const { path: keyPath } = req.query || {};
        const { config, error } = resolveConfigInstance(name, keyPath);
        if (error) return HttpResponse.error(res, new Error(error), name === 'system' ? 400 : 404, 'config.flat');
        const data = await config.read();
        const flat = config.flattenData(data);
        HttpResponse.success(res, { flat });
      }, 'config.flat')
    },

    // 批量扁平写入：一次提交多个 path=>value，后端展开/校验/写入
    {
      method: 'POST',
      path: '/api/config/:name/batch-set',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const { name } = req.params;
        const { flat, path: keyPath, backup = true, validate = true } = req.body || {};
        if (!flat || typeof flat !== 'object') {
          return HttpResponse.validationError(res, '缺少 flat 对象');
        }
        const { config, error } = resolveConfigInstance(name, keyPath);
        if (error) {
          return HttpResponse.error(res, new Error(error), name === 'system' ? 400 : 404, 'config.batch-set');
        }

        const current = await config.read(false);
        const patchObj = config.expandFlatData(flat);
        // 使用内部深合并，保持其余字段不动
        const merged = config._deepMerge(current, patchObj);

        // 校验并写入
        const valid = await config.validate(merged);
        if (!valid.valid) {
          BotUtil.makeLog('warn', `配置验证失败 [${name}${keyPath ? '/' + keyPath : ''}]: ${valid.errors.join('; ')}`, 'ConfigAPI');
          return HttpResponse.validationError(res, `校验失败: ${valid.errors.join('; ')}`);
        }
        await config.write(merged, { backup, validate });
        HttpResponse.success(res, null, '批量写入成功');
      }, 'config.batch-set')
    },

    {
      method: 'GET',
      path: '/api/config/:name/read',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const configName = req.params?.name;
        const { path: keyPath } = req.query || {};
        if (!configName) return HttpResponse.validationError(res, '配置名称不能为空');
        if (!global.ConfigManager) return HttpResponse.error(res, new Error('配置管理器未初始化'), 503, 'config.read');
        const { config, error } = resolveConfigInstance(configName, keyPath);
        if (error) return HttpResponse.notFound(res, error);
        let data;
        if (configName === 'system' && keyPath) data = await config.read();
        else if (keyPath && typeof config.get === 'function') data = await config.get(keyPath);
        else if (typeof config.read === 'function') data = await config.read();
        else throw new Error('配置对象不支持 read/get 方法');
        HttpResponse.success(res, { data });
      }, 'config.read')
    },

    {
      method: 'POST',
      path: '/api/config/:name/write',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const configName = req.params?.name;
        const { data, path: keyPath, backup = true, validate = true } = req.body || {};

        if (!configName) {
          return HttpResponse.validationError(res, '配置名称不能为空');
        }

        if (!global.ConfigManager) return HttpResponse.error(res, new Error('配置管理器未初始化'), 503, 'config.write');
        const config = getConfig(configName);
        if (!config) return HttpResponse.notFound(res, `配置 ${configName} 不存在`);
        let result;
        if (keyPath) {
          if (configName === 'system' && typeof config.write === 'function') {
            result = await config.write(keyPath, data, { backup, validate });
          } else if (typeof config.set === 'function') {
            result = await config.set(keyPath, data, { backup, validate });
          } else {
            throw new Error('配置对象不支持 set 方法');
          }
        } else {
          // 没有 keyPath，写入完整配置
          if (configName === 'system') {
            throw new Error('SystemConfig 需要指定子配置名称（使用 path 参数）');
          } else if (typeof config.write === 'function') {
            result = await config.write(data, { backup, validate });
          } else {
            throw new Error('配置对象不支持 write 方法');
          }
        }

        HttpResponse.success(res, { result }, '配置已保存');
      }, 'config.write')
    },


    {
      method: 'POST',
      path: '/api/config/:name/validate',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const { name } = req.params;
        const { data } = req.body;
        const config = getConfig(name);
        if (!config) return HttpResponse.notFound(res, `配置 ${name} 不存在`);
        const validation = await config.validate(data);
        HttpResponse.success(res, { validation });
      }, 'config.validate')
    },

    {
      method: 'POST',
      path: '/api/config/:name/backup',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const { name } = req.params;
        const config = getConfig(name);
        if (!config) return HttpResponse.notFound(res, `配置 ${name} 不存在`);
        const backupPath = await config.backup();
        HttpResponse.success(res, { backupPath }, '配置已备份');
      }, 'config.backup')
    },

    {
      method: 'POST',
      path: '/api/config/:name/reset',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const { name } = req.params;
        const { backup = true } = req.body;
        const config = getConfig(name);
        if (!config) return HttpResponse.notFound(res, `配置 ${name} 不存在`);
        const result = await config.reset({ backup });
        HttpResponse.success(res, { result }, '配置已重置为默认值');
      }, 'config.reset')
    },

    {
      method: 'POST',
      path: '/api/config/clear-cache',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        global.ConfigManager.clearAllCache();
        HttpResponse.success(res, null, '已清除所有配置缓存');
      }, 'config.clear-cache')
    }
  ]
};