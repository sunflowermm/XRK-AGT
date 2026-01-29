import fetch from 'node-fetch';
import VisionFactory from '../vision/VisionFactory.js';

/**
 * GPTGod LLM 客户端
 * 支持聊天和识图功能
 * 
 * 识图说明（经由 VisionFactory 抽离）：
 * - LLM 本身不再直接下载/上传图片，而是把图片 URL / 本地路径交给识图工厂
 * - 识图工厂根据 aistream.yaml 中的 vision.Provider 选择运营商（如 gptgod）
 * - 识图结果拼接回 user 文本，兼容原有「[图片:描述]」格式
 */
export default class GPTGodLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this.timeout = config.timeout || 360000;
  }

  /**
   * 规范化端点地址
   */
  normalizeEndpoint(config) {
    const base = (config.baseUrl || 'https://api.gptgod.online/v1').replace(/\/+$/, '');
    const path = (config.path || '/chat/completions').replace(/^\/?/, '/');
    return `${base}${path}`;
  }

  /**
   * 构建请求头
   */
  buildHeaders(extra = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...extra
    };
    
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    
    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }
    
    return headers;
  }

  /**
   * 构建请求体
   * GPTGod API 兼容 OpenAI Chat Completions 格式
   * 支持所有标准参数：temperature、max_tokens、top_p、presence_penalty、frequency_penalty
   */
  buildBody(messages, overrides = {}) {
    const body = {
      model: this.config.chatModel || 'gemini-exp-1114',
      messages,
      temperature: this.config.temperature ?? 0.8,
      max_tokens: this.config.maxTokens ?? 6000,
      stream: overrides.stream ?? false
    };

    // 可选参数（仅在配置时添加）
    if (this.config.topP !== undefined) body.top_p = this.config.topP;
    if (this.config.presencePenalty !== undefined) body.presence_penalty = this.config.presencePenalty;
    if (this.config.frequencyPenalty !== undefined) body.frequency_penalty = this.config.frequencyPenalty;

    return body;
  }

  /**
   * 使用识图工厂处理消息中的图片，将图片转换为文本描述并拼接到 user 文本中
   * @param {Array} messages - 原始消息数组
   * @returns {Promise<Array>} 转换后的消息数组（content 变为纯字符串）
   */
  async transformMessages(messages) {
    if (!Array.isArray(messages)) return messages;

    const visionProvider = (this.config.visionProvider || 'gptgod').toLowerCase();
    const visionConfig = this.config.visionConfig || {};
    const visionClient = VisionFactory.hasProvider(visionProvider) && visionConfig.apiKey
      ? VisionFactory.createClient({ provider: visionProvider, ...visionConfig })
      : null;

    const transformed = [];
    for (const msg of messages) {
      const newMsg = { ...msg };

      if (msg.role === 'user' && msg.content && typeof msg.content === 'object') {
        const text = msg.content.text || '';
        const images = msg.content.images || [];
        const replyImages = msg.content.replyImages || [];
        const allImages = [...replyImages, ...images];

        if (visionClient && allImages.length > 0) {
          const descList = await visionClient.recognizeImages(allImages);
          const parts = allImages.map((img, idx) => {
            const desc = descList[idx] || '识别失败';
            const prefix = replyImages.includes(img) ? '[回复图片:' : '[图片:';
            return `${prefix}${desc}]`;
          });
          newMsg.content = text + (parts.length ? ' ' + parts.join(' ') : '');
        } else {
          newMsg.content = text || '';
        }
      } else if (newMsg.content && typeof newMsg.content === 'object') {
        newMsg.content = newMsg.content.text || '';
      } else if (newMsg.content == null) {
        newMsg.content = '';
      }

      transformed.push(newMsg);
    }

    return transformed;
  }


  /**
   * 聊天（非流式）
   * @param {Array} messages - 消息数组，可能包含图片URL
   * @param {Object} overrides - 覆盖配置
   * @returns {Promise<string>} AI 回复文本
   */
  async chat(messages, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: JSON.stringify(this.buildBody(transformedMessages, overrides)),
      signal: this.timeout ? AbortSignal.timeout(this.timeout) : undefined
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`GPTGod LLM 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    const data = await resp.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  /**
   * 聊天（流式）
   * @param {Array} messages - 消息数组
   * @param {Function} onDelta - 每个数据块的回调函数
   * @param {Object} overrides - 覆盖配置
   * @returns {Promise<void>}
   */
  async chatStream(messages, onDelta, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: JSON.stringify(this.buildBody(transformedMessages, { ...overrides, stream: true })),
      signal: this.timeout ? AbortSignal.timeout(this.timeout) : undefined
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`GPTGod LLM 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

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
