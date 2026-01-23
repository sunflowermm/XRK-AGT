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
   * 非流式调用（支持工具调用）
   */
  async chat(messages, overrides = {}) {
    // 转换messages，处理图片（经由 VisionFactory 抽离识图能力）
    const transformedMessages = await this.transformMessages(messages);

    // 支持多轮工具调用
    const maxToolRounds = this.config.maxToolRounds || 5;
    let currentMessages = [...transformedMessages];
    let round = 0;

    while (round < maxToolRounds) {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(overrides.headers),
        body: JSON.stringify(this.buildBody(currentMessages, { ...overrides })),
        signal: this.timeout ? AbortSignal.timeout(this.timeout) : undefined
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`火山引擎 LLM 请求失败: ${response.status} ${response.statusText}${errorText ? ` | ${errorText}` : ''}`);
      }

      const result = await response.json();
      const choice = result.choices?.[0];
      if (!choice) break;

      const message = choice.message;
      
      // 检查是否有工具调用
      if (message.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        // 添加助手消息（包含tool_calls）
        currentMessages.push(message);
        
        // 调用MCP工具并获取结果
        const toolResults = await MCPToolAdapter.handleToolCalls(message.tool_calls);
        
        // 添加工具结果消息
        currentMessages.push(...toolResults);
        
        round++;
        continue;
      }

      // 没有工具调用，返回最终结果
      return message.content || '';
    }

    // 达到最大轮次，返回最后一条消息
    const lastMessage = currentMessages[currentMessages.length - 1];
    return lastMessage?.content || '';
  }

  /**
   * 流式调用（支持工具调用）
   */
  async chatStream(messages, onDelta, overrides = {}) {
    // 转换messages，处理图片（经由 VisionFactory 抽离识图能力）
    const transformedMessages = await this.transformMessages(messages);

    // 流式模式下工具调用支持有限，主要处理内容流
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(overrides.headers),
      body: JSON.stringify(this.buildBody(transformedMessages, { ...overrides, stream: true })),
      signal: this.timeout ? AbortSignal.timeout(this.timeout) : undefined
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`火山引擎 LLM 流式请求失败: ${response.status} ${response.statusText}${errorText ? ` | ${errorText}` : ''}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let toolCalls = [];

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
          const choice = json.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta || {};
          
          // 处理内容流
          if (delta.content && typeof onDelta === 'function') {
            onDelta(delta.content);
          }

          // 处理工具调用（流式模式下工具调用可能分块返回）
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.index !== undefined) {
                if (!toolCalls[tc.index]) {
                  toolCalls[tc.index] = { id: tc.id, function: { name: '', arguments: '' }, type: 'function' };
                }
                if (tc.function?.name) {
                  toolCalls[tc.index].function.name += tc.function.name;
                }
                if (tc.function?.arguments) {
                  toolCalls[tc.index].function.arguments += tc.function.arguments;
                }
              }
            }
          }
        } catch {
          // 忽略解析错误，继续读取
        }
      }
    }
  }

}

