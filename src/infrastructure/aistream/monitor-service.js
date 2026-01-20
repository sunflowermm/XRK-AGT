/**
 * Monitor Service - 监控服务
 * 负责Agent执行追踪、性能指标、错误追踪、成本分析等
 */
import BotUtil from '#utils/botutil.js';
import EventEmitter from 'events';

export class MonitorService extends EventEmitter {
  constructor() {
    super();
    this.executionTraces = new Map(); // traceId -> 执行追踪
    this.performanceMetrics = new Map(); // metricName -> 指标数据
    this.errorLogs = []; // 错误日志
    this.costStats = new Map(); // 成本统计
    this.maxTraces = 10000; // 最大追踪数
    this.maxErrors = 1000; // 最大错误数
  }

  /**
   * 开始执行追踪
   * @param {string} traceId - 追踪ID
   * @param {Object} context - 上下文
   * @returns {string} traceId
   */
  startTrace(traceId, context = {}) {
    const trace = {
      id: traceId,
      agentId: context.agentId,
      workflow: context.workflow,
      userId: context.userId,
      startTime: Date.now(),
      endTime: null,
      steps: [],
      toolsCalled: [],
      errors: [],
      tokensUsed: {
        input: 0,
        output: 0,
        total: 0
      },
      cost: 0,
      status: 'running'
    };

    this.executionTraces.set(traceId, trace);

    // 限制大小
    if (this.executionTraces.size > this.maxTraces) {
      const oldestTrace = Array.from(this.executionTraces.values())
        .sort((a, b) => a.startTime - b.startTime)[0];
      this.executionTraces.delete(oldestTrace.id);
    }

    this.emit('trace:started', { traceId, trace });
    return traceId;
  }

  /**
   * 添加执行步骤
   * @param {string} traceId - 追踪ID
   * @param {Object} step - 步骤信息
   */
  addStep(traceId, step) {
    const trace = this.executionTraces.get(traceId);
    if (!trace) return;

    trace.steps.push({
      ...step,
      timestamp: Date.now()
    });
  }

  /**
   * 记录工具调用
   * @param {string} traceId - 追踪ID
   * @param {Object} toolCall - 工具调用信息
   */
  recordToolCall(traceId, toolCall) {
    const trace = this.executionTraces.get(traceId);
    if (!trace) return;

    trace.toolsCalled.push({
      ...toolCall,
      timestamp: Date.now()
    });
  }

  /**
   * 记录Token使用
   * @param {string} traceId - 追踪ID
   * @param {Object} tokens - Token信息
   */
  recordTokens(traceId, tokens) {
    const trace = this.executionTraces.get(traceId);
    if (!trace) return;

    trace.tokensUsed.input += tokens.input || 0;
    trace.tokensUsed.output += tokens.output || 0;
    trace.tokensUsed.total += (tokens.input || 0) + (tokens.output || 0);
  }

  /**
   * 记录成本
   * @param {string} traceId - 追踪ID
   * @param {number} cost - 成本（元）
   */
  recordCost(traceId, cost) {
    const trace = this.executionTraces.get(traceId);
    if (!trace) return;

    trace.cost += cost;

    // 更新成本统计
    const date = new Date().toISOString().split('T')[0];
    const key = `${trace.agentId || 'unknown'}_${date}`;
    if (!this.costStats.has(key)) {
      this.costStats.set(key, { agentId: trace.agentId, date, total: 0 });
    }
    this.costStats.get(key).total += cost;
  }

  /**
   * 记录错误
   * @param {string} traceId - 追踪ID
   * @param {Error} error - 错误对象
   */
  recordError(traceId, error) {
    const trace = this.executionTraces.get(traceId);
    if (trace) {
      trace.errors.push({
        message: error.message,
        stack: error.stack,
        timestamp: Date.now()
      });
    }

    // 添加到错误日志
    this.errorLogs.push({
      traceId,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      timestamp: Date.now()
    });

    // 限制大小
    if (this.errorLogs.length > this.maxErrors) {
      this.errorLogs.shift();
    }

    this.emit('error:recorded', { traceId, error });
  }

