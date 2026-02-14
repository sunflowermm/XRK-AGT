import fs from "fs";
import path from "path";
import paths from '#utils/paths.js';
import { HttpResponse } from '#utils/http-utils.js';

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
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const stdinHandler = global.stdinHandler;
        
        if (!stdinHandler) {
          return HttpResponse.error(res, new Error('Stdin handler not initialized'), 503, 'stdin.status');
        }

        const tempDir = path.join(paths.data, "stdin");
        const mediaDir = path.join(paths.data, "media");
        
        HttpResponse.success(res, {
          bot_id: 'stdin',
          status: 'online',
          uptime: process.uptime(),
          temp_files: fs.existsSync(tempDir) ? fs.readdirSync(tempDir).length : 0,
          media_files: fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir).length : 0,
          base_url: Bot.getServerUrl ? Bot.getServerUrl() : `http://localhost:${Bot.httpPort || 3000}`,
          timestamp: Date.now()
        });
      }, 'stdin.status')
    },

    {
      method: 'POST',
      path: '/api/stdin/command',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const stdinHandler = global.stdinHandler;
        if (!stdinHandler) return HttpResponse.error(res, new Error('Stdin handler not initialized'), 503, 'stdin.command');

        const { command, user_info = {} } = req.body;
        // 默认以 JSON 形式返回插件输出，除非显式传入 json=false
        const wantJson = String(req.body?.json ?? req.query?.json ?? 'true').toLowerCase() === 'true';
        
        if (!command) {
          return HttpResponse.validationError(res, 'Command is required');
        }

        user_info.tasker = 'api';

        // JSON 模式：通过 Bot.callStdin 收集本次命令触发的所有插件输出
        if (wantJson) {
          const result = await Bot.callStdin(command, { user_info });
          return res.json(result);
        }

        const result = await stdinHandler.processCommand(command, user_info);
        res.json(result);
      }, 'stdin.command')
    },

    {
      method: 'POST',
      path: '/api/stdin/event',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const stdinHandler = global.stdinHandler;
        if (!stdinHandler) return HttpResponse.error(res, new Error('Stdin handler not initialized'), 503, 'stdin.event');

        const { event_type = 'message', content, user_info = {} } = req.body;
        const wantJson = String(req.body?.json ?? req.query?.json ?? 'true').toLowerCase() === 'true';
        const timeout = Number(req.body?.timeout || req.query?.timeout) || 5000;
        
        user_info.tasker = 'api';
        
        const event = stdinHandler.createEvent(content, {
          ...user_info,
          post_type: event_type
        });

        const output = wantJson
          ? await Bot.em(event_type, event, true, { timeout })
          : (Bot.em(event_type, event), null);

        HttpResponse.success(res, {
          event_id: event.message_id,
          output: output || undefined,
          timestamp: Date.now()
        }, 'Event triggered');
      }, 'stdin.event')
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
      const StdinModule = await import('../tasker/stdin.js');
      global.stdinHandler = new StdinModule.StdinHandler();
    }
    
    if (!Bot.url && Bot.getServerUrl) {
      Bot.url = Bot.getServerUrl();
    }
  }
};