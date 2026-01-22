import fetch from 'node-fetch';
import VisionFactory from '../vision/VisionFactory.js';

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
   * 构建请求体（OpenAI 兼容格式）
   * 小米 MiMo API 使用 max_completion_tokens 而非 max_tokens
   * 支持高级参数：stop、thinking、tool_choice、tools、response_format
   */
  buildBody(messages, overrides = {}) {
    const body = {
      model: this.config.chatModel || this.config.model || 'mimo-v2-flash',
      messages,
      temperature: this.config.temperature ?? 0.3,
      max_completion_tokens: this.config.maxTokens ?? 1024,
      top_p: this.config.topP ?? 0.95,
      stream: overrides.stream ?? false,
      frequency_penalty: this.config.frequencyPenalty ?? 0,
      presence_penalty: this.config.presencePenalty ?? 0
    };

    // 高级可选参数（仅在配置时添加）
    if (this.config.stop !== undefined) body.stop = this.config.stop;
    if (this.config.thinkingType !== undefined) body.thinking = { type: this.config.thinkingType };
    if (this.config.toolChoice !== undefined) body.tool_choice = this.config.toolChoice;
    if (this.config.tools !== undefined) body.tools = this.config.tools;
    if (this.config.response_format !== undefined) body.response_format = this.config.response_format;

    return body;
  }

  /**
   * 非流式调用
   * @param {Array} messages - OpenAI 风格 messages
   * @param {Object} overrides - 临时覆盖参数
   * @returns {Promise<string>} - 回复文本
   */
  async chat(messages, overrides = {}) {
    // 转换消息格式，经由 VisionFactory 抽离识图能力
    const transformedMessages = await this.transformMessages(messages);

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
    // 转换消息格式，经由 VisionFactory 抽离识图能力
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


