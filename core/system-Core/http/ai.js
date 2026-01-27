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
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/** 厂商 LLM 配置（与 aistream getProviderConfig 一致），body.apiKey 永不传入 LLM */
function getProviderConfig(provider) {
  if (!provider) return {};
  const key = `${String(provider).toLowerCase()}_llm`;
  return cfg[key] || {};
}

async function handleChatCompletionsV3(req, res) {
  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages) return HttpResponse.validationError(res, 'messages 参数无效');

  // 支持多种认证方式：body.apiKey、Authorization头部Bearer令牌
  let accessKey = (body.apiKey || '').toString().trim();
  if (!accessKey) {
    const authHeader = (req.headers.authorization || '').toString().trim();
    if (authHeader.startsWith('Bearer ')) {
      accessKey = authHeader.substring(7).trim();
    }
  }
  if (!accessKey || accessKey !== BotUtil.apiKey) return HttpResponse.unauthorized(res, 'apiKey 无效');

  const streamFlag = Boolean(body.stream);
  const llm = cfg.aistream?.llm || {};
  let provider = (body.model || '').toString().trim().toLowerCase();
  if (!provider || !LLMFactory.hasProvider(provider)) {
    provider = (llm.Provider || 'gptgod').toLowerCase();
  }

  const base = getProviderConfig(provider);
  const llmConfig = {
    ...base,
    provider,
    ...(body.temperature != null && { temperature: Number(body.temperature) }),
    ...(body.max_tokens != null && { maxTokens: Number(body.max_tokens) })
  };

  const client = LLMFactory.createClient(llmConfig);

  if (!streamFlag) {
    const text = await client.chat(messages, llmConfig);
    const now = Math.floor(Date.now() / 1000);
    
    // 估算 token 使用量（OpenAI 标准要求）
    const promptText = messages.map(m => m.content || '').join('');
    const promptTokens = Math.ceil(promptText.length / 4); // 粗略估算，1token≈4字符
    const completionTokens = Math.ceil((text || '').length / 4);
    
    res.json({
      id: `chatcmpl_${Date.now()}`,
      object: 'chat.completion',
      created: now,
      model: llmConfig.provider || llmConfig.model || llmConfig.chatModel || 'unknown',
      choices: [
        {
          index: 0,
          message: { 
            role: 'assistant', 
            content: text || '',
            refusal: null // OpenAI 标准字段
          },
          logprobs: null, // OpenAI 标准字段
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        completion_tokens_details: {
          reasoning_tokens: 0,
          accepted_prediction_tokens: 0,
          rejected_prediction_tokens: 0
        }
      },
      system_fingerprint: null // OpenAI 标准字段
    });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const now = Math.floor(Date.now() / 1000);
  const id = `chatcmpl_${Date.now()}`;
  const modelName = llmConfig.provider || llmConfig.model || llmConfig.chatModel || 'unknown';
  
  try {
    let totalContent = '';
    await client.chatStream(messages, (delta) => {
      totalContent += delta || '';
      res.write(
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created: now,
          model: modelName,
          system_fingerprint: null,
          choices: [{
            index: 0,
            delta: { 
              content: delta || '',
              role: delta ? undefined : 'assistant' // 首个 chunk 包含 role
            },
            logprobs: null,
            finish_reason: null
          }]
        })}\n\n`
      );
    }, llmConfig);
    
    // 发送最终 chunk（包含 finish_reason 和 usage）
    const promptText = messages.map(m => m.content || '').join('');
    const promptTokens = Math.ceil(promptText.length / 4);
    const completionTokens = Math.ceil(totalContent.length / 4);
    
    res.write(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created: now,
        model: modelName,
        system_fingerprint: null,
        choices: [{
          index: 0,
          delta: {},
          logprobs: null,
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          completion_tokens_details: {
            reasoning_tokens: 0,
            accepted_prediction_tokens: 0,
            rejected_prediction_tokens: 0
          }
        }
      })}\n\n`
    );
    res.write('data: [DONE]\n\n');
  } catch (error) {
    // 在流模式下，使用SSE格式发送错误信息
    res.write(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created: now,
        model: modelName,
        system_fingerprint: null,
        choices: [{
          index: 0,
          delta: {},
          logprobs: null,
          finish_reason: 'error'
        }],
        error: {
          message: error.message,
          type: 'server_error'
        }
      })}\n\n`
    );
    res.write('data: [DONE]\n\n');
  } finally {
    res.end();
  }
}

async function handleModels(req, res) {
  const llm = cfg.aistream?.llm || {};
  const providers = LLMFactory.listProviders();
  const defaultProvider = (llm.Provider || 'gptgod').toLowerCase();
  const format = (req.query.format || '').toLowerCase();

  if (format === 'openai' || req.path === '/api/v3/models') {
    const list = providers.length ? providers : (defaultProvider ? [defaultProvider] : []);
    const now = Math.floor(Date.now() / 1000);
    const data = list.map((p) => ({
      id: p,
      object: 'model',
      created: now,
      owned_by: 'xrk-agt',
      // 保留 meta 字段用于内部扩展，但符合 OpenAI 基本标准
      meta: { key: p, label: p, description: `LLM提供商: ${p}`, tags: [], baseUrl: null }
    }));
    return res.json({ object: 'list', data });
  }

  // 详细格式（用于前端，包含工作流信息）
  const profiles = providers.map(provider => ({
    key: provider,
    label: provider,
    description: `LLM提供商: ${provider}`,
    tags: [],
    model: null,
    baseUrl: null,
    maxTokens: null,
    temperature: null,
    hasApiKey: false,
    capabilities: []
  }));

  const allStreams = StreamLoader.getStreamsByPriority();
  const workflows = allStreams.map(stream => ({
    key: stream.name,
    label: stream.description || stream.name,
    description: stream.description || '',
    profile: null,
    persona: null,
    uiHidden: false
  }));

  return HttpResponse.success(res, {
    enabled: llm.enabled !== false,
    defaultProfile: defaultProvider,
    defaultWorkflow: workflows[0]?.key || null,
    persona: llm.persona || '',
    profiles,
    workflows
  });
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
      handler: HttpResponse.asyncHandler(handleModels, 'ai.v3.models')
    },
    {
      method: 'GET',
      path: '/api/ai/models',
      handler: HttpResponse.asyncHandler(handleModels, 'ai.models')
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

          const stream = StreamLoader.getStream(workflowName) || StreamLoader.getStream('chat') || StreamLoader.getStream('device');
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
    }
  ]
};