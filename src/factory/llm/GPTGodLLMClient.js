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
   */
  buildBody(messages, overrides = {}) {
    const {
      model,
      temperature,
      maxTokens,
      topP,
      presencePenalty,
      frequencyPenalty,
      stream
    } = overrides;

    const body = {
      model: model || this.config.chatModel || 'gemini-exp-1114',
      messages,
      temperature: temperature ?? this.config.temperature ?? 0.8,
      max_tokens: maxTokens ?? this.config.maxTokens ?? 6000,
      stream: stream ?? false
    };

    if (topP !== undefined || this.config.topP !== undefined) {
      body.top_p = topP ?? this.config.topP ?? 0.9;
    }
    
    if (presencePenalty !== undefined || this.config.presencePenalty !== undefined) {
      body.presence_penalty = presencePenalty ?? this.config.presencePenalty ?? 0.6;
    }
    
    if (frequencyPenalty !== undefined || this.config.frequencyPenalty !== undefined) {
      body.frequency_penalty = frequencyPenalty ?? this.config.frequencyPenalty ?? 0.6;
    }

    return body;
  }

  /**
   * 使用识图工厂处理消息中的图片，将图片转换为文本描述并拼接到 user 文本中
   * @param {Array} messages - 原始消息数组
   * @returns {Promise<Array>} 转换后的消息数组（content 变为纯字符串）
   */
  async transformMessages(messages) {
    const transformed = [];

    // 识图配置：由 AIStream.resolveLLMConfig 注入 visionProvider 和 visionConfig
    const visionProvider = (this.config.visionProvider || 'gptgod').toLowerCase();
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
        const text = msg.content.text || '';
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
      }

      transformed.push(newMsg);
    }

    return transformed;
  }

  // 调试保存请求数据的函数在生产环境中已不再使用，避免频繁写入调试文件和多余日志

  /**
   * 聊天（非流式）
   * @param {Array} messages - 消息数组，可能包含图片URL
   * @param {Object} overrides - 覆盖配置
   * @returns {Promise<string>} AI 回复文本
   */
  async chat(messages, overrides = {}) {
    // 转换messages，处理图片识图（经由 VisionFactory）
    const transformedMessages = await this.transformMessages(messages);
    
    const body = this.buildBody(transformedMessages, overrides);
    const headers = this.buildHeaders();

    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: this.timeout ? AbortSignal.timeout(this.timeout) : undefined
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`API错误: ${resp.status} ${text}`);
    }

    const data = await resp.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  /**
   * 聊天（流式）
   * @param {Array} messages - 消息数组
   * @param {Function} onChunk - 每个数据块的回调函数
   * @param {Object} overrides - 覆盖配置
   * @returns {Promise<string>} 完整的 AI 回复文本
   */
  async chatStream(messages, onChunk, overrides = {}) {
    const body = this.buildBody(messages, { ...overrides, stream: true });
    const headers = this.buildHeaders();

    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: this.timeout ? AbortSignal.timeout(this.timeout) : undefined
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`API错误: ${resp.status} ${text}`);
    }

    let fullText = '';
    const decoder = new TextDecoder('utf-8');

    for await (const chunk of resp.body) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split('\n').filter(line => line.trim().startsWith('data:'));

      for (const line of lines) {
        const dataStr = line.replace(/^data:\s*/, '').trim();
        if (dataStr === '[DONE]') continue;
        if (!dataStr) continue;

        try {
          const json = JSON.parse(dataStr);
          const content = json?.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            if (onChunk) onChunk(content);
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }

    return fullText;
  }

}
