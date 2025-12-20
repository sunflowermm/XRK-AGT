import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';

/**
 * 记忆系统工作流插件
 * 可注册的记忆功能，自动为其他工作流提供记忆能力
 */
export default class MemoryStream extends AIStream {
  static initialized = false;

  constructor() {
    super({
      name: 'memory',
      description: '记忆系统工作流插件',
      version: '1.0.0',
      author: 'XRK',
      priority: 1, // 高优先级，确保先加载
      config: {
        enabled: true,
        temperature: 0.7,
        maxTokens: 2000
      },
      embedding: {
        enabled: true,
        provider: 'lightweight'
      }
    });
  }

  async init() {
    await super.init();

    try {
      await this.initEmbedding();
    } catch (error) {
      BotUtil.makeLog('warn', `[${this.name}] Embedding初始化失败，记忆功能可能受限`, 'MemoryStream');
    }

    MemoryStream.initialized = true;
    BotUtil.makeLog('info', `[${this.name}] 记忆系统已初始化`, 'MemoryStream');
  }

  /**
   * 构建系统提示词（记忆系统不需要自己的提示词）
   */
  buildSystemPrompt(context) {
    return '记忆系统插件，为其他工作流提供记忆能力。';
  }

  async buildChatContext(e, question) {
    // 记忆系统不直接处理消息，而是为其他工作流提供记忆能力
    return [];
  }

  async cleanup() {
    await super.cleanup();
    MemoryStream.initialized = false;
  }
}