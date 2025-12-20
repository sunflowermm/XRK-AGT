import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';

export default class MemoryStream extends AIStream {
  constructor() {
    super({
      name: 'memory',
      description: '记忆系统工作流插件',
      version: '1.0.0',
      author: 'XRK',
      priority: 1,
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

    BotUtil.makeLog('info', `[${this.name}] 记忆系统已初始化`, 'MemoryStream');
  }

  buildSystemPrompt(context) {
    return '记忆系统插件，为其他工作流提供记忆能力。';
  }

  async buildChatContext(e, question) {
    return [];
  }

  async cleanup() {
    await super.cleanup();
  }
}
