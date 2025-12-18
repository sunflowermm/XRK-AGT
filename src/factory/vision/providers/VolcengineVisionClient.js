import fetch from 'node-fetch';

/**
 * 火山引擎豆包 识图客户端
 *
 * 与 GPTGod 不同，火山引擎支持在 messages 中直接传入图片 URL。
 * 这里用于在“识图工厂”语义下，把单张图片转成描述文本，方便任何 LLM（包括 MiMo）复用。
 */
export default class VolcengineVisionClient {
  constructor(config = {}) {
    this.config = config;
    this.apiKey = config.apiKey;
    this.visionModel = config.visionModel || 'doubao-vision-pro-32k';
    this.timeout = config.timeout || 360000;

    const base = (config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
    const path = (config.path || '/chat/completions').replace(/^\/?/, '/');
    this.endpoint = `${base}${path}`;
  }

  /**
   * 识别单张图片
   * @param {string} imageUrlOrPath - 图片 URL 或本地路径（本实现仅支持 URL）
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  async recognizeImage(imageUrlOrPath, prompt = '请详细描述这张图片的内容') {
    if (!imageUrlOrPath || !this.visionModel) {
      throw new Error('图片URL或识图模型未配置');
    }

    // 若传入的是本地路径，业务方应自行先上传或转换为 URL，这里简单按 URL 处理
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
              url: imageUrlOrPath
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

    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`API错误: ${resp.status} ${text}`);
    }

    const data = await resp.json();
    return data?.choices?.[0]?.message?.content || '识图失败';
  }

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
}


