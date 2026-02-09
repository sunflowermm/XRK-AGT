import BotUtil from './botutil.js';
import chalk from 'chalk';

/**
 * 错误类型枚举
 */
export const ErrorCodes = {
  // 工作流错误 (1000-1999)
  WORKFLOW_EXECUTION_FAILED: 1001,
  WORKFLOW_NOT_FOUND: 1002,
  WORKFLOW_ALREADY_RUNNING: 1003,
  WORKFLOW_MAX_ITERATIONS: 1004,
  
  // 插件错误 (2000-2999)
  PLUGIN_LOAD_FAILED: 2001,
  PLUGIN_EXECUTION_FAILED: 2002,
  PLUGIN_NOT_FOUND: 2003,
  
  // 输入验证错误 (3000-3999)
  INVALID_INPUT: 3001,
  INVALID_PATH: 3002,
  INVALID_COMMAND: 3003,
  PATH_TRAVERSAL: 3004,
  INPUT_VALIDATION_FAILED: 3005,
  
  // 系统错误 (4000-4999)
  SYSTEM_ERROR: 4001,
  MEMORY_ERROR: 4002,
  NETWORK_ERROR: 4003,
  NOT_FOUND: 4004,
  
  // 配置错误 (5000-5999)
  CONFIG_ERROR: 5001,
  CONFIG_NOT_FOUND: 5002
};

/**
 * 统一错误处理类
 * 提供标准化的错误处理、分类和恢复机制
 */
export class BotError extends Error {
  constructor(message, code = ErrorCodes.SYSTEM_ERROR, context = {}) {
    super(message);
    this.name = 'BotError';
    this.code = code;
    this.context = context;
    this.timestamp = Date.now();
    Error.captureStackTrace?.(this, BotError);
  }

  /**
   * 从普通错误创建BotError
   */
  static fromError(error, code = ErrorCodes.SYSTEM_ERROR, context = {}) {
    if (error instanceof BotError) {
      return error;
    }
    
    const botError = new BotError(
      error.message || '未知错误',
      code,
      { ...context, original: error }
    );
    
    if (error.stack) botError.stack = error.stack;
    
    return botError;
  }

  /**
   * 判断错误是否可恢复
   */
  isRecoverable() {
    const recoverableCodes = [
      ErrorCodes.NETWORK_ERROR,
      ErrorCodes.WORKFLOW_MAX_ITERATIONS
    ];
    return recoverableCodes.includes(this.code);
  }

  /**
   * 获取错误严重程度
   * @returns {'low'|'medium'|'high'|'critical'}
   */
  getSeverity() {
    if (this.code >= 4000) return 'critical';
    if (this.code >= 3000) return 'high';
    if (this.code >= 2000) return 'medium';
    return 'low';
  }

  /**
   * 转换为可序列化的对象
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
      severity: this.getSeverity(),
      recoverable: this.isRecoverable()
    };
  }
}

/**
 * 错误处理器
 * 统一处理、记录和恢复错误
 */
export class ErrorHandler {
  constructor() {
    this.errorStats = new Map();
    this.recoveryStrategies = new Map();
  }

  /**
   * 处理错误
   * @param {Error|BotError} error - 错误对象
   * @param {Object} context - 上下文信息
   * @param {boolean} shouldLog - 是否记录日志
   */
  handle(error, context = {}, shouldLog = true) {
    const botError = BotError.fromError(error, error.code, {
      ...context,
      ...error.context
    });

    // 记录错误统计
    this.recordError(botError);

    // 记录日志
    if (shouldLog) {
      this.logError(botError);
    }

    // 尝试恢复
    if (botError.isRecoverable()) {
      return this.attemptRecovery(botError);
    }

    return botError;
  }

  /**
   * 记录错误统计
   */
  recordError(error) {
    const key = `${error.code}`;
    const stats = this.errorStats.get(key) || {
      count: 0,
      firstOccurrence: Date.now(),
      lastOccurrence: Date.now(),
      contexts: []
    };
    
    stats.count++;
    stats.lastOccurrence = Date.now();
    if (stats.contexts.length < 10) {
      stats.contexts.push({
        message: error.message,
        timestamp: error.timestamp,
        context: error.context
      });
    }
    
    this.errorStats.set(key, stats);
  }

  /**
   * 记录错误日志
   */
  logError(error) {
    const severity = error.getSeverity();
    const level = ['critical', 'high'].includes(severity) ? 'error' : 
                  severity === 'medium' ? 'warn' : 'info';
    
    const logMessage = `[${error.code}] ${error.message}`;
    const contextStr = Object.keys(error.context).length > 0 
      ? `\n上下文: ${JSON.stringify(error.context, null, 2)}`
      : '';
    
    BotUtil.makeLog(level, chalk.red(`✗ ${logMessage}${contextStr}`), 'ErrorHandler');
    
    if (severity === 'critical' && error.stack) {
      BotUtil.makeLog('debug', chalk.gray(error.stack), 'ErrorHandler');
    }
  }

  /**
   * 尝试恢复错误
   */
  attemptRecovery(error) {
    const strategy = this.recoveryStrategies.get(error.code);
    if (typeof strategy === 'function') {
      try {
        return strategy(error);
      } catch (recoveryError) {
        BotUtil.makeLog('error', 
          `恢复策略执行失败: ${recoveryError.message}`, 
          'ErrorHandler'
        );
      }
    }
  }

  /**
   * 注册恢复策略
   */
  registerRecoveryStrategy(code, strategy) {
    this.recoveryStrategies.set(code, strategy);
  }

  /**
   * 获取错误统计报告
   */
  getErrorReport() {
    const report = {
      totalErrors: 0,
      byCode: {},
      bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
      topErrors: []
    };

    const getSeverityByCode = (code) => {
      const numCode = Number(code);
      if (numCode >= 4000) return 'critical';
      if (numCode >= 3000) return 'high';
      if (numCode >= 2000) return 'medium';
      return 'low';
    };

    for (const [code, stats] of this.errorStats.entries()) {
      report.totalErrors += stats.count;
      report.byCode[code] = stats;
      report.bySeverity[getSeverityByCode(code)] += stats.count;
    }

    // 获取最常见的错误
    report.topErrors = Array.from(this.errorStats.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([code, stats]) => ({ code, ...stats }));

    return report;
  }

  /**
   * 清理错误统计
   */
  clearStats() {
    this.errorStats.clear();
  }
}

// 全局错误处理器实例
export const errorHandler = new ErrorHandler();

