/**
 * 配置管理API
 * 提供统一的配置文件读写接口
 */
export default {
  name: 'config-manager',
  dsc: '配置管理API - 统一的配置文件读写接口',
  priority: 85,

  routes: [
    {
      method: 'GET',
      path: '/api/config/list',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

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
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

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

    {
      method: 'GET',
      path: '/api/config/:name/read',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        try {
          const { name } = req.params;
          const { path: keyPath } = req.query;

          const config = global.ConfigManager.get(name);

          if (!config) {
            return res.status(404).json({
              success: false,
              message: `配置 ${name} 不存在`
            });
          }

          let data;
          if (keyPath) {
            data = await config.get(keyPath);
          } else {
            data = await config.read();
          }

          res.json({
            success: true,
            data
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: '读取配置失败',
            error: error.message
          });
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/write',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        try {
          const { name } = req.params;
          const { data, path: keyPath, backup = true, validate = true } = req.body;

          const config = global.ConfigManager.get(name);

          if (!config) {
            return res.status(404).json({
              success: false,
              message: `配置 ${name} 不存在`
            });
          }

          let result;
          if (keyPath) {
            result = await config.set(keyPath, data, { backup, validate });
          } else {
            result = await config.write(data, { backup, validate });
          }

          res.json({
            success: result,
            message: '配置已保存'
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: '写入配置失败',
            error: error.message
          });
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/merge',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        try {
          const { name } = req.params;
          const { data, deep = true, backup = true, validate = true } = req.body;

          const config = global.ConfigManager.get(name);

          if (!config) {
            return res.status(404).json({
              success: false,
              message: `配置 ${name} 不存在`
            });
          }

          const result = await config.merge(data, { deep, backup, validate });

          res.json({
            success: result,
            message: '配置已合并'
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: '合并配置失败',
            error: error.message
          });
        }
      }
    },

    {
      method: 'DELETE',
      path: '/api/config/:name/delete',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        try {
          const { name } = req.params;
          const { path: keyPath, backup = true } = req.body;

          if (!keyPath) {
            return res.status(400).json({
              success: false,
              message: '缺少path参数'
            });
          }

          const config = global.ConfigManager.get(name);

          if (!config) {
            return res.status(404).json({
              success: false,
              message: `配置 ${name} 不存在`
            });
          }

          const result = await config.delete(keyPath, { backup });

          res.json({
            success: result,
            message: '配置已删除'
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: '删除配置失败',
            error: error.message
          });
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/array/append',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        try {
          const { name } = req.params;
          const { path: keyPath, value, backup = true, validate = true } = req.body;

          if (!keyPath) {
            return res.status(400).json({
              success: false,
              message: '缺少path参数'
            });
          }

          const config = global.ConfigManager.get(name);

          if (!config) {
            return res.status(404).json({
              success: false,
              message: `配置 ${name} 不存在`
            });
          }

          const result = await config.append(keyPath, value, { backup, validate });

          res.json({
            success: result,
            message: '已追加到数组'
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: '追加失败',
            error: error.message
          });
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/array/remove',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        try {
          const { name } = req.params;
          const { path: keyPath, index, backup = true, validate = true } = req.body;

          if (!keyPath) {
            return res.status(400).json({
              success: false,
              message: '缺少path参数'
            });
          }

          if (index === undefined) {
            return res.status(400).json({
              success: false,
              message: '缺少index参数'
            });
          }

          const config = global.ConfigManager.get(name);

          if (!config) {
            return res.status(404).json({
              success: false,
              message: `配置 ${name} 不存在`
            });
          }

          const result = await config.remove(keyPath, index, { backup, validate });

          res.json({
            success: result,
            message: '已从数组移除'
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: '移除失败',
            error: error.message
          });
        }
      }
    },

    {
      method: 'POST',
      path: '/api/config/:name/validate',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

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
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

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
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

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
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

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