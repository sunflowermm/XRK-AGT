/**
 * 配置管理API
 * 提供统一的配置文件读写接口
 * 重构版 - 确保前后端有机联系
 */
import BotUtil from '../../lib/common/util.js';

// 辅助函数：清理配置数据
function cleanConfigData(data, config) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const cleaned = Array.isArray(data) ? [...data] : { ...data };
  const schema = config?.schema;

  if (schema && schema.fields) {
    for (const [field, fieldSchema] of Object.entries(schema.fields)) {
      if (field in cleaned) {
        const value = cleaned[field];
        
        // 对于数字类型字段，将空字符串转换为 null
        if (fieldSchema.type === 'number' && value === '') {
          cleaned[field] = null;
        }
        
        // 递归处理嵌套对象
        if (fieldSchema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
          cleaned[field] = cleanConfigData(value, { schema: { fields: fieldSchema.fields || {} } });
        }
        
        // 递归处理数组中的对象
        if (fieldSchema.type === 'array' && Array.isArray(value) && fieldSchema.itemType === 'object') {
          cleaned[field] = value.map(item => {
            if (item && typeof item === 'object') {
              return cleanConfigData(item, { schema: { fields: fieldSchema.itemSchema?.fields || {} } });
            }
            return item;
          });
        }
      }
    }
  }

  return cleaned;
}

// 统一错误响应格式
function errorResponse(res, status, message, error = null, details = {}) {
  const response = {
    success: false,
    message,
    ...details
  };
  
  if (error) {
    response.error = error.message || String(error);
    if (process.env.NODE_ENV === 'development' && error.stack) {
      response.stack = error.stack;
    }
  }
  
  BotUtil.makeLog('error', `[ConfigAPI] ${message}`, 'ConfigAPI', error);
  return res.status(status).json(response);
}

// 统一成功响应格式
function successResponse(res, data = null, message = '操作成功') {
  const response = {
    success: true,
    message
  };
  
  if (data !== null) {
    if (Array.isArray(data)) {
      response.data = data;
      response.count = data.length;
    } else if (typeof data === 'object') {
      Object.assign(response, data);
    } else {
      response.data = data;
    }
  }
  
  return res.json(response);
}

// 检查 ConfigManager 是否可用
function checkConfigManager() {
  if (!global.ConfigManager) {
    throw new Error('配置管理器未初始化，请稍后重试');
  }
  return global.ConfigManager;
}

export default {
  name: 'config-manager',
  dsc: '配置管理API - 统一的配置文件读写接口',
  priority: 85,

  // 初始化钩子：确保 ConfigManager 已加载
  async init(app, Bot) {
    BotUtil.makeLog('info', '[ConfigAPI] 初始化配置管理API', 'ConfigAPI');
    
    // 验证 ConfigManager 是否可用
    if (!global.ConfigManager) {
      BotUtil.makeLog('warn', '[ConfigAPI] ConfigManager 未初始化，API可能无法正常工作', 'ConfigAPI');
    } else {
      const configCount = global.ConfigManager.configs?.size || 0;
      BotUtil.makeLog('info', `[ConfigAPI] ConfigManager 已就绪，共 ${configCount} 个配置`, 'ConfigAPI');
    }
  },

  routes: [
    {
      method: 'GET',
      path: '/api/config/list',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return errorResponse(res, 403, 'Unauthorized');
        }

        try {
          const configManager = checkConfigManager();
          const configList = configManager.getList();
          
          return successResponse(res, {
            configs: configList,
            count: configList.length
          }, '获取配置列表成功');
        } catch (error) {
          return errorResponse(res, 500, '获取配置列表失败', error);
        }
      }
    },

    {
      method: 'GET',
      path: '/api/config/health',
      handler: async (req, res, Bot) => {
        try {
          const configManager = checkConfigManager();
          const configCount = configManager.configs?.size || 0;
          const loaded = configManager.loaded || false;
          
          return successResponse(res, {
            status: loaded ? 'healthy' : 'initializing',
            configCount,
            loaded,
            timestamp: Date.now()
          }, '配置管理器健康检查');
        } catch (error) {
          return errorResponse(res, 503, '配置管理器不可用', error);
        }
      }
    },

    {
      method: 'GET',
      path: '/api/config/:name/structure',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return errorResponse(res, 403, 'Unauthorized');
        }

        try {
          const { name } = req.params;
          const configManager = checkConfigManager();
          const config = configManager.get(name);

          if (!config) {
            return errorResponse(res, 404, `配置 ${name} 不存在`, null, { configName: name });
          }

          const structure = config.getStructure();
          return successResponse(res, { structure }, '获取配置结构成功');
        } catch (error) {
          return errorResponse(res, 500, '获取配置结构失败', error);
        }
      }
    },

    {
      method: 'GET',
      path: '/api/config/:name/read',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return errorResponse(res, 403, 'Unauthorized');
        }

        let configName = null;
        try {
          configName = req.params?.name;
          const { path: keyPath } = req.query || {};

          if (!configName) {
            return errorResponse(res, 400, '配置名称不能为空');
          }

          const configManager = checkConfigManager();
          const config = configManager.get(configName);

          if (!config) {
            return errorResponse(res, 404, `配置 ${configName} 不存在`, null, { configName });
          }

          let data;
          if (keyPath) {
            // 如果有 keyPath，读取指定路径的配置值
            if (configName === 'system' && typeof config.read === 'function') {
              // SystemConfig 的特殊处理：keyPath 是子配置名称
              data = await config.read(keyPath);
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
              data = await config.read();
            } else if (typeof config.read === 'function') {
              // 普通配置：读取完整配置
              data = await config.read();
            } else {
              throw new Error('配置对象不支持 read 方法');
            }
          }

          return successResponse(res, { data }, '读取配置成功');
        } catch (error) {
          const errorName = configName || 'unknown';
          return errorResponse(res, 500, '读取配置失败', error, { configName: errorName });
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/write',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return errorResponse(res, 403, 'Unauthorized');
        }

        let configName = null;
        try {
          configName = req.params?.name;
          const { data, path: keyPath, backup = true, validate = true } = req.body || {};

          BotUtil.makeLog('info', `[ConfigAPI] 收到配置写入请求 [${configName}] path: ${keyPath || 'none'}`, 'ConfigAPI');

          if (!configName) {
            return errorResponse(res, 400, '配置名称不能为空');
          }

          const configManager = checkConfigManager();
          const config = configManager.get(configName);

          if (!config) {
            return errorResponse(res, 404, `配置 ${configName} 不存在`, null, { configName });
          }

          // 清理数据：将空字符串转换为 null（对于数字字段）
          const cleanedData = cleanConfigData(data, config);

          let result;
          if (keyPath) {
            // 如果有 keyPath，使用 set 方法设置指定路径的值
            if (configName === 'system' && typeof config.write === 'function') {
              // SystemConfig 的特殊处理：keyPath 是子配置名称
              BotUtil.makeLog('info', `[ConfigAPI] 写入 SystemConfig 子配置 [${configName}/${keyPath}]`, 'ConfigAPI');
              result = await config.write(keyPath, cleanedData, { backup, validate });
            } else if (typeof config.set === 'function') {
              BotUtil.makeLog('info', `[ConfigAPI] 使用 set 方法写入配置路径 [${configName}/${keyPath}]`, 'ConfigAPI');
              result = await config.set(keyPath, cleanedData, { backup, validate });
            } else {
              throw new Error('配置对象不支持 set 方法');
            }
          } else {
            // 没有 keyPath，写入完整配置
            if (configName === 'system') {
              throw new Error('SystemConfig 需要指定子配置名称（使用 path 参数）');
            } else if (typeof config.write === 'function') {
              BotUtil.makeLog('info', `[ConfigAPI] 写入完整配置 [${configName}]`, 'ConfigAPI');
              result = await config.write(cleanedData, { backup, validate });
            } else {
              throw new Error('配置对象不支持 write 方法');
            }
          }

          return successResponse(res, { result }, '配置已保存');
        } catch (error) {
          const errorName = configName || req.params?.name || 'unknown';
          return errorResponse(res, 500, '写入配置失败', error, { configName: errorName });
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/merge',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return errorResponse(res, 403, 'Unauthorized');
        }

        try {
          const { name } = req.params;
          const { data, deep = true, backup = true, validate = true } = req.body || {};

          if (!data) {
            return errorResponse(res, 400, '缺少 data 参数');
          }

          const configManager = checkConfigManager();
          const config = configManager.get(name);

          if (!config) {
            return errorResponse(res, 404, `配置 ${name} 不存在`, null, { configName: name });
          }

          const result = await config.merge(data, { deep, backup, validate });
          return successResponse(res, { result }, '配置已合并');
        } catch (error) {
          return errorResponse(res, 500, '合并配置失败', error);
        }
      }
    },

    {
      method: 'DELETE',
      path: '/api/config/:name/delete',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return errorResponse(res, 403, 'Unauthorized');
        }

        try {
          const { name } = req.params;
          const { path: keyPath, backup = true } = req.body || {};

          if (!keyPath) {
            return errorResponse(res, 400, '缺少 path 参数');
          }

          const configManager = checkConfigManager();
          const config = configManager.get(name);

          if (!config) {
            return errorResponse(res, 404, `配置 ${name} 不存在`, null, { configName: name });
          }

          const result = await config.delete(keyPath, { backup });
          return successResponse(res, { result }, '配置已删除');
        } catch (error) {
          return errorResponse(res, 500, '删除配置失败', error);
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/array/append',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return errorResponse(res, 403, 'Unauthorized');
        }

        try {
          const { name } = req.params;
          const { path: keyPath, value, backup = true, validate = true } = req.body || {};

          if (!keyPath) {
            return errorResponse(res, 400, '缺少 path 参数');
          }

          if (value === undefined) {
            return errorResponse(res, 400, '缺少 value 参数');
          }

          const configManager = checkConfigManager();
          const config = configManager.get(name);

          if (!config) {
            return errorResponse(res, 404, `配置 ${name} 不存在`, null, { configName: name });
          }

          const result = await config.append(keyPath, value, { backup, validate });
          return successResponse(res, { result }, '已追加到数组');
        } catch (error) {
          return errorResponse(res, 500, '追加失败', error);
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/array/remove',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return errorResponse(res, 403, 'Unauthorized');
        }

        try {
          const { name } = req.params;
          const { path: keyPath, index, backup = true, validate = true } = req.body || {};

          if (!keyPath) {
            return errorResponse(res, 400, '缺少 path 参数');
          }

          if (index === undefined) {
            return errorResponse(res, 400, '缺少 index 参数');
          }

          const configManager = checkConfigManager();
          const config = configManager.get(name);

          if (!config) {
            return errorResponse(res, 404, `配置 ${name} 不存在`, null, { configName: name });
          }

          const result = await config.remove(keyPath, index, { backup, validate });
          return successResponse(res, { result }, '已从数组移除');
        } catch (error) {
          return errorResponse(res, 500, '移除失败', error);
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/validate',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return errorResponse(res, 403, 'Unauthorized');
        }

        try {
          const { name } = req.params;
          const { data } = req.body || {};

          if (data === undefined) {
            return errorResponse(res, 400, '缺少 data 参数');
          }

          const configManager = checkConfigManager();
          const config = configManager.get(name);

          if (!config) {
            return errorResponse(res, 404, `配置 ${name} 不存在`, null, { configName: name });
          }

          const validation = await config.validate(data);
          return successResponse(res, { validation }, '验证完成');
        } catch (error) {
          return errorResponse(res, 500, '验证失败', error);
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/backup',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return errorResponse(res, 403, 'Unauthorized');
        }

        try {
          const { name } = req.params;
          const configManager = checkConfigManager();
          const config = configManager.get(name);

          if (!config) {
            return errorResponse(res, 404, `配置 ${name} 不存在`, null, { configName: name });
          }

          const backupPath = await config.backup();
          return successResponse(res, { backupPath }, '配置已备份');
        } catch (error) {
          return errorResponse(res, 500, '备份失败', error);
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/reset',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return errorResponse(res, 403, 'Unauthorized');
        }

        try {
          const { name } = req.params;
          const { backup = true } = req.body || {};

          const configManager = checkConfigManager();
          const config = configManager.get(name);

          if (!config) {
            return errorResponse(res, 404, `配置 ${name} 不存在`, null, { configName: name });
          }

          const result = await config.reset({ backup });
          return successResponse(res, { result }, '配置已重置为默认值');
        } catch (error) {
          return errorResponse(res, 500, '重置失败', error);
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/clear-cache',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return errorResponse(res, 403, 'Unauthorized');
        }

        try {
          const configManager = checkConfigManager();
          configManager.clearAllCache();
          return successResponse(res, null, '已清除所有配置缓存');
        } catch (error) {
          return errorResponse(res, 500, '清除缓存失败', error);
        }
      }
    }
  ]
};