  /**
   * 结束执行追踪
   * @param {string} traceId - 追踪ID
   * @param {Object} result - 结果
   */
  endTrace(traceId, result = {}) {
    const trace = this.executionTraces.get(traceId);
    if (!trace) return;

    trace.endTime = Date.now();
    trace.duration = trace.endTime - trace.startTime;
    trace.status = result.success !== false ? 'completed' : 'failed';
    trace.result = result;

    this.emit('trace:ended', { traceId, trace });
  }

  /**
   * 获取执行追踪
   * @param {string} traceId - 追踪ID
   * @returns {Object|null}
   */
  getTrace(traceId) {
    return this.executionTraces.get(traceId) || null;
  }

  /**
   * 获取Agent的执行追踪
   * @param {string} agentId - Agent ID
   * @param {number} limit - 限制条数
   * @returns {Array}
   */
  getAgentTraces(agentId, limit = 10) {
    return Array.from(this.executionTraces.values())
      .filter(t => t.agentId === agentId)
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit);
  }

  /**
   * 记录性能指标
   * @param {string} name - 指标名称
   * @param {number} value - 指标值
   * @param {Object} tags - 标签
   */
  recordMetric(name, value, tags = {}) {
    if (!this.performanceMetrics.has(name)) {
      this.performanceMetrics.set(name, []);
    }

    const metrics = this.performanceMetrics.get(name);
    metrics.push({
      value,
      tags,
      timestamp: Date.now()
    });

    // 限制大小
    if (metrics.length > 1000) {
      metrics.shift();
    }
  }

  /**
   * 获取性能指标
   * @param {string} name - 指标名称
   * @param {Object} filters - 过滤条件
   * @returns {Object}
   */
  getMetrics(name, filters = {}) {
    const metrics = this.performanceMetrics.get(name) || [];
    let filtered = metrics;

    if (filters.startTime) {
      filtered = filtered.filter(m => m.timestamp >= filters.startTime);
    }
    if (filters.endTime) {
      filtered = filtered.filter(m => m.timestamp <= filters.endTime);
    }

    if (filtered.length === 0) {
      return { count: 0, avg: 0, min: 0, max: 0 };
    }

    const values = filtered.map(m => m.value);
    return {
      count: values.length,
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      values
    };
  }

  /**
   * 获取错误统计
   * @param {Object} filters - 过滤条件
   * @returns {Object}
   */
  getErrorStats(filters = {}) {
    let errors = this.errorLogs;

    if (filters.startTime) {
      errors = errors.filter(e => e.timestamp >= filters.startTime);
    }
    if (filters.endTime) {
      errors = errors.filter(e => e.timestamp <= filters.endTime);
    }

    const byType = {};
    for (const error of errors) {
      const type = error.error.name || 'Unknown';
      byType[type] = (byType[type] || 0) + 1;
    }

    return {
      total: errors.length,
      byType,
      recent: errors.slice(-10)
    };
  }

  /**
   * 获取成本统计
   * @param {string} agentId - Agent ID（可选）
   * @param {string} date - 日期（可选）
   * @returns {Object}
   */
  getCostStats(agentId = null, date = null) {
    let stats = Array.from(this.costStats.values());

    if (agentId) {
      stats = stats.filter(s => s.agentId === agentId);
    }
    if (date) {
      stats = stats.filter(s => s.date === date);
    }

    const total = stats.reduce((sum, s) => sum + s.total, 0);
    const byAgent = {};
    const byDate = {};

    for (const stat of stats) {
      byAgent[stat.agentId] = (byAgent[stat.agentId] || 0) + stat.total;
      byDate[stat.date] = (byDate[stat.date] || 0) + stat.total;
    }

    return {
      total,
      byAgent,
      byDate,
      records: stats
    };
  }

  /**
   * 获取全局统计
   * @returns {Object}
   */
  getGlobalStats() {
    const traces = Array.from(this.executionTraces.values());
    const completed = traces.filter(t => t.status === 'completed');
    const failed = traces.filter(t => t.status === 'failed');

    return {
      traces: {
        total: traces.length,
        completed: completed.length,
        failed: failed.length,
        running: traces.filter(t => t.status === 'running').length
      },
      performance: {
        avgDuration: completed.length > 0
          ? completed.reduce((sum, t) => sum + (t.duration || 0), 0) / completed.length
          : 0
      },
      costs: this.getCostStats(),
      errors: this.getErrorStats()
    };
  }
}

export default new MonitorService();
