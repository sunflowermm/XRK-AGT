import VisionFactory from '#factory/vision/VisionFactory.js';

/**
 * 消息转换工具：将“user.content 为对象且包含图片”的结构转为纯文本
 * - 保持现有业务消息结构兼容：图片会先通过 VisionFactory 识别，再拼接为 `[图片:描述]`
 */

/**
 * 将消息数组转换为纯文本 content（必要时走 Vision 识图）
 * @param {Array} messages - OpenAI-like messages
 * @param {Object} config - LLM config（包含 visionProvider/visionConfig 等）
 * @param {Object} options
 * @param {string} options.defaultVisionProvider - 默认视觉 provider
 * @param {boolean} options.allowProviderFallback - 是否允许用 config.provider 作为视觉 provider fallback
 * @returns {Promise<Array>}
 */
export async function transformMessagesWithVision(messages, config = {}, options = {}) {
  if (!Array.isArray(messages)) return messages;

  const defaultVisionProvider = options.defaultVisionProvider || 'gptgod';
  const allowProviderFallback = options.allowProviderFallback === true;

  const providerCandidate = allowProviderFallback ? (config.visionProvider || config.provider || defaultVisionProvider) : (config.visionProvider || defaultVisionProvider);
  const visionProvider = String(providerCandidate || defaultVisionProvider).toLowerCase();
  const visionConfig = config.visionConfig || {};
  const visionClient = VisionFactory.hasProvider(visionProvider) && visionConfig.apiKey
    ? VisionFactory.createClient({ provider: visionProvider, ...visionConfig })
    : null;

  const transformed = [];
  for (const msg of messages) {
    const newMsg = { ...msg };

    if (msg.role === 'user' && msg.content && typeof msg.content === 'object') {
      const text = msg.content.text || msg.content.content || '';
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
      newMsg.content = newMsg.content.text || newMsg.content.content || '';
    } else if (newMsg.content == null) {
      newMsg.content = '';
    }

    transformed.push(newMsg);
  }

  return transformed;
}

