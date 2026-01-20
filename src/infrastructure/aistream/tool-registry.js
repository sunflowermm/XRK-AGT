/**
 * Tool Registry - 工具注册服务
 * 统一管理所有工具，支持工具注册、发现、调用、权限控制
 */
import BotUtil from '#utils/botutil.js';
import EventEmitter from 'events';

export class ToolRegistry extends EventEmitter {
  constructor() {
    super();
    this.tools = new Map(); // toolName -> Tool定义
    this.toolCategories = new Map(); // category -> Tool列表
    this.toolPermissions = new Map(); // toolName -> 权限配置
    this.toolStats = new Map(); // toolName -> 使用统计
  }

  /**
   * 注册工具
   * @param {string} name - 工具名称
   * @param {Object} tool - 工具定义
   * @param {string} tool.description - 工具描述
   * @param {Object} tool.schema - 参数Schema（JSON Schema）
   * @param {Function} tool.handler - 工具处理函数
   * @param {string} tool.category - 工具分类
   * @param {Object} tool.permissions - 权限配置
   */
  registerTool(name, tool) {
    if (this.tools.has(name)) {
      BotUtil.makeLog('warn', `工具 ${name} 已存在，将被覆盖`, 'ToolRegistry');
    }

    const toolDef = {
      name,
      description: tool.description || '',
      schema: tool.schema || {},
      handler: tool.handler,
      category: tool.category || 'general',
      permissions: tool.permissions || { public: true },
      enabled: tool.enabled !== false,
      version: tool.version || '1.0.0',
      author: tool.author || 'unknown'
    };

    this.tools.set(name, toolDef);

    // 分类管理
    if (!this.toolCategories.has(toolDef.category)) {
      this.toolCategories.set(toolDef.category, []);
    }
    this.toolCategories.get(toolDef.category).push(name);

    // 权限管理
    this.toolPermissions.set(name, toolDef.permissions);

    // 统计初始化
    this.toolStats.set(name, {
      callCount: 0,
      successCount: 0,
      errorCount: 0,
      totalDuration: 0,
      lastCalled: null
    });

    this.emit('tool:registered', { name, tool: toolDef });
    // 工具注册日志已移除，避免冗余输出
  }

  /**
   * 批量注册工具
   * @param {Array} tools - 工具列表
   */
  registerTools(tools) {
    for (const tool of tools) {
      this.registerTool(tool.name, tool);
    }
  }

  /**
   * 获取工具
   * @param {string} name - 工具名称
   * @returns {Object|null}
   */
  getTool(name) {
    return this.tools.get(name) || null;
  }

  /**
   * 获取所有工具
   * @param {Object} filters - 过滤条件
   * @param {string} filters.category - 分类过滤
   * @param {boolean} filters.enabled - 是否启用
   * @returns {Array}
   */
  getAllTools(filters = {}) {
    let tools = Array.from(this.tools.values());

    if (filters.category) {
      tools = tools.filter(t => t.category === filters.category);
    }

    if (filters.enabled !== undefined) {
      tools = tools.filter(t => t.enabled === filters.enabled);
    }

    return tools;
  }

  /**
   * 按分类获取工具
   * @param {string} category - 分类名称
   * @returns {Array}
   */
  getToolsByCategory(category) {
    const toolNames = this.toolCategories.get(category) || [];
    return toolNames.map(name => this.tools.get(name)).filter(Boolean);
  }

  /**
   * 调用工具
   * @param {string} name - 工具名称
   * @param {Object} args - 参数
   * @param {Object} context - 上下文（包含用户信息等）
   * @returns {Promise<Object>}
   */
  async callTool(name, args = {}, context = {}) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`工具 ${name} 不存在`);
    }

    if (!tool.enabled) {
      throw new Error(`工具 ${name} 已禁用`);
    }

    // 权限检查
    if (!this.checkPermission(name, context)) {
      throw new Error(`无权限调用工具 ${name}`);
    }

    const startTime = Date.now();
    const stats = this.toolStats.get(name);

    try {
      const result = await tool.handler(args, context);
      const duration = Date.now() - startTime;

      // 更新统计
      stats.callCount++;
      stats.successCount++;
      stats.totalDuration += duration;
      stats.lastCalled = Date.now();

      this.emit('tool:called', { name, args, result, duration, success: true });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // 更新统计
      stats.callCount++;
      stats.errorCount++;
      stats.totalDuration += duration;
      stats.lastCalled = Date.now();

      this.emit('tool:called', { name, args, error, duration, success: false });
      throw error;
    }
  }

  /**
   * 检查权限
   * @param {string} name - 工具名称
   * @param {Object} context - 上下文
   * @returns {boolean}
   */
  checkPermission(name, context) {
    const permissions = this.toolPermissions.get(name);
    if (!permissions) return false;

    // 公开工具
    if (permissions.public) return true;

    // 检查用户角色
    const userRole = context.userRole || 'user';
    if (permissions.roles && permissions.roles.includes(userRole)) {
      return true;
    }

    // 检查用户ID白名单
    const userId = context.userId;
    if (permissions.whitelist && permissions.whitelist.includes(userId)) {
      return true;
    }

    return false;
  }

  /**
   * 启用/禁用工具
   * @param {string} name - 工具名称
   * @param {boolean} enabled - 是否启用
   */
  setToolEnabled(name, enabled) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`工具 ${name} 不存在`);
    }

    tool.enabled = enabled;
    this.emit('tool:enabled_changed', { name, enabled });
    BotUtil.makeLog('info', `工具 ${enabled ? '启用' : '禁用'}: ${name}`, 'ToolRegistry');
  }

  /**
   * 获取工具统计
   * @param {string} name - 工具名称（可选）
   * @returns {Object}
   */
  getToolStats(name = null) {
    if (name) {
      return this.toolStats.get(name) || null;
    }

    return {
      total: this.tools.size,
      byCategory: Array.from(this.toolCategories.keys()).reduce((acc, cat) => {
        acc[cat] = this.toolCategories.get(cat).length;
        return acc;
      }, {}),
      topUsed: Array.from(this.toolStats.entries())
        .sort((a, b) => b[1].callCount - a[1].callCount)
        .slice(0, 10)
        .map(([name, stats]) => ({ name, ...stats }))
    };
  }

  /**
   * 验证工具参数
   * @param {string} name - 工具名称
   * @param {Object} args - 参数
   * @returns {boolean}
   */
  validateToolArgs(name, args) {
    const tool = this.tools.get(name);
    if (!tool) return false;

    // 简单的参数验证（实际应该使用JSON Schema验证）
    const schema = tool.schema;
    if (!schema || !schema.properties) return true;

    for (const [key, prop] of Object.entries(schema.properties)) {
      if (prop.required && args[key] === undefined) {
        return false;
      }
    }

    return true;
  }
}

export default new ToolRegistry();
