import fs from 'fs';
import path from 'path';
import paths from '#utils/paths.js';
import { HttpResponse } from '#utils/http-utils.js';
import { getRuntimeGlobal } from '#utils/runtime-globals.js';

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
      handler: HttpResponse.asyncHandler(async (req, res, AgentRuntime) => {
        const stdinHandler = getRuntimeGlobal('stdinHandler');

        if (!stdinHandler) {
          return HttpResponse.error(res, new Error('Stdin handler not initialized'), 503, 'stdin.status');
        }

        const tempDir = path.join(paths.data, 'stdin');
        const mediaDir = path.join(paths.data, 'media');

        return HttpResponse.success(res, {
          bot_id: 'stdin',
          status: 'online',
          uptime: process.uptime(),
          temp_files: fs.existsSync(tempDir) ? fs.readdirSync(tempDir).length : 0,
          media_files: fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir).length : 0,
          base_url: AgentRuntime.getServerUrl ? AgentRuntime.getServerUrl() : `http://localhost:${AgentRuntime.httpPort || 3000}`,
          timestamp: Date.now()
        });
      }, 'stdin.status')
    },

    {
      method: 'POST',
      path: '/api/stdin/command',
      handler: HttpResponse.asyncHandler(async (req, res, AgentRuntime) => {
        const stdinHandler = getRuntimeGlobal('stdinHandler');
        if (!stdinHandler) {
          return HttpResponse.error(res, new Error('Stdin handler not initialized'), 503, 'stdin.command');
        }

        const { command, user_info = {} } = req.body;
        const wantJson = String(req.body?.json ?? req.query?.json ?? 'true').toLowerCase() === 'true';

        if (!command) {
          return HttpResponse.validationError(res, 'Command is required');
        }

        user_info.tasker = 'api';

        if (wantJson) {
          const result = await AgentRuntime.callStdin(command, { user_info });
          return HttpResponse.json(res, result);
        }

        const result = await stdinHandler.processCommand(command, user_info);
        return HttpResponse.json(res, result);
      }, 'stdin.command')
    },

    {
      method: 'POST',
      path: '/api/stdin/event',
      handler: HttpResponse.asyncHandler(async (req, res, AgentRuntime) => {
        const stdinHandler = getRuntimeGlobal('stdinHandler');
        if (!stdinHandler) {
          return HttpResponse.error(res, new Error('Stdin handler not initialized'), 503, 'stdin.event');
        }

        const { event_type = 'message', content, user_info = {} } = req.body;
        const wantJson = String(req.body?.json ?? req.query?.json ?? 'true').toLowerCase() === 'true';
        const timeout = Number(req.body?.timeout || req.query?.timeout) || 5000;

        user_info.tasker = 'api';

        const event = stdinHandler.createEvent(content, {
          ...user_info,
          post_type: event_type
        });

        const output = wantJson
          ? await AgentRuntime.em(event_type, event, true, { timeout })
          : (AgentRuntime.em(event_type, event), null);

        return HttpResponse.success(res, {
          event_id: event.message_id,
          output: output || undefined,
          timestamp: Date.now()
        }, 'Event triggered');
      }, 'stdin.event')
    }
  ],

  ws: {
    stdin: [(conn, req, AgentRuntime) => {
      const listener = (data) => {
        conn.sendMsg(JSON.stringify({
          type: 'stdin',
          data,
          timestamp: Date.now()
        }));
      };

      AgentRuntime.on('stdin.command', listener);
      AgentRuntime.on('stdin.output', listener);

      conn.on('close', () => {
        AgentRuntime.off('stdin.command', listener);
        AgentRuntime.off('stdin.output', listener);
      });
    }]
  },

  async init(app, AgentRuntime) {
    if (!getRuntimeGlobal('stdinHandler')) {
      const StdinModule = await import('../tasker/stdin.js');
      const instance = new StdinModule.default();
      instance.load();
    }

    if (!AgentRuntime.url && AgentRuntime.getServerUrl) {
      AgentRuntime.url = AgentRuntime.getServerUrl();
    }
  }
};
