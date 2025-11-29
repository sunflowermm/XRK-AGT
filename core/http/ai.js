import StreamLoader from '../../src/infrastructure/aistream/loader.js';
import cfg from '../../src/infrastructure/config/config.js';

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
          const profileKey = (req.query.profile || req.query.llm || req.query.model || '').toString().trim() || undefined;
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
          const llmOverrides = {
            ...stream.config,
            workflow: workflowName,
            persona,
            profile: profileKey
          };
          await stream.callAIStream(messages, llmOverrides, (delta) => {
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
    },
    {
      method: 'GET',
      path: '/api/ai/models',
      handler: async (_req, res) => {
        try {
          const llm = cfg.aistream?.llm;
          if (!llm) {
            return res.status(404).json({ success: false, message: '未找到 LLM 配置' });
          }

          const defaults = llm.defaults || {};
          const profiles = Object.entries(llm.profiles || llm.models || {}).map(([key, value]) => ({
            key,
            label: value.label || key,
            description: value.description || '',
            tags: value.tags || [],
            model: value.model || defaults.model,
            baseUrl: value.baseUrl || defaults.baseUrl,
            maxTokens: value.maxTokens || defaults.maxTokens,
            temperature: value.temperature ?? defaults.temperature,
            hasApiKey: Boolean(value.apiKey || defaults.apiKey),
            capabilities: value.capabilities || value.tags || []
          }));

          const workflows = Object.entries(llm.workflows || {}).map(([key, value]) => ({
            key,
            label: value.label || key,
            description: value.description || '',
            profile: value.profile || null,
            persona: value.persona || null,
            uiHidden: Boolean(value.uiHidden)
          }));

          res.json({
            success: true,
            enabled: llm.enabled !== false,
            defaultProfile: llm.defaultProfile || llm.defaultModel || profiles[0]?.key || null,
            defaultWorkflow: llm.defaultWorkflow || llm.defaultProfile || workflows[0]?.key || null,
            persona: llm.persona || '',
            profiles,
            workflows
          });
        } catch (e) {
          res.status(500).json({ success: false, message: e.message });
        }
      }
    }
  ]
};


