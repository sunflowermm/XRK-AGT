import { MCPToolAdapter } from '../../utils/llm/mcp-tool-adapter.js';
import { buildOpenAIChatCompletionsBody, applyOpenAITools } from '../../utils/llm/openai-chat-utils.js';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';
import { ensureMessagesImagesDataUrl } from '../../utils/llm/image-utils.js';
import BotUtil from '../../utils/botutil.js';
import { iterateSSE } from '../../utils/llm/sse-utils.js';

/**
 * OpenAI 兼容第三方 LLM 客户端（OpenAI-like / OpenAI-Compatible）
 *
 * 职责与特性：
 * - 接入各种第三方“OpenAI 协议”接口（可自定义 baseUrl/path/headers/认证/额外参数）
 * - 统一多模态消息结构：通过 `transformMessagesWithVision` 构造 text + image_url（含 base64 data URL）
 * - 支持 MCP tool calling：完整支持 OpenAI tools / tool_calls 协议，多轮工具调用
 * - chat：单次请求内自动执行工具调用（非流式），最终返回纯文本回答
 * - chatStream：基于 iterateSSE 解析 SSE，边流式输出 delta.content，边累计 tool_calls 分片并在一轮结束后执行工具
 * - streams：从 overrides.streams 读取当前工作流白名单，透传给 MCPToolAdapter，用于限制可用工具
 *
 * 常用配置（来自 cfg.*_llm）：
 * - baseUrl: 第三方 API base（例如 https://xxx.com/v1）
 * - path: 默认为 /chat/completions，也可配置成 /v1/chat/completions、/api/v3/chat/completions 等
 * - apiKey: 密钥
 * - authMode:
 *   - bearer（默认）：Authorization: Bearer ${apiKey}
 *   - api-key：api-key: ${apiKey}
 *   - header：使用 authHeaderName 指定头名
 * - authHeaderName: authMode=header 时使用（例如 X-Api-Key）
 * - extraBody: 额外请求体字段（原样透传到下游）
 * - maxToolRounds: 允许的最大工具调用轮数，防止死循环
 */
