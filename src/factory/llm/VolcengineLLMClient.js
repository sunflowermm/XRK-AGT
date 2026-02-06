import fetch from 'node-fetch';
import FormData from 'form-data';
import { MCPToolAdapter } from '../../utils/llm/mcp-tool-adapter.js';
import { buildOpenAIChatCompletionsBody, applyOpenAITools } from '../../utils/llm/openai-chat-utils.js';
import { transformMessagesWithVision } from '../../utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '../../utils/llm/proxy-utils.js';

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
   * 获取基础 URL（公共逻辑）
   * 火山引擎支持多个区域，可以通过 region 配置指定区域
   * 支持的区域：cn-beijing（北京）、cn-shanghai（上海）等
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
   * 获取文件上传端点
   */
  getFileUploadEndpoint() {
    return `${this.getBaseUrl()}/files`;
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
    const body = buildOpenAIChatCompletionsBody(messages, this.config, overrides, (this.config.chatModel || this.config.model || 'doubao-pro-4k'));
    applyOpenAITools(body, this.config, overrides);
    return body;
  }

  /**
   * 上传文件到火山引擎
   * @param {Buffer} buffer - 文件数据 Buffer
   * @param {string} mimeType - MIME 类型，如 'image/png'
   * @param {string} filename - 文件名
   * @returns {Promise<string>} file_id
   */
  async uploadFile(buffer, mimeType = 'image/png', filename = 'image.png') {
    if (!Buffer.isBuffer(buffer)) {
      throw new Error('文件数据必须是 Buffer 类型');
    }

    const uploadUrl = this.getFileUploadEndpoint();
    const formData = new FormData();
    formData.append('file', buffer, {
      filename: filename,
      contentType: mimeType
    });
    formData.append('purpose', 'user_data');

    // 构建请求头，移除 Content-Type（FormData 会自动设置）
    const headers = { ...this.buildHeaders() };
    delete headers['Content-Type'];
    Object.assign(headers, formData.getHeaders());
    
    const resp = await fetch(
      uploadUrl,
      buildFetchOptionsWithProxy(this.config, {
        method: 'POST',
        headers,
        body: formData,
        signal: AbortSignal.timeout(this.timeout)
      })
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`火山引擎文件上传失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`);
    }

    const result = await resp.json();
    const fileId = result.id;
    
    if (!fileId) {
      throw new Error('火山引擎文件上传响应中缺少 file_id');
    }

    return fileId;
  }

  /**
   * 将图片 URL/base64 转换为 file_id
   * @param {string} imageUrl - 图片 URL 或 base64 data URL
   * @returns {Promise<string>} file_id
   */
  async convertImageToFileId(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new Error('无效的图片 URL');
    }

    let buffer;
    let mimeType = 'image/png';
    let filename = 'image.png';

    // HTTP/HTTPS URL：下载图片
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const resp = await fetch(imageUrl, {
        signal: AbortSignal.timeout(30000)
      });
      if (!resp.ok) {
        throw new Error(`下载图片失败: ${resp.status} ${resp.statusText}`);
      }
      const arrayBuffer = await resp.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      mimeType = resp.headers.get('content-type') || mimeType;
      filename = imageUrl.split('/').pop() || filename;
    }
    // base64 data URL：解析并提取数据
    else if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        throw new Error('无效的 data URL 格式');
      }
      mimeType = match[1];
      const base64Data = match[2];
      buffer = Buffer.from(base64Data, 'base64');
      const ext = mimeType.split('/')[1] || 'png';
      filename = `image.${ext}`;
    }
    // 纯 base64 字符串
    else {
      buffer = Buffer.from(imageUrl, 'base64');
    }

    return await this.uploadFile(buffer, mimeType, filename);
  }

  /**
   * 转换消息，将图片转换为火山引擎的 file_id 格式
   * 火山引擎不支持直接传 base64，必须先上传文件获取 file_id
   */
  async transformMessages(messages) {
    if (!Array.isArray(messages)) return messages;

    // 先统一转换为 OpenAI 格式（处理对象格式等）
    const openaiMessages = await transformMessagesWithVision(messages, this.config, { mode: 'openai' });

    const transformed = [];
    
    for (const msg of openaiMessages) {
      // 只处理用户消息中的图片数组
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        const contentParts = [];
        
        for (const part of msg.content) {
          if (part.type === 'text') {
            contentParts.push(part);
          } else if (part.type === 'image_url' && part.image_url?.url) {
            // 上传图片获取 file_id
            try {
              const fileId = await this.convertImageToFileId(part.image_url.url);
              contentParts.push({ type: 'image', content: { file_id: fileId } });
            } catch (error) {
              Bot.makeLog?.('warn', `[VolcengineLLMClient] 图片上传失败，跳过: ${error.message}`);
            }
          } else if (part.type === 'image' && part.content?.file_id) {
            // 已经是火山引擎格式，直接保留
            contentParts.push(part);
          }
        }
        
        // 简化：只有文本时转为字符串
        msg.content = contentParts.length === 1 && contentParts[0].type === 'text' 
          ? contentParts[0].text 
          : contentParts.length > 0 ? contentParts : '';
      }
      
      transformed.push(msg);
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

