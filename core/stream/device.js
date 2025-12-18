import AIStream from '../../src/infrastructure/aistream/aistream.js';
import BotUtil from '../../src/utils/botutil.js';

/**
 * 设备工作流
 * - 解析响应中的表情标记并驱动设备显示/表情与TTS
 * - 支持 [开心]、[开心}、[惊讶] 等简写
 * - 返回 { text, emotion } 给调用方（core/api/device.js 已对接 TTS 与 display）
 */
export default class DeviceStream extends AIStream {
  constructor() {
    super({
      name: 'device',
      description: '设备工作流',
      version: '1.0.0',
      author: 'XRK',
      priority: 5,
      config: {
        enabled: true,
        temperature: 0.7,
        maxTokens: 4000,
        topP: 0.9,
        presencePenalty: 0.3,
        frequencyPenalty: 0.3
      },
      embedding: {
        enabled: false
      }
    });
  }

  /**
   * 系统提示：引导模型优先返回简洁中文，并可选择一个表情指令
   */
  buildSystemPrompt(context) {
    const persona = context?.persona || '你是一个简洁友好的设备语音助手，以地道中文回答。';
    return `【人设】
${persona}

【表情标记说明】
你的回复中包含表情标记格式时，系统会自动解析并驱动设备显示对应表情，然后从文本中移除标记格式。

格式要求：精确匹配，如 [开心]、[惊讶]、[伤心]、[大笑]、[害怕]、[生气]
可用表情：开心、惊讶、伤心、大笑、害怕、生气

使用示例：
- "[开心]你好" → 设备显示开心表情，并语音播放"你好"
- "[惊讶]真的吗？" → 设备显示惊讶表情，并语音播放"真的吗？"

【规则】
1. 尽量简洁，优先中文
2. 如需展示表情，在文本前加一个表情标记（可选）
3. 最多一个表情标记
4. 格式必须完全匹配，表情标记会被移除，用户只听到普通文本
5. 不要输出多余解释`;
  }

  /**
   * 构建消息
   */
  async buildChatContext(e, question) {
    const text = typeof question === 'string' ? question : (question?.text || question?.content || '');
    const messages = [
      { role: 'system', content: this.buildSystemPrompt({ persona: question?.persona }) },
      { role: 'user', content: text || '你好' }
    ];
    return messages;
  }

  /**
   * 执行设备工作流并解析输出
   */
  async execute(deviceId, question, apiConfig, deviceInfo = {}, persona = '') {
    try {
      const messages = await this.buildChatContext(null, { text: question, persona });
      const response = await this.callAI(messages, apiConfig);
      if (!response) {
        return null;
      }
      const { emotion, cleanText } = this.parseEmotion(response);
      return {
        text: cleanText || '',
        emotion
      };
    } catch (err) {
      BotUtil.makeLog('error', `设备工作流失败: ${err.message}`, 'DeviceStream');
      return null;
    }
  }

  /**
   * 解析表情指令，兼容 ] 或 }
   * 示例：
   *  [开心]你好 → emotion=开心, text=你好
   *  [惊讶}哇 → emotion=惊讶, text=哇
   */
  parseEmotion(text) {
    const regex = /^\s*\[(开心|惊讶|伤心|大笑|害怕|生气)[\]\}]\s*/;
    const match = regex.exec(text || '');
    if (!match) {
      return { emotion: null, cleanText: (text || '').trim() };
    }
    const emotion = match[1];
    const cleanText = (text || '').replace(regex, '').trim();
    return { emotion, cleanText };
  }
}


