import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream';

const streamPipeline = promisify(pipeline);

/**
 * GPTGod 识图客户端
 *
 * 职责：
 * - 接收图片 URL 或本地绝对路径
 * - 对网络图片执行下载 → 上传到 GPTGod 文件服务
 * - 使用 vision 模型对图片进行识别，返回文字描述
 *
 * 注意：
 * - 这里只负责“把一张图变成一段描述文本”
 * - 把描述拼到 user 文本里的逻辑由 LLM 层处理，以保持兼容现有调用格式
 */
export default class GPTGodVisionClient {
  constructor(config = {}) {
    this.config = config;
    this.apiKey = config.apiKey;
    this.visionModel = config.visionModel;
    this.fileUploadUrl = config.fileUploadUrl;
    this.baseUrl = (config.baseUrl || 'https://api.gptgod.online/v1').replace(/\/+$/, '');
    this.timeout = config.timeout || 360000;

    this.endpoint = `${this.baseUrl}/chat/completions`;
    this.tempImageDir = path.join(process.cwd(), 'data/temp/ai_images');
    // 目录在使用时按需创建，无需在构造函数中创建
  }

  /**
   * 识别单张图片
   * @param {string} imagePathOrUrl - 图片 URL 或本地绝对路径
   * @param {string} prompt - 识图提示词
   * @returns {Promise<string>}
   */
  async recognizeImage(imagePathOrUrl, prompt = '请详细描述这张图片的内容') {
    if (!imagePathOrUrl || !this.visionModel) {
      throw new Error('图片URL或识图模型未配置');
    }

    let tempFilePath = null;
    try {
      // 1) 处理本地路径 / 远程 URL
      if (this._isLocalFile(imagePathOrUrl)) {
        tempFilePath = imagePathOrUrl;
      } else {
        tempFilePath = await this._downloadImage(imagePathOrUrl);
      }

      // 2) 上传图片
      const uploadedUrl = await this._uploadImageToAPI(tempFilePath);

      // 3) 调用 GPTGod vision 模型
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

      const result = await this._callVisionAPI(messages);
      return result || '识图失败';
    } catch (err) {
      throw new Error(`图片识别失败: ${err.message}`);
    } finally {
      // 如果是临时下载的文件，尝试清理
      if (tempFilePath && !this._isLocalFile(imagePathOrUrl) && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          // 忽略清理错误
        }
      }
    }
  }

  /**
   * 批量识别图片
   * @param {string[]} imageList
   * @param {string} prompt
   * @returns {Promise<string[]>}
   */
  async recognizeImages(imageList = [], prompt) {
    const results = [];
    for (const img of imageList) {
      try {
        const desc = await this.recognizeImage(img, prompt);
        results.push(desc);
      } catch {
        results.push('识别失败');
      }
    }
    return results;
  }

  _isLocalFile(target) {
    // 简单判断：Windows 盘符 / Unix 绝对路径
    return (
      typeof target === 'string' &&
      (path.isAbsolute(target) || /^[a-zA-Z]:[\\/]/.test(target))
    );
  }

  async _downloadImage(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`下载失败: ${response.status}`);
    }

    const filename = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
    const filePath = path.join(this.tempImageDir, filename);

    // 确保目录存在（按需创建）
    if (!fs.existsSync(this.tempImageDir)) {
      fs.mkdirSync(this.tempImageDir, { recursive: true });
    }

    await streamPipeline(response.body, fs.createWriteStream(filePath));
    return filePath;
  }

  async _uploadImageToAPI(filePath) {
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
        Authorization: `Bearer ${this.apiKey}`,
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
      throw new Error('上传成功但未返回URL');
    }

    return finalUrl;
  }

  async _callVisionAPI(messages) {
    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
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


