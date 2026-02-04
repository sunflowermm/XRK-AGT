/**
 * 消息转换工具：
 * - 统一处理形如 { text, images, replyImages } 的自定义结构
 * - 为不同厂商输出两种形态：
 *   - openai: 生成 OpenAI Chat Completions 多模态 content 数组（text + image_url），支持 base64
 *   - text_only: 退化为纯文本，在末尾追加简单的图片占位描述
 *
 * 说明：
 * - 不再依赖独立的 VisionFactory，也不再调用单独的“识图工厂”
 * - 真正的图片理解由各家 LLM 自身的多模态能力完成
 */

/**
 * 将消息数组转换为目标 LLM 可用的 content 结构
 * @param {Array} messages - OpenAI-like messages
 * @param {Object} config - LLM config（目前仅用于读取可选的 visionImageMimeType 等）
 * @param {Object} options
 * @param {('openai'|'text_only')} [options.mode='text_only'] - 多模态输出模式
 * @param {boolean} [options.allowBase64=true] - 是否把裸 base64 自动包装为 data:image/*;base64, 前缀
 * @returns {Promise<Array>}
 */
export async function transformMessagesWithVision(messages, config = {}, options = {}) {
  if (!Array.isArray(messages)) return messages;

  const mode = options.mode === 'openai' ? 'openai' : 'text_only';
  const allowBase64 = options.allowBase64 !== false;
  const defaultMime = config.visionImageMimeType || 'image/png';

  const isProbablyBase64 = (str) => {
    if (!str || typeof str !== 'string') return false;
    if (str.startsWith('data:')) return true;
    if (str.includes('://')) return false;
    const s = str.trim();
    if (s.length < 64) return false;
    return /^[A-Za-z0-9+/=\r\n]+$/.test(s);
  };

  const buildOpenAIContentParts = (text, images, replyImages) => {
    const parts = [];
    if (text) {
      parts.push({ type: 'text', text: String(text) });
    }

    const allImages = [...(replyImages || []), ...(images || [])];
    for (const img of allImages) {
      if (!img) continue;
      let url = String(img).trim();
      if (!url) continue;

      if (allowBase64 && isProbablyBase64(url) && !url.startsWith('data:')) {
        url = `data:${defaultMime};base64,${url}`;
      }

      parts.push({
        type: 'image_url',
        image_url: { url }
      });
    }
    return parts;
  };

  const transformed = [];
  for (const msg of messages) {
    const newMsg = { ...msg };

    if (msg.role === 'user' && msg.content && typeof msg.content === 'object') {
      // 已经是 OpenAI 风格的多模态 content 数组，则在 openai 模式下直接透传，不再二次转换
      if (Array.isArray(msg.content) && mode === 'openai') {
        newMsg.content = msg.content;
        transformed.push(newMsg);
        continue;
      }

      const text = msg.content.text || msg.content.content || '';
      const images = msg.content.images || [];
      const replyImages = msg.content.replyImages || [];

      if (mode === 'openai') {
        const parts = buildOpenAIContentParts(text, images, replyImages);
        if (parts.length === 1 && parts[0].type === 'text') {
          newMsg.content = parts[0].text;
        } else if (parts.length > 0) {
          newMsg.content = parts;
        } else {
          newMsg.content = '';
        }
      } else {
        let content = text || '';
        const allImages = [...replyImages, ...images];
        if (allImages.length > 0) {
          const placeholders = allImages.map((img) => {
            const prefix = replyImages.includes(img) ? '[回复图片:' : '[图片:';
            return `${prefix}${String(img)}]`;
          });
          content = content ? `${content} ${placeholders.join(' ')}` : placeholders.join(' ');
        }
        newMsg.content = content;
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

