import StreamLoader from '#infrastructure/aistream/loader.js';
import cfg from '#infrastructure/config/config.js';
import LLMFactory from '#factory/llm/LLMFactory.js';
import BotUtil from '#utils/botutil.js';
import { errorHandler, ErrorCodes } from '#utils/error-handler.js';
import { InputValidator } from '#utils/input-validator.js';
import { HttpResponse } from '#utils/http-utils.js';

/**
 * 解析 multipart/form-data（仅用于 v3/chat/completions 图片上传场景）
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
    if (Object.hasOwn(obj, k) && obj[k] !== undefined) return obj[k];
  }
  return;
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
  if (v == null || v === '') return;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toBool(v) {
  if (v == null || v === '') return;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return;
}

function getProviderConfig(provider) {
  return provider ? (cfg[`${provider.toLowerCase()}_llm`] || {}) : {};
}

const getDefaultProvider = () => {
  const llm = cfg.aistream?.llm;
  return (llm?.Provider || llm?.provider || '').toString().trim().toLowerCase();
};

const trimLower = (v) => (v || '').toString().trim().toLowerCase();

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

/**
 * OpenAI 兼容的 Chat Completions v3 接口
 *
 * 特性概览：
 * - 路径：POST /api/v3/chat/completions
 * - 支持 JSON 与 multipart/form-data（含图片上传，多模态对话）
 * - 非流式：直接调用各 provider 的 client.chat，返回 OpenAI 风格响应
 * - 流式：通过 client.chatStream + SSE 输出 chat.completion.chunk 事件，前端按 choices[0].delta.content 渲染
 * - 工作流/工具：仅负责把前端选择的“带 MCP 工具的工作流”转换为 streams 透传给 LLM 工厂，用于工具白名单控制
 */
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
        } catch {
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

  // 鉴权由 src/bot.js _authMiddleware 统一处理，/api/* 到达此处已通过校验
  const streamFlag = Boolean(pickFirst(body, ['stream']));
  const bodyModel = trimLower(pickFirst(body, ['model']));
  const defaultProvider = getDefaultProvider();
  
  const provider = (bodyModel && LLMFactory.hasProvider(bodyModel)) 
    ? bodyModel 
    : (defaultProvider && LLMFactory.hasProvider(defaultProvider) ? defaultProvider : null);
  
  if (!provider) {
    return HttpResponse.error(res, new Error(`未指定有效的LLM提供商，请在 aistream.yaml 中配置 llm.Provider`), 400, 'ai.v3.chat.completions');
  }

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

  const workflowConfig = pickFirst(body, ['workflow']);
  const workflowStreams = workflowConfig && typeof workflowConfig === 'object' ? (() => {
    const streams = [];
    if (Array.isArray(workflowConfig.workflows)) streams.push(...workflowConfig.workflows.filter(Boolean));
    if (Array.isArray(workflowConfig.streams)) streams.push(...workflowConfig.streams.filter(Boolean));
    if (typeof workflowConfig.workflow === 'string' && workflowConfig.workflow.trim()) streams.push(workflowConfig.workflow.trim());
    return streams.length ? [...new Set(streams)] : null;
  })() : null;

  const client = LLMFactory.createClient(llmConfig);
  const overrides = {};
  const addNum = (key, ...aliases) => {
    const v = toNum(pickFirst(body, [key, ...aliases]));
    if (v !== undefined) {
      overrides[key] = v;
      if (aliases.length) overrides[aliases[0]] = v;
    }
  };
  const addVal = (key, ...aliases) => {
    const v = pickFirst(body, [key, ...aliases]);
    if (v !== undefined) {
      overrides[key] = v;
      if (aliases.length) overrides[aliases[0]] = v;
    }
  };
  const addBool = (key, ...aliases) => {
    const v = toBool(pickFirst(body, [key, ...aliases]));
    if (v !== undefined) {
      overrides[key] = v;
      if (aliases.length) overrides[aliases[0]] = v;
    }
  };

  addNum('temperature');
  addNum('max_tokens', 'maxTokens', 'max_completion_tokens', 'maxCompletionTokens');
  addNum('top_p', 'topP');
  addNum('presence_penalty', 'presencePenalty');
  addNum('frequency_penalty', 'frequencyPenalty');
  addVal('tool_choice', 'toolChoice');
  addBool('parallel_tool_calls', 'parallelToolCalls');
  addVal('tools');
  addVal('stop');
  addVal('response_format', 'responseFormat');
  addVal('stream_options', 'streamOptions');
  addNum('seed');
  addVal('user');
  addNum('n');
  addVal('logit_bias', 'logitBias');
  addBool('logprobs');
  addNum('top_logprobs', 'topLogprobs');
  
  if (workflowStreams?.length) overrides.streams = workflowStreams;

  const extraBody = parseOptionalJson(pickFirst(body, ['extraBody']));
  if (extraBody && typeof extraBody === 'object') overrides.extraBody = extraBody;

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

  // SSE 响应头：标准 Server-Sent Events 配置 + 关闭 Nginx 缓冲，确保实时流式输出
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁用Nginx缓冲
  res.flushHeaders?.();

  const now = Math.floor(Date.now() / 1000);
  const id = `chatcmpl_${Date.now()}`;
  const modelName = llmConfig.provider || 'unknown';
  
  BotUtil.makeLog('info', `[v3/chat/completions] 开始流式输出: provider=${modelName}, id=${id}`, 'ai.v3.stream');
  
  try {
    let totalContent = '';
    let isFirstChunk = true;
    let chunkCount = 0;
    let mcpTools = [];
    
    // 流式回调：所有工厂统一通过 onDelta 返回“纯文本增量”，这里封装成 OpenAI 风格 SSE 事件
    const streamCallback = (delta, metadata = {}) => {
      if (delta && typeof delta === 'string') {
        totalContent += delta;
        chunkCount++;
        const deltaObj = isFirstChunk ? { role: 'assistant', content: delta } : { content: delta };
        
        const chunkData = {
          id,
          object: 'chat.completion.chunk',
          created: now,
          model: modelName,
          choices: [{
            index: 0,
            delta: deltaObj,
            finish_reason: null
          }]
        };
        
        if (metadata && metadata.mcp_tools && Array.isArray(metadata.mcp_tools) && metadata.mcp_tools.length > 0) {
          mcpTools = metadata.mcp_tools;
          chunkData.mcp_tools = mcpTools;
        }
        
        const chunkStr = `data: ${JSON.stringify(chunkData)}\n\n`;
        
        if (chunkCount % 10 === 1 || chunkCount <= 3) {
          BotUtil.makeLog('debug', `[v3/chat/completions] 发送chunk #${chunkCount}: delta长度=${delta.length}, 总长度=${totalContent.length}`, 'ai.v3.stream');
        }
        
        try {
          res.write(chunkStr);
          if (typeof res.flush === 'function') {
            res.flush();
          }
        } catch (writeError) {
          BotUtil.makeLog('error', `[v3/chat/completions] 写入chunk失败: ${writeError.message}`, 'ai.v3.stream');
          throw writeError;
        }
        
        isFirstChunk = false;
      } else if (delta === '' && metadata && metadata.mcp_tools && Array.isArray(metadata.mcp_tools) && metadata.mcp_tools.length > 0) {
        mcpTools = metadata.mcp_tools;
        const mcpData = {
          id,
          object: 'chat.completion.chunk',
          created: now,
          model: modelName,
          mcp_tools: mcpTools
        };
        res.write(`data: ${JSON.stringify(mcpData)}\n\n`);
        if (typeof res.flush === 'function') {
          res.flush();
        }
      } else {
        BotUtil.makeLog('warn', `[v3/chat/completions] 收到无效delta: type=${typeof delta}, value=${String(delta).substring(0, 50)}`, 'ai.v3.stream');
      }
    };
    
    BotUtil.makeLog('info', `[v3/chat/completions] 调用client.chatStream开始`, 'ai.v3.stream');
    
    await client.chatStream(messages, streamCallback, overrides);
    BotUtil.makeLog('info', `[v3/chat/completions] chatStream完成: 总chunks=${chunkCount}, 总长度=${totalContent.length}`, 'ai.v3.stream');
    
    // 发送完成标记和统计信息
    const promptText = extractMessageText(messages);
    const promptTokens = estimateTokens(promptText);
    const completionTokens = estimateTokens(totalContent);
    
    const finishData = {
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
    };
    
    BotUtil.makeLog('debug', `[v3/chat/completions] 发送完成标记`, 'ai.v3.stream');
    res.write(`data: ${JSON.stringify(finishData)}\n\n`);
    res.write('data: [DONE]\n\n');
    BotUtil.makeLog('info', `[v3/chat/completions] 流式输出完成`, 'ai.v3.stream');
  } catch (error) {
    BotUtil.makeLog('error', `[v3/chat/completions] 流式输出错误: ${error.message}, stack=${error.stack?.substring(0, 200)}`, 'ai.v3.stream');
    
    // 错误处理：发送错误信息并结束流
    const errorData = {
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
    };
    
    res.write(`data: ${JSON.stringify(errorData)}\n\n`);
    res.write('data: [DONE]\n\n');
  } finally {
    BotUtil.makeLog('debug', `[v3/chat/completions] 关闭响应流`, 'ai.v3.stream');
    res.end();
  }
}

