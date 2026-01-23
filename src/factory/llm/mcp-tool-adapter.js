import StreamLoader from '#infrastructure/aistream/loader.js';

/**
 * MCP工具适配器
 * 将MCP工具转换为OpenAI格式的tools数组，并处理tool_calls响应
 */
export class MCPToolAdapter {
  /**
   * 获取MCP服务器实例
   */
  static getMCPServer() {
    return StreamLoader.mcpServer;
  }

  /**
   * 将MCP工具转换为OpenAI格式的tools数组
   * @returns {Array} OpenAI格式的工具列表
   */
  static convertMCPToolsToOpenAI() {
    const mcpServer = this.getMCPServer();
    if (!mcpServer) {
      return [];
    }

    const mcpTools = mcpServer.listTools();
    return mcpTools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: this.convertSchemaToOpenAI(tool.inputSchema || {})
      }
    }));
  }

  /**
   * 将JSON Schema转换为OpenAI格式的参数定义
   * @param {Object} schema - JSON Schema格式
   * @returns {Object} OpenAI格式的参数定义
   */
  static convertSchemaToOpenAI(schema) {
    if (!schema || typeof schema !== 'object') {
      return { type: 'object', properties: {}, required: [] };
    }

    const result = {
      type: schema.type || 'object',
      properties: {},
      required: schema.required || []
    };

    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        result.properties[key] = {
          type: prop.type || 'string',
          description: prop.description || ''
        };

        // 处理枚举类型
        if (prop.enum) {
          result.properties[key].enum = prop.enum;
        }

        // 处理默认值
        if (prop.default !== undefined) {
          result.properties[key].default = prop.default;
        }
      }
    }

    return result;
  }

  /**
   * 处理tool_calls响应，调用MCP工具并返回结果
   * @param {Array} toolCalls - 工具调用列表（OpenAI格式）
   * @returns {Promise<Array>} 工具调用结果消息列表
   */
  static async handleToolCalls(toolCalls) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return [];
    }

    const mcpServer = this.getMCPServer();
    if (!mcpServer) {
      return toolCalls.map(tc => ({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify({ 
          success: false, 
          error: 'MCP服务未启用' 
        })
      }));
    }

    // 并行调用所有工具
    const promises = toolCalls.map(async (toolCall) => {
      try {
        const functionName = toolCall.function?.name;
        let argumentsObj = {};

        // 解析arguments（可能是JSON字符串）
        if (toolCall.function?.arguments) {
          try {
            argumentsObj = typeof toolCall.function.arguments === 'string'
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments;
          } catch (e) {
            // 如果解析失败，使用原始值
            argumentsObj = { raw: toolCall.function.arguments };
          }
        }

        // 调用MCP工具
        const result = await mcpServer.handleToolCall({
          name: functionName,
          arguments: argumentsObj
        });

        // 格式化响应
        const content = result.content?.[0]?.text || JSON.stringify(result);
        
        return {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: content
        };
      } catch (error) {
        return {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            success: false,
            error: error.message || String(error)
          })
        };
      }
    });

    return await Promise.all(promises);
  }

  /**
   * 检查是否有可用的MCP工具
   * @returns {boolean}
   */
  static hasTools() {
    const mcpServer = this.getMCPServer();
    return mcpServer && mcpServer.tools && mcpServer.tools.size > 0;
  }
}