export default class OpenAICompatibleLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout ?? 360000;
  }

  normalizeEndpoint(config) {
    const base = (config.baseUrl ?? '').replace(/\/+$/, '');
    const path = (config.path || '/chat/completions').replace(/^\/?/, '/');
    if (!base) {
      throw new Error('openai_compat: 未配置 baseUrl（第三方 OpenAI 兼容接口地址）');
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
        if (!name) {
          throw new Error('openai_compat: authMode=header 时必须提供 authHeaderName');
        }
        headers[name] = apiKey;
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }
    }

    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  async transformMessages(messages) {
    // OpenAI 兼容第三方：假定支持 Chat Completions 多模态协议
    return await transformMessagesWithVision(messages, this.config, { mode: 'openai' });
  }

  buildBody(messages, overrides = {}) {
    const body = buildOpenAIChatCompletionsBody(messages, this.config, overrides, 'gpt-4o-mini');
    applyOpenAITools(body, this.config, overrides);
    return body;
  }

  async chat(messages, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformedMessages, { timeoutMs: this.timeout });
    const maxToolRounds = this.config.maxToolRounds || 7;
    const currentMessages = [...transformedMessages];

    for (let round = 0; round < maxToolRounds; round++) {
      const resp = await fetch(
        this.endpoint,
        buildFetchOptionsWithProxy(this.config, {
          method: 'POST',
          headers: this.buildHeaders(overrides.headers),
          body: JSON.stringify(this.buildBody(currentMessages, { ...overrides })),
          signal: AbortSignal.timeout(this.timeout)
        })
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`openai_compat 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
      }

      const result = await resp.json();
      const message = result?.choices?.[0]?.message;
      if (!message) break;

      if (message.tool_calls?.length > 0) {
        currentMessages.push(message);
        currentMessages.push(...await MCPToolAdapter.handleToolCalls(message.tool_calls));
        continue;
      }

      return message.content || '';
    }

    return currentMessages[currentMessages.length - 1]?.content || '';
  }

  async chatStream(messages, onDelta, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformedMessages, { timeoutMs: this.timeout });
    
    // 检查是否需要处理工具调用
    const maxToolRounds = this.config.maxToolRounds || 7;
    let currentMessages = [...transformedMessages];
    let round = 0;
    let resp = null;
    
    while (round < maxToolRounds) {
      // 发起流式请求
      resp = await fetch(
        this.endpoint,
        buildFetchOptionsWithProxy(this.config, {
          method: 'POST',
          headers: this.buildHeaders(overrides.headers),
          body: JSON.stringify(this.buildBody(currentMessages, { ...overrides, stream: true })),
          signal: AbortSignal.timeout(this.timeout)
        })
      );

      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => '');
        throw new Error(`openai_compat 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
      }
      
      // 收集工具调用信息
      const toolCallsCollector = {
        toolCalls: [],
        content: '',
        finishReason: null
      };
      
      await this._consumeSSEWithToolCalls(resp, onDelta, toolCallsCollector);
      
      // 如果收集到了工具调用，执行工具调用并继续
      if (toolCallsCollector.toolCalls.length > 0 && toolCallsCollector.finishReason === 'tool_calls') {
        BotUtil.makeLog('info', `[OpenAICompatibleLLMClient] 检测到工具调用，执行工具: ${toolCallsCollector.toolCalls.length}个`, 'LLMFactory');
        
        // 构建工具调用消息
        const toolCallMessage = {
          role: 'assistant',
          tool_calls: toolCallsCollector.toolCalls,
          content: null
        };
        currentMessages.push(toolCallMessage);
        
        // 执行工具调用（传递streams参数用于权限验证）
        const streams = Array.isArray(overrides.streams) ? overrides.streams : null;
        const toolResults = await MCPToolAdapter.handleToolCalls(toolCallsCollector.toolCalls, { streams });
        currentMessages.push(...toolResults);
        
        // 继续下一轮
        round++;
        if (round >= maxToolRounds) {
          BotUtil.makeLog('warn', `[OpenAICompatibleLLMClient] 达到最大工具调用轮数: ${maxToolRounds}`, 'LLMFactory');
          break;
        }
        
        // 继续循环，发起新的流式请求
        continue;
      }
      
      // 如果有内容输出，或者没有工具调用，结束
      if (toolCallsCollector.content || !toolCallsCollector.toolCalls.length) {
        break;
      }
      
      round++;
    }
  }
  
  async _consumeSSEWithToolCalls(resp, onDelta, collector) {
    const toolCallsMap = new Map(); // 用于收集分块的tool_calls

    for await (const { data } of iterateSSE(resp)) {
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta;
        const finishReason = json?.choices?.[0]?.finish_reason;

        if (finishReason) {
          collector.finishReason = finishReason;
        }

        // 处理文本内容
        if (delta?.content && typeof delta.content === 'string' && delta.content.length > 0) {
          collector.content += delta.content;
          if (typeof onDelta === 'function') onDelta(delta.content);
        }

        // 收集工具调用（流式工具调用是分块的）
        if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            if (index === undefined || index === null) continue;

            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, {
                id: '',
                type: 'function',
                function: { name: '', arguments: '' }
              });
            }

            const toolCall = toolCallsMap.get(index);
            if (tc.id) toolCall.id = tc.id;
            if (tc.function?.name) toolCall.function.name = tc.function.name;
            if (tc.function?.arguments) {
              toolCall.function.arguments += tc.function.arguments;
            }
          }
        }
      } catch (e) {
        BotUtil.makeLog('warn', `[OpenAICompatibleLLMClient] _consumeSSEWithToolCalls JSON解析失败: ${e.message}`, 'LLMFactory');
      }
    }

    if (toolCallsMap.size > 0) {
      const sortedIndices = Array.from(toolCallsMap.keys()).sort((a, b) => a - b);
      collector.toolCalls = sortedIndices.map(index => toolCallsMap.get(index));
      BotUtil.makeLog('info', `[OpenAICompatibleLLMClient] 收集到${collector.toolCalls.length}个工具调用`, 'LLMFactory');
    }
  }
}

