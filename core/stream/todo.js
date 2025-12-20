import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';
import { WorkflowManager } from '../workflow-manager.js';

export default class TodoStream extends AIStream {
  constructor() {
    super({
      name: 'todo',
      description: 'TODO工作流插件',
      version: '1.0.0',
      author: 'XRK',
      priority: 2,
      config: {
        enabled: true,
        temperature: 0.7,
        maxTokens: 4000
      },
      embedding: { enabled: false }
    });
    this.workflowManager = null;
  }

  async init() {
    await super.init();
    this.workflowManager = new WorkflowManager(this);
    BotUtil.makeLog('info', `[${this.name}] TODO工作流插件已初始化`, 'TodoStream');
  }

  injectWorkflowManager(targetStream) {
    if (!targetStream.workflowManager) {
      targetStream.workflowManager = this.workflowManager;
      this.workflowManager.stream = targetStream;
    }
  }

  buildSystemPrompt(context) {
    return 'TODO工作流插件，为其他工作流提供多步骤任务执行能力。';
  }

  async buildChatContext(e, question) {
    return [];
  }

  async cleanup() {
    await super.cleanup();
  }
}