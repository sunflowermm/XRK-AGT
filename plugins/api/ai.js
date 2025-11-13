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
          const prompt = (req.query.prompt || '').toString();
          const persona = (req.query.persona || '').toString();
          const stream = StreamLoader.getStream('device');
          if (!stream) {
            res.status(500).json({ success: false, message: '设备工作流未加载' });
            return;
          }
          // SSE 头
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders?.();

          const messages = await stream.buildChatContext(null, { text: prompt, persona });
          let acc = '';
          await stream.callAIStream(messages, stream.config, (delta) => {
            acc += delta;
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          });
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        } catch (e) {
          try {
            res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
          } catch {}
          res.end();
        }
      }
    }
  ]
};


