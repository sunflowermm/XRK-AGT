import StreamLoader from '#infrastructure/aistream/loader.js';
import cfg from '#infrastructure/config/config.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import LLMFactory from '#factory/llm/LLMFactory.js';
import BotUtil from '#utils/botutil.js';
import { errorHandler, ErrorCodes } from '#utils/error-handler.js';
import { InputValidator } from '#utils/input-validator.js';
import { HttpResponse } from '#utils/http-utils.js';
import { parseMultipartData } from '#utils/multipart-parser.js';

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

const getDefaultProvider = () => {
  const llm = getAistreamConfigOptional().llm || cfg?.aistream?.llm || {};
  return (llm?.Provider || llm?.provider || '').toString().trim().toLowerCase();
};

const trimLower = (v) => (v || '').toString().trim().toLowerCase();

function ensureSystemCoreAuth(req, res, Bot, context) {
  if (!Bot?.checkApiAuthorization?.(req)) {
    return HttpResponse.error(res, new Error('未授权'), 401, context || 'system-Core.ai');
  }
}

function getProviderConfig(provider) {
  return LLMFactory.getProviderConfig(provider) || {};
}

function resolveProviderFromRequest(body = {}) {
  return LLMFactory.resolveProvider({
    model: trimLower(pickFirst(body, ['model'])),
    provider: trimLower(pickFirst(body, ['provider', 'llm', 'profile'])),
    llm: trimLower(pickFirst(body, ['llm'])),
    profile: trimLower(pickFirst(body, ['profile'])),
    defaultProvider: getDefaultProvider()
  });
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

function writeSSEChunk(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

function safePreview(value, { maxLen = 500 } = {}) {
  if (value == null) return value;
  if (typeof value === 'string') {
    const s = value.replace(/\s+/g, ' ').trim();
    return s.length > maxLen ? `${s.slice(0, maxLen)}…(len=${s.length})` : s;
  }
  try {
    const s = JSON.stringify(value);
    return s.length > maxLen ? `${s.slice(0, maxLen)}…(len=${s.length})` : s;
  } catch {
    return String(value);
  }
}

function redactSecrets(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = String(k).toLowerCase();
    if (key === 'authorization' || key === 'api-key' || key === 'x-api-key') {
      out[k] = '<redacted>';
    } else {
      out[k] = safePreview(v, { maxLen: 200 });
    }
  }
  return out;
}

function summarizeTools(tools) {
  if (!Array.isArray(tools)) return { type: typeof tools, count: 0, names: [] };
  const names = [];
  for (const t of tools) {
    const name = t?.function?.name || t?.name || t?.id;
    if (name) names.push(String(name));
  }
  return {
    type: 'array',
    count: tools.length,
    names: names.slice(0, 12),
    namesTruncated: names.length > 12
  };
}

function summarizeV3Request(req, body, { contentType, messages, uploadedImagesCount = 0 } = {}) {
  const rawWorkflow = pickFirst(body, ['workflow']);
  const workflowType = rawWorkflow == null ? null : (Array.isArray(rawWorkflow) ? 'array' : typeof rawWorkflow);
  const workflowPreview = rawWorkflow && typeof rawWorkflow === 'object'
    ? {
        workflow: safePreview(rawWorkflow.workflow, { maxLen: 120 }),
        workflowsCount: Array.isArray(rawWorkflow.workflows) ? rawWorkflow.workflows.length : 0,
        streamsCount: Array.isArray(rawWorkflow.streams) ? rawWorkflow.streams.length : 0
      }
    : safePreview(rawWorkflow, { maxLen: 200 });

  const toolChoice = pickFirst(body, ['tool_choice', 'toolChoice']);
  const parallelToolCalls = pickFirst(body, ['parallel_tool_calls', 'parallelToolCalls']);
  const tools = pickFirst(body, ['tools']);

  return {
    method: req?.method,
    path: req?.path,
    ip: req?.ip,
    contentType: safePreview(contentType, { maxLen: 200 }),
    stream: Boolean(pickFirst(body, ['stream'])),
    model: safePreview(pickFirst(body, ['model']), { maxLen: 120 }),
    provider: safePreview(pickFirst(body, ['provider']), { maxLen: 120 }),
    llm: safePreview(pickFirst(body, ['llm']), { maxLen: 120 }),
    profile: safePreview(pickFirst(body, ['profile']), { maxLen: 120 }),
    temperature: toNum(pickFirst(body, ['temperature'])),
    max_tokens: toNum(pickFirst(body, ['max_tokens', 'maxTokens', 'max_completion_tokens', 'maxCompletionTokens'])),
    top_p: toNum(pickFirst(body, ['top_p', 'topP'])),
    tool_choice: safePreview(toolChoice, { maxLen: 200 }),
    parallel_tool_calls: toBool(parallelToolCalls),
    toolsSummary: summarizeTools(tools),
    workflow: { type: workflowType, preview: workflowPreview },
    messagesCount: Array.isArray(messages) ? messages.length : 0,
    uploadedImagesCount,
    headers: redactSecrets({
      'user-agent': req?.headers?.['user-agent'],
      'x-request-id': req?.headers?.['x-request-id'],
      'x-trace-id': req?.headers?.['x-trace-id'],
      authorization: req?.headers?.authorization,
      'api-key': req?.headers?.['api-key'],
      'content-length': req?.headers?.['content-length']
    })
  };
}

function createOpenAIChunk({ id, created, model, index = 0, delta = {}, finishReason = null, usage, mcpTools }) {
  const chunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model
  };

  if (Object.keys(delta || {}).length > 0 || finishReason !== null || usage) {
    chunk.choices = [{
      index,
      delta,
      finish_reason: finishReason
    }];
  }

  if (usage) chunk.usage = usage;
  if (Array.isArray(mcpTools) && mcpTools.length > 0) chunk.mcp_tools = mcpTools;

  return chunk;
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

  BotUtil.makeLog(
    'debug',
    `[v3/chat/completions] 入参摘要: ${safePreview(summarizeV3Request(req, body, { contentType, messages, uploadedImagesCount: uploadedImages.length }), { maxLen: 2000 })}`,
    'ai.v3.chat.completions'
  );
  
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

  const streamFlag = Boolean(pickFirst(body, ['stream']));
  const provider = resolveProviderFromRequest(body);

  if (!provider) {
    return HttpResponse.error(
      res,
      new Error('未指定有效的LLM提供商：请检查 aistream.yaml 的 llm.Provider 是否已配置，或在请求中传入 model/provider。'),
      400,
      'ai.v3.chat.completions'
    );
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

  // YAML 默认工作流 & 远程 MCP：在调用方未显式传入 workflow 时生效
  const aistreamCfg = getAistreamConfigOptional();
  const mcpCfg = aistreamCfg.mcp || {};
  const defaultStreamsCfg = Array.isArray(mcpCfg.defaultStreams) ? mcpCfg.defaultStreams.filter(Boolean) : [];
  const defaultRemoteMcpCfg = Array.isArray(mcpCfg.defaultRemoteMcp)
    ? mcpCfg.defaultRemoteMcp.filter(Boolean).map((name) => `remote-mcp.${String(name).trim()}`).filter(Boolean)
    : [];
  const mergedDefaultStreams = [...new Set([...defaultStreamsCfg, ...defaultRemoteMcpCfg])];
  const effectiveStreams = (workflowStreams && workflowStreams.length)
    ? workflowStreams
    : (mergedDefaultStreams.length ? mergedDefaultStreams : null);

  const client = LLMFactory.createClient(llmConfig);
  const overrides = {};
  // hybrid：有 body.tools 时区分中游(MCP)/下游(请求)，中游 XRK 执行、下游透传客户端
  // execute：无 body.tools 且有声明的 streams 时，仅中游由 XRK 执行
  // passthrough：无 body.tools 且无 streams 时，tool_calls 透传
  const hasRequestTools = Array.isArray(body.tools) && body.tools.length > 0;
  overrides.mcpToolMode = hasRequestTools ? 'hybrid' : (effectiveStreams?.length ? 'execute' : 'passthrough');
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
  
  if (effectiveStreams?.length) overrides.streams = effectiveStreams;

  const extraBody = parseOptionalJson(pickFirst(body, ['extraBody']));
  if (extraBody && typeof extraBody === 'object') overrides.extraBody = extraBody;

  if (!streamFlag) {
    const chatResult = await client.chat(messages, overrides);
    const text = typeof chatResult === 'string' ? chatResult : (chatResult?.content || '');
    const executedToolNames = Array.isArray(chatResult?.executedToolNames) ? chatResult.executedToolNames : [];

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
      ...(executedToolNames.length > 0 ? { mcp_tools: executedToolNames.map((name) => ({ name })) }: {}),
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
    let totalReasoningContent = '';
    let isFirstChunk = true;
    let chunkCount = 0;

    const streamCallback = (delta, metadata = {}) => {
      const hasTextDelta = typeof delta === 'string' && delta.length > 0;
      const hasMcpTools = Array.isArray(metadata?.mcp_tools) && metadata.mcp_tools.length > 0;
      const hasToolCalls = Array.isArray(metadata?.tool_calls) && metadata.tool_calls.length > 0;
      const hasReasoningDelta = typeof metadata?.reasoning_content === 'string' && metadata.reasoning_content.length > 0;

      if (!hasTextDelta && !hasMcpTools && !hasToolCalls && !hasReasoningDelta) return;

      if (hasTextDelta) {
        totalContent += delta;
        chunkCount++;

        if (chunkCount % 10 === 1 || chunkCount <= 3) {
          BotUtil.makeLog('debug', `[v3/chat/completions] 发送chunk #${chunkCount}: delta长度=${delta.length}, 总长度=${totalContent.length}`, 'ai.v3.stream');
        }

        writeSSEChunk(res, createOpenAIChunk({
          id,
          created: now,
          model: modelName,
          delta: isFirstChunk ? { role: 'assistant', content: delta } : { content: delta },
          finishReason: null
          // 工具结果统一通过“纯 mcp_tools chunk”下发，避免同一批工具在文本chunk和独立chunk中各出现一次
        }));

        isFirstChunk = false;
      }

      if (hasReasoningDelta) {
        totalReasoningContent += metadata.reasoning_content;
        writeSSEChunk(res, createOpenAIChunk({
          id,
          created: now,
          model: modelName,
          delta: isFirstChunk ? { role: 'assistant', reasoning_content: metadata.reasoning_content } : { reasoning_content: metadata.reasoning_content },
          finishReason: null
        }));
        isFirstChunk = false;
      }

      if (hasMcpTools && !hasTextDelta) {
        // 仅在真正有工具结果、且本次没有文本增量时，单独输出一条工具 chunk
        writeSSEChunk(res, createOpenAIChunk({
          id,
          created: now,
          model: modelName,
          mcpTools: metadata.mcp_tools
        }));
      }

      if (hasToolCalls) {
        // 透传上游模型产生的 tool_calls（例如 OpenClaw 自带的工具），由上游客户端自行执行
        writeSSEChunk(res, createOpenAIChunk({
          id,
          created: now,
          model: modelName,
          delta: { tool_calls: metadata.tool_calls },
          finishReason: null
        }));
      }
    };

    BotUtil.makeLog('info', `[v3/chat/completions] 调用client.chatStream开始`, 'ai.v3.stream');

    await client.chatStream(messages, streamCallback, overrides);
    BotUtil.makeLog('info', `[v3/chat/completions] chatStream完成: 总chunks=${chunkCount}, 总长度=${totalContent.length}`, 'ai.v3.stream');

    const promptText = extractMessageText(messages);
    const promptTokens = estimateTokens(promptText);
    const completionTokens = estimateTokens(totalContent);

    BotUtil.makeLog('debug', `[v3/chat/completions] 发送完成标记`, 'ai.v3.stream');
    writeSSEChunk(res, createOpenAIChunk({
      id,
      created: now,
      model: modelName,
      delta: {},
      finishReason: 'stop',
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
      // 不再在最终 usage chunk 中重复附带 mcp_tools，避免前端收到“重复/空工具卡片”事件
    }));
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
  const llm = getAistreamConfigOptional().llm || {};
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

  // 远程 MCP 服务器也视为“工作流选项”，但默认不勾选，由用户显式选择。
  const remoteServers = StreamLoader.listRemoteMCPServers?.() || [];
  const remoteWorkflows = remoteServers.map((name) => ({
    key: `remote-mcp.${name}`,
    label: `远程 MCP：${name}`,
    description: `远程 MCP 服务器 ${name}`,
    profile: null,
    persona: null,
    uiHidden: false
  }));

  return HttpResponse.success(res, {
    enabled: llm.enabled !== false,
    defaultProfile: defaultProvider,
    // 不为 MCP 工具工作流设置默认值，避免“默认就勾选一堆工具工作流/远程 MCP”
    defaultWorkflow: null,
    persona: llm.persona || '',
    profiles,
    workflows: [...workflows, ...remoteWorkflows]
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
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const authResp = ensureSystemCoreAuth(req, res, Bot, 'ai.v3.chat.completions');
        if (authResp) return authResp;
        return handleChatCompletionsV3(req, res);
      }, 'ai.v3.chat.completions')
    },
    {
      method: 'GET',
      path: '/api/v3/models',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const authResp = ensureSystemCoreAuth(req, res, Bot, 'ai.v3.models');
        if (authResp) return authResp;
        return handleModels(req, res);
      }, 'ai.v3.models')
    },
    {
      method: 'GET',
      path: '/api/ai/models',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const authResp = ensureSystemCoreAuth(req, res, Bot, 'ai.models');
        if (authResp) return authResp;
        return handleModels(req, res);
      }, 'ai.models')
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