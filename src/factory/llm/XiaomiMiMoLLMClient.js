import fetch from 'node-fetch';
import VisionFactory from '../vision/VisionFactory.js';
import { MCPToolAdapter } from './mcp-tool-adapter.js';

/**
 * 小米 MiMo LLM 客户端
 *
 * 默认使用 OpenAI 兼容 Chat Completions 接口：
 * - baseUrl: https://api.xiaomimimo.com/v1
 * - path: /chat/completions
 * - 认证头：api-key: $MIMO_API_KEY
 *
 * 模型本身是纯文本的，图片统一通过 VisionFactory 转成描述文本后再交给 MiMo 处理。
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

  /**
   * 通过识图工厂把图片转成文本描述，再交给 MiMo 文本模型处理
   * @param {Array} messages - 原始消息数组
   * @returns {Promise<Array>} 转换后的消息数组（content 变为纯字符串）
   */
  async transformMessages(messages) {
    if (!Array.isArray(messages)) return messages;

    const transformed = [];

    // 识图配置：由 AIStream.resolveLLMConfig 注入 visionProvider 和 visionConfig
    const visionProvider = (this.config.visionProvider || this.config.provider || 'gptgod').toLowerCase();
    const visionConfig = this.config.visionConfig || {};

    let visionClient = null;
    if (VisionFactory.hasProvider(visionProvider) && visionConfig.apiKey) {
      visionClient = VisionFactory.createClient({
        provider: visionProvider,
        ...visionConfig
      });
    }

    for (const msg of messages) {
      const newMsg = { ...msg };

      if (msg.role === 'user' && msg.content && typeof msg.content === 'object') {
        // 用户消息支持多模态：text + images/replyImages
        const text = msg.content.text || msg.content.content || '';
        const images = msg.content.images || [];
        const replyImages = msg.content.replyImages || [];
        const allImages = [...replyImages, ...images];

        if (!visionClient || allImages.length === 0) {
          // 没有可用的识图客户端或没有图片，直接退化为仅文本
          newMsg.content = text || '';
        } else {
          const descList = await visionClient.recognizeImages(allImages);
          const parts = [];

          allImages.forEach((img, idx) => {
            const desc = descList[idx] || '识别失败';
            const prefix = replyImages.includes(img) ? '[回复图片:' : '[图片:';
            parts.push(`${prefix}${desc}]`);
          });

          newMsg.content = text + (parts.length ? ' ' + parts.join(' ') : '');
        }
      } else if (newMsg.content && typeof newMsg.content === 'object') {
        // 其他角色如果误传了对象，也退化为纯文本
        newMsg.content = newMsg.content.text || newMsg.content.content || '';
      } else if (newMsg.content == null) {
        newMsg.content = '';
      }

      transformed.push(newMsg);
    }

    return transformed;
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
   * @param {Array} messages - OpenAI 风格 messages
   * @param {Object} overrides - 临时覆盖参数
   * @returns {Promise<string>} - 回复文本
   */
  async chat(messages, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    const maxToolRounds = this.config.maxToolRounds || 5;
    let currentMessages = [...transformedMessages];

    for (let round = 0; round < maxToolRounds; round++) {
      const resp = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
        body: JSON.stringify(this.buildBody(currentMessages, overrides)),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`小米 MiMo LLM 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
      }

      const data = await resp.json();
      const message = data?.choices?.[0]?.message;
      if (!message) break;

      if (message.tool_calls?.length > 0) {
        // 还原工具名称用于调用 MCP 工具
        const denormalizedToolCalls = this.denormalizeToolCalls(message.tool_calls);
        currentMessages.push({ ...message, tool_calls: denormalizedToolCalls });
        currentMessages.push(...await MCPToolAdapter.handleToolCalls(denormalizedToolCalls));
        continue;
      }

      return message.content || '';
    }

    return currentMessages[currentMessages.length - 1]?.content || '';
  }

  /**
   * 流式调用（支持工具调用）
   * @param {Array} messages - OpenAI 风格 messages
   * @param {Function} onDelta - (delta: string) => void
   * @param {Object} overrides - 临时覆盖参数
   * @returns {Promise<void>}
   */
  async chatStream(messages, onDelta, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: JSON.stringify(this.buildBody(transformedMessages, { ...overrides, stream: true })),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`小米 MiMo LLM 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const reader = resp.body.getReader();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);

        if (!line?.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;

        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta;
          if (delta?.content && typeof onDelta === 'function') {
            onDelta(delta.content);
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  }
}
