import fetch from 'node-fetch';

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
    // 火山引擎默认接口地址
    this.endpoint = this.normalizeEndpoint(config);
    this.timeout = config.timeout || 30000;
    
    // 火山引擎识图配置
    this.visionModel = config.visionModel || 'doubao-vision-pro-32k';
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
    const {
      model,
      temperature,
      maxTokens,
      topP,
      presencePenalty,
      frequencyPenalty,
      stream,
      extraPayload
    } = overrides;

    const body = {
      model: model || this.config.model || 'doubao-pro-4k',
      messages,
      temperature: temperature ?? this.config.temperature ?? 0.8,
      max_tokens: maxTokens ?? this.config.maxTokens ?? this.config.max_tokens ?? 2000,
      stream: stream ?? false
    };

    // 可选参数
    if (topP !== undefined || this.config.topP !== undefined) {
      body.top_p = topP ?? this.config.topP ?? 0.9;
    }
    
    if (presencePenalty !== undefined || this.config.presencePenalty !== undefined) {
      body.presence_penalty = presencePenalty ?? this.config.presencePenalty ?? 0.6;
    }
    
    if (frequencyPenalty !== undefined || this.config.frequencyPenalty !== undefined) {
      body.frequency_penalty = frequencyPenalty ?? this.config.frequencyPenalty ?? 0.6;
    }

    // 合并额外配置
    if (this.config.body) {
      Object.assign(body, this.config.body);
    }
    
    if (extraPayload) {
      Object.assign(body, extraPayload);
    }

    return body;
  }

  /**
   * 获取超时时间
   */
  get timeout() {
    return this.config.timeout || 30_000;
  }

  /**
   * 处理消息中的图片，转换为火山引擎格式
   * @param {Object} content - 消息内容（可能是字符串或对象）
   * @returns {Promise<Object|string>} 处理后的内容
   */
  async processImageContent(content) {
    if (typeof content === 'string') {
      return content;
    }
    
    if (content && typeof content === 'object') {
      const text = content.text || '';
      const images = content.images || [];
      const replyImages = content.replyImages || [];
      const allImages = [...replyImages, ...images];
      
      if (allImages.length === 0) {
        return text;
      }
      
      // 火山引擎支持直接在content数组中传递图片URL
      const contentArray = [];
      
      // 添加文本
      if (text) {
        contentArray.push({
          type: 'text',
          text: text
        });
      }
      
      // 添加图片（火山引擎支持直接使用URL）
      for (const imageUrl of allImages) {
        contentArray.push({
          type: 'image_url',
          image_url: {
            url: imageUrl
          }
        });
      }
      
      return contentArray;
    }
    
    return '';
  }

  /**
   * 检查messages中是否包含图片
   * @param {Array} messages - 消息数组
   * @returns {boolean} 是否包含图片
   */
  hasImages(messages) {
    for (const msg of messages) {
      if (msg.role === 'user' && msg.content) {
        if (typeof msg.content === 'object') {
          const images = msg.content.images || [];
          const replyImages = msg.content.replyImages || [];
          if (images.length > 0 || replyImages.length > 0) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * 转换messages，处理其中的图片内容
   * @param {Array} messages - 原始消息数组
   * @returns {Promise<Array>} 转换后的消息数组
   */
  async transformMessages(messages) {
    const transformed = [];
    
    for (const msg of messages) {
      const newMsg = { ...msg };
      
      // 处理user消息中的图片
      if (msg.role === 'user' && msg.content) {
        newMsg.content = await this.processImageContent(msg.content);
      }
      
      transformed.push(newMsg);
    }
    
    return transformed;
  }

  /**
   * 非流式调用
   */
  async chat(messages, overrides = {}) {
    // 转换messages，处理图片URL
    const transformedMessages = await this.transformMessages(messages);
    
    // 如果包含图片，使用vision模型
    const useVisionModel = this.hasImages(messages);
    const modelOverride = useVisionModel ? { model: this.visionModel } : {};
    
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: JSON.stringify(this.buildBody(transformedMessages, { ...overrides, ...modelOverride })),
      signal: AbortSignal.timeout(this.timeout)
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
  async stream(messages, overrides = {}, onDelta) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: JSON.stringify(this.buildBody(messages, { ...overrides, stream: true })),
      signal: AbortSignal.timeout(this.timeout)
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

  /**
   * 识别图片内容
   * 火山引擎支持直接传递图片 URL 进行识别
   * @param {string} imageUrl - 图片URL（支持 http/https/base64）
   * @param {string} prompt - 识图提示词（可选）
   * @returns {Promise<string>} 图片描述文本
   */
  async recognizeImage(imageUrl, prompt = '请详细描述这张图片的内容') {
    if (!imageUrl || !this.visionModel) {
      throw new Error('图片URL或识图模型未配置');
    }

    try {
      // 火山引擎支持直接在 messages 中传递图片 URL
      const messages = [
        {
          role: 'system',
          content: prompt
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: imageUrl
              }
            }
          ]
        }
      ];

      const body = {
        model: this.visionModel,
        messages,
        temperature: this.config.temperature ?? 0.8,
        max_tokens: this.config.maxTokens ?? 4096
      };

      const headers = this.buildHeaders();
      const resp = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`API错误: ${resp.status} ${text}`);
      }

      const data = await resp.json();
      return data?.choices?.[0]?.message?.content || '识图失败';
    } catch (error) {
      throw new Error(`图片识别失败: ${error.message}`);
    }
  }
}

