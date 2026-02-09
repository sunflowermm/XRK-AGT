import { errorHandler, ErrorCodes } from './error-handler.js'

/**
 * HTTP响应工具类
 * 统一HTTP响应格式，减少重复代码
 */
export class HttpResponse {
  /**
   * 成功响应
   * @param {Object} res - Express响应对象
   * @param {*} data - 响应数据
   * @param {string} message - 响应消息
   * @returns {Object} Express响应
   */
  static success(res, data = null, message = '操作成功') {
    const response = { success: true, message }
    if (data !== null) {
      if (typeof data === 'object' && !Array.isArray(data)) {
        Object.assign(response, data)
      } else {
        response.data = data
      }
    }
    return res.json(response)
  }

  /**
   * 错误响应
   * @param {Object} res - Express响应对象
   * @param {Error} error - 错误对象
   * @param {number} statusCode - HTTP状态码
   * @param {string} context - 错误上下文
   * @returns {Object} Express响应
   */
  static error(res, error, statusCode = 500, context = '') {
    const botError = errorHandler.handle(
      error,
      { context, code: ErrorCodes.SYSTEM_ERROR },
      false
    )
    return res.status(statusCode).json({
      success: false,
      message: botError.message,
      code: botError.code
    })
  }

  /**
   * 验证错误响应
   * @param {Object} res - Express响应对象
   * @param {string} message - 错误消息
   * @param {string} code - 错误码
   * @returns {Object} Express响应
   */
  static validationError(res, message, code = ErrorCodes.INPUT_VALIDATION_FAILED) {
    return res.status(400).json({
      success: false,
      message,
      code
    })
  }

  /**
   * 未找到响应
   * @param {Object} res - Express响应对象
   * @param {string} message - 错误消息
   * @returns {Object} Express响应
   */
  static notFound(res, message = '资源未找到') {
    return res.status(404).json({
      success: false,
      message,
      code: ErrorCodes.NOT_FOUND
    })
  }

  /**
   * 未授权响应
   * @param {Object} res - Express响应对象
   * @param {string} message - 错误消息
   * @returns {Object} Express响应
   */
  static unauthorized(res, message = '未授权') {
    return res.status(401).json({
      success: false,
      message,
      code: 'UNAUTHORIZED'
    })
  }

  /**
   * 禁止访问响应
   * @param {Object} res - Express响应对象
   * @param {string} message - 错误消息
   * @returns {Object} Express响应
   */
  static forbidden(res, message = '禁止访问') {
    return res.status(403).json({
      success: false,
      message,
      code: 'FORBIDDEN'
    })
  }

  /**
   * 异步处理器包装器
   * 自动捕获错误并返回统一格式
   * @param {Function} handler - 异步处理函数
   * @param {string} context - 错误上下文
   * @returns {Function} 包装后的处理函数
   */
  static asyncHandler(handler, context = '') {
    return async (req, res, ...args) => {
      try {
        await handler(req, res, ...args)
      } catch (error) {
        this.error(res, error, 500, context)
      }
    }
  }

  /**
   * 流式响应（SSE）
   * @param {Object} res - Express响应对象
   * @param {Function} streamHandler - 流处理函数
   * @param {string} context - 错误上下文
   */
  static async streamResponse(res, streamHandler, context = '') {
    try {
      // SSE 头
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.setHeader('Access-Control-Allow-Origin', '*')

      await streamHandler(res)
    } catch (error) {
      // 发送错误消息
      res.write(`data: ${JSON.stringify({ 
        success: false, 
        message: error.message,
        code: error.code || ErrorCodes.SYSTEM_ERROR
      })}\n\n`)
      res.end()
      
      errorHandler.handle(error, { context, code: ErrorCodes.SYSTEM_ERROR })
    }
  }

  /**
   * JSON-RPC 2.0 错误响应（MCP标准）
   * @param {Object} res - Express响应对象
   * @param {number|string} id - 请求ID
   * @param {number} code - JSON-RPC错误码
   * @param {string} message - 错误消息
   * @param {*} data - 错误数据（可选）
   * @param {number} httpStatusCode - HTTP状态码
   */
  static jsonRpcError(res, id, code, message, data = null, httpStatusCode = 200) {
    const response = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message
      }
    }
    
    if (data !== null) {
      response.error.data = data
    }
    
    return res.status(httpStatusCode).json(response)
  }

  /**
   * JSON-RPC 2.0 成功响应（MCP标准）
   * @param {Object} res - Express响应对象
   * @param {number|string} id - 请求ID
   * @param {*} result - 结果数据
   */
  static jsonRpcSuccess(res, id, result) {
    return res.json({
      jsonrpc: '2.0',
      id,
      result
    })
  }

  /**
   * 验证JSON-RPC请求格式
   * @param {Object} request - JSON-RPC请求
   * @returns {Object|null} 错误对象，如果验证通过则返回null
   */
  static validateJsonRpcRequest(request) {
    if (!request || typeof request !== 'object') {
      return {
        code: -32600,
        message: 'Invalid Request: request must be an object'
      }
    }

    if (request.jsonrpc !== '2.0') {
      return {
        code: -32600,
        message: 'Invalid Request: jsonrpc must be "2.0"'
      }
    }

    if (typeof request.method !== 'string') {
      return {
        code: -32600,
        message: 'Invalid Request: method is required and must be a string'
      }
    }

    return null
  }
}

