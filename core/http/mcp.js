import BotUtil from '#utils/botutil.js';
import StreamLoader from '#infrastructure/aistream/loader.js';
import { HttpResponse } from '../../src/utils/http-utils.js';

/**
 * MCP HTTP API
 * 提供Model Context Protocol服务，支持外部AI平台（如小智AI、Claude、豆包）连接并调用工具
 * 
 * 功能：
 * - 工具列表查询：GET /api/mcp/tools
 * - 工具调用：POST /api/mcp/tools/call
 * - 工具详情：GET /api/mcp/tools/:name
 * - SSE连接：GET /api/mcp/connect
 * - WebSocket连接：ws://host/mcp/ws
 * - 健康检查：GET /api/mcp/health
 */
export default {
  name: 'mcp',
  dsc: 'MCP服务HTTP接口，支持外部平台连接',
  priority: 100,

  routes: [
    {
      method: 'GET',
      path: '/api/mcp/tools',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
          const mcpServer = StreamLoader.mcpServer;
          if (!mcpServer) {
          return HttpResponse.error(res, new Error('MCP服务未启用'), 503, 'mcp.tools');
          }

          const tools = mcpServer.listTools();
        HttpResponse.success(res, {
            tools,
            count: tools.length
          });
      }, 'mcp.tools')
    },
    {
      method: 'POST',
      path: '/api/mcp/tools/call',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const startTime = Date.now();
          const { name, arguments: args } = req.body;
          
          if (!name) {
          return HttpResponse.validationError(res, '工具名称不能为空');
          }

          const mcpServer = StreamLoader.mcpServer;
          if (!mcpServer) {
          return HttpResponse.error(res, new Error('MCP服务未启用'), 503, 'mcp.tools.call');
          }

          // 验证工具是否存在
          if (!mcpServer.tools.has(name)) {
          return HttpResponse.notFound(res, `工具 "${name}" 不存在`);
          }

          const result = await mcpServer.handleToolCall({ name, arguments: args || {} });
          const duration = Date.now() - startTime;
          
          res.json({
            success: !result.isError,
            ...result,
            metadata: {
              tool: name,
              duration: `${duration}ms`,
              timestamp: Date.now()
            }
          });
      }, 'mcp.tools.call')
    },
    {
      method: 'GET',
      path: '/api/mcp/connect',
      handler: (req, res, Bot) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Accel-Buffering', 'no'); // 禁用Nginx缓冲

        const mcpServer = StreamLoader.mcpServer;
        const toolsCount = mcpServer ? mcpServer.tools.size : 0;

        // 发送初始连接消息
        res.write(`data: ${JSON.stringify({ 
          type: 'connected', 
          message: 'MCP连接已建立',
          timestamp: Date.now(),
          toolsCount
        })}\n\n`);

        // 定期发送心跳
        const heartbeat = setInterval(() => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ 
              type: 'ping', 
              timestamp: Date.now(),
              toolsCount
            })}\n\n`);
          }
        }, 30000);

        // 清理连接
        req.on('close', () => {
          clearInterval(heartbeat);
          if (!res.writableEnded) {
            res.end();
          }
        });

        req.on('error', () => {
          clearInterval(heartbeat);
        });
      }
    },
    {
      method: 'GET',
      path: '/api/mcp/tools/:name',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
          const { name } = req.params;
          const mcpServer = StreamLoader.mcpServer;
          
          if (!mcpServer) {
          return HttpResponse.error(res, new Error('MCP服务未启用'), 503, 'mcp.tool.detail');
          }

          if (!mcpServer.tools.has(name)) {
          return HttpResponse.notFound(res, `工具 "${name}" 不存在`);
          }

          const tool = mcpServer.tools.get(name);
        HttpResponse.success(res, {
            tool: {
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema
            }
          });
      }, 'mcp.tool.detail')
    },
    {
      method: 'GET',
      path: '/api/mcp/health',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
          const mcpServer = StreamLoader.mcpServer;
          const isEnabled = mcpServer !== null;
          
        HttpResponse.success(res, {
            status: isEnabled ? 'healthy' : 'disabled',
            enabled: isEnabled,
            toolsCount: isEnabled ? mcpServer.tools.size : 0,
            timestamp: Date.now()
          });
      }, 'mcp.health')
    }
  ],

  ws: {
    '/mcp/ws': (ws, req, Bot) => {
      BotUtil.makeLog('info', 'MCP WebSocket连接已建立', 'MCPApi');

      // 发送连接确认
      ws.send(JSON.stringify({
        type: 'connected',
        message: 'MCP WebSocket连接已建立'
      }));

      ws.on('message', async (data) => {
        const startTime = Date.now();
        try {
          const message = JSON.parse(data.toString());
          const { type, requestId } = message;
          
          if (type === 'call_tool') {
            const { name, arguments: args } = message;
            const mcpServer = StreamLoader.mcpServer;
            
            if (!mcpServer) {
              ws.send(JSON.stringify({ 
                type: 'error',
                requestId,
                error: 'MCP服务未启用',
                code: 503
              }));
              return;
            }

            if (!mcpServer.tools.has(name)) {
              ws.send(JSON.stringify({
                type: 'error',
                requestId,
                error: '工具未找到',
                code: 404,
                message: `工具 "${name}" 不存在`
              }));
              return;
            }

            const result = await mcpServer.handleToolCall({ name, arguments: args || {} });
            const duration = Date.now() - startTime;
            
            ws.send(JSON.stringify({
              type: 'tool_result',
              requestId,
              result,
              metadata: {
                tool: name,
                duration: `${duration}ms`,
                timestamp: Date.now()
              }
            }));
          } else if (type === 'list_tools') {
            const mcpServer = StreamLoader.mcpServer;
            const tools = mcpServer ? mcpServer.listTools() : [];
            ws.send(JSON.stringify({
              type: 'tools_list',
              requestId,
              tools,
              count: tools.length,
              timestamp: Date.now()
            }));
          } else if (type === 'get_tool') {
            const { name } = message;
            const mcpServer = StreamLoader.mcpServer;
            
            if (!mcpServer || !mcpServer.tools.has(name)) {
              ws.send(JSON.stringify({
                type: 'error',
                requestId,
                error: '工具未找到',
                code: 404
              }));
              return;
            }

            const tool = mcpServer.tools.get(name);
            ws.send(JSON.stringify({
              type: 'tool_info',
              requestId,
              tool: {
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
              }
            }));
          } else if (type === 'ping') {
            ws.send(JSON.stringify({
              type: 'pong',
              requestId,
              timestamp: Date.now()
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              requestId,
              error: '不支持的消息类型',
              code: 400,
              message: `未知的消息类型: ${type}`
            }));
          }
        } catch (error) {
          BotUtil.makeLog('error', `MCP WebSocket消息处理失败: ${error.message}`, 'MCPApi');
          ws.send(JSON.stringify({
            type: 'error',
            requestId: null,
            error: error.message,
            code: 500
          }));
        }
      });

      ws.on('close', () => {
        BotUtil.makeLog('info', 'MCP WebSocket连接已关闭', 'MCPApi');
      });
    }
  }
};
