import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { ensureMessagesImagesDataUrl } from '../../utils/llm/image-utils.js';
import { iterateSSE } from '../../utils/llm/sse-utils.js';
import { MCPToolAdapter } from '../../utils/llm/mcp-tool-adapter.js';
import BotUtil from '../../utils/botutil.js';

function pick(overrides, config, keys) {
  for (const k of keys) {
    if (overrides?.[k] !== undefined) return overrides[k];
    if (config?.[k] !== undefined) return config[k];
  }
  return undefined;
}

function isOpenAIResponsesBuiltInTool(tool) {
  const type = String(tool?.type || '').trim();
  return type === 'web_search' || type === 'web_search_preview' || type === 'file_search' || type === 'code_interpreter' || type === 'computer_use_preview' || type === 'image_generation';
}

function normalizeInputPart(part) {
  if (part.type === 'text') {
    return { type: 'input_text', text: String(part.text || '') };
  }
  if (part.type === 'image_url' && part.image_url?.url) {
    return { type: 'input_image', image_url: String(part.image_url.url) };
  }
  return part;
}

function toResponsesInput(messages = []) {
  return messages.map((m) => ({
    role: m.role || 'user',
    content: Array.isArray(m.content)
      ? m.content.map(normalizeInputPart)
      : typeof m.content === 'string'
        ? [{ type: 'input_text', text: m.content }]
        : [{ type: 'input_text', text: m.content?.text || '' }]
  }));
}

function extractResponsesText(resp) {
  if (typeof resp?.output_text === 'string' && resp.output_text) return resp.output_text;
  const outputs = Array.isArray(resp?.output) ? resp.output : [];
  const chunks = [];

  for (const item of outputs) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      if (typeof c?.text === 'string' && c.text) chunks.push(c.text);
    }
  }

  return chunks.join('');
}

function extractFunctionCalls(resp) {
  const outputs = Array.isArray(resp.output) ? resp.output : [];
  return outputs.filter((item) => item.type === 'function_call' && item.name);
}

export default class OpenAIResponsesCompatibleLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout ?? 360000;
  }

  normalizeEndpoint(config) {
    const base = (config.baseUrl ?? '').replace(/\/+$/, '');
    const path = (config.path || '/v1/responses').replace(/^\/?/, '/');
    if (!base) {
      throw new Error('openai_responses_compat: 未配置 baseUrl（Responses 兼容接口地址）');
    }
    return `${base}${path}`;
  }

  get timeout() {
    return this._timeout ?? 360000;
  }

  buildHeaders(extra = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...extra
    };

    if (this.config.apiKey) {
      const mode = String(this.config.authMode || 'bearer').toLowerCase();
      const apiKey = String(this.config.apiKey).trim();
      if (mode === 'api-key') {
        headers['api-key'] = apiKey;
      } else if (mode === 'header') {
        const name = String(this.config.authHeaderName ?? '').trim();
        if (!name) throw new Error('openai_responses_compat: authMode=header 时必须提供 authHeaderName');
        headers[name] = apiKey;
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }
    }

    if (this.config.headers) Object.assign(headers, this.config.headers);
    return headers;
  }

  async transformMessages(messages) {
    return await transformMessagesWithVision(messages, this.config, { mode: 'openai' });
  }

  buildBody(input, overrides = {}, { stream = false, previousResponseId } = {}) {
    const body = {
      model: pick(overrides, this.config, ['model', 'chatModel']),
      input,
      stream
    };

    const temperature = pick(overrides, this.config, ['temperature']);
    if (temperature !== undefined) body.temperature = temperature;

    const maxTokens = pick(overrides, this.config, ['maxOutputTokens', 'max_output_tokens', 'maxTokens', 'max_tokens', 'maxCompletionTokens']);
    if (maxTokens !== undefined) body.max_output_tokens = maxTokens;

    const topP = pick(overrides, this.config, ['topP', 'top_p']);
    if (topP !== undefined) body.top_p = topP;

    const serviceTier = pick(overrides, this.config, ['service_tier', 'serviceTier']);
    if (serviceTier !== undefined) body.service_tier = serviceTier;

    const promptCacheKey = pick(overrides, this.config, ['prompt_cache_key', 'promptCacheKey']);
    if (promptCacheKey !== undefined) body.prompt_cache_key = promptCacheKey;

    const promptCacheRetention = pick(overrides, this.config, ['prompt_cache_retention', 'promptCacheRetention']);
    if (promptCacheRetention !== undefined) body.prompt_cache_retention = promptCacheRetention;

    const safetyIdentifier = pick(overrides, this.config, ['safety_identifier', 'safetyIdentifier']);
    if (safetyIdentifier !== undefined) body.safety_identifier = safetyIdentifier;

    const instructions = pick(overrides, this.config, ['instructions']);
    if (instructions !== undefined) body.instructions = instructions;

    const textFormat = pick(overrides, this.config, ['text', 'text_format', 'textFormat']);
    if (textFormat && typeof textFormat === 'object') {
      body.text = textFormat.format ? textFormat : { format: textFormat };
    }

    const responseFormat = pick(overrides, this.config, ['response_format', 'responseFormat']);
    if (!body.text && responseFormat && typeof responseFormat === 'object') {
      body.text = { format: responseFormat };
    }

    const verbosity = pick(overrides, this.config, ['verbosity']);
    if (verbosity !== undefined) {
      body.text = body.text && typeof body.text === 'object' ? body.text : {};
      body.text.verbosity = verbosity;
    }

    if (previousResponseId) body.previous_response_id = previousResponseId;

    const maxToolCalls = pick(overrides, this.config, ['max_tool_calls', 'maxToolCalls']);
    if (maxToolCalls !== undefined) body.max_tool_calls = maxToolCalls;

    const parallelToolCalls = pick(overrides, this.config, ['parallel_tool_calls', 'parallelToolCalls']);
    if (parallelToolCalls !== undefined) body.parallel_tool_calls = parallelToolCalls;

    const tools = this.buildTools(overrides);
    if (tools) body.tools = tools;

    const toolChoice = pick(overrides, this.config, ['tool_choice', 'toolChoice']);
    if (toolChoice !== undefined) body.tool_choice = toolChoice;

    const extraBody = pick(overrides, this.config, ['extraBody']);
    if (this.config.extraBody && typeof this.config.extraBody === 'object') Object.assign(body, this.config.extraBody);
    if (extraBody && typeof extraBody === 'object') Object.assign(body, extraBody);

    return body;
  }

  buildTools(overrides = {}) {
    if (Object.hasOwn(overrides, 'tools')) return overrides.tools || undefined;

    const workflow = overrides.workflow || this.config.workflow || this.config.streamName || null;
    const streams = Array.isArray(overrides.streams) ? overrides.streams : null;

    const mcpTools = this.config.enableTools !== false && MCPToolAdapter.hasTools()
      ? MCPToolAdapter.convertMCPToolsToOpenAI({ workflow, streams, excludeStreams: ['chat'] })
      : [];

    const customTools = Array.isArray(this.config.tools) ? this.config.tools : [];

    const merged = [...mcpTools, ...customTools]
      .map((tool) => {
        if (!tool || typeof tool !== 'object') return null;
        if (isOpenAIResponsesBuiltInTool(tool)) return tool;

        // Chat 风格 function tool -> Responses function tool
        if (tool.type === 'function' && tool.function?.name) {
          return {
            type: 'function',
            name: tool.function.name,
            description: tool.function.description || '',
            parameters: tool.function.parameters || { type: 'object', properties: {}, required: [] }
          };
        }

        // 已是 Responses function tool
        if (tool.type === 'function' && tool.name) {
          return {
            type: 'function',
            name: tool.name,
            description: tool.description || '',
            parameters: tool.parameters || { type: 'object', properties: {}, required: [] }
          };
        }

        return null;
      })
      .filter(Boolean);

    return merged.length ? merged : undefined;
  }

  async executeResponsesFunctionCalls(functionCalls, overrides = {}, onDelta) {
    if (!Array.isArray(functionCalls) || !functionCalls.length) return [];

    const openaiToolCalls = functionCalls.map((fc, idx) => ({
      id: fc.call_id || fc.id || `call_${idx}_${String(fc.name || 'tool').replace(/\W/g, '_')}`,
      type: 'function',
      function: {
        name: String(fc.name || ''),
        arguments: typeof fc.arguments === 'string' ? fc.arguments : JSON.stringify(fc.arguments || {})
      }
    }));

    const streams = Array.isArray(overrides.streams) ? overrides.streams : null;
    const toolResults = await MCPToolAdapter.handleToolCalls(openaiToolCalls, { streams });

    if (typeof onDelta === 'function') {
      const mcpTools = openaiToolCalls.map((tc, idx) => ({
        name: tc.function?.name || `工具${idx + 1}`,
        arguments: tc.function?.arguments || '{}',
        result: toolResults[idx]?.content ?? ''
      }));
      onDelta('', { mcp_tools: mcpTools });
    }

    return functionCalls.map((fc, idx) => ({
      type: 'function_call_output',
      call_id: fc.call_id || fc.id || openaiToolCalls[idx].id,
      output: toolResults[idx]?.content ?? ''
    }));
  }

  async requestResponses(input, overrides = {}, opts = {}) {
    const body = this.buildBody(input, overrides, opts);
    const resp = await fetch(
      this.endpoint,
      buildFetchOptionsWithProxy(this.config, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout)
      })
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`openai_responses_compat 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    return resp;
  }

  async chat(messages, overrides = {}) {
    const transformed = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformed, { timeoutMs: this.timeout });

    let input = toResponsesInput(transformed);
    let previousResponseId = undefined;
    const maxToolRounds = this.config.maxToolRounds || 7;
    const executedToolNames = [];

    for (let round = 0; round < maxToolRounds; round++) {
      const resp = await this.requestResponses(input, overrides, { stream: false, previousResponseId });
      const json = await resp.json();
      previousResponseId = json?.id || previousResponseId;

      const functionCalls = extractFunctionCalls(json);
      if (!functionCalls.length) {
        const text = extractResponsesText(json);
        return executedToolNames.length ? { content: text, executedToolNames } : text;
      }

      for (const fc of functionCalls) {
        if (fc?.name && !executedToolNames.includes(fc.name)) executedToolNames.push(fc.name);
      }

      input = await this.executeResponsesFunctionCalls(functionCalls, overrides);
    }

    BotUtil.makeLog('warn', `[OpenAIResponsesCompatibleLLMClient] 达到最大工具调用轮数: ${maxToolRounds}`, 'LLMFactory');
    return executedToolNames.length ? { content: '', executedToolNames } : '';
  }

  async chatStream(messages, onDelta, overrides = {}) {
    const transformed = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformed, { timeoutMs: this.timeout });

    const input = toResponsesInput(transformed);
    const resp = await this.requestResponses(input, overrides, { stream: true });

    if (!resp.body) {
      throw new Error('openai_responses_compat 流式请求失败: 响应体为空');
    }

    for await (const { data } of iterateSSE(resp)) {
      try {
        const evt = JSON.parse(data);
        const type = evt?.type;

        if (type === 'response.output_text.delta' && typeof evt.delta === 'string' && evt.delta) {
          if (typeof onDelta === 'function') onDelta(evt.delta);
        }
      } catch (e) {
        BotUtil.makeLog('warn', `[OpenAIResponsesCompatibleLLMClient] SSE JSON解析失败: ${e.message}`, 'LLMFactory');
      }
    }
  }
}
