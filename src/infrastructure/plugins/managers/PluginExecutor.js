import lodash from 'lodash';
import cfg from '#infrastructure/config/config.js';

const EVENT_MAP = {
  message: ['post_type', 'message_type', 'sub_type'],
  notice: ['post_type', 'notice_type', 'sub_type'],
  request: ['post_type', 'request_type', 'sub_type'],
  device: ['post_type', 'event_type', 'sub_type']
};

/**
 * 插件执行器
 * 负责插件的规则匹配、上下文处理和执行。
 */
class PluginExecutor {

  /**
   * 运行插件
   * @param {Object} e - 事件对象
   * @param {Object} context - 包含插件列表的上下文
   * @param {boolean} isExtended - 是否为扩展插件
   * @returns {Promise<boolean>}
   */
  async runPlugins(e, context, isExtended = false) {
    const { priority, extended, defaultMsgHandlers, parseMessage } = context;
    try {
      const plugins = await this.initPlugins(e, isExtended ? extended : priority);

      if (isExtended) {
        return await this.processPlugins(plugins, e, defaultMsgHandlers, true);
      }

      for (const plugin of plugins) {
        if (plugin?.accept) {
          try {
            const res = await plugin.accept(e);

            if (e._needReparse) {
              delete e._needReparse;
              if (typeof parseMessage === 'function') {
                await parseMessage(e);
              }
            }

            if (res === 'return') return true;
            if (res) break;
          } catch (error) {
            logger.error(`插件 ${plugin.name} accept错误`, error);
          }
        }
      }

      if (!e.isDevice && !e.isStdin) {
        if (await this.handleContext(plugins, e)) return true;
      }

      return await this.processPlugins(plugins, e, defaultMsgHandlers, false);
    } catch (error) {
      logger.error('运行插件错误', error);
      return false;
    }
  }

  /**
   * 初始化插件列表
   * @param {Object} e - 事件对象
   * @param {Array} pluginList - 插件列表
   * @returns {Promise<Array>}
   */
  async initPlugins(e, pluginList) {
    const activePlugins = [];
    for (const p of pluginList) {
      if (!p?.class) continue;
      try {
        const plugin = new p.class(e);
        plugin.e = e;
        plugin.bypassThrottle = p.bypassThrottle;
        plugin.priority = typeof p.execPriority === 'number' ? p.execPriority : plugin.priority;
        plugin.rule = this.cloneRules(p.rules);

        if (this.checkDisable(plugin) && this.filtEvent(e, plugin)) {
          activePlugins.push(plugin);
        }
      } catch (error) {
        logger.error(`初始化插件 ${p.name} 失败`, error);
      }
    }
    return activePlugins;
  }

  /**
   * 处理插件执行
   * @param {Array} plugins - 插件列表
   * @param {Object} e - 事件对象
   * @param {Array} defaultMsgHandlers - 默认消息处理器
   * @param {boolean} isExtended - 是否为扩展插件
   * @returns {Promise<boolean>}
   */
  async processPlugins(plugins, e, defaultMsgHandlers, isExtended) {
    if (!Array.isArray(plugins) || !plugins.length) {
        return isExtended ? false : await this.processDefaultHandlers(e, defaultMsgHandlers);
    }

    if (isExtended) {
      return await this.processRules(plugins, e);
    }

    const pluginsByPriority = lodash.groupBy(plugins, 'priority');
    const priorities = Object.keys(pluginsByPriority).map(Number).sort((a, b) => a - b);

    for (const priority of priorities) {
      const priorityPlugins = pluginsByPriority[priority];
      if (!Array.isArray(priorityPlugins)) continue;
      const handled = await this.processRules(priorityPlugins, e);
      if (handled) return true;
    }

    return await this.processDefaultHandlers(e, defaultMsgHandlers);
  }

  /**
   * 处理插件规则
   * @param {Array} plugins - 插件列表
   * @param {Object} e - 事件对象
   * @returns {Promise<boolean>}
   */
  async processRules(plugins, e) {
    for (const plugin of plugins) {
      if (!plugin?.rule) continue;
      for (const v of plugin.rule) {
        if (v.event && !this.filtEvent(e, v)) continue;
        if (v.reg && e.msg !== undefined && !v.reg.test(e.msg)) continue;

        e.logFnc = `[${plugin.name}][${v.fnc}]`;
        if (v.log !== false) {
          logger.info(`${e.logFnc}${e.logText} ${lodash.truncate(e.msg || '', { length: 100 })}`);
        }

        if (!this.filtPermission(e, v)) return true;

        try {
          const start = Date.now();
          if (typeof plugin[v.fnc] === 'function') {
            const res = await plugin[v.fnc](e);
            if (res !== false) {
              if (v.log !== false) {
                logger.mark(`${e.logFnc}${e.logText} 处理完成 ${Date.now() - start}ms`);
              }
              return true;
            }
          }
        } catch (error) {
          logger.error(`${e.logFnc} 执行错误`, error);
        }
      }
    }
    return false;
  }

  /**
   * 处理默认消息处理器
   * @param {Object} e - 事件对象
   * @param {Array} defaultMsgHandlers - 默认消息处理器
   * @returns {Promise<boolean>}
   */
  async processDefaultHandlers(e, defaultMsgHandlers) {
    if (e.isDevice || e.isStdin) return false;
    for (const handler of defaultMsgHandlers) {
      try {
        const plugin = new handler.class(e);
        plugin.e = e;
        if (typeof plugin.handleNonMatchMsg === 'function') {
          const res = await plugin.handleNonMatchMsg(e);
          if (res === 'return' || res) return true;
        }
      } catch (error) {
        logger.error(`默认消息处理器 ${handler.name} 执行错误`, error);
      }
    }
    return false;
  }

  /**
   * 处理上下文
   * @param {Array} plugins - 插件列表
   * @param {Object} e - 事件对象
   * @returns {Promise<boolean>}
   */
  async handleContext(plugins, e) {
    if (!Array.isArray(plugins)) return false;
    for (const plugin of plugins) {
      if (!plugin?.getContext) continue;
      const contexts = { ...plugin.getContext(), ...plugin.getContext(false, true) };
      if (!lodash.isEmpty(contexts)) {
        for (const fnc in contexts) {
          if (typeof plugin[fnc] === 'function') {
            try {
              const ret = await plugin[fnc](contexts[fnc]);
              if (ret !== 'continue' && ret !== false) return true;
            } catch (error) {
              logger.error(`上下文方法 ${fnc} 执行错误`, error);
            }
          }
        }
      }
    }
    return false;
  }

  /**
   * 过滤事件
   * @param {Object} e - 事件对象
   * @param {Object} v - 规则对象
   * @returns {boolean}
   */
  filtEvent(e, v) {
    if (!v.event) return true;
    const event = v.event.split('.');
    const postType = e.post_type || '';
    const eventMap = EVENT_MAP[postType] || [];
    const newEvent = event.map((val, i) => {
      if (val === '*') return val;
      const mapKey = eventMap[i];
      return mapKey && e[mapKey] ? e[mapKey] : '';
    });
    return v.event === newEvent.join('.');
  }

  /**
   * 过滤权限
   * @param {Object} e - 事件对象
   * @param {Object} v - 规则对象
   * @returns {boolean}
   */
  filtPermission(e, v) {
    if (e.isDevice || e.isStdin) return true;
    if (!v.permission || v.permission === 'all' || e.isMaster) return true;

    const permissionMap = {
      master: { check: () => false, msg: '暂无权限，只有主人才能操作' },
      owner: { check: () => e.member?.is_owner === true, msg: '暂无权限，只有群主才能操作' },
      admin: { check: () => e.member?.is_owner === true || e.member?.is_admin === true, msg: '暂无权限，只有管理员才能操作' }
    };

    const perm = permissionMap[v.permission];
    if (!perm || !e.isGroup) return true;

    if (!perm.check()) {
      e.reply(perm.msg);
      return false;
    }
    return true;
  }

  /**
   * 检查插件禁用状态
   * @param {Object} p - 插件对象
   * @returns {boolean}
   */
  checkDisable(p) {
    if (!p) return false;

    if (p.e && (p.e.isDevice || p.e.isStdin)) {
      const other = cfg.getOther();
      if (!other) return true;
      const { disableDevice = [], enableDevice = [] } = other;
      if (disableDevice.includes(p.name)) return false;
      if (enableDevice.length > 0 && !enableDevice.includes(p.name)) return false;
      return true;
    }

    if (!p.e?.group_id) return true;
    const groupCfg = cfg.getGroup(p.e.group_id);
    if (!groupCfg) return true;
    const { disable = [], enable = [] } = groupCfg;
    if (disable.includes(p.name)) return false;
    if (enable.length > 0 && !enable.includes(p.name)) return false;
    return true;
  }

  /**
   * 创建正则表达式
   * @param {string|RegExp} pattern - 正则模式
   * @returns {RegExp|boolean}
   */
  createRegExp(pattern) {
    if (pattern instanceof RegExp) return pattern;

    const buildRegExp = (source, flags = '') => {
      try {
        return new RegExp(source, flags);
      } catch (error) {
        logger.error(`正则表达式创建失败: ${source}`, error);
        return false;
      }
    };

    if (pattern && typeof pattern === 'object') {
      const source = pattern.source || pattern.pattern || pattern.reg;
      if (typeof source === 'string') {
        return buildRegExp(source, pattern.flags || '');
      }
    }

    if (pattern === '' || pattern === null || pattern === undefined) return /.*/;

    const str = String(pattern).trim();
    if (!str) return /.*/;

    const literalMatch = str.match(/^\/(.+)\/([a-z]*)$/i);
    if (literalMatch) {
      return buildRegExp(literalMatch[1], literalMatch[2]);
    }

    return buildRegExp(str);
  }

  cloneRules(rules) {
    if (!Array.isArray(rules)) return [];
    return rules.map(rule => {
      if (!rule) return null;
      const cloned = { ...rule };
      if (rule.reg instanceof RegExp) {
        cloned.reg = new RegExp(rule.reg.source, rule.reg.flags);
      }
      return cloned;
    }).filter(Boolean);
  }
}

export default new PluginExecutor();

