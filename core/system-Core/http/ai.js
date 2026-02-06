import StreamLoader from '#infrastructure/aistream/loader.js';
import cfg from '#infrastructure/config/config.js';
import LLMFactory from '#factory/llm/LLMFactory.js';
import BotUtil from '#utils/botutil.js';
import { errorHandler, ErrorCodes } from '#utils/error-handler.js';
import { InputValidator } from '#utils/input-validator.js';
import { HttpResponse } from '#utils/http-utils.js';

/**
 * 解析 multipart/form-data
 */
async function parseMultipartData(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=([^;]+)/);
    if (!boundaryMatch) {
      reject(new Error('No boundary found'));
      return;
    }
    const boundary = boundaryMatch[1];

    let data = Buffer.alloc(0);
    const files = [];
    const fields = {};

    req.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
    });

    req.on('end', () => {
      try {
        const parts = data.toString('binary').split(`--${boundary}`);
        
        for (const part of parts) {
          if (!part.trim() || part.trim() === '--') continue;
          
          if (part.includes('Content-Disposition: form-data')) {
            const nameMatch = part.match(/name="([^"]+)"/);
            const filenameMatch = part.match(/filename="([^"]+)"/);
            
            if (filenameMatch) {
              // 文件字段
              const filename = filenameMatch[1];
              const contentTypeMatch = part.match(/Content-Type: ([^\r\n]+)/);
              const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream';
              
              const headerEndIndex = part.indexOf('\r\n\r\n');
              if (headerEndIndex !== -1) {
                const fileStart = headerEndIndex + 4;
                const fileEnd = part.lastIndexOf('\r\n');
                const fileContent = Buffer.from(part.substring(fileStart, fileEnd), 'binary');
                
                files.push({
                  fieldname: nameMatch ? nameMatch[1] : 'file',
                  originalname: filename,
                  mimetype: contentType,
                  buffer: fileContent,
                  size: fileContent.length
                });
              }
            } else if (nameMatch) {
              // 普通字段
              const fieldName = nameMatch[1];
              const headerEndIndex = part.indexOf('\r\n\r\n');
              if (headerEndIndex !== -1) {
                const fieldStart = headerEndIndex + 4;
                const fieldEnd = part.lastIndexOf('\r\n');
                // 注意：part 是 binary 字符串（latin1），直接 substring 会导致中文等 UTF-8 字符出现乱码
                // 这里用 Buffer 按 binary 取回原始字节，再按 utf8 解码文本字段
                const fieldBuf = Buffer.from(part.substring(fieldStart, fieldEnd), 'binary');
                fields[fieldName] = fieldBuf.toString('utf8');
              }
            }
          }
        }
        
        resolve({ files, fields });
      } catch (e) {
        reject(e);
      }
    });

    req.on('error', reject);
  });
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function parseOptionalJson(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function toNum(v) {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toBool(v) {
  if (v == null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return undefined;
}

function getProviderConfig(provider) {
  if (!provider) return {};
  const key = `${String(provider).toLowerCase()}_llm`;
  return cfg[key] || {};
}

/** 提取消息文本内容（支持字符串和对象格式） */
function extractMessageText(messages) {
  return messages.map(m => {
    const content = m.content;
    return typeof content === 'string' ? content : (content?.text || '');
  }).join('');
}

/** 计算 token 数量（粗略估算：1 token ≈ 4 字符） */
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

async function handleChatCompletionsV3(req, res) {
  const contentType = req.headers['content-type'] || '';
  const body = req.body || {};
  let messages = Array.isArray(body.messages) ? body.messages : null;
  const uploadedImages = [];

  // 支持 multipart/form-data 格式（图片上传）
  if (contentType.includes('multipart/form-data')) {
    try {
      const { files, fields } = await parseMultipartData(req);
      
      // 解析 JSON 字段
      if (fields.messages) {
        try {
          messages = JSON.parse(fields.messages);
        } catch (_e) {
          return HttpResponse.validationError(res, 'messages 字段格式无效');
        }
      }
      
      // 解析其他字段
      if (fields.model) body.model = fields.model;
      if (fields.stream) body.stream = fields.stream === 'true';
      if (fields.apiKey) body.apiKey = fields.apiKey;
      if (fields.api_key) body.api_key = fields.api_key;
      if (fields.temperature) body.temperature = fields.temperature;
      if (fields.max_tokens) body.max_tokens = fields.max_tokens;
      if (fields.maxTokens) body.maxTokens = fields.maxTokens;
      
      // 处理上传的图片（字段名可以是 'images' 或 'file'）
      if (files && files.length > 0) {
        for (const file of files) {
          if (file.mimetype?.startsWith('image/')) {
            const base64 = file.buffer.toString('base64');
            uploadedImages.push(`data:${file.mimetype};base64,${base64}`);
          }
        }
      }
    } catch (e) {
      return HttpResponse.error(res, new Error(`解析 multipart/form-data 失败: ${e.message}`), 400, 'ai.v3.chat.completions');
    }
  }
  
  if (!messages || !Array.isArray(messages)) {
    return HttpResponse.validationError(res, 'messages 参数无效');
  }
  
  // 如果有上传的图片，将图片添加到最后一条用户消息中
  if (uploadedImages.length > 0) {
    const imageParts = uploadedImages.map(img => ({
      type: 'image_url',
      image_url: { url: img }
    }));

    if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
      const lastMessage = messages[messages.length - 1];
      // 兼容多种 content 形态：
      // - string: 转为 [text, ...images]
      // - array(OpenAI multimodal): 直接 push images
      // - object({text, images, replyImages}): 追加到 images
      if (Array.isArray(lastMessage.content)) {
        lastMessage.content.push(...imageParts);
      } else if (typeof lastMessage.content === 'string') {
        const text = lastMessage.content.trim();
        lastMessage.content = text ? [{ type: 'text', text }, ...imageParts] : imageParts;
      } else if (lastMessage.content && typeof lastMessage.content === 'object') {
        const c = lastMessage.content;
        const text = (c.text || c.content || '').toString().trim();
        const images = Array.isArray(c.images) ? c.images : [];
        // 这里把上传后的 dataURL 直接追加到 images，后续由各 provider 的 transformMessagesWithVision 统一转协议
        c.text = text;
        c.images = [...images, ...uploadedImages];
        lastMessage.content = c;
      } else {
        lastMessage.content = imageParts;
      }
    } else {
      messages.push({
        role: 'user',
        content: imageParts
      });
    }
  }

  // 支持多种认证方式：body.apiKey、Authorization头部Bearer令牌
  let accessKey = (pickFirst(body, ['apiKey', 'api_key']) || '').toString().trim();
  if (!accessKey) {
    const authHeader = (req.headers.authorization || '').toString().trim();
    if (authHeader.startsWith('Bearer ')) {
      accessKey = authHeader.substring(7).trim();
    }
  }
  // 兼容 Web 控制台常见写法：X-API-Key
  if (!accessKey) {
    accessKey = (req.headers['x-api-key'] || '').toString().trim();
  }
  if (!accessKey || accessKey !== BotUtil.apiKey) return HttpResponse.unauthorized(res, 'apiKey 无效');

  const streamFlag = Boolean(pickFirst(body, ['stream']));
  const llm = cfg.aistream?.llm || {};
  const defaultProvider = (llm.Provider || 'gptgod').toLowerCase();
  const bodyModel = (pickFirst(body, ['model']) || '').toString().trim().toLowerCase();

  // 约定（对外接口）：
  // - 外部调用只需要把 body.model 填成运营商 provider
  const provider = (bodyModel && LLMFactory.hasProvider(bodyModel)) ? bodyModel : defaultProvider;

  const base = getProviderConfig(provider);
  const llmConfig = {
    provider,
    ...base
  };

  if (streamFlag && base.enableStream === false) {
    return HttpResponse.error(
      res,
      new Error(`提供商 ${provider} 的流式输出已禁用`),
      400,
      'ai.v3.chat.completions'
    );
  }

  const client = LLMFactory.createClient(llmConfig);
  // 有意义的别名兼容：同义字段统一传给各 provider client
  const overrides = {};
  const temperature = toNum(pickFirst(body, ['temperature']));
  if (temperature !== undefined) overrides.temperature = temperature;

  const maxTokens = toNum(pickFirst(body, ['max_tokens', 'maxTokens', 'max_completion_tokens', 'maxCompletionTokens']));
  if (maxTokens !== undefined) {
    overrides.max_tokens = maxTokens;
    overrides.maxTokens = maxTokens;
  }
  const topP = toNum(pickFirst(body, ['top_p', 'topP']));
  if (topP !== undefined) {
    overrides.top_p = topP;
    overrides.topP = topP;
  }
  const presencePenalty = toNum(pickFirst(body, ['presence_penalty', 'presencePenalty']));
  if (presencePenalty !== undefined) {
    overrides.presence_penalty = presencePenalty;
    overrides.presencePenalty = presencePenalty;
  }
  const frequencyPenalty = toNum(pickFirst(body, ['frequency_penalty', 'frequencyPenalty']));
  if (frequencyPenalty !== undefined) {
    overrides.frequency_penalty = frequencyPenalty;
    overrides.frequencyPenalty = frequencyPenalty;
  }
  const toolChoice = pickFirst(body, ['tool_choice', 'toolChoice']);
  if (toolChoice !== undefined) overrides.tool_choice = toolChoice;
  const parallel = toBool(pickFirst(body, ['parallel_tool_calls', 'parallelToolCalls']));
  if (parallel !== undefined) {
    overrides.parallel_tool_calls = parallel;
    overrides.parallelToolCalls = parallel;
  }
  const tools = pickFirst(body, ['tools']);
  if (tools !== undefined) overrides.tools = tools;

  // 2026 常见扩展字段透传（兼容 OpenAI-like / vLLM / 本地推理）
  const stop = pickFirst(body, ['stop']);
  if (stop !== undefined) overrides.stop = stop;
  const responseFormat = pickFirst(body, ['response_format', 'responseFormat']);
  if (responseFormat !== undefined) overrides.response_format = responseFormat;
  const streamOptions = pickFirst(body, ['stream_options', 'streamOptions']);
  if (streamOptions !== undefined) overrides.stream_options = streamOptions;
  const seed = toNum(pickFirst(body, ['seed']));
  if (seed !== undefined) overrides.seed = seed;
  const user = pickFirst(body, ['user']);
  if (user !== undefined) overrides.user = user;
  const n = toNum(pickFirst(body, ['n']));
  if (n !== undefined) overrides.n = n;
  const logitBias = pickFirst(body, ['logit_bias', 'logitBias']);
  if (logitBias !== undefined) overrides.logit_bias = logitBias;
  const logprobs = toBool(pickFirst(body, ['logprobs']));
  if (logprobs !== undefined) overrides.logprobs = logprobs;
  const topLogprobs = toNum(pickFirst(body, ['top_logprobs', 'topLogprobs']));
  if (topLogprobs !== undefined) overrides.top_logprobs = topLogprobs;

  const extraBody = parseOptionalJson(pickFirst(body, ['extraBody']));
  if (extraBody && typeof extraBody === 'object') overrides.extraBody = extraBody;

  // 对外接口约定：body.model 用作 provider，不承诺用它承载“真实模型名”的语义
  if (!streamFlag) {
    const text = await client.chat(messages, overrides);
    const promptText = extractMessageText(messages);
    const promptTokens = estimateTokens(promptText);
    const completionTokens = estimateTokens(text);
    
    // 对外返回 model=provider
    const responseModel = llmConfig.provider || 'unknown';
    return res.json({
      id: `chatcmpl_${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: responseModel,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text || '' },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const now = Math.floor(Date.now() / 1000);
  const id = `chatcmpl_${Date.now()}`;
  const modelName = llmConfig.provider || 'unknown';
  
  try {
    let totalContent = '';
    let isFirstChunk = true;
    
    await client.chatStream(messages, (delta) => {
      if (delta) {
        totalContent += delta;
        const deltaObj = isFirstChunk ? { role: 'assistant', content: delta } : { content: delta };
        
        res.write(`data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created: now,
          model: modelName,
          choices: [{
            index: 0,
            delta: deltaObj,
            finish_reason: null
          }]
        })}\n\n`);
        
        isFirstChunk = false;
      }
    }, overrides);
    
    const promptText = extractMessageText(messages);
    const promptTokens = estimateTokens(promptText);
    const completionTokens = estimateTokens(totalContent);
    
    res.write(`data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: now,
      model: modelName,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    })}\n\n`);
    res.write('data: [DONE]\n\n');
  } catch (error) {
    res.write(`data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: now,
      model: modelName,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: null
      }],
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error',
        code: 'internal_error'
      }
    })}\n\n`);
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
    return res.json({
      object: 'list',
      data: list.map((p) => ({
        id: p,
        object: 'model',
        created: now,
        owned_by: 'xrk-agt'
      }))
    });
  }

  const profiles = providers.map((provider) => {
    const c = getProviderConfig(provider) || {};
    const model = c.model || c.chatModel || null;
    const baseUrl = c.baseUrl || null;
    const maxTokens = c.maxTokens ?? c.max_tokens ?? null;
    const temperature = c.temperature ?? null;
    const hasApiKey = Boolean((c.apiKey || '').toString().trim());

    const capabilities = [];
    if (c.enableStream !== false) capabilities.push('stream');
    if (c.enableTools === true) capabilities.push('tools');

    return {
      key: provider,
      label: provider,
      description: `LLM提供商: ${provider}`,
      tags: [],
      model,
      baseUrl,
      maxTokens,
      temperature,
      hasApiKey,
      capabilities
    };
  });

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
          const profileKey = (req.query.profile || req.query.llm || '').toString().trim() || undefined;
          const queryProvider = (req.query.provider || '').toString().trim().toLowerCase() || undefined;
          const queryModel = (req.query.model || '').toString().trim().toLowerCase() || undefined;
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

          // 对外接口约定：query.model 通常填 provider；query.provider 仅作为可选字段
          if (queryModel && LLMFactory.hasProvider(queryModel)) {
            llmOverrides.provider = queryModel;
          } else if (queryProvider && LLMFactory.hasProvider(queryProvider)) {
            llmOverrides.provider = queryProvider;
          } else if (profileKey && LLMFactory.hasProvider(profileKey.toLowerCase())) {
            llmOverrides.provider = profileKey.toLowerCase();
          }

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