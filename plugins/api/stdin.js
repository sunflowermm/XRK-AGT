import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 标准输入API
 * 提供命令执行和事件触发功能
 */
export default {
  name: 'stdin-api',
  dsc: '标准输入API接口',
  priority: 85,

  routes: [
    {
      method: 'GET',
      path: '/api/stdin/status',
      handler: async (req, res, Bot) => {
        const stdinHandler = global.stdinHandler;
        
        if (!stdinHandler) {
          return res.status(503).json({
            success: false,
            code: 503,
            message: 'Stdin handler not initialized'
          });
        }

        const tempDir = path.join(process.cwd(), "www/stdin");
        const mediaDir = path.join(process.cwd(), "www/media");
        
        res.json({
          success: true,
          code: 200,
          data: {
            bot_id: 'stdin',
            status: 'online',
            uptime: process.uptime(),
            temp_files: fs.existsSync(tempDir) ? fs.readdirSync(tempDir).length : 0,
            media_files: fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir).length : 0,
            base_url: Bot.getServerUrl ? Bot.getServerUrl() : `http://localhost:${Bot.httpPort || 3000}`,
            timestamp: Date.now()
          }
        });
      }
    },

    {
      method: 'POST',
      path: '/api/stdin/command',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ 
            success: false, 
            code: 403,
            message: 'Unauthorized' 
          });
        }

        const stdinHandler = global.stdinHandler;
        
        if (!stdinHandler) {
          return res.status(503).json({
            success: false,
            code: 503,
            message: 'Stdin handler not initialized'
          });
        }

        try {
          const { command, user_info = {} } = req.body;
          
          if (!command) {
            return res.status(400).json({
              success: false,
              code: 400,
              message: 'Command is required'
            });
          }

          user_info.adapter = 'api';
          const result = await stdinHandler.processCommand(command, user_info);
          res.json(result);
        } catch (error) {
          res.status(500).json({
            success: false,
            code: 500,
            error: error.message,
            timestamp: Date.now()
          });
        }
      }
    },

    {
      method: 'POST',
      path: '/api/stdin/event',
      handler: async (req, res, Bot) => {
        if (!Bot.checkApiAuthorization(req)) {
          return res.status(403).json({ 
            success: false, 
            code: 403,
            message: 'Unauthorized' 
          });
        }

        const stdinHandler = global.stdinHandler;
        
        if (!stdinHandler) {
          return res.status(503).json({
            success: false,
            code: 503,
            message: 'Stdin handler not initialized'
          });
        }

        try {
          const { event_type = 'message', content, user_info = {} } = req.body;
          
          user_info.adapter = 'api';
          
          const event = stdinHandler.createEvent(content, {
            ...user_info,
            post_type: event_type
          });

          Bot.em(event_type, event);

          res.json({
            success: true,
            code: 200,
            message: 'Event triggered',
            event_id: event.message_id,
            timestamp: Date.now()
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            code: 500,
            error: error.message,
            timestamp: Date.now()
          });
        }
      }
    }
  ],

  // WebSocket处理器
  ws: {
    stdin: [(conn, req, Bot) => {
      const listener = (data) => {
        conn.sendMsg(JSON.stringify({
          type: 'stdin',
          data,
          timestamp: Date.now()
        }));
      };

      Bot.on('stdin.command', listener);
      Bot.on('stdin.output', listener);

      conn.on('close', () => {
        Bot.off('stdin.command', listener);
        Bot.off('stdin.output', listener);
      });
    }]
  },

  async init(app, Bot) {
    if (!global.stdinHandler) {
      const StdinModule = await import('../adapter/stdin.js');
      if (StdinModule.StdinHandler) {
        global.stdinHandler = new StdinModule.StdinHandler();
      }
    }
    
    // 设置Bot的URL
    if (!Bot.url && Bot.getServerUrl) {
      Bot.url = Bot.getServerUrl();
    }
  }
};