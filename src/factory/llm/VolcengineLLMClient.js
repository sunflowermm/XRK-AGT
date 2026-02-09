import { MCPToolAdapter } from '../../utils/llm/mcp-tool-adapter.js';
import { buildOpenAIChatCompletionsBody, applyOpenAITools } from '../../utils/llm/openai-chat-utils.js';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';
import { ensureMessagesImagesDataUrl } from '../../utils/llm/image-utils.js';

/**
 * 火山引擎豆包大模型客户端
 * 
 * 火山引擎豆包大模型 API 文档：
 * - 接口地址：https://ark.{region}.volces.com/api/v3/chat/completions
 * - 认证方式：Bearer Token（API Key）
 * - 支持的模型：doubao-pro-4k、doubao-pro-32k、doubao-lite-4k 等
 * - 详细文档：https://www.volcengine.com/docs/82379
 * - 兼容 OpenAI SDK：完全兼容 OpenAI Chat Completions API 格式
 * 
 * 注意：
 * - baseUrl 应包含 /api/v3（如：https://ark.cn-beijing.volces.com/api/v3）
 * - path 为 /chat/completions
 * - 最终端点：{baseUrl}{path} = https://ark.cn-beijing.volces.com/api/v3/chat/completions
 */
export default class VolcengineLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout ?? 360000;
  }

  /**
   * 获取基础 URL
   */
  getBaseUrl() {
    const config = this.config;
    if (config.region && !config.baseUrl) {
      return `https://ark.${config.region}.volces.com/api/v3`;
    }
    return (config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  }

  /**
   * 规范化端点地址
   */
  normalizeEndpoint(config) {
    const base = this.getBaseUrl();
    const path = (config.path || '/chat/completions').replace(/^\/?/, '/');
    return `${base}${path}`;
  }

  /**
   * 获取超时时间
   */
  get timeout() {
    return this._timeout ?? 360000;
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
      const apiKey = String(this.config.apiKey).trim();
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    
    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }
    
    return headers;
  }

  /**
   * 构建请求体
   * 火山引擎的 API 格式与 OpenAI 兼容
   * 支持所有标准参数：temperature、max_tokens、top_p、presence_penalty、frequency_penalty
   * 支持工具调用：tools、tool_choice、parallel_tool_calls
   */
  buildBody(messages, overrides = {}) {
    const body = buildOpenAIChatCompletionsBody(messages, this.config, overrides, (this.config.chatModel || this.config.model || 'doubao-pro-4k'));
    applyOpenAITools(body, this.config, overrides);
    return body;
  }

  /**
   * 转换消息，将图片转换为火山引擎的 file_id 格式
   * 注意：火山引擎 Chat Completions 多模态仅支持 `text` / `image_url` / `video_url`，
   * 且 `image_url.url` 仅支持 base64(data URL) 或 http/https URL。
   * 因此这里直接走 OpenAI 风格多模态转换即可（不再做 file_id 上传/转换）。
   */
  async transformMessages(messages) {
    // 统一为 OpenAI 风格多模态（text + image_url）
    return await transformMessagesWithVision(messages, this.config, { mode: 'openai' });
  }

  /**
   * 非流式调用（支持工具调用）
   * @param {Array} messages - 消息数组
   * @param {Object} overrides - 覆盖配置
   * @returns {Promise<string>} AI 回复文本
   */
  async chat(messages, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformedMessages, { timeoutMs: this.timeout });
    const maxToolRounds = this.config.maxToolRounds || 5;
    const currentMessages = [...transformedMessages];

    for (let round = 0; round < maxToolRounds; round++) {
      const resp = await fetch(
        this.endpoint,
        buildFetchOptionsWithProxy(this.config, {
          method: 'POST',
          headers: this.buildHeaders(overrides.headers),
          body: JSON.stringify(this.buildBody(currentMessages, { ...overrides })),
          signal: AbortSignal.timeout(this.timeout)
        })
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`火山引擎 LLM 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
      }

      const result = await resp.json();
      const message = result.choices?.[0]?.message;
      if (!message) break;

      if (message.tool_calls?.length > 0) {
        currentMessages.push(message);
        currentMessages.push(...await MCPToolAdapter.handleToolCalls(message.tool_calls));
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
      throw new Error(`火山引擎 LLM 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }
    await this._consumeSSE(resp, onDelta);
  }

}

