import StreamLoader from '#infrastructure/aistream/loader.js';

/**
 * MCP 工具适配器
 * - 将 MCP 工具转换为 OpenAI tools 数组格式
 * - 处理 OpenAI tool_calls 响应：调用 MCP 工具并返回 role=tool 的消息列表
 */
export class MCPToolAdapter {
  /**
   * 获取 MCP 服务器实例
   * @returns {*}
   */
  static getMCPServer() {
    return StreamLoader.mcpServer;
  }

  /**
   * 将 MCP 工具转换为 OpenAI 格式的 tools 数组
   *
   * @param {Object} options
   * @param {string|null} options.workflow - 单个工作流名称；若提供则仅注入该工作流下的工具
   * @param {Array<string>} [options.streams] - 白名单工作流列表；优先级高于 workflow
   * @param {Array<string>} [options.excludeStreams] - 黑名单工作流列表（如 ['chat']）
   * @returns {Array} OpenAI tools
   */
  static convertMCPToolsToOpenAI(options = {}) {
    const {
      workflow = null,
      streams = null,
      excludeStreams = ['chat']
    } = options || {};

    const mcpServer = this.getMCPServer();
    if (!mcpServer) return [];

    let mcpTools;

    // 1. 若显式传入 streams 白名单，则只保留这些前缀的工具
    if (Array.isArray(streams) && streams.length > 0) {
      // 明确指定多个工作流时：分别调用 listTools(stream) 再合并，避免受全局过滤影响
      const uniq = new Map();
      for (const s of streams.filter(Boolean)) {
        const toolsOfStream = mcpServer.listTools(s);
        for (const tool of toolsOfStream) {
          if (!uniq.has(tool.name)) {
            uniq.set(tool.name, tool);
          }
        }
      }
      mcpTools = Array.from(uniq.values());
    } else if (workflow) {
      // 2. 若指定单一 workflow，则直接用 listTools(workflow)
      mcpTools = mcpServer.listTools(workflow);
    } else {
      // 3. 默认：所有工具，但排除黑名单工作流（如 chat）
      const all = mcpServer.listTools();
      const excludes = new Set((excludeStreams || []).filter(Boolean));
      mcpTools = all.filter(tool => {
        const prefix = String(tool.name).split('.')[0];
        return !excludes.has(prefix);
      });
    }

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
   * 将 JSON Schema 转换为 OpenAI function.parameters 定义
   * @param {Object} schema - JSON Schema
   * @returns {Object} OpenAI schema
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

        if (prop.enum) result.properties[key].enum = prop.enum;
        if (prop.default !== undefined) result.properties[key].default = prop.default;
      }
    }

    return result;
  }

  /**
   * 处理 tool_calls：并行调用 MCP 工具并返回 tool 角色消息
   * @param {Array} toolCalls - OpenAI tool_calls
   * @returns {Promise<Array>} tool role messages
   */
  static async handleToolCalls(toolCalls) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return [];

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

    const promises = toolCalls.map(async (toolCall) => {
      try {
        const functionName = toolCall.function?.name;
        let argumentsObj = {};

        if (toolCall.function?.arguments) {
          try {
            argumentsObj = typeof toolCall.function.arguments === 'string'
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments;
          } catch {
            argumentsObj = { raw: toolCall.function.arguments };
          }
        }

        const result = await mcpServer.handleToolCall({
          name: functionName,
          arguments: argumentsObj
        });

        const content = result.content?.[0]?.text || JSON.stringify(result);
        return {
          role: 'tool',
          tool_call_id: toolCall.id,
          content
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
   * 是否有可用 MCP 工具
   * @returns {boolean}
   */
  static hasTools() {
    const mcpServer = this.getMCPServer();
    return Boolean(mcpServer && mcpServer.tools && mcpServer.tools.size > 0);
  }
}

