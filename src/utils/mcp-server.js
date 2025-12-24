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
    
    // 注册跨平台通用工具
    this.registerCoreTools();
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
   * 注册跨平台通用核心工具
   * 这些工具在所有平台上都可用，提供基础功能
   */
  registerCoreTools() {
    // 工具1：系统信息（跨平台）
    this.registerTool('system.info', {
      description: '获取系统信息（操作系统、CPU、内存、平台等）',
      inputSchema: {
        type: 'object',
        properties: {
          detail: {
            type: 'boolean',
            description: '是否返回详细信息（默认false）',
            default: false
          }
        },
        required: []
      },
      handler: async (args) => {
        const { detail = false } = args;
        const memUsage = process.memoryUsage();
        const cpuInfo = os.cpus();
        
        const info = {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          hostname: os.hostname(),
          cpu: {
            cores: cpuInfo.length,
            model: cpuInfo[0]?.model || 'Unknown'
          },
          memory: {
            total: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
            free: `${Math.round(os.freemem() / 1024 / 1024 / 1024)}GB`,
            used: `${Math.round((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024)}GB`,
            usage: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
          },
          uptime: {
            seconds: Math.round(os.uptime()),
            hours: Math.round(os.uptime() / 3600),
            days: Math.round(os.uptime() / 86400)
          }
        };
        
        if (detail) {
          info.processMemory = {
            rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
          };
          info.networkInterfaces = Object.keys(os.networkInterfaces()).length;
        }
        
        return info;
      }
    });

    // 工具2：时间工具（跨平台）
    this.registerTool('time.now', {
      description: '获取当前时间信息（支持多种格式和时区）',
      inputSchema: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['iso', 'locale', 'timestamp', 'unix'],
            description: '时间格式: iso(ISO 8601), locale(本地格式), timestamp(毫秒时间戳), unix(秒时间戳)',
            default: 'locale'
          },
          timezone: {
            type: 'string',
            description: '时区（可选，例如: Asia/Shanghai, America/New_York）'
          }
        },
        required: []
      },
      handler: async (args) => {
        const { format = 'locale', timezone } = args;
        const now = new Date();
        const options = timezone ? { timeZone: timezone } : {};

        switch (format) {
          case 'iso':
            return {
              format: 'iso',
              time: now.toISOString(),
              timestamp: now.getTime(),
              unix: Math.floor(now.getTime() / 1000)
            };
          case 'timestamp':
            return {
              format: 'timestamp',
              timestamp: now.getTime(),
              unix: Math.floor(now.getTime() / 1000),
              iso: now.toISOString()
            };
          case 'unix':
            return {
              format: 'unix',
              unix: Math.floor(now.getTime() / 1000),
              timestamp: now.getTime(),
              iso: now.toISOString()
            };
          case 'locale':
          default:
            return {
              format: 'locale',
              time: now.toLocaleString('zh-CN', options),
              date: now.toLocaleDateString('zh-CN', options),
              timeOnly: now.toLocaleTimeString('zh-CN', options),
              timestamp: now.getTime(),
              unix: Math.floor(now.getTime() / 1000),
              iso: now.toISOString()
            };
        }
      }
    });

    // 工具3：UUID生成（跨平台）
    this.registerTool('util.uuid', {
      description: '生成UUID（通用唯一标识符）',
      inputSchema: {
        type: 'object',
        properties: {
          version: {
            type: 'string',
            enum: ['v4'],
            description: 'UUID版本: v4(随机UUID)',
            default: 'v4'
          },
          count: {
            type: 'integer',
            description: '生成数量（1-100）',
            minimum: 1,
            maximum: 100,
            default: 1
          }
        },
        required: []
      },
      handler: async (args) => {
        const { version = 'v4', count = 1 } = args;
        const crypto = await import('crypto');
        
        const generateUUID = () => {
          // 使用crypto.randomUUID() (Node.js 14.17.0+)
          if (crypto.randomUUID) {
            return crypto.randomUUID();
          }
          // 降级方案：手动生成v4 UUID
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
        };
        
        const uuids = [];
        for (let i = 0; i < Math.min(count, 100); i++) {
          uuids.push(generateUUID());
        }
        
        return {
          version,
          count: uuids.length,
          uuids: count === 1 ? uuids[0] : uuids
        };
      }
    });

    // 工具4：哈希计算（跨平台）
    this.registerTool('util.hash', {
      description: '计算字符串或数据的哈希值（支持多种算法）',
      inputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'string',
            description: '要计算哈希的数据'
          },
          algorithm: {
            type: 'string',
            enum: ['md5', 'sha1', 'sha256', 'sha512'],
            description: '哈希算法',
            default: 'sha256'
          }
        },
        required: ['data']
      },
      handler: async (args) => {
        const { data, algorithm = 'sha256' } = args;
        if (!data) {
          throw new Error('数据不能为空');
        }

        const crypto = await import('crypto');
        const hash = crypto.createHash(algorithm);
        hash.update(data);
        
        return {
          algorithm,
          hash: hash.digest('hex'),
          length: hash.digest('hex').length
        };
      }
    });

    BotUtil.makeLog('info', `已注册${this.tools.size}个MCP核心工具`, 'MCPServer');
  }
}

