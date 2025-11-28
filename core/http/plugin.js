import PluginsLoader from '../../src/infrastructure/plugins/loader.js';

function collectPluginEntries() {
  const priorityPlugins = PluginsLoader.priority || [];
  const extendedPlugins = PluginsLoader.extended || [];
  const allPlugins = [...priorityPlugins, ...extendedPlugins];
  const plugins = [];

  for (const entry of allPlugins) {
    try {
      const instance = new entry.class();
      plugins.push({
        key: entry.key,
        name: instance.name || entry.key,
        priority: entry.priority,
        dsc: instance.dsc || '暂无描述',
        rule: instance.rule?.length || 0,
        task: instance.task ? 1 : 0
      });
    } catch (error) {
      logger?.error?.(`[Plugin API] 初始化插件失败: ${entry.key}`, error);
    }
  }

  return plugins;
}

function buildPluginStats(plugins = []) {
  const stats = PluginsLoader.pluginLoadStats || {};
  const extendedPlugins = PluginsLoader.extended || [];
  const taskList = PluginsLoader.task || [];

  return {
    totalPlugins: plugins.length,
    totalLoadTime: stats.totalLoadTime || 0,
    startTime: stats.startTime || 0,
    taskCount: taskList.length,
    extendedCount: extendedPlugins.length,
    withRules: plugins.filter(p => (p.rule || 0) > 0).length,
    withTasks: plugins.filter(p => p.task > 0).length,
    plugins: stats.plugins || []
  };
}

/**
 * 插件管理API
 * 提供插件列表查询、重载、任务管理等功能
 */
export default {
  name: 'plugin',
  dsc: '插件管理API',
  priority: 80,

  routes: [
    {
      method: 'GET',
      path: '/api/plugins',
      handler: async (req, res, Bot) => {
        const plugins = collectPluginEntries();
        res.json({ success: true, plugins });
      }
    },

    {
      method: 'GET',
      path: '/api/plugins/summary',
      handler: async (req, res) => {
        const plugins = collectPluginEntries();
        const summary = buildPluginStats(plugins);
        res.json({ success: true, summary, plugins });
      }
    },

    {
      method: 'POST',
      path: '/api/plugin/:key/reload',
      handler: async (req, res, Bot) => {
        try {
          const { key } = req.params;
          if (!key) {
            return res.status(400).json({ 
              success: false, 
              message: '缺少插件key参数' 
            });
          }

          await PluginsLoader.changePlugin(decodeURIComponent(key));
          
          res.json({ success: true, message: '插件重载成功' });
        } catch (error) {
          res.status(500).json({ 
            success: false, 
            message: '插件重载失败',
            error: error.message 
          });
        }
      }
    },

    {
      method: 'GET',
      path: '/api/plugins/tasks',
      handler: async (req, res, Bot) => {
        const taskList = PluginsLoader.task || [];
        const tasks = taskList.map(t => ({
          name: t.name,
          cron: t.cron,
          nextRun: t.job?.nextInvocation ? t.job.nextInvocation() : null
        }));

        res.json({ success: true, tasks });
      }
    },

    {
      method: 'GET',
      path: '/api/plugins/stats',
      handler: async (req, res, Bot) => {
        const plugins = collectPluginEntries();
        res.json({
          success: true,
          stats: buildPluginStats(plugins)
        });
      }
    }
  ]
};