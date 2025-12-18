import fetch from 'node-fetch';

/**
 * 小米 MiMo LLM 客户端
 *
 * 仅文本大模型调用，不包含任何识图逻辑。
 * 默认使用 OpenAI 兼容 Chat Completions 接口：
 * - baseUrl: https://api.xiaomimimo.com/v1
 * - path: /chat/completions
 * - 认证头：api-key: $MIMO_API_KEY
 */
export default class XiaomiMiMoLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout || 360000;
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
   * 转换消息格式，确保所有消息的 content 是字符串
   * MiMo 仅支持文本，不支持图片，所以需要将对象格式的 content 转换为字符串
   * @param {Array} messages - 消息数组
   * @returns {Array} 转换后的消息数组
   */
  transformMessages(messages) {
    if (!Array.isArray(messages)) return messages;

    return messages.map(msg => {
      const newMsg = { ...msg };

      // 如果 content 是对象，转换为字符串（MiMo 只支持字符串格式的 content）
      if (msg.content && typeof msg.content === 'object') {
        // 提取文本内容（支持多种可能的字段名）
        const text = msg.content.text || msg.content.content || '';
        // MiMo 不支持图片和多模态，忽略图片相关字段，仅使用文本
        newMsg.content = text || '';
      } else if (msg.content === null || msg.content === undefined) {
        // 确保 content 不为 null 或 undefined
        newMsg.content = '';
      } else if (typeof msg.content !== 'string') {
        // 如果 content 不是字符串也不是对象（如数组），尝试转换为字符串
        newMsg.content = String(msg.content || '');
      }

      return newMsg;
    });
  }

  /**
   * 构建请求体（OpenAI 兼容格式）
   */
  buildBody(messages, overrides = {}) {
    const {
      model,
      temperature,
      maxTokens,
      topP,
      frequencyPenalty,
      presencePenalty,
      stream,
      extraBody,
      thinkingType,
      tool_choice,
      tools,
      response_format
    } = overrides;

    const body = {
      model: model || this.config.chatModel || this.config.model || 'mimo-v2-flash',
      messages,
      temperature: temperature ?? this.config.temperature ?? 0.3,
      max_completion_tokens: maxTokens ?? this.config.maxTokens ?? 1024,
      top_p: topP ?? this.config.topP ?? 0.95,
      stream: stream ?? false,
      stop: overrides.stop ?? this.config.stop ?? null,
      frequency_penalty: frequencyPenalty ?? this.config.frequencyPenalty ?? 0,
      presence_penalty: presencePenalty ?? this.config.presencePenalty ?? 0
    };

    // 思维链配置：映射为 thinking.type
    const finalThinkingType = thinkingType ?? this.config.thinkingType;
    if (finalThinkingType) {
      body.thinking = { type: finalThinkingType };
    }

    // 工具调用相关参数
    const finalToolChoice = tool_choice ?? this.config.toolChoice;
    if (finalToolChoice) {
      body.tool_choice = finalToolChoice;
    }
    const finalTools = tools ?? this.config.tools;
    if (finalTools) {
      body.tools = finalTools;
    }

    // 响应格式（例如强制 JSON 输出）
    const finalResponseFormat = response_format ?? this.config.response_format;
    if (finalResponseFormat) {
      body.response_format = finalResponseFormat;
    }

    // 合并额外 body 配置（如 thinking 开关等）
    if (this.config.extraBody && typeof this.config.extraBody === 'object') {
      Object.assign(body, this.config.extraBody);
    }
    if (extraBody && typeof extraBody === 'object') {
      Object.assign(body, extraBody);
    }

    return body;
  }

  /**
   * 非流式调用
   * @param {Array} messages - OpenAI 风格 messages
   * @param {Object} overrides - 临时覆盖参数
   * @returns {Promise<string>} - 回复文本
   */
  async chat(messages, overrides = {}) {
    // 转换消息格式，确保 content 为字符串
    const transformedMessages = this.transformMessages(messages);

    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: JSON.stringify(this.buildBody(transformedMessages, overrides)),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`小米 MiMo LLM 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    const data = await resp.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  /**
   * 流式调用
   * @param {Array} messages - OpenAI 风格 messages
   * @param {Function} onDelta - (delta: string) => void
   * @param {Object} overrides - 临时覆盖参数
   * @returns {Promise<void>}
   */
  async chatStream(messages, onDelta, overrides = {}) {
    // 转换消息格式，确保 content 为字符串
    const transformedMessages = this.transformMessages(messages);

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

        if (!line || !line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          return;
        }

        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta && typeof onDelta === 'function') {
            onDelta(delta);
          }
        } catch {
          // 忽略解析错误，继续读取
        }
      }
    }
  }
}


