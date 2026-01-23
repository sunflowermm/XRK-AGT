import path from 'path';
import { BotError, ErrorCodes } from './error-handler.js';

/**
 * 输入验证器
 * 提供统一的输入验证和安全检查
 */
export class InputValidator {
  /**
   * 验证文件路径
   * 防止路径遍历攻击
   */
  static validatePath(filePath, baseDir = process.cwd()) {
    if (!filePath || typeof filePath !== 'string') {
      throw new BotError('路径必须是字符串', ErrorCodes.INVALID_INPUT);
    }

    // 规范化路径
    const normalized = path.normalize(filePath);
    
    // 防止路径遍历攻击
    if (normalized.includes('..') || path.isAbsolute(normalized)) {
      throw new BotError(
        `无效的路径: ${filePath} (检测到路径遍历尝试)`,
        ErrorCodes.PATH_TRAVERSAL
      );
    }

    // 检查是否在基础目录内
    const resolved = path.resolve(baseDir, normalized);
    const baseResolved = path.resolve(baseDir);
    
    if (!resolved.startsWith(baseResolved)) {
      throw new BotError(
        `路径超出允许范围: ${filePath}`,
        ErrorCodes.INVALID_PATH
      );
    }

    return normalized;
  }

  /**
   * 验证命令
   * 防止执行危险命令
   */
  static validateCommand(command) {
    if (!command || typeof command !== 'string') {
      throw new BotError('命令必须是字符串', ErrorCodes.INVALID_INPUT);
    }

    const dangerousPatterns = [
      /rm\s+-rf/i,
      /format\s+/i,
      /del\s+\/f/i,
      /rmdir\s+\/s/i,
      /mkfs/i,
      /dd\s+if=/i,
      />\s*\/dev/i,
      /\|\s*sh\s*$/i,
      /\|\s*bash\s*$/i
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        throw new BotError(
          `禁止执行危险命令: ${command}`,
          ErrorCodes.INVALID_COMMAND
        );
      }
    }

    return command.trim();
  }

  /**
   * 验证用户ID
   */
  static validateUserId(userId) {
    if (!userId) {
      throw new BotError('用户ID不能为空', ErrorCodes.INVALID_INPUT);
    }

    const idStr = String(userId);
    if (!/^\d+$/.test(idStr)) {
      throw new BotError(`无效的用户ID格式: ${userId}`, ErrorCodes.INVALID_INPUT);
    }

    return idStr;
  }

  /**
   * 验证端口号
   */
  static validatePort(port) {
    const portNum = parseInt(port, 10);
    
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      throw new BotError(
        `无效的端口号: ${port} (范围: 1-65535)`,
        ErrorCodes.INVALID_INPUT
      );
    }

    return portNum;
  }

  /**
   * 验证URL
   */
  static validateUrl(url) {
    if (!url || typeof url !== 'string') {
      throw new BotError('URL必须是字符串', ErrorCodes.INVALID_INPUT);
    }

    try {
      const urlObj = new URL(url);
      
      // 只允许 http 和 https
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new BotError(
          `不支持的协议: ${urlObj.protocol}`,
          ErrorCodes.INVALID_INPUT
        );
      }

      return url;
    } catch (error) {
      if (error instanceof BotError) throw error;
      throw new BotError(`无效的URL格式: ${url}`, ErrorCodes.INVALID_INPUT);
    }
  }

  /**
   * 验证JSON字符串
   */
  static validateJson(jsonString) {
    if (!jsonString || typeof jsonString !== 'string') {
      throw new BotError('JSON必须是字符串', ErrorCodes.INVALID_INPUT);
    }

    try {
      return JSON.parse(jsonString);
    } catch (error) {
      throw new BotError(
        `无效的JSON格式: ${error.message}`,
        ErrorCodes.INVALID_INPUT
      );
    }
  }


  /**
   * 清理和验证文本输入
   */
  static sanitizeText(text, maxLength = 10000) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    // 移除控制字符（保留换行和制表符）
    let sanitized = text.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
    
    // 限制长度
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength) + '...(已截断)';
    }

    return sanitized.trim();
  }

  /**
   * 验证API密钥
   */
  static validateApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new BotError('API密钥必须是字符串', ErrorCodes.INVALID_INPUT);
    }

    if (apiKey.length < 16 || apiKey.length > 256) {
      throw new BotError(
        'API密钥长度必须在16-256字符之间',
        ErrorCodes.INVALID_INPUT
      );
    }

    return apiKey;
  }
}

