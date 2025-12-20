import BotUtil from '#utils/botutil.js';
import StreamLoader from '#infrastructure/aistream/loader.js';

/**
 * MCP HTTP API
 * 提供Model Context Protocol服务，支持外部AI平台（如小智AI、Claude、豆包）连接并调用工具
 * 
 * 功能：
 * - 工具列表查询：GET /api/mcp/tools
 * - 工具调用：POST /api/mcp/tools/call
 * - SSE连接：GET /api/mcp/connect
 * - WebSocket连接：ws://host/mcp/ws
 */
export default {
  name: 'mcp',
  dsc: 'MCP服务HTTP接口，支持外部平台连接',
  priority: 100,

  routes: [
    {
      method: 'GET',
      path: '/api/mcp/tools',
      handler: async (req, res, Bot) => {
        try {
          const mcpServer = StreamLoader.mcpServer;
          if (!mcpServer) {
            return res.status(503).json({ 
              success: false,
              error: 'MCP服务未启用',
              code: 503
            });
          }

          const tools = mcpServer.listTools();
          res.json({ 
            success: true,
            tools,
            count: tools.length
          });
        } catch (error) {
          BotUtil.makeLog('error', `获取MCP工具列表失败: ${error.message}`, 'MCPApi');
          res.status(500).json({ 
            success: false,
            error: error.message,
            code: 500
          });
        }
      }
    },
    {
      method: 'POST',
      path: '/api/mcp/tools/call',
      handler: async (req, res, Bot) => {
        try {
          const { name, arguments: args } = req.body;
          
          if (!name) {
            return res.status(400).json({ 
              success: false,
              error: '工具名称不能为空',
              code: 400
            });
          }

          const mcpServer = StreamLoader.mcpServer;
          if (!mcpServer) {
            return res.status(503).json({ 
              success: false,
              error: 'MCP服务未启用',
              code: 503
            });
          }

          const result = await mcpServer.handleToolCall({ name, arguments: args || {} });
          res.json({
            success: !result.isError,
            ...result
          });
        } catch (error) {
          BotUtil.makeLog('error', `MCP工具调用失败: ${error.message}`, 'MCPApi');
          res.status(500).json({ 
            success: false,
            error: error.message,
            code: 500
          });
        }
      }
    },
    {
      method: 'GET',
      path: '/api/mcp/connect',
      handler: (req, res, Bot) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // 发送初始连接消息
        res.write(`data: ${JSON.stringify({ type: 'connected', message: 'MCP连接已建立' })}\n\n`);

        // 定期发送心跳
        const heartbeat = setInterval(() => {
          res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: Date.now() })}\n\n`);
        }, 30000);

        // 清理连接
        req.on('close', () => {
          clearInterval(heartbeat);
          res.end();
        });
      }
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
        try {
          const message = JSON.parse(data.toString());
          
          if (message.type === 'call_tool') {
            const { name, arguments: args } = message;
            const mcpServer = StreamLoader.mcpServer;
            
            if (!mcpServer) {
              ws.send(JSON.stringify({ 
                type: 'error', 
                message: 'MCP服务未启用' 
              }));
              return;
            }

            const result = await mcpServer.handleToolCall({ name, arguments: args || {} });
            ws.send(JSON.stringify({
              type: 'tool_result',
              requestId: message.requestId,
              result
            }));
          } else if (message.type === 'list_tools') {
            const mcpServer = StreamLoader.mcpServer;
            const tools = mcpServer ? mcpServer.listTools() : [];
            ws.send(JSON.stringify({
              type: 'tools_list',
              tools
            }));
          }
        } catch (error) {
          BotUtil.makeLog('error', `MCP WebSocket消息处理失败: ${error.message}`, 'MCPApi');
          ws.send(JSON.stringify({
            type: 'error',
            message: error.message
          }));
        }
      });

      ws.on('close', () => {
        BotUtil.makeLog('info', 'MCP WebSocket连接已关闭', 'MCPApi');
      });
    }
  }
};
