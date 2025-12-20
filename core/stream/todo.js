import AIStream from '#infrastructure/aistream/aistream.js';
import BotUtil from '#utils/botutil.js';
import { WorkflowManager } from '../workflow-manager.js';

/**
 * TODO工作流插件
 * 可注册的TODO功能，为其他工作流提供多步骤任务执行能力
 */
export default class TodoStream extends AIStream {
  static initialized = false;

  constructor() {
    super({
      name: 'todo',
      description: 'TODO工作流插件',
      version: '1.0.0',
      author: 'XRK',
      priority: 2, // 高优先级
      config: {
        enabled: true,
        temperature: 0.7,
        maxTokens: 4000
      },
      embedding: {
        enabled: false
      }
    });

    // 工作流管理器会在需要时注入到其他工作流
    this.workflowManager = null;
  }

  async init() {
    await super.init();
    
    // 创建全局工作流管理器（可以被其他工作流使用）
    this.workflowManager = new WorkflowManager(this);
    
    TodoStream.initialized = true;
    BotUtil.makeLog('info', `[${this.name}] TODO工作流插件已初始化`, 'TodoStream');
  }

  /**
   * 为其他工作流注入工作流管理器
   * @param {AIStream} targetStream - 目标工作流
   */
  injectWorkflowManager(targetStream) {
    if (!targetStream.workflowManager) {
      targetStream.workflowManager = this.workflowManager;
      // 设置stream引用
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
    TodoStream.initialized = false;
  }
}