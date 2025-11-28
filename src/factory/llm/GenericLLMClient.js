import fetch from 'node-fetch';

/**
 * 通用 LLM 客户端
 * 兼容大多数遵循 OpenAI Chat Completions 协议的服务
 */
export default class GenericLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
  }

  normalizeEndpoint(config) {
    const base = config.baseUrl?.replace(/\/+$/, '') || '';
    const path = (config.path || '/chat/completions').replace(/^\/?/, '/');
    return `${base}${path}`;
  }

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

    return {
      model: model || this.config.model || this.config.chatModel || 'gpt-3.5-turbo',
      messages,
      temperature: temperature ?? this.config.temperature ?? 0.7,
      max_tokens: maxTokens ?? this.config.maxTokens ?? this.config.max_tokens ?? 2000,
      top_p: topP ?? this.config.topP ?? 0.9,
      presence_penalty: presencePenalty ?? this.config.presencePenalty ?? 0.6,
      frequency_penalty: frequencyPenalty ?? this.config.frequencyPenalty ?? 0.6,
      stream: stream ?? false,
      ...(this.config.body || {}),
      ...(extraPayload || {})
    };
  }

  get timeout() {
    return this.config.timeout || 30_000;
  }

  async chat(messages, overrides = {}) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: JSON.stringify(this.buildBody(messages, overrides))
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`LLM请求失败: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    return result.choices?.[0]?.message?.content || '';
  }

  async stream(messages, overrides = {}, onDelta) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: JSON.stringify(this.buildBody(messages, { ...overrides, stream: true }))
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`LLM流式请求失败: ${response.status} ${errorText}`);
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

