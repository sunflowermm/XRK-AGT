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

  /**
   * 注入工作流管理器到目标stream
   */
  injectWorkflowManager(targetStream) {
    if (!targetStream) return;
    if (targetStream.workflowManager) return;
    
    targetStream.workflowManager = this.workflowManager;
    this.workflowManager.stream = targetStream;
  }

  /**
   * 构建系统提示（辅助工作流，合并时不会被调用）
   * 只有注册的函数的prompt字段会被合并到主工作流
   */
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