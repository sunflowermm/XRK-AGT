import fetch from 'node-fetch';
import VisionFactory from '../vision/VisionFactory.js';
import { MCPToolAdapter } from './mcp-tool-adapter.js';

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
    this._timeout = config.timeout || 360000;
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
    const body = {
      model: this.config.chatModel || this.config.model || 'doubao-pro-4k',
      messages,
      temperature: this.config.temperature ?? 0.8,
      max_tokens: this.config.maxTokens ?? 4000,
      stream: overrides.stream ?? false
    };

    // 可选参数（仅在配置时添加）
    if (this.config.topP !== undefined) body.top_p = this.config.topP;
    if (this.config.presencePenalty !== undefined) body.presence_penalty = this.config.presencePenalty;
    if (this.config.frequencyPenalty !== undefined) body.frequency_penalty = this.config.frequencyPenalty;

    // 工具调用支持：从MCP获取工具列表
    const enableTools = this.config.enableTools !== false && MCPToolAdapter.hasTools();
    if (enableTools && !overrides.tools) {
      const tools = MCPToolAdapter.convertMCPToolsToOpenAI();
      if (tools.length > 0) {
        body.tools = tools;
        // 工具调用模式：auto（自动）、none（禁用）、required（必须）
        body.tool_choice = this.config.toolChoice || 'auto';
        // 是否允许多个工具并行调用（豆包支持）
        if (this.config.parallelToolCalls !== undefined) {
          body.parallel_tool_calls = this.config.parallelToolCalls;
        }
      }
    } else if (overrides.tools !== undefined) {
      // 允许外部覆盖工具配置
      body.tools = overrides.tools;
      if (overrides.tool_choice !== undefined) body.tool_choice = overrides.tool_choice;
      if (overrides.parallel_tool_calls !== undefined) body.parallel_tool_calls = overrides.parallel_tool_calls;
    }

    return body;
  }

  /**
   * 通过识图工厂把图片转成文本描述，再交给文本模型处理
   * @param {Array} messages - 原始消息数组
   * @returns {Promise<Array>} 转换后的消息数组（content 变为纯字符串）
   */
  async transformMessages(messages) {
    if (!Array.isArray(messages)) return messages;

    const visionProvider = (this.config.visionProvider || 'volcengine').toLowerCase();
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
   * 非流式调用（支持工具调用）
   * @param {Array} messages - 消息数组
   * @param {Object} overrides - 覆盖配置
   * @returns {Promise<string>} AI 回复文本
   */
  async chat(messages, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    const maxToolRounds = this.config.maxToolRounds || 5;
    let currentMessages = [...transformedMessages];

    for (let round = 0; round < maxToolRounds; round++) {
      const resp = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
        body: JSON.stringify(this.buildBody(currentMessages, { ...overrides })),
        signal: AbortSignal.timeout(this.timeout)
      });

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

  /**
   * 流式调用
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
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`火山引擎 LLM 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
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