async function handleModels(req, res) {
  const llm = cfg.aistream?.llm || {};
  const providers = LLMFactory.listProviders();
  const defaultProvider = getDefaultProvider();
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

  const profiles = providers.map(provider => {
    const c = getProviderConfig(provider);
    return {
      key: provider,
      label: provider,
      description: `LLM提供商: ${provider}`,
      tags: [],
      model: c.model || c.chatModel || null,
      baseUrl: c.baseUrl || null,
      maxTokens: c.maxTokens ?? c.max_tokens ?? null,
      temperature: c.temperature ?? null,
      hasApiKey: Boolean((c.apiKey || '').toString().trim()),
      capabilities: [
        ...(c.enableStream !== false ? ['stream'] : []),
        ...(c.enableTools === true ? ['tools'] : [])
      ]
    };
  });

  const workflows = StreamLoader.getStreamsByPriority()
    .filter(s => !s.primaryStream && !s.secondaryStreams && (s.mcpTools?.size || 0) > 0)
    .map(s => ({
      key: s.name,
      label: s.description || s.name,
      description: s.description || '',
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
          const workflowName = trimLower(req.query.workflow) || 'chat';
          const profileKey = trimLower(req.query.profile || req.query.llm) || undefined;
          const queryProvider = trimLower(req.query.provider) || undefined;
          const queryModel = trimLower(req.query.model) || undefined;
          const contextObj = parseOptionalJson(req.query.context);
          const metadata = parseOptionalJson(req.query.meta);

          const stream = StreamLoader.getStream(workflowName) || StreamLoader.getStream('chat');
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
          } else if (profileKey && LLMFactory.hasProvider(profileKey)) {
            llmOverrides.provider = profileKey;
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