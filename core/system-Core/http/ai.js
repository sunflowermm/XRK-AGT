import StreamLoader from '#infrastructure/aistream/loader.js';
import cfg from '#infrastructure/config/config.js';
import LLMFactory from '#factory/llm/LLMFactory.js';
import BotUtil from '#utils/botutil.js';
import { errorHandler, ErrorCodes } from '#utils/error-handler.js';
import { InputValidator } from '#utils/input-validator.js';
import { HttpResponse } from '#utils/http-utils.js';

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

async function handleChatCompletionsV3(req, res) {
  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages) {
    return HttpResponse.validationError(res, 'messages 参数无效');
  }

  // v3 为“对外伪造的 OpenAI 兼容入口”，这里的 apiKey 是访问鉴权（Bot 启动生成的 key），不是厂商 apiKey。
  const accessKey = (body.apiKey || '').toString().trim();

  if (!accessKey || accessKey !== BotUtil.apiKey) {
    return HttpResponse.unauthorized(res, 'apiKey 无效');
  }

  const streamFlag = Boolean(body.stream);

  // /api/v3/chat/completions：对外提供“类 ChatGPT 协议”的统一 LLM 调用入口（给子服务端/生态使用）
  // - 不走工作流/StreamLoader（避免子服务端->主服务端->子服务端递归链路）
  // - 只按 cfg.aistream.llm.defaults / profiles 合并得到工厂参数
  // - 约定：body.model 填运营商(provider)，其余字段自由覆盖配置；body.apiKey 仅用于访问鉴权
  const llm = cfg.aistream?.llm || {};
  const defaults = llm.defaults || {};
  const profiles = llm.profiles || llm.models || {};

  const providerKey = (body.model || '').toString().trim();
  const profile = profiles[providerKey] || {};

  const llmConfig = {
    ...defaults,
    ...profile,
    ...(typeof body === 'object' ? body : {})
  };

  if (providerKey && LLMFactory.hasProvider(providerKey)) {
    llmConfig.provider = providerKey;
  }

  delete llmConfig.messages;
  delete llmConfig.stream;
  delete llmConfig.apiKey;
  llmConfig.apiKey = (profile.apiKey || defaults.apiKey || '').toString().trim() || undefined;
  const client = LLMFactory.createClient(llmConfig);

  if (!streamFlag) {
    const text = await client.chat(messages, llmConfig);
    const now = Math.floor(Date.now() / 1000);
    res.json({
      id: `chatcmpl_${Date.now()}`,
      object: 'chat.completion',
      created: now,
      model: llmConfig.provider || llmConfig.model || llmConfig.chatModel || 'unknown',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text || '' },
          finish_reason: 'stop'
        }
      ],
      usage: null
    });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const now = Math.floor(Date.now() / 1000);
  const id = `chatcmpl_${Date.now()}`;
  await client.chatStream(messages, (delta) => {
    res.write(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created: now,
        model: llmConfig.provider || llmConfig.model || llmConfig.chatModel || 'unknown',
        choices: [{ index: 0, delta: { content: delta || '' }, finish_reason: null }]
      })}\n\n`
    );
  }, llmConfig);
  res.write('data: [DONE]\n\n');
  res.end();
}

function handleModelsV3(_req, res) {
  const llm = cfg.aistream?.llm;
  const defaults = llm?.defaults || {};
  const profiles = llm?.profiles || llm?.models || {};
  const data = Object.entries(profiles).map(([key, value]) => ({
    id: value.model || defaults.model || key,
    object: 'model',
    owned_by: value.provider || defaults.provider || 'xrk-agt',
    meta: {
      key,
      label: value.label || key,
      description: value.description || '',
      tags: value.tags || [],
      baseUrl: value.baseUrl || defaults.baseUrl
    }
  }));

  res.json({ object: 'list', data });
}

export default {
  name: 'ai-stream',
  dsc: 'AI 流式输出（SSE）',
  priority: 80,
  routes: [
    {
      method: 'POST',
      path: '/api/v3/chat/completions',
      handler: HttpResponse.asyncHandler(handleChatCompletionsV3, 'ai.v3.chat.completions')
    },
    {
      method: 'GET',
      path: '/api/v3/models',
      handler: HttpResponse.asyncHandler(handleModelsV3, 'ai.v3.models')
    },
    {
      method: 'GET',
      path: '/api/ai/stream',
      handler: async (req, res) => {
        try {
          const prompt = InputValidator.sanitizeText((req.query.prompt || '').toString(), 10000);
          if (!prompt.trim()) {
            return HttpResponse.validationError(res, '缺少 prompt 参数');
          }

          const persona = (req.query.persona || '').toString();
          const workflowName = (req.query.workflow || 'chat').toString().trim() || 'chat';
          const profileKey = (req.query.profile || req.query.llm || req.query.model || '').toString().trim() || undefined;
          const contextObj = parseOptionalJson(req.query.context);
          const metadata = parseOptionalJson(req.query.meta);

          const fallbackStream = StreamLoader.getStream('chat') || StreamLoader.getStream('device');
          const stream = StreamLoader.getStream(workflowName) || fallbackStream;
          if (!stream) {
            return HttpResponse.error(res, new Error('工作流未加载'), 500, 'ai.stream');
          }

          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders?.();

          const messages = await stream.buildChatContext(null, {
            text: prompt,
            persona,
            context: contextObj,
            metadata
          });

          const llmOverrides = {
            ...stream.config,
            workflow: workflowName,
            persona,
            profile: profileKey
          };

          const executionContext = {
            e: null,
            question: {
              text: prompt,
              persona,
              context: contextObj,
              metadata
            },
            config: llmOverrides
          };

          let acc = '';
          const finalText = await stream.callAIStream(
            messages,
            llmOverrides,
            (delta) => {
              acc += delta;
              res.write(`data: ${JSON.stringify({ delta, workflow: stream.name })}\n\n`);
            },
            {
              context: executionContext
            }
          );

          res.write(
            `data: ${JSON.stringify({
              done: true,
              workflow: stream.name,
              text: finalText || acc
            })}\n\n`
          );
          res.end();
        } catch (e) {
          errorHandler.handle(e, { context: 'ai.stream', code: ErrorCodes.SYSTEM_ERROR });
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
      handler: HttpResponse.asyncHandler(async (_req, res) => {
        const llm = cfg.aistream?.llm;
        if (!llm) {
          return HttpResponse.notFound(res, '未找到 LLM 配置');
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

        HttpResponse.success(res, {
          enabled: llm.enabled !== false,
          defaultProfile: llm.defaultProfile || llm.defaultModel || profiles[0]?.key || null,
          defaultWorkflow: llm.defaultWorkflow || llm.defaultProfile || workflows[0]?.key || null,
          persona: llm.persona || '',
          profiles,
          workflows
        });
      }, 'ai.models')
    }
  ]
};