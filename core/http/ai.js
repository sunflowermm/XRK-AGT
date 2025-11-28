import StreamLoader from '../../src/infrastructure/aistream/loader.js';

function parseOptionalJson(raw) {
  if (!raw && raw !== 0) return null;
  try {
    if (typeof raw === 'string') {
      return JSON.parse(raw);
    }
    return raw;
  } catch {
    return null;
  }
}

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
          if (!prompt.trim()) {
            res.status(400).json({ success: false, message: '缺少 prompt 参数' });
            return;
          }

          const persona = (req.query.persona || '').toString();
          const workflowName = (req.query.workflow || 'chat').toString().trim() || 'chat';
          const context = parseOptionalJson(req.query.context);
          const metadata = parseOptionalJson(req.query.meta);

          const fallbackStream = StreamLoader.getStream('chat') || StreamLoader.getStream('device');
          const stream = StreamLoader.getStream(workflowName) || fallbackStream;
          if (!stream) {
            res.status(500).json({ success: false, message: '工作流未加载' });
            return;
          }

          // SSE 头
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders?.();

          const messages = await stream.buildChatContext(null, { text: prompt, persona, context, metadata });
          let acc = '';
          await stream.callAIStream(messages, stream.config, (delta) => {
            acc += delta;
            res.write(`data: ${JSON.stringify({ delta, workflow: stream.name })}\n\n`);
          });
          res.write(`data: ${JSON.stringify({ done: true, workflow: stream.name })}\n\n`);
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


