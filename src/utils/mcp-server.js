import BotUtil from '#utils/botutil.js';
import os from 'os';

/**
 * Model Context Protocol (MCP) 服务器实现
 * 提供标准化的工具调用接口，支持AI与系统工具之间的通信
 * 
 * 作用：
 * - 统一管理所有工作流的函数，作为MCP工具暴露给外部AI平台
 * - 支持小智AI、Claude、豆包等平台通过HTTP/WebSocket调用工具
 * - 提供标准化的工具注册、调用、错误处理机制
 */
export class MCPServer {
  constructor(streamInstance = null) {
    this.stream = streamInstance;
    this.tools = new Map(); // 注册的工具
    this.resources = new Map(); // 注册的资源
    
    // 注册示例工具（供测试和演示使用）
    this.registerExampleTools();
  }

  /**
   * 注册MCP工具
   * @param {string} name - 工具名称
   * @param {Object} tool - 工具定义
   * @param {string} tool.description - 工具描述
   * @param {Object} tool.inputSchema - 输入参数schema（JSON Schema格式）
   * @param {Function} tool.handler - 工具处理函数
   */
  registerTool(name, tool) {
    this.tools.set(name, {
      name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || {},
      handler: tool.handler
    });
    BotUtil.makeLog('debug', `MCP工具已注册: ${name}`, 'MCPServer');
  }

  /**
   * 注册MCP资源
   * @param {string} uri - 资源URI
   * @param {Object} resource - 资源定义
   */
  registerResource(uri, resource) {
    this.resources.set(uri, resource);
  }

  /**
   * 处理MCP工具调用请求
   * @param {Object} request - MCP请求
   * @param {string} request.name - 工具名称
   * @param {Object} request.arguments - 工具参数
   * @returns {Promise<Object>} MCP响应
   */
  async handleToolCall(request) {
    const { name, arguments: args } = request;

    if (!this.tools.has(name)) {
      return {
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `工具未找到: ${name}`
        },
        isError: true
      };
    }

    const tool = this.tools.get(name);

    try {
      const result = await tool.handler(args || {});
      
      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          }
        ],
        isError: false
      };
    } catch (error) {
      BotUtil.makeLog('error', `MCP工具调用失败[${name}]: ${error.message}`, 'MCPServer');
      
      return {
        error: {
          code: 'TOOL_EXECUTION_ERROR',
          message: error.message
        },
        isError: true
      };
    }
  }

  /**
   * 获取所有可用工具列表
   * @returns {Array} 工具列表
   */
  listTools() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
  }

  /**
   * 注册示例工具（供测试和演示使用）
   */
  registerExampleTools() {
    // 示例工具1：获取系统信息
    this.registerTool('get_system_info', {
      description: '获取系统信息（操作系统、CPU、内存等）',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async (args) => {
        return {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          cpuCount: os.cpus().length,
          totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
          freeMemory: `${Math.round(os.freemem() / 1024 / 1024 / 1024)}GB`,
          uptime: `${Math.round(os.uptime() / 3600)}小时`,
          hostname: os.hostname()
        };
      }
    });

    // 示例工具2：计算数学表达式
    this.registerTool('calculate', {
      description: '计算数学表达式（支持基本运算）',
      inputSchema: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '要计算的数学表达式，例如: "2 + 2" 或 "10 * 5"'
          }
        },
        required: ['expression']
      },
      handler: async (args) => {
        const { expression } = args;
        if (!expression) {
          throw new Error('表达式不能为空');
        }

        // 安全计算：只允许基本数学运算
        const safeExpression = expression.replace(/[^0-9+\-*/().\s]/g, '');
        try {
          // 使用Function构造器进行安全计算
          const result = Function(`"use strict"; return (${safeExpression})`)();
          return {
            expression,
            result,
            formatted: `${expression} = ${result}`
          };
        } catch (error) {
          throw new Error(`计算失败: ${error.message}`);
        }
      }
    });

    // 示例工具3：文本处理
    this.registerTool('text_process', {
      description: '文本处理工具（统计字数、转换大小写等）',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '要处理的文本'
          },
          operation: {
            type: 'string',
            enum: ['count', 'uppercase', 'lowercase', 'reverse'],
            description: '操作类型: count(统计字数), uppercase(转大写), lowercase(转小写), reverse(反转)'
          }
        },
        required: ['text', 'operation']
      },
      handler: async (args) => {
        const { text, operation } = args;
        if (!text) {
          throw new Error('文本不能为空');
        }

        switch (operation) {
          case 'count':
            return {
              text,
              operation: 'count',
              result: {
                length: text.length,
                words: text.split(/\s+/).filter(w => w).length,
                lines: text.split('\n').length
              }
            };
          case 'uppercase':
            return {
              text,
              operation: 'uppercase',
              result: text.toUpperCase()
            };
          case 'lowercase':
            return {
              text,
              operation: 'lowercase',
              result: text.toLowerCase()
            };
          case 'reverse':
            return {
              text,
              operation: 'reverse',
              result: text.split('').reverse().join('')
            };
          default:
            throw new Error(`不支持的操作: ${operation}`);
        }
      }
    });

    // 示例工具4：时间工具
    this.registerTool('get_time', {
      description: '获取当前时间信息',
      inputSchema: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['iso', 'locale', 'timestamp'],
            description: '时间格式: iso(ISO格式), locale(本地格式), timestamp(时间戳)'
          },
          timezone: {
            type: 'string',
            description: '时区（可选，例如: Asia/Shanghai）'
          }
        },
        required: []
      },
      handler: async (args) => {
        const { format = 'locale', timezone } = args;
        const now = new Date();

        switch (format) {
          case 'iso':
            return {
              format: 'iso',
              time: now.toISOString(),
              timestamp: now.getTime()
            };
          case 'timestamp':
            return {
              format: 'timestamp',
              timestamp: now.getTime(),
              seconds: Math.floor(now.getTime() / 1000)
            };
          case 'locale':
          default:
            return {
              format: 'locale',
              time: now.toLocaleString('zh-CN', timezone ? { timeZone: timezone } : {}),
              date: now.toLocaleDateString('zh-CN'),
              timeOnly: now.toLocaleTimeString('zh-CN'),
              timestamp: now.getTime()
            };
        }
      }
    });

    BotUtil.makeLog('info', `已注册${this.tools.size}个MCP示例工具`, 'MCPServer');
  }
}

