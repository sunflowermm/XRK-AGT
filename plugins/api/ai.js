import StreamLoader from '../../lib/aistream/loader.js';

export default {
  name: 'ai-stream',
  dsc: 'AI 流式输出（SSE）',
  priority: 80,
  routes: [
    {
      method: 'GET',
      path: '/api/ai/stream',
      handler: async (req, res) => {
        try {
          // 如果响应已经发送，直接返回
          if (res.headersSent) {
            return;
          }
          
          const prompt = (req.query.prompt || '').toString();
          const persona = (req.query.persona || '').toString();
          const stream = StreamLoader.getStream('device');
          if (!stream) {
            if (!res.headersSent) {
              res.status(500).json({ success: false, message: '设备工作流未加载' });
            }
            return;
          }
          
          // SSE 头（必须在发送响应前设置）
          if (!res.headersSent) {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders?.();
          }

          const messages = await stream.buildChatContext(null, { text: prompt, persona });
          let acc = '';
          await stream.callAIStream(messages, stream.config, (delta) => {
            if (!res.headersSent || res.writable) {
              try {
                res.write(`data: ${JSON.stringify({ delta })}\n\n`);
              } catch (err) {
                // 写入失败，连接可能已关闭
              }
            }
            acc += delta;
          });
          
          if (!res.headersSent || res.writable) {
            try {
              res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
              res.end();
            } catch (err) {
              // 写入失败，连接可能已关闭
            }
          }
        } catch (e) {
          if (!res.headersSent) {
            try {
              res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
              res.end();
            } catch (err) {
              // 响应已关闭，忽略错误
            }
          } else if (res.writable) {
            try {
              res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
              res.end();
            } catch (err) {
              // 响应已关闭，忽略错误
            }
          }
        }
      }
    }
  ]
};


