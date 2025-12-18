import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream';

/**
 * GPTGod LLM 客户端
 * 支持聊天和识图功能
 * 
 * GPTGod 识图流程：
 * 1. 下载图片到本地临时目录
 * 2. 上传图片到 GPTGod 文件服务
 * 3. 调用 chat/completions API（使用 visionModel）进行识图
 */
export default class GPTGodLLMClient {
  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this.timeout = config.timeout || 30000;
    
    // GPTGod 识图相关配置
    this.visionModel = config.visionModel;
    this.fileUploadUrl = config.fileUploadUrl;
    this.tempImageDir = path.join(process.cwd(), 'data/temp/ai_images');
    
    // 确保临时图片目录存在
    if (!fs.existsSync(this.tempImageDir)) {
      fs.mkdirSync(this.tempImageDir, { recursive: true });
    }
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
   * 处理消息中的图片，上传到服务器并转换为识图结果
   * @param {Object} content - 消息内容（可能是字符串或对象）
   * @returns {Promise<string>} 处理后的文本内容
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
      
      // 对每张图片进行识图
      const imageDescriptions = [];
      for (const imageUrl of allImages) {
        try {
          const desc = await this.recognizeImage(imageUrl);
          const prefix = replyImages.includes(imageUrl) ? '[回复图片:' : '[图片:';
          imageDescriptions.push(`${prefix}${desc}]`);
        } catch (error) {
          const prefix = replyImages.includes(imageUrl) ? '[回复图片:识别失败]' : '[图片:识别失败]';
          imageDescriptions.push(prefix);
        }
      }
      
      return text + (imageDescriptions.length > 0 ? ' ' + imageDescriptions.join(' ') : '');
    }
    
    return '';
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

  // 调试保存请求数据的函数在生产环境中已不再使用，避免频繁写入调试文件和多余日志

  /**
   * 聊天（非流式）
   * @param {Array} messages - 消息数组，可能包含图片URL
   * @param {Object} overrides - 覆盖配置
   * @returns {Promise<string>} AI 回复文本
   */
  async chat(messages, overrides = {}) {
    // 转换messages，处理图片上传和识图
    const transformedMessages = await this.transformMessages(messages);
    
    const body = this.buildBody(transformedMessages, overrides);
    const headers = this.buildHeaders();

    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      // 放宽或禁用过紧的超时，避免正常长回复被过早中断
      signal: this.timeout ? AbortSignal.timeout(this.timeout * 2) : undefined
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
      signal: this.timeout ? AbortSignal.timeout(this.timeout * 2) : undefined
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

  /**
   * 识别图片内容
   * @param {string} imageUrl - 图片URL
   * @param {string} prompt - 识图提示词（可选）
   * @returns {Promise<string>} 图片描述文本
   */
  async recognizeImage(imageUrl, prompt = '请详细描述这张图片的内容') {
    if (!imageUrl || !this.visionModel) {
      throw new Error('图片URL或识图模型未配置');
    }

    let tempFilePath = null;
    try {
      // 1) 下载图片到本地临时目录
      tempFilePath = await this.downloadImage(imageUrl);

      // 2) 上传图片到 GPTGod 文件服务
      const uploadedUrl = await this.uploadImageToAPI(tempFilePath);

      // 3) 调用 GPTGod chat/completions（visionModel）
      const messages = [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: uploadedUrl }
            }
          ]
        }
      ];

      const result = await this.callVisionAPI(messages);
      return result || '识图失败';
    } catch (error) {
      throw new Error(`图片识别失败: ${error.message}`);
    } finally {
      // 清理临时文件
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (err) {
          // 忽略清理错误
        }
      }
    }
  }

  /**
   * 下载图片到本地临时目录
   * @param {string} url - 图片URL
   * @returns {Promise<string>} 本地文件路径
   */
  async downloadImage(url) {
      const response = await fetch(url);
      if (!response.ok) {
      throw new Error(`下载失败: ${response.status}`);
      }

      const filename = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
      const filePath = path.join(this.tempImageDir, filename);

      const streamPipeline = promisify(pipeline);
      await streamPipeline(response.body, fs.createWriteStream(filePath));

      return filePath;
  }

  /**
   * 上传图片到 GPTGod 文件服务
   * @param {string} filePath - 本地文件路径
   * @returns {Promise<string>} GPTGod 返回的图片URL
   */
  async uploadImageToAPI(filePath) {
    if (!this.fileUploadUrl) {
      throw new Error('未配置文件上传URL(fileUploadUrl)');
    }

      const form = new FormData();
      const fileBuffer = await fs.promises.readFile(filePath);

      form.append('file', fileBuffer, {
        filename: path.basename(filePath),
        contentType: 'image/png'
      });

      const response = await fetch(this.fileUploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          ...form.getHeaders()
        },
        body: form
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
      throw new Error(`上传失败: ${response.status} ${text}`);
      }

      const result = await response.json().catch(() => ({}));
      const finalUrl =
        result?.data?.url ??
        (Array.isArray(result?.data) ? result.data[0]?.url : undefined) ??
        result?.url;

      if (!finalUrl) {
      throw new Error(`上传成功但未返回URL`);
      }

      return finalUrl;
  }

  /**
   * 调用 GPTGod 识图 API（chat/completions + visionModel）
   * @param {Array} messages - OpenAI 风格消息数组
   * @returns {Promise<string>} AI识图结果
   */
  async callVisionAPI(messages) {
      const resp = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.visionModel,
          messages,
          temperature: this.config.temperature || 0.8,
        max_tokens: this.config.maxTokens || 6000,
        top_p: this.config.topP || 0.9,
        presence_penalty: this.config.presencePenalty || 0.6,
        frequency_penalty: this.config.frequencyPenalty || 0.6
        }),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
      throw new Error(`API错误: ${resp.status} ${text}`);
      }

      const data = await resp.json();
      return data?.choices?.[0]?.message?.content || null;
  }
}
