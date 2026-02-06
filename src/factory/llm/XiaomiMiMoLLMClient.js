import fetch from 'node-fetch';
import { MCPToolAdapter } from '../../utils/llm/mcp-tool-adapter.js';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';

/**
 * 小米 MiMo LLM 客户端
 *
 * 默认使用 OpenAI 兼容 Chat Completions 接口：
 * - baseUrl: https://api.xiaomimimo.com/v1
 * - path: /chat/completions
 * - 认证头：api-key: $MIMO_API_KEY
 *
 * 模型本身是纯文本的，图片由上游转为简单的占位文本后再交给 MiMo 处理（不再依赖独立的识图工厂）。
 */
export default class XiaomiMiMoLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout || 360000;
    // 工具名称映射：规范化名称 -> 原始名称
    this._toolNameMap = new Map();
  }

  /**
   * 规范化端点地址
   */
  normalizeEndpoint(config) {
    const base = (config.baseUrl || 'https://api.xiaomimimo.com/v1').replace(/\/+$/, '');
    const path = (config.path || '/chat/completions').replace(/^\/?/, '/');
    return `${base}${path}`;
  }

  /**
   * 获取超时时间
   */
  get timeout() {
    return this._timeout || 360000;
  }

  /**
   * 构建请求头
   */
  buildHeaders(extra = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...extra
    };

    // 小米 MiMo 支持两种认证方式：api-key 或 Authorization: Bearer
    if (this.config.apiKey) {
      const mode = (this.config.authMode || 'api-key').toLowerCase();
      if (mode === 'bearer') {
        headers.Authorization = `Bearer ${this.config.apiKey}`;
      } else {
        headers['api-key'] = this.config.apiKey;
      }
    }

    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  async transformMessages(messages) {
    // MiMo 当前仅文本，退化为 text_only，占位拼接图片 URL / base64 方便调试
    return await transformMessagesWithVision(messages, this.config, { mode: 'text_only' });
  }

  /**
   * 规范化工具名称以符合小米 MiMo API 要求
   * 要求：只能包含 a-z、A-Z、0-9、下划线(_)和连字符(-)，最大长度64
   * @param {string} originalName - 原始工具名称（可能包含点号等）
   * @returns {string} 规范化后的名称
   */
  normalizeToolName(originalName) {
    if (!originalName || typeof originalName !== 'string') return originalName;
    
    // 将点号替换为下划线，移除其他不符合要求的字符
    let normalized = originalName
      .replace(/\./g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 64);
    
    // 确保不以数字开头
    if (/^\d/.test(normalized)) {
      normalized = 'tool_' + normalized;
    }
    
    // 存储映射关系
    this._toolNameMap.set(normalized, originalName);
    return normalized;
  }

  /**
   * 将规范化的工具名称还原为原始名称
   * @param {string} normalizedName - 规范化后的名称
   * @returns {string} 原始工具名称
   */
  denormalizeToolName(normalizedName) {
    return this._toolNameMap.get(normalizedName) || normalizedName;
  }

  /**
   * 规范化工具列表中的名称
   * @param {Array} tools - 工具列表
   * @returns {Array} 规范化后的工具列表
   */
  normalizeTools(tools) {
    if (!Array.isArray(tools)) return tools;
    return tools.map(tool => {
      if (tool?.type === 'function' && tool.function?.name) {
        return {
          ...tool,
          function: { ...tool.function, name: this.normalizeToolName(tool.function.name) }
        };
      }
      return tool;
    });
  }

  /**
   * 规范化消息数组中的 tool_calls
   * @param {Array} messages - 消息数组
   * @returns {Array} 规范化后的消息数组
   */
  normalizeMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map(msg => {
      if (msg.tool_calls?.length > 0) {
        return {
          ...msg,
          tool_calls: msg.tool_calls.map(tc => ({
            ...tc,
            function: tc.function?.name
              ? { ...tc.function, name: this.normalizeToolName(tc.function.name) }
              : tc.function
          }))
        };
      }
      return msg;
    });
  }

  /**
   * 还原工具调用中的名称
   * @param {Array} toolCalls - 工具调用列表
   * @returns {Array} 还原后的工具调用列表
   */
  denormalizeToolCalls(toolCalls) {
    if (!Array.isArray(toolCalls)) return toolCalls;
    return toolCalls.map(tc => {
      if (tc.function?.name) {
        return {
          ...tc,
          function: { ...tc.function, name: this.denormalizeToolName(tc.function.name) }
        };
      }
      return tc;
    });
  }

  /**
   * 构建请求体（OpenAI 兼容格式）
   * 小米 MiMo API 使用 max_completion_tokens 而非 max_tokens
   * 支持高级参数：stop、thinking、tool_choice、tools、response_format
   */
  buildBody(messages, overrides = {}) {
    // 规范化消息中的 tool_calls（多轮工具调用时需要）
    const normalizedMessages = this.normalizeMessages(messages);
    
    const body = {
      model: this.config.chatModel || this.config.model || 'mimo-v2-flash',
      messages: normalizedMessages,
      temperature: this.config.temperature ?? 0.3,
      max_completion_tokens: this.config.maxTokens ?? 1024,
      top_p: this.config.topP ?? 0.95,
      stream: overrides.stream ?? false,
      frequency_penalty: this.config.frequencyPenalty ?? 0,
      presence_penalty: this.config.presencePenalty ?? 0
    };

    if (this.config.stop !== undefined) body.stop = this.config.stop;
    if (this.config.thinkingType !== undefined) body.thinking = { type: this.config.thinkingType };
    if (this.config.response_format !== undefined) body.response_format = this.config.response_format;

    // 工具调用支持
    const enableTools = this.config.enableTools !== false && MCPToolAdapter.hasTools();
    let tools = overrides.tools ?? this.config.tools;
    
    if (!tools && enableTools) {
      tools = MCPToolAdapter.convertMCPToolsToOpenAI();
    }
    
    if (tools?.length > 0) {
      body.tools = this.normalizeTools(tools);
      body.tool_choice = overrides.tool_choice ?? this.config.toolChoice ?? 'auto';
    }

    return body;
  }

  /**
   * 非流式调用（支持工具调用）
   * @param {Array} messages - 消息数组
   * @param {Object} overrides - 覆盖配置
   * @returns {Promise<string>} AI 回复文本
   */
  async chat(messages, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    const maxToolRounds = this.config.maxToolRounds || 5;
    const currentMessages = [...transformedMessages];

    for (let round = 0; round < maxToolRounds; round++) {
      const resp = await fetch(
        this.endpoint,
        buildFetchOptionsWithProxy(this.config, {
          method: 'POST',
          headers: this.buildHeaders(overrides.headers),
          body: JSON.stringify(this.buildBody(currentMessages, overrides)),
          signal: AbortSignal.timeout(this.timeout)
        })
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`小米 MiMo LLM 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
      }

      const data = await resp.json();
      const message = data?.choices?.[0]?.message;
      if (!message) break;

      if (message.tool_calls?.length > 0) {
        const denormalizedToolCalls = this.denormalizeToolCalls(message.tool_calls);
        currentMessages.push({ ...message, tool_calls: denormalizedToolCalls });
        currentMessages.push(...await MCPToolAdapter.handleToolCalls(denormalizedToolCalls));
        continue;
      }

      return message.content || '';
    }

    return currentMessages[currentMessages.length - 1]?.content || '';
  }

  async _consumeSSE(resp, onDelta) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE：以空行分隔事件（兼容多行 data:）
      let sep;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const dataLines = chunk
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).trim());

        if (!dataLines.length) continue;
        const payload = dataLines.join('\n');
        if (payload === '[DONE]') return;

        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta;
          if (delta?.content && typeof onDelta === 'function') {
            onDelta(delta.content);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * 流式调用
   * @param {Array} messages - 消息数组
   * @param {Function} onDelta - 每个数据块的回调函数
   * @param {Object} overrides - 覆盖配置
   * @returns {Promise<void>}
   */
  async chatStream(messages, onDelta, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    const resp = await fetch(
      this.endpoint,
      buildFetchOptionsWithProxy(this.config, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
        body: JSON.stringify(this.buildBody(transformedMessages, { ...overrides, stream: true })),
        signal: AbortSignal.timeout(this.timeout)
      })
    );

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`小米 MiMo LLM 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }
    await this._consumeSSE(resp, onDelta);
  }
}
