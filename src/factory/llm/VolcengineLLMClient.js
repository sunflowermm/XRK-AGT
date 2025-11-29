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
   * 非流式调用
   */
  async chat(messages, overrides = {}) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: JSON.stringify(this.buildBody(messages, overrides)),
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
}

