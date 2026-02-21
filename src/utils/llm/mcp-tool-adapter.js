import StreamLoader from '#infrastructure/aistream/loader.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import BotUtil from '#utils/botutil.js';

/**
 * MCP 工具适配器
 *
 * 职责边界：
 * - 将 StreamLoader 暴露的 MCP 工具转换为 OpenAI tools 数组格式，供各 LLM 工厂在构造请求体时注入
 * - 在收到 OpenAI style tool_calls 时，实际调用 MCP 工具，并返回 role=tool 的消息列表
 * - 基于 streams/allowedTools 做工具白名单过滤：保证"未通过接口声明的工具"不会被调用
 * - 自动合并远程 MCP 工具：无论指定什么工作流，都会自动添加已启用的远程 MCP 工具
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
   * 说明：
   * - streams 白名单优先：只有在 streams 中声明的工作流，其下工具才会被注入
   * - workflow 为单工作流名，仅在未显式提供 streams 时使用
   * - 默认分支会排除 excludeStreams（如 chat），防止基础通用工作流的工具"泄漏"到所有会话
   * - 自动合并远程 MCP：无论指定什么工作流，都会自动添加已启用的远程 MCP 工具
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

    // 自动合并远程 MCP 工具（无论是否指定工作流，都会添加）
    const remoteConfig = getAistreamConfigOptional().mcp?.remote || {};
    if (remoteConfig.enabled && Array.isArray(remoteConfig.servers)) {
      const { selected = [], servers = [] } = remoteConfig;
      const selectedNames = Array.isArray(selected) && selected.length > 0 
        ? new Set(selected.map(s => String(s).trim()).filter(Boolean))
        : null;
      
      const toolMap = new Map(mcpTools.map(t => [t.name, t]));
      
      for (const server of servers) {
        const serverName = String(server.name || '').trim();
        if (!serverName || (selectedNames && !selectedNames.has(serverName))) continue;
        
        const remoteTools = mcpServer.listTools(`remote-mcp.${serverName}`);
        for (const tool of remoteTools) {
          if (!toolMap.has(tool.name)) {
            toolMap.set(tool.name, tool);
          }
        }
      }
      
      mcpTools = Array.from(toolMap.values());
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
   *
   * 权限控制策略：
   * - 若传入 options.allowedTools，则仅允许显式列出的工具被调用
   * - 否则，若传入 options.streams，则会基于 streams 计算允许的工具白名单
   * - 最终，任何不在白名单中的工具调用都会被拒绝，并返回一条失败的 tool 消息
   *
   * @param {Array} toolCalls - OpenAI tool_calls
   * @param {Object} options - 选项
   * @param {Array<string>} options.allowedTools - 允许的工具名称列表（用于权限验证）
   * @param {Array<string>} options.streams - 允许的工作流列表（用于权限验证）
   * @returns {Promise<Array>} tool role messages
   */
  static async handleToolCalls(toolCalls, options = {}) {
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

    // 获取允许的工具列表（用于权限验证）
    let allowedToolNames = null;
    if (options.allowedTools && Array.isArray(options.allowedTools)) {
      allowedToolNames = new Set(options.allowedTools);
    } else if (options.streams && Array.isArray(options.streams)) {
      // 根据streams获取允许的工具
      const allowedTools = this.convertMCPToolsToOpenAI({
        streams: options.streams,
        excludeStreams: []
      });
      allowedToolNames = new Set(allowedTools.map(t => t.function.name));
    }

    const promises = toolCalls.map(async (toolCall, index) => {
      try {
        const functionName = toolCall.function?.name;
        
        // 权限验证：如果指定了允许的工具列表，检查工具是否在允许列表中
        if (allowedToolNames && !allowedToolNames.has(functionName)) {
          BotUtil.makeLog(
            'warn',
            `MCP 工具调用被拒绝（不在白名单）: ${functionName}`,
            'MCPToolAdapter'
          );
          return {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: false,
              error: `工具 "${functionName}" 不在允许的工具列表中`
            })
          };
        }
        
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

        const argPreview = (() => {
          try {
            const s = JSON.stringify(argumentsObj);
            return s.length > 500 ? `${s.slice(0, 500)}...` : s;
          } catch {
            return '[unserializable arguments]';
          }
        })();

        BotUtil.makeLog(
          'info',
          `MCP 工具调用开始: #${index + 1} name=${functionName}, args=${argPreview}`,
          'MCPToolAdapter'
        );

        const result = await mcpServer.handleToolCall({
          name: functionName,
          arguments: argumentsObj
        });

        // 确保 content 始终是字符串，避免出现 undefined 传给 LLM
        let content = result?.content?.[0]?.text;
        if (typeof content !== 'string' || !content.length) {
          try {
            const fallback = result !== undefined && result !== null ? result : { success: true };
            content = JSON.stringify(fallback);
          } catch {
            content = '{"success":false,"error":"MCPToolAdapter: 无法序列化工具返回值"}';
          }
        }

        BotUtil.makeLog(
          'info',
          `MCP 工具调用完成: #${index + 1} name=${functionName}, isError=${Boolean(result.isError)}`,
          'MCPToolAdapter'
        );

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

