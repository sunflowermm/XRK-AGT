import fetch from 'node-fetch';
import VisionFactory from '../vision/VisionFactory.js';

/**
 * 火山引擎豆包大模型客户端
 * 
 * 火山引擎豆包大模型 API 文档：
 * - 接口地址：https://ark.cn-beijing.volces.com/api/v3
 * - 认证方式：Bearer Token（API Key）
 * - 支持的模型：doubao-pro-4k、doubao-pro-32k、doubao-lite-4k 等
 * - 详细文档：https://www.volcengine.com/docs/82379
 * 
 * 注意：火山引擎的 API 格式与 OpenAI 兼容，但部分参数名称可能不同
 */
export default class VolcengineLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
  }

  /**
   * 规范化端点地址
   * 
   * 火山引擎支持多个区域，可以通过 region 配置指定区域
   * 支持的区域：cn-beijing（北京）、cn-shanghai（上海）等
   * 如果配置了 region，会自动构建对应的 endpoint
   */
  normalizeEndpoint(config) {
    // 如果指定了 region，根据 region 构建 endpoint
    if (config.region && !config.baseUrl) {
      const region = config.region;
      const base = `https://ark.${region}.volces.com/api/v3`;
      const path = (config.path || '/chat/completions').replace(/^\/?/, '/');
      return `${base}${path}`;
    }
    
    // 否则使用配置的 baseUrl 或默认值
    const base = (config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
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
    
    // 火山引擎使用 Bearer Token 认证
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
   * 火山引擎的 API 格式与 OpenAI 兼容
   */
  buildBody(messages, overrides = {}) {
    const body = {
      model: this.config.model || 'doubao-pro-4k',
      messages,
      temperature: this.config.temperature ?? 0.8,
      max_tokens: this.config.maxTokens ?? this.config.max_tokens ?? 2000,
      stream: overrides.stream ?? false
    };

    if (this.config.topP !== undefined) body.top_p = this.config.topP;
    if (this.config.presencePenalty !== undefined) body.presence_penalty = this.config.presencePenalty;
    if (this.config.frequencyPenalty !== undefined) body.frequency_penalty = this.config.frequencyPenalty;

    return body;
  }

  /**
   * 获取超时时间
   */
  get timeout() {
    return this.config.timeout || 360_000;
  }

  /**
   * 通过识图工厂把图片转成文本描述，再交给文本模型处理
   * 这样可以让 MiMo 等纯文本 LLM 也复用火山识图能力
   * @param {Array} messages
   * @returns {Promise<Array>}
   */
  async transformMessages(messages) {
    const transformed = [];

    // 识图配置：由 AIStream.resolveLLMConfig 注入 visionProvider 和 visionConfig
    const visionProvider = (this.config.visionProvider || 'volcengine').toLowerCase();
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

  /**
   * 非流式调用
   */
  async chat(messages, overrides = {}) {
    // 转换messages，处理图片（经由 VisionFactory 抽离识图能力）
    const transformedMessages = await this.transformMessages(messages);

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: JSON.stringify(this.buildBody(transformedMessages, { ...overrides })),
      signal: this.config.timeout ? AbortSignal.timeout(this.config.timeout) : undefined
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`火山引擎 LLM 请求失败: ${response.status} ${response.statusText}${errorText ? ` | ${errorText}` : ''}`);
    }

    const result = await response.json();
    
    // 火山引擎返回格式与 OpenAI 兼容
    return result.choices?.[0]?.message?.content || '';
  }

  /**
   * 流式调用
   */
  async chatStream(messages, onDelta, overrides = {}) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: JSON.stringify(this.buildBody(messages, { ...overrides, stream: true })),
      signal: this.config.timeout ? AbortSignal.timeout(this.config.timeout) : undefined
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`火山引擎 LLM 流式请求失败: ${response.status} ${response.statusText}${errorText ? ` | ${errorText}` : ''}`);
    }

    const reader = response.body.getReader();
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

