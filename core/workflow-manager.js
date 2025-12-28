import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';
import path from 'path';
import StreamLoader from '#infrastructure/aistream/loader.js';
import { BotError, ErrorCodes, errorHandler } from '#utils/error-handler.js';
import { InputValidator } from '#utils/input-validator.js';
import { WorkflowCleanupManager } from '#utils/heap-manager.js';
import { WorkflowDecisionTree } from '#utils/neural-algorithms.js';

// 工作流状态常量
const WORKFLOW_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PAUSED: 'paused'
};

const TODO_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// 工作流配置常量
const WORKFLOW_CONFIG = {
  MAX_ITERATIONS: 20,
  RETRY_MAX: 3,
  RETRY_DELAY: 2000,
  CLEANUP_DELAY: 30000,
  LOCK_CLEANUP_DELAY: 5000,
  STEP_DELAY: 1000,
  COMPLETION_THRESHOLD: 0.8,
  PROGRESS_THRESHOLD: 0.5
};

// 全局工作流管理器（单例模式）
let globalWorkflowManager = null;

/**
 * 工作流管理器
 * 负责多步骤任务的规划、执行和状态管理
 */
export class WorkflowManager {
  constructor(streamInstance) {
    if (globalWorkflowManager && globalWorkflowManager.stream === streamInstance) {
      return globalWorkflowManager;
    }
    
    this.stream = streamInstance;
    this.activeWorkflows = new Map();
    this.workflowLock = new Map();
    this.cleanupManager = new WorkflowCleanupManager();
    // 使用神经网络决策树优化工作流决策
    this.decisionTree = new WorkflowDecisionTree();
    
    // 启动定期清理任务（使用堆算法优化）
    this.cleanupInterval = setInterval(() => {
      this.cleanupCompletedWorkflows();
      this.cleanupStaleLocks();
    }, 60000); // 每分钟清理一次
    
    globalWorkflowManager = this;
  }

  /**
   * 获取全局单例实例
   */
  static getInstance(streamInstance) {
    if (!globalWorkflowManager) {
      globalWorkflowManager = new WorkflowManager(streamInstance);
      return globalWorkflowManager;
    }
    
    if (streamInstance && globalWorkflowManager.stream !== streamInstance) {
      globalWorkflowManager = new WorkflowManager(streamInstance);
    }
    
    return globalWorkflowManager;
  }

  /**
   * 清理已完成的工作流（使用堆算法优化，防止内存泄漏）
   */
  cleanupCompletedWorkflows() {
    try {
      const now = Date.now();
      const toDelete = this.cleanupManager.getWorkflowsToCleanup(now);
      
      // 同时检查直接存储的工作流（兼容旧逻辑）
      for (const [id, workflow] of this.activeWorkflows.entries()) {
        const { status, completedAt } = workflow;
        if ((status === WORKFLOW_STATUS.COMPLETED || status === WORKFLOW_STATUS.FAILED) && 
            completedAt && (now - completedAt) > WORKFLOW_CONFIG.CLEANUP_DELAY &&
            !toDelete.includes(id)) {
          toDelete.push(id);
        }
      }
      
      if (toDelete.length > 0) {
        BotUtil.makeLog('info', `清理 ${toDelete.length} 个已完成的工作流`, 'WorkflowManager');
        toDelete.forEach(id => {
          this.activeWorkflows.delete(id);
          this.cleanupManager.remove(id);
        });
      }
    } catch (error) {
      errorHandler.handle(error, { context: 'cleanupCompletedWorkflows' }, true);
    }
  }

  /**
   * 清理过期的锁（防止锁泄漏）
   */
  cleanupStaleLocks() {
    try {
      const now = Date.now();
      const staleThreshold = 300000; // 5分钟
      const toDelete = [];
      
      for (const [key, workflowId] of this.workflowLock.entries()) {
        const workflow = this.activeWorkflows.get(workflowId);
        if (!workflow || 
            (workflow.status !== WORKFLOW_STATUS.RUNNING && 
             (now - (workflow.completedAt || workflow.createdAt)) > staleThreshold)) {
          toDelete.push(key);
        }
      }
      
      if (toDelete.length > 0) {
        BotUtil.makeLog('debug', `清理 ${toDelete.length} 个过期的锁`, 'WorkflowManager');
        toDelete.forEach(key => this.workflowLock.delete(key));
      }
    } catch (error) {
      errorHandler.handle(error, { context: 'cleanupStaleLocks' }, true);
    }
  }

  /**
   * 发送工作流状态更新
   */
  async sendReply(workflow, type, data = {}) {
    const e = workflow?.context?.e;
    if (!e) return;

    const progress = this.calculateProgress(workflow);
    const timestamp = Date.now();

    const replyData = {
      type: 'workflow',
      event: type,
      workflowId: workflow.id,
      goal: workflow.goal,
      progress,
      iteration: workflow.iteration,
      timestamp,
      ...data
    };

    const text = this.formatStatusText(type, workflow, progress, data);
    const replyContent = `${JSON.stringify(replyData)}\n\n${text}`;
    
    await e.reply(replyContent).catch(err => {
      // debug: 发送失败是技术细节，不影响业务流程
      BotUtil.makeLog('debug', `发送工作流回复失败: ${err.message}`, 'WorkflowManager');
    });
  }

  /**
   * 计算工作流进度
   */
  calculateProgress(workflow) {
    const completed = workflow.todos.filter(t => t.status === TODO_STATUS.COMPLETED).length;
    return { completed, total: workflow.todos.length };
  }

  /**
   * 格式化状态文本
   */
  formatStatusText(type, workflow, progress, data) {
    const statusMap = {
      start: `🚀 工作流启动\n目标: ${workflow.goal}\n步骤: ${progress.total}\nID: ${workflow.id}`,
      step: this.formatStepText(progress, data),
      complete: `🎉 工作流完成\n目标: ${workflow.goal}\n完成: ${progress.completed}/${progress.total}`,
      error: `❌ 错误: ${data.task || ''}\n${data.error || ''}`,
      retry: `⚠️ 重试中: ${data.task || ''}\n${data.message || ''}`,
      update: `📢 ${data.message || ''}`
    };
    return statusMap[type] || data.message || '工作流状态更新';
  }

  /**
   * 格式化步骤文本（不包含自然语言回复）
   */
  formatStepText(progress, data) {
    const stepNum = data.stepNum || (progress.completed + 1);
    const completion = data.completion || 0.5;
    const status = this.getStepStatusIcon(completion);
    
    // 构建基础状态信息（不包含自然语言）
    return `${status} [${stepNum}/${progress.total}] ${data.task || ''}\n执行: ${data.action || ''}`;
  }

  /**
   * 获取步骤状态图标
   */
  getStepStatusIcon(completion) {
    if (completion >= WORKFLOW_CONFIG.COMPLETION_THRESHOLD) return '✅';
    if (completion >= WORKFLOW_CONFIG.PROGRESS_THRESHOLD) return '⏳';
    return '🔄';
  }

  /**
   * 判断是否需要工作流
   */
  async decideWorkflowMode(e, goal, workflow = null) {
    // 检查是否已有运行中的工作流
    const existing = this.findExistingWorkflow(e, goal);
    if (existing) {
      const userId = e?.user_id || e?.user?.id || '';
      // debug: 内部状态检查，不影响用户可见的业务流程
      BotUtil.makeLog('debug', `用户 ${userId} 已有运行中的工作流，跳过任务分析`, 'WorkflowManager');
      return { shouldUseTodo: false, response: '已有运行中的工作流', todos: [] };
    }

    // 调用AI判断，响应会被清理，不会执行任何命令
    return await this.aiDecideWorkflow(goal, workflow);
  }

  /**
   * 查找已存在的运行中工作流
   */
  findExistingWorkflow(e, goal) {
    const userId = e?.user_id || e?.user?.id || '';
    
    return Array.from(this.activeWorkflows.values())
      .find(w => {
        if (w.status !== WORKFLOW_STATUS.RUNNING) return false;
        
        const workflowUserId = w.context?.e?.user_id || w.context?.e?.user?.id || '';
        return w.goal === goal || workflowUserId === userId;
      });
  }

  /**
   * AI判断是否需要工作流（使用神经网络决策树优化）
   */
  async aiDecideWorkflow(goal, workflow = null) {
    // 先尝试使用决策树预测（神经网络算法）
    const prediction = this.decisionTree.predict(goal, []);
    
    // 如果预测置信度高，直接使用预测结果（减少AI调用）
    if (prediction && prediction.confidence >= 0.8) {
      BotUtil.makeLog('debug', `使用决策树预测（置信度: ${prediction.confidence.toFixed(2)}）`, 'WorkflowManager');
      
      if (!prediction.shouldUseTodo) {
        return { shouldUseTodo: false, response: '基于历史决策模式，此任务不需要工作流', todos: [] };
      }
      
      // 如果需要工作流，继续生成TODO
      const generatedTodos = await this.generateInitialTodos(goal, workflow);
      return { shouldUseTodo: true, response: '基于历史决策模式，此任务需要工作流', todos: generatedTodos };
    }

    // 置信度不足，调用AI进行决策
    const messages = this.buildDecisionMessages(goal);
    
    // 调用AI时，确保不会解析和执行任何命令
    // 任务分析助手的响应只用于判断，不执行任何操作
    const response = await this.stream.callAI(messages, this.stream.config);
    
    // 记录决策阶段的 AI 调用
    if (workflow) {
      this.recordDecisionStep(workflow, {
        type: 'decision',
        prompt: messages[1]?.content || '',
        messages,
        aiResponse: response || '',
        timestamp: Date.now()
      });
    }
    
    if (!response) {
      return { shouldUseTodo: false, response: '', todos: [] };
    }

    // 提取判断结果（移除所有命令格式，确保不会执行）
    const cleanResponse = this.cleanDecisionResponse(response);
    const shouldUseTodo = /是否需要TODO工作流:\s*是/i.test(cleanResponse);
    
    // 记录决策到决策树（用于学习）
    const todos = this.extractTodos(cleanResponse);
    this.decisionTree.recordDecision(goal, todos, shouldUseTodo);
    
    // 如果不需要工作流，直接返回
    if (!shouldUseTodo) {
      return { shouldUseTodo: false, response: cleanResponse, todos: [] };
    }
    
    // 如果已有TODO列表，直接返回
    if (todos.length > 0) {
      return { shouldUseTodo: true, response: cleanResponse, todos };
    }
    
    // 如果没有TODO列表，生成初始TODO
    const generatedTodos = await this.generateInitialTodos(goal, workflow);
    return { shouldUseTodo: true, response: cleanResponse, todos: generatedTodos };
  }


  /**
   * 清理决策响应，移除所有命令格式，确保不会执行任何命令
   * 只保留格式化的判断结果
   */
  cleanDecisionResponse(response) {
    if (!response) return '';
    
    // 先清理命令格式
    let cleaned = this.cleanAIResponse(response);
    
    // 只保留格式化的判断结果部分
    const todoMatch = cleaned.match(/是否需要TODO工作流:[\s\S]+?(?:\n\n|$)/);
    if (todoMatch) {
      cleaned = todoMatch[0].trim();
    } else {
      cleaned = ''; // 没有格式化输出，返回空
    }
    
    return cleaned;
  }

  /**
   * 获取可用指令列表（统一方法，避免重复代码）
   */
  getAvailableCommands(limit = 25) {
    const allFunctions = this.collectAllFunctions();
    return allFunctions
      .filter(f => !f.onlyTopLevel && f.enabled && f.prompt)
      .map(f => this.simplifyPrompt(f.prompt))
      .filter(cmd => cmd && !cmd.includes('启动工作流'))
      .slice(0, limit);
  }

  /**
   * 格式化指令列表为字符串
   */
  formatCommandsList(commands, title = '【可用指令参考】（用于设计TODO步骤）') {
    return commands.length > 0 
      ? `\n${title}\n${commands.map(cmd => `- ${cmd}`).join('\n')}\n`
      : '';
  }

  /**
   * 构建决策提示和消息
   * 优化：明确区分简单任务和复杂任务
   */
  buildDecisionMessages(goal) {
    const availableCommands = this.getAvailableCommands(25);
    const commandsList = this.formatCommandsList(availableCommands);

    return [
      {
        role: 'system',
        content: `你是任务分析助手，只负责评估任务，不执行任何操作。

【严格禁止】
- 这是评估阶段，不是执行阶段
- 你没有任何执行权限，不能执行任何函数或命令
- 绝对禁止使用任何命令格式（如[回桌面]、[截屏]、[股票:代码]、[读取:文件]等）
- 绝对禁止在回复中包含任何[]格式的命令
- 绝对禁止执行任何操作
- 你的回复不会被解析为命令，也不会执行任何操作

【你的职责】
- 只分析任务是否需要多步工作流
- 如果需要工作流，根据可用指令列表设计合理的TODO步骤
- 只输出分析结果，不执行任何操作

【判断标准 - 简单任务 vs 复杂任务】

【简单任务】（不需要工作流，单步可完成）
- 只需要执行一个操作即可完成的任务
- 例如：
  * "查询688270的股票" → 只需执行[股票:688270]
  * "回到桌面" → 只需执行[回桌面]
  * "读取文件test.txt" → 只需执行[读取:test.txt]
  * "截屏" → 只需执行[截屏]
  * "搜索文件中的关键词" → 只需执行[搜索:关键词:文件路径]
- 特点：任务目标单一，一个指令就能完成

【复杂任务】（需要工作流，多步完成）
- 需要多个步骤、多个操作才能完成的任务
- 例如：
  * "查股票然后生成表格" → 需要：1.查询股票 2.分析数据 3.生成表格
  * "读取文件A和文件B，然后合并内容" → 需要：1.读取A 2.读取B 3.合并
  * "先回桌面，然后截图，最后保存" → 需要：1.回桌面 2.截图 3.保存
  * "查询多只股票并对比分析" → 需要：1.查询股票1 2.查询股票2 3.对比分析
- 特点：任务目标复杂，需要多个步骤，步骤之间有依赖关系

【TODO设计原则】
- 根据任务描述和可用指令列表，设计合理的步骤
- 每个步骤应该对应一个具体的操作目标
- 步骤描述要清晰，使用纯文本描述，不要使用命令格式
- 步骤之间要有逻辑顺序，前一步的输出可能是后一步的输入
- 例如：任务"查股票然后生成表格"可以分解为：
  1. 查询股票行情数据
  2. 分析数据并生成Excel表格
${commandsList}
【输出格式】
是否需要TODO工作流: [是/否]
理由: [简要说明为什么是简单任务或复杂任务]
如果选择"是"，输出：
TODO列表:
1. 第一步（任务描述，纯文本，不要包含任何命令格式）
2. 第二步（任务描述，纯文本，不要包含任何命令格式）

【重要提醒】
- 你的回复只会用于判断是否需要工作流，不会执行任何命令
- 即使你在回复中写了命令格式，也不会被执行
- 请只输出分析结果，不要包含任何命令格式
- 不要输出自然语言说明，只输出格式化的判断结果`
      },
      {
        role: 'user',
        content: `分析任务：${goal}`
      }
    ];
  }

  /**
   * 清理文本，移除命令格式和多余空格（统一方法）
   */
  sanitizeText(text) {
    if (!text) return '';
    return text
      .replace(/\[([^\]]+)\]/g, '') // 移除命令格式
      .replace(/\s+/g, ' ') // 移除多余空格
      .trim();
  }

  extractTodos(text) {
    if (!text) return [];
    
    const todos = [];
    const todoMatch = text.match(/TODO列表:\s*([\s\S]+?)(?:\n\n|$)/);
    if (!todoMatch) return todos;
    
    const todoRegex = /^\d+[\.、]\s*(.+)$/gm;
    let match;
    while ((match = todoRegex.exec(todoMatch[1])) !== null) {
      const content = this.sanitizeText(match[1]);
      if (content && content.length > 2) {
        todos.push(content);
      }
    }
    
    return todos;
  }

  async generateInitialTodos(goal, workflow = null) {
    // 使用统一方法获取可用指令列表
    const availableCommands = this.getAvailableCommands(20);
    const commandsList = this.formatCommandsList(availableCommands);

    const messages = [
      {
        role: 'system',
        content: `你是任务规划助手，只负责规划步骤，不执行任何操作。

【严格禁止】
- 这是规划阶段，不是执行阶段
- 你没有任何执行权限，不能执行任何函数或命令
- 绝对禁止使用任何命令格式（如[回桌面]、[截屏]、[股票:代码]、[读取:文件]等）
- 绝对禁止在回复中包含任何[]格式的命令
- 绝对禁止执行任何操作

【你的职责】
- 只规划任务步骤，不执行任何操作
- 根据可用指令列表设计合理的步骤
- 只输出步骤描述，纯文本，不要包含任何命令格式

【TODO设计原则】
- 根据任务描述和可用指令列表，设计合理的步骤
- 每个步骤应该对应一个具体的操作目标
- 步骤描述要清晰，不要使用命令格式
${commandsList}
【要求】
- 步骤要精简高效
- 避免冗余步骤
- 输出格式：每行一个步骤，用数字编号
- 步骤描述必须是纯文本，不要包含任何命令格式

【重要提醒】
- 你的回复只会用于创建工作流步骤，不会执行任何命令
- 即使你在回复中写了命令格式，也不会被执行
- 请只输出步骤描述，不要包含任何命令格式
- 不要输出自然语言说明，只输出格式化的步骤列表`
      },
      {
        role: 'user',
        content: `将任务分解为2-3个步骤：${goal}`
      }
    ];
    
    const response = await this.stream.callAI(messages, this.stream.config);
    
    if (workflow) {
      this.recordDecisionStep(workflow, {
        type: 'generate_todos',
        prompt: messages[1]?.content || '',
        messages,
        aiResponse: response || '',
        timestamp: Date.now()
      });
    }
    
    // 清理响应，移除所有命令格式
    const cleanResponse = response ? this.cleanDecisionResponse(response) : '';
    const todos = cleanResponse ? this.extractTodos(cleanResponse) : [];
    return todos.length > 0 ? todos : ['执行第一步', '执行第二步'];
  }

  /**
   * 创建工作流
   */
  async createWorkflow(e, goal, initialTodos = []) {
    try {
      // 输入验证
      if (!goal || typeof goal !== 'string') {
        throw new BotError('工作流目标不能为空', ErrorCodes.INVALID_INPUT);
      }
      
      const sanitizedGoal = InputValidator.sanitizeText(goal, 500);
      const sanitizedTodos = Array.isArray(initialTodos) 
        ? initialTodos.map(t => InputValidator.sanitizeText(t, 200))
        : [];

      this.cleanupCompletedWorkflows();

      const userKey = e?.user_id || e?.sender?.user_id || 'default';
      const workflowKey = `${userKey}:${sanitizedGoal}`;

      const existingId = this.checkExistingWorkflow(workflowKey, sanitizedGoal, userKey);
      if (existingId) return existingId;

      this.workflowLock.set(workflowKey, null);

      const workflowId = `workflow_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const workflow = this.createWorkflowObject(workflowId, sanitizedGoal, sanitizedTodos, e);

      await this.stream.storeWorkflowMemory(workflowId, { goal: sanitizedGoal, createdAt: Date.now() });
      this.activeWorkflows.set(workflowId, workflow);
      this.workflowLock.set(workflowKey, workflowId);
      
      // info: 工作流创建是重要的业务操作
      BotUtil.makeLog('info', `创建工作流 [${workflowId}]: ${sanitizedGoal}`, 'WorkflowManager');
      await this.sendReply(workflow, 'start', { todos: sanitizedTodos });
      
      this.executeWorkflow(workflowId).catch(err => {
        const error = errorHandler.handle(
          err, 
          { workflowId, goal: sanitizedGoal, context: 'createWorkflow' },
          true
        );
        BotUtil.makeLog('error', `工作流执行失败[${workflowId}]: ${error.message}`, 'WorkflowManager');
      }).finally(() => {
        setTimeout(() => this.workflowLock.delete(workflowKey), WORKFLOW_CONFIG.LOCK_CLEANUP_DELAY);
      });
      
      return workflowId;
    } catch (error) {
      const handledError = errorHandler.handle(error, { goal, context: 'createWorkflow' }, true);
      throw handledError;
    }
  }

  /**
   * 检查已存在的工作流（同一用户同时只能有一个运行中的工作流）
   */
  checkExistingWorkflow(workflowKey, goal, userKey) {
    // 检查是否正在创建中
    if (this.workflowLock.has(workflowKey)) {
      BotUtil.makeLog('warn', `[工作流] 正在创建中，跳过重复创建`, 'WorkflowManager');
      return this.workflowLock.get(workflowKey);
    }

    // 检查是否已有运行中的工作流
    const existing = Array.from(this.activeWorkflows.values())
      .find(w => {
        if (w.status !== WORKFLOW_STATUS.RUNNING) return false;
        const workflowUserKey = w.context?.e?.user_id || w.context?.e?.sender?.user_id;
        return workflowUserKey === userKey;
      });

    if (existing) {
      BotUtil.makeLog('warn', `[工作流] 用户 ${userKey} 已有运行中的工作流 [${existing.id}]，拒绝创建新工作流`, 'WorkflowManager');
      return existing.id;
    }

    return null;
  }

  /**
   * 创建工作流对象
   */
  createWorkflowObject(workflowId, goal, initialTodos, e) {
    return {
      id: workflowId,
      goal,
      todos: initialTodos.map((todo, index) => this.createTodoObject(index, todo)),
      notes: [],
      currentStep: 0,
      history: [],
      context: { e },
      createdAt: Date.now(),
      maxIterations: WORKFLOW_CONFIG.MAX_ITERATIONS,
      iteration: 0,
      status: WORKFLOW_STATUS.RUNNING,
      debugSteps: [],
      decisionSteps: []  // 记录决策阶段的 AI 调用
    };
  }

  /**
   * 创建TODO对象
   */
  createTodoObject(index, content) {
    return {
      id: `todo_${index}`,
      content,
      status: TODO_STATUS.PENDING,
      result: null,
      error: null,
      notes: []
    };
  }

  /**
   * 执行工作流
   */
  async executeWorkflow(workflowId) {
    try {
      // 输入验证
      InputValidator.validateWorkflowId(workflowId);
      
      const workflow = this.activeWorkflows.get(workflowId);
      if (!workflow) {
        throw new BotError(`工作流不存在: ${workflowId}`, ErrorCodes.WORKFLOW_NOT_FOUND);
      }

      try {
        await this.runWorkflowLoop(workflow);
        this.handleWorkflowCompletion(workflow);
        
        // 工作流完成，调度清理
        if (workflow.status === WORKFLOW_STATUS.COMPLETED || 
            workflow.status === WORKFLOW_STATUS.FAILED) {
          workflow.completedAt = Date.now();
          this.cleanupManager.scheduleCleanup(
            workflowId, 
            workflow.completedAt, 
            WORKFLOW_CONFIG.CLEANUP_DELAY
          );
        }
      } catch (error) {
        this.handleWorkflowError(workflow, error);
      } finally {
        await this.saveDebugLog(workflow).catch(err => {
          // debug: 日志保存失败不影响业务流程
          BotUtil.makeLog('debug', `保存工作流调试日志失败[${workflowId}]: ${err.message}`, 'WorkflowManager');
        });
      }
    } catch (error) {
      const handledError = errorHandler.handle(
        error, 
        { workflowId, context: 'executeWorkflow' },
        true
      );
      throw handledError;
    }
  }

  /**
   * 运行工作流循环
   */
  async runWorkflowLoop(workflow) {
    while (workflow.status === WORKFLOW_STATUS.RUNNING && workflow.iteration < workflow.maxIterations) {
      workflow.iteration++;

      // 检查是否全部完成
      if (workflow.todos.every(t => t.status === TODO_STATUS.COMPLETED || t.status === TODO_STATUS.FAILED)) {
        workflow.status = WORKFLOW_STATUS.COMPLETED;
        workflow.completedAt = Date.now();
        await this.sendReply(workflow, 'complete');
        
        // 工作流完成后，调用AI进行收尾总结
        await this.generateWorkflowSummary(workflow);
        return;
      }

      // 获取下一个待执行的TODO
      const todo = workflow.todos.find(t => t.status === TODO_STATUS.PENDING) ||
                   workflow.todos.find(t => t.status === TODO_STATUS.IN_PROGRESS);
      
      if (!todo) {
        workflow.status = WORKFLOW_STATUS.COMPLETED;
        return;
      }
      
      await this.executeTodo(workflow, todo);
      await BotUtil.sleep(WORKFLOW_CONFIG.STEP_DELAY);
    }
  }

  /**
   * 处理工作流完成
   */
  handleWorkflowCompletion(workflow) {
    if (workflow.iteration < workflow.maxIterations) return;
    
    workflow.status = WORKFLOW_STATUS.FAILED;
    workflow.completedAt = Date.now();
    this.sendReply(workflow, 'error', { 
      error: '达到最大迭代次数', 
      message: '工作流已停止' 
    });
  }

  /**
   * 处理工作流错误
   */
  handleWorkflowError(workflow, error) {
    const botError = BotError.fromError(
      error, 
      ErrorCodes.WORKFLOW_EXECUTION_FAILED,
      { workflowId: workflow.id, goal: workflow.goal }
    );
    
    workflow.status = WORKFLOW_STATUS.FAILED;
    workflow.error = botError.message;
    workflow.completedAt = Date.now();
    
    // 调度清理
    this.cleanupManager.scheduleCleanup(
      workflow.id,
      workflow.completedAt,
      WORKFLOW_CONFIG.CLEANUP_DELAY
    );
    
    errorHandler.handle(botError, { workflowId: workflow.id }, true);
    BotUtil.makeLog('error', `工作流执行异常[${workflow.id}]: ${botError.message}`, 'WorkflowManager');
  }

  /**
   * 执行TODO
   */
  async executeTodo(workflow, todo) {
    todo.status = TODO_STATUS.IN_PROGRESS;
    
    try {
      await this.processTodo(workflow, todo);
    } catch (error) {
      this.handleTodoError(workflow, todo, error);
    }
  }

  /**
   * 处理TODO
   */
  async processTodo(workflow, todo) {
    // 步骤1: 准备上下文和提示
    const notes = await this.stream.getNotes(workflow.id);
    const prompt = await this.buildTodoPrompt(workflow, todo, notes);
    const messages = [
      { role: 'system', content: this.buildSystemPrompt(workflow) },
      { role: 'user', content: prompt }
    ];
    
    // 步骤2: 调用AI获取执行指令
    const response = await this.callAIWithRetry(messages, workflow, todo);
    const parsed = this.parseAIResponse(response);
    
    // 步骤3: 记录历史
    this.recordHistory(workflow, todo, response, parsed);
    
    // 步骤4: 执行所有提取的指令
    const result = await this.executeAction(workflow, parsed.commands);
    todo.result = result;

    // 步骤5: 智能判断完成度
    const completion = this.calculateSmartCompletion(workflow, todo, parsed, result);
    
    // 步骤6: 记录错误和异常情况
    if (result.error) {
      await this.storeNote(workflow, todo.id, `执行错误：${result.error}`);
    }
    
    if (completion < WORKFLOW_CONFIG.COMPLETION_THRESHOLD && parsed.hasCompleteCommand) {
      await this.storeNote(workflow, todo.id, `AI标记完成但系统判断未完成，完成度：${completion.toFixed(2)}`);
    }

    // 步骤7: 合并上下文并更新笔记
    this.mergeContext(workflow, result.context);
    todo.notes = await this.stream.getNotes(workflow.id);
    
    // 步骤8: 发送流程回复
    await this.handleExecutionResult(workflow, todo, result, completion);
    
    // 步骤9: 发送自然语言回复（在流程回复之后）
    const aiMessage = this.extractAIMessage(response);
    if (aiMessage?.trim()) {
      await this.sendAIMessage(workflow, aiMessage);
    }

    // 步骤10: 记录调试信息
    this.recordDebugStep(workflow, todo, {
      prompt,
      messages,
      response,
      parsed,
      notes,
      result,
      completion
    });
  }


  /**
   * 记录历史
   */
  recordHistory(workflow, todo, response, parsed) {
    workflow.history.push({
      todoId: todo.id,
      iteration: workflow.iteration,
      response,
      commands: parsed.commands || [],
      hasCompleteCommand: parsed.hasCompleteCommand || false,
      timestamp: Date.now()
    });
  }

  /**
   * 处理TODO错误
   * 标准化错误处理，记录错误并继续执行
   */
  async handleTodoError(workflow, todo, error) {
    const botError = BotError.fromError(
      error,
      ErrorCodes.WORKFLOW_EXECUTION_FAILED,
      { workflowId: workflow.id, todoId: todo.id, todoContent: todo.content }
    );
    
    errorHandler.handle(botError, { workflowId: workflow.id, todoId: todo.id }, true);
    BotUtil.makeLog('error', `Todo执行失败[${todo.id}]: ${botError.message}`, 'WorkflowManager');
    
    await this.storeNote(workflow, todo.id, `执行异常: ${botError.message}，已记录到笔记，继续下一步`);
    todo.status = TODO_STATUS.COMPLETED;
    todo.error = botError.message;
  }

  /**
   * 带重试的AI调用
   */
  async callAIWithRetry(messages, workflow, todo) {
    let response = null;
    let retryCount = 0;
    
    while (!response && retryCount < WORKFLOW_CONFIG.RETRY_MAX) {
      response = await this.stream.callAI(messages, this.stream.config);
      if (!response && retryCount < WORKFLOW_CONFIG.RETRY_MAX) {
        retryCount++;
        await this.sendReply(workflow, 'retry', { 
          task: todo.content,
          message: `AI响应为空，正在重试 (${retryCount}/${WORKFLOW_CONFIG.RETRY_MAX})` 
        });
        await BotUtil.sleep(WORKFLOW_CONFIG.RETRY_DELAY);
      }
    }
    
    if (!response) {
      throw new Error(`AI返回空响应（已重试${WORKFLOW_CONFIG.RETRY_MAX}次）`);
    }
    
    return response;
  }

  /**
   * 清理AI响应文本（统一方法，移除命令格式和多余空白）
   */
  cleanAIResponse(response) {
    if (!response) return '';
    return response
      .replace(/\[([^\]]+)\]/g, '') // 移除命令格式
      .replace(/\n{3,}/g, '\n\n') // 合并多余空行
      .replace(/[ \t]{2,}/g, ' ') // 合并多余空格
      .trim();
  }

  /**
   * 提取AI的自然语言回复（去除[]指令）
   */
  extractAIMessage(response) {
    return this.cleanAIResponse(response);
  }

  /**
   * 合并上下文
   */
  mergeContext(workflow, newContext) {
    if (!newContext || typeof newContext !== 'object') return;
    
    // 保留事件对象 e
    const e = workflow.context.e;
    
    // 合并新上下文，排除undefined和null值
    for (const [key, value] of Object.entries(newContext)) {
      if (value !== undefined && value !== null && key !== 'e') {
        workflow.context[key] = value;
      }
    }
    
    // 确保事件对象不被覆盖
    if (e) {
      workflow.context.e = e;
    }
    
    // 记录上下文更新日志（仅在有重要数据时）
    if (newContext.fileContent) {
      const fileName = newContext.fileSearchResult?.fileName || newContext.fileName || '未知文件';
      BotUtil.makeLog('debug', `工作流[${workflow.id}]上下文已更新：读取文件 ${fileName}`, 'WorkflowManager');
    }
    if (newContext.commandOutput && newContext.commandSuccess) {
      BotUtil.makeLog('debug', `工作流[${workflow.id}]上下文已更新：命令执行成功`, 'WorkflowManager');
    }
  }

  async handleExecutionResult(workflow, todo, result, completion) {
    const completionRate = completion || 0.5;
    const progress = this.calculateProgress(workflow);
    
    // 构建执行动作文本（使用统一格式化方法）
    const actionText = this.formatFunctions(result.functions);
    
    // 发送流程回复（自然语言已在processTodo中发送）
    await this.sendReply(workflow, 'step', {
      stepNum: progress.completed + 1,
      task: todo.content,
      action: actionText,
      completion: completionRate
    });
    
    this.updateTodoStatus(workflow, todo, completionRate);
  }

  /**
   * 发送AI的自然语言回复（单独发送）
   */
  async sendAIMessage(workflow, message) {
    const e = workflow?.context?.e;
    if (!e || !message || !message.trim()) return;
    
    await e.reply(message.trim()).catch(err => {
      // debug: 发送失败是技术细节
      BotUtil.makeLog('debug', `发送AI自然语言回复失败: ${err.message}`, 'WorkflowManager');
    });
  }

  addNextStep(workflow, nextStep) {
    workflow.todos.push(this.createTodoObject(workflow.todos.length, nextStep));
  }

  /**
   * 生成工作流完成总结（收尾AI调用）
   */
  async generateWorkflowSummary(workflow) {
    const e = workflow?.context?.e;
    if (!e) return;

    try {
      // 收集已完成的任务信息
      const completedTodos = workflow.todos.filter(t => t.status === TODO_STATUS.COMPLETED);
      const todosSummary = completedTodos.map((todo, index) => {
        const actionText = this.formatFunctions(todo.result?.functions);
        return `${index + 1}. ${todo.content} - 执行: ${actionText}`;
      }).join('\n');

      // 收集工作流笔记摘要
      const notesSummary = workflow.notes
        .slice(-5)
        .map((note, index) => `${index + 1}. ${this.truncateText(note.content, 200)}`)
        .join('\n');

      const messages = [
        {
          role: 'system',
          content: `你是工作流总结助手，负责对已完成的工作流进行总结。

【你的职责】
- 对已完成的工作流进行简洁、清晰的总结
- 说明完成了哪些任务，取得了什么结果
- 用自然、友好的语言向用户汇报
- 不要使用任何命令格式，只输出自然语言

【输出要求】
- 简洁明了，2-3句话即可
- 突出主要成果
- 语气友好自然`
        },
        {
          role: 'user',
          content: `工作流目标：${workflow.goal}

已完成的任务：
${todosSummary}

工作流笔记摘要：
${notesSummary || '无'}

请对这次工作流进行总结，用自然语言向用户汇报完成情况。`
        }
      ];

      const response = await this.stream.callAI(messages, this.stream.config);
      
      if (response) {
        // 使用统一的清理方法
        const summary = this.cleanAIResponse(response);
        if (summary) {
          await e.reply(summary).catch(err => {
            // debug: 发送失败是技术细节
            BotUtil.makeLog('debug', `发送工作流总结失败: ${err.message}`, 'WorkflowManager');
          });
        }
      }
    } catch (error) {
      BotUtil.makeLog('error', `生成工作流总结失败: ${error.message}`, 'WorkflowManager');
    }
  }

  /**
   * 存储笔记
   */
  async storeNote(workflow, source, content) {
    await this.stream.storeNote(workflow.id, content, source, true);
    workflow.notes.push({ content, source, time: Date.now(), temporary: true });
  }

  /**
   * 更新TODO状态
   */
  updateTodoStatus(workflow, todo, completionRate) {
    const rate = this.normalizeCompletionRate(completionRate);
    
    if (rate >= WORKFLOW_CONFIG.COMPLETION_THRESHOLD) {
      todo.status = TODO_STATUS.COMPLETED;
      todo.completedAt = Date.now();
      return;
    }
    
    if (rate >= WORKFLOW_CONFIG.PROGRESS_THRESHOLD) {
      todo.status = TODO_STATUS.IN_PROGRESS;
      return;
    }
    
    todo.status = TODO_STATUS.PENDING;
  }

  /**
   * 标准化完成度
   */
  normalizeCompletionRate(completionRate) {
    if (typeof completionRate !== 'number' || isNaN(completionRate)) {
      return 0.5;
    }
    return completionRate;
  }

  /**
   * 构建TODO提示
   */
  async buildTodoPrompt(workflow, todo, notes = []) {
    const context = workflow.context || {};
    const progress = this.calculateProgress(workflow);
    const previousTodos = this.getPreviousTodos(workflow);
    
    const sections = this.buildPromptSections(workflow, todo, context, progress, previousTodos, notes);
    return sections.join('\n\n');
  }

  /**
   * 获取之前的TODO
   */
  getPreviousTodos(workflow) {
    return workflow.todos
      .filter(t => t.status === TODO_STATUS.COMPLETED)
      .slice(-3);
  }

  /**
   * 构建提示部分（通用、简洁，提高token量）
   */
  buildPromptSections(workflow, todo, context, progress, previousTodos, notes) {
    const sections = [];
    
    sections.push(`【工作流目标】\n${workflow.goal}\n`);
    // 强调当前步骤位置
    const stepNum = progress.completed + 1;
    sections.push(`【当前步骤】第 ${stepNum}/${progress.total} 步\n`);
    sections.push(`【当前任务】\n${todo.content}\n`);
    sections.push(`【执行进度】已完成 ${progress.completed}/${progress.total} 个任务\n`);
    
    const completedTasks = this.buildCompletedTasksSection(previousTodos);
    if (completedTasks) {
      sections.push(completedTasks);
    }
    
    const contextSection = this.buildContextSection(context);
    if (contextSection) {
      sections.push(contextSection);
    }
    
    const notesSection = this.buildNotesSection(notes);
    if (notesSection) {
      sections.push(notesSection);
    }
    
    sections.push(this.buildRequirementsSection(context));
    
    // 添加更多上下文信息以提高token量和准确性
    if (workflow.history && workflow.history.length > 0) {
      const recentHistory = workflow.history.slice(-5); // 增加历史记录数量
      const historyText = recentHistory.map((h, idx) => {
        const commands = h.commands || [];
        const stepInfo = `步骤${idx + 1}: ${commands.length > 0 ? commands.join(' ') : '无指令'}`;
        return `  - ${stepInfo}`;
      }).join('\n');
      if (historyText) {
        sections.push(`【最近执行记录】（用于参考，避免重复执行）\n${historyText}\n`);
      }
    }
    
    return sections;
  }


  /**
   * 提取相关上下文（简化，删除冗余逻辑）
   */
  extractRelevantContext(context) {
    if (!context || typeof context !== 'object') return {};
    
    const excludeFields = ['e', 'workflowId', 'question'];
    const relevant = {};
    
    for (const [key, value] of Object.entries(context)) {
      if (excludeFields.includes(key) || value == null) continue;
      
      if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
      
      relevant[key] = typeof value === 'object' && !Array.isArray(value)
        ? this.truncateText(JSON.stringify(value), 200)
        : value;
    }
    
    return relevant;
  }

  /**
   * 构建已完成任务部分
   */
  buildCompletedTasksSection(previousTodos) {
    if (previousTodos.length === 0) return '';
    
    const taskLines = previousTodos.map(todo => {
      let line = `✓ ${todo.content}`;
      
      if (todo.result?.executed) {
        const details = [];
        if (todo.result.functions?.length > 0) {
          details.push(`执行: ${this.formatFunctions(todo.result.functions, '、')}`);
        }
        const ctx = this.extractRelevantContext(todo.result.context);
        for (const [key, value] of Object.entries(ctx)) {
          const displayValue = typeof value === 'string' && (value.includes('/') || value.includes('\\'))
            ? value.split(/[/\\]/).pop()
            : value;
          details.push(`${key}: ${displayValue}`);
        }
        if (details.length > 0) {
          line += ` [${details.join('，')}]`;
        }
      }
      
      return line;
    });
    
    return `【已完成任务】\n${taskLines.join('\n')}\n\n【重要提示】\n仔细检查已完成任务的上下文信息。如果已完成任务的上下文显示已经完成了当前任务的目标，直接输出[完成]，不要重复执行相同操作。\n`;
  }


  /**
   * 构建上下文部分（合并，删除冗余方法）
   */
  buildContextSection(context) {
    const sections = [];
    
    // 文件上下文
    if (context.fileContent) {
      const fileName = context.fileSearchResult?.fileName || context.fileName || '文件';
      const content = this.truncateText(context.fileContent, 5000, '\n...(已截断)');
      sections.push(`【文件内容】\n文件名：${fileName}\n${content}`);
    }
    
    // 命令上下文
    if (context.commandOutput && context.commandSuccess) {
      const output = this.truncateText(context.commandOutput, 1000, '\n...(已截断)');
      sections.push(`【命令输出】\n${output}`);
    }
    
    return sections.join('\n\n');
  }

  /**
   * 截断文本（统一方法）
   */
  truncateText(text, maxLength, suffix = '...') {
    if (!text || text.length <= maxLength) return text;
    return text.slice(0, maxLength) + suffix;
  }

  /**
   * 构建笔记部分（通用，无特定场景过滤）
   */
  buildNotesSection(notes) {
    if (!notes || notes.length === 0) return '';
    
    const relevantNotes = notes
      .filter(note => note.content && note.content.trim())
      .slice(-5);
    
    if (relevantNotes.length === 0) return '';
    
    const notesText = relevantNotes
      .map((note, i) => `${i + 1}. ${this.truncateText(note.content, 500)}`)
      .join('\n\n');
    
    return `【工作流笔记】\n${notesText}\n\n重要：这些笔记记录了之前步骤的执行结果和上下文信息，请基于这些实际信息判断当前任务是否已完成。\n`;
  }

  /**
   * 构建要求部分（通用）
   * 优化：提高清晰度和可操作性
   */
  buildRequirementsSection(context) {
    const requirements = [
      '仔细阅读当前任务描述，明确这一步要完成什么',
      '检查已完成任务的上下文信息（笔记、文件内容、命令输出等），判断当前任务是否已经完成',
      '如果已完成任务的上下文显示已经完成了当前任务的目标，直接输出[完成]',
      '如果当前任务未完成，根据任务描述选择合适的指令执行',
      '不要重复执行相同操作，充分利用已有上下文内容（笔记、文件、数据等）',
      '基于实际上下文判断，不要编造信息',
      '如果任务需要多个操作，可以一次输出多个[]指令，例如：[读取:文件1.txt][读取:文件2.txt]',
      '执行完成后，输出[完成]标记任务完成',
      '必须同时输出[]指令和自然语言说明，让用户了解执行情况'
    ];
    
    return `【执行要求】\n${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  }

  buildSystemPrompt(workflow) {
    const funcPrompt = this.buildFunctionsPrompt();
    const contextInfo = this.buildContextInfo(workflow.context);

    return `【工作流执行助手】
执行多步骤工作流任务。

【工具】
${funcPrompt || '- 无可用工具'}

【核心原则】
1. 只输出[]指令，不要输出任何特殊格式
2. 可以一次执行多个函数，例如：[股票:600519][股票:000001][股票:000858]
3. 如果任务已完成，输出[完成]或[标记完成]
4. 如果任务需要继续，输出相应的[]指令
5. 仔细检查已完成任务的上下文信息，如果已经完成了当前任务的目标，直接输出[完成]
6. 避免重复执行相同操作，充分利用已有上下文内容（笔记、文件、数据等）
7. 使用已有上下文内容，不重复获取相同信息
8. 【严格禁止】绝对禁止启动新工作流，不要输出[启动工作流:...]命令
9. 基于实际上下文判断，不要编造信息
10. 对于复杂任务，可以分步执行，每一步都要明确目标

【任务完成判断】
- 如果已完成任务的上下文信息显示已经完成了当前任务的目标，直接输出[完成]
- 例如：如果任务是"查询股票"，而上下文显示已经查询到了股票数据，直接输出[完成]
- 不要重复执行已经完成的操作

【输出要求】
- 只输出[]指令，例如：[回桌面]、[读取:文件.txt]、[生成Excel:文件名.xlsx:[{"列":"值"}]]、[完成]
- 可以输出多个指令，例如：[读取:文件1.txt][读取:文件2.txt]
- 如果任务已完成，输出[完成]
- 【重要】必须添加自然语言说明（1-2句话），说明你正在做什么或已完成什么
- 自然语言说明会在回复中显示给用户，让用户了解执行情况
${contextInfo}
`;
  }

  buildFunctionsPrompt() {
    const allFunctions = this.collectAllFunctions();
    const funcPrompts = [];
    
    for (const func of allFunctions) {
      if (func.onlyTopLevel || !func.enabled || !func.prompt) continue;
      
      const resolvedPrompt = typeof func.prompt === 'function' ? func.prompt() : func.prompt;
      const simplified = this.simplifyPrompt(resolvedPrompt);
      if (simplified && !funcPrompts.includes(simplified)) {
        funcPrompts.push(simplified);
      }
    }
    
    if (funcPrompts.length === 0) return '';
    
    return `【工具使用说明】
直接输出[]指令即可执行操作，可以一次执行多个函数：
- [股票:600519][股票:000001][股票:000858] - 同时查询三只股票
- [读取:文件1.txt][读取:文件2.txt] - 同时读取两个文件
- [生成Excel:文件名.xlsx:[{"列1":"值1","列2":"值2"}]] - 生成Excel文件
- [回桌面] - 单个命令
- [完成] - 标记当前任务已完成
【输出格式要求】
- 必须同时输出[]指令和自然语言说明
- 例如："好的，我来帮你回到桌面。[回桌面]"
- 自然语言说明会在回复中显示给用户，让用户了解执行情况

【可用工具列表】
${funcPrompts.map(p => `- ${p}`).join('\n')}

【完成指令】
- [完成] - 标记当前任务已完成，系统会自动判断完成度
- [标记完成] - 同[完成]`;
  }

  /**
   * 过滤可执行命令（移除完成指令）
   */
  filterExecutableCommands(commands) {
    return commands
      .map(cmd => cmd?.trim())
      .filter(cmd => cmd && !/^\[(完成|标记完成)\]$/i.test(cmd));
  }

  /**
   * 格式化函数列表为字符串（统一方法）
   */
  formatFunctions(functions, separator = '') {
    if (!functions || !Array.isArray(functions) || functions.length === 0) {
      return '无';
    }
    return functions.map(f => `[${f}]`).join(separator);
  }

  simplifyPrompt(prompt) {
    if (!prompt) return '';
    const parts = prompt.split(' - ');
    const command = parts[0].trim();
    const description = parts[1]?.trim();
    
    if (command.startsWith('[') && command.includes(']')) {
      const endIndex = command.indexOf(']');
      const baseCommand = command.substring(0, endIndex + 1);
      return description ? `${baseCommand} - ${description.split('，')[0]}` : baseCommand;
    }
    
    return command;
  }

  collectAllFunctions() {
    const allFunctions = [];
    const seen = new Set();
    
    const addFunctions = (stream) => {
      if (!stream?.functions) return;
      stream.functions.forEach(func => {
        const key = `${stream.name}.${func.type}`;
        if (!seen.has(key)) {
          seen.add(key);
        allFunctions.push(func);
      }
      });
    };
    
    // 使用统一的stream收集方法
    const streams = this._collectAllStreams();
    streams.forEach(addFunctions);
    
    return allFunctions;
  }

  /**
   * 构建上下文信息（通用）
   */
  buildContextInfo(context) {
    if (!context) return '';
    const info = [];
    
    if (context.fileContent) {
      const fileName = context.fileSearchResult?.fileName || context.fileName || '文件';
      info.push(`已读取文件：${fileName}`);
    }
    
    if (context.commandOutput && context.commandSuccess) {
      info.push('上一个命令执行成功');
    }
    
    return info.length > 0 ? `\n【上下文】\n${info.join('\n')}\n` : '';
  }

  /**
   * 解析AI响应 - 只提取[]指令
   */
  parseAIResponse(response) {
    // 提取所有[]指令
    const commands = this.extractCommands(response);
    
    // 检查是否有完成指令
    const hasCompleteCommand = commands.some(cmd => 
      /^\[(完成|标记完成)\]$/i.test(cmd.trim())
    );
    
    return {
      commands,
      hasCompleteCommand,
      // 完成度和下一步由系统智能判断，不再从AI响应中提取
      completion: null,
      nextStep: null,
      note: null
    };
  }

  /**
   * 提取所有[]指令
   */
  extractCommands(response) {
    if (!response) return [];
    
    const commands = [];
    const commandRegex = /\[([^\]]+)\]/g;
    let match;
    
    while ((match = commandRegex.exec(response)) !== null) {
      const fullCommand = `[${match[1]}]`;
      // 排除工作流启动命令
      if (!/^\[启动工作流:/.test(fullCommand)) {
        commands.push(fullCommand);
      }
    }
    
    return commands;
  }

  /**
   * 智能判断完成度 - 基于执行结果、上下文、完成指令等
   */
  calculateSmartCompletion(workflow, todo, parsed, result) {
    // 1. 如果AI输出了[完成]指令，直接判断为完成
    if (parsed.hasCompleteCommand) {
      return 1.0;
    }
    
    // 2. 检查上下文是否显示任务已完成（优先检查，因为上下文更可靠）
    const contextCompletion = this.checkContextCompletion(workflow, todo);
    if (contextCompletion >= WORKFLOW_CONFIG.COMPLETION_THRESHOLD) {
      return contextCompletion;
    }
    
    // 3. 如果执行成功且没有错误
    if (result?.success && result?.executed && !result.error) {
      if (result.functions?.length > 0) {
        return 0.9;
      }
      // 执行成功但没有函数，可能是无操作任务
      return 0.8;
    }
    
    // 4. 如果有执行但失败
    if (result?.executed && result.error) {
      return 0.3;
    }
    
    // 5. 如果有执行但部分成功（部分函数执行成功）
    if (result?.executed && result.functions?.length > 0) {
      const totalCommands = parsed.commands?.filter(cmd => 
        !/^\[(完成|标记完成)\]$/i.test(cmd.trim())
      ).length || 0;
      const executedCount = result.functions.length;
      const failedCount = result.failedFunctions?.length || 0;
      
      if (totalCommands > 0) {
        // 根据成功率和失败率计算完成度
        const successRate = executedCount / totalCommands;
        const failRate = failedCount / totalCommands;
        return Math.max(0.3, Math.min(0.9, 0.5 + (successRate * 0.4) - (failRate * 0.2)));
      }
      
      // 如果有成功执行但无法计算比例，使用默认值
      if (result.successRate !== undefined) {
        return Math.max(0.5, result.successRate);
      }
      return 0.7;
    }
    
    // 6. 如果AI输出了指令但未执行，可能是解析失败或任务描述不清晰
    if (parsed.commands?.length > 0) {
      return 0.5;
    }
    
    // 7. 如果没有任何指令输出，可能是任务已完成或不需要操作
    return 0.6;
  }

  /**
   * 检查上下文是否显示任务已完成
   */
  checkContextCompletion(workflow, todo) {
    const context = workflow.context || {};
    const previousTodos = workflow.todos.filter(t => 
      t.status === TODO_STATUS.COMPLETED && t.id !== todo.id
    );
    
    // 检查已完成任务的上下文是否已经完成了当前任务的目标
    for (const prevTodo of previousTodos) {
      if (!prevTodo.result?.context) continue;
      
      const prevContext = prevTodo.result.context;
      const prevFunctions = prevTodo.result.functions || [];
      
      // 检查文件操作：如果上一步已经读取了相同文件，则认为已完成
      if (context.fileName && prevContext.fileName && 
          context.fileName === prevContext.fileName &&
          context.fileContent && prevContext.fileContent) {
        return 1.0;
      }
      
      // 检查命令执行：如果上一步已经执行了相同命令且成功，则认为已完成
      if (context.commandOutput && prevContext.commandOutput &&
          prevContext.commandSuccess && context.commandSuccess) {
        // 进一步检查命令是否相同（通过函数类型判断）
        if (prevFunctions.length > 0) {
          return 1.0;
        }
      }
      
      // 检查是否有明确的完成标记
      if (prevContext.taskCompleted || prevContext.completed) {
        return 1.0;
      }
    }
    
    // 检查笔记中是否有相关信息表明任务已完成
    const notes = workflow.notes || [];
    const todoNotes = todo.notes || [];
    const allNotes = [...notes, ...todoNotes];
    
    const completionKeywords = ['完成', '成功', '已完成', '执行完成', '操作成功'];
    const relevantNotes = allNotes.filter(note => {
      const content = note.content || '';
      return completionKeywords.some(keyword => content.includes(keyword));
    });
    
    if (relevantNotes.length > 0) {
      return 0.85;
    }
    
    return 0;
  }

  /**
   * 执行动作 - 执行所有[]指令
   */
  async executeAction(workflow, commands) {
    const context = this.buildActionContext(workflow);
    
    // 如果没有指令，返回成功（可能是任务已完成或不需要操作）
    if (!commands || commands.length === 0) {
      return {
        executed: false,
        functions: [],
        context,
        success: true,
        error: null
      };
    }
    
    // 过滤掉完成指令（这些指令不需要执行，只用于判断）
    const executableCommands = commands
      .map(cmd => cmd?.trim())
      .filter(cmd => cmd && !/^\[(完成|标记完成)\]$/i.test(cmd));
    
    // 如果只有完成指令，返回成功
    if (executableCommands.length === 0) {
      return {
        executed: false,
        functions: [],
        context,
        success: true,
        error: null
      };
    }
    
    // 合并所有指令为一个字符串，确保格式正确（保留命令之间的分隔）
    const actionText = executableCommands.join(' ').trim();
    
    if (!actionText) {
      return {
        executed: false,
        functions: [],
        context,
        success: true,
        error: null
      };
    }
    
    try {
      const result = await this.executeFunctions(actionText, context);
      // 确保上下文被正确传递
      if (result.context) {
        Object.assign(context, result.context);
      }
      return result;
    } catch (error) {
      const botError = errorHandler.handle(
        error,
        { context: 'executeAction', workflowId: context.workflowId },
        true
      );
      BotUtil.makeLog('error', `执行动作失败: ${botError.message}`, 'WorkflowManager');
      return { 
        executed: false, 
        functions: [], 
        context: { ...context, error: botError.message }, 
        success: false, 
        error: botError.message 
      };
    }
  }

  /**
   * 构建执行上下文（简化，删除冗余字段）
   */
  buildActionContext(workflow) {
    const { e, ...restContext } = workflow.context;
    return {
      e,
      workflowId: workflow.id,
      ...restContext
    };
  }

  /**
   * 执行函数
   */
  async executeFunctions(actionText, context) {
    if (!actionText?.trim()) {
      return { executed: false, functions: [], context, success: true, error: null };
    }

    const { functions } = this.parseWorkflowFunctions(actionText.trim(), context);
    
    if (functions.length === 0) {
      BotUtil.makeLog('warn', `[执行] 没有解析到任何函数: ${this.truncateText(actionText, 100)}`, 'WorkflowManager');
      context.parseError = `执行动作格式不正确：${this.truncateText(actionText, 100)}`;
      return { executed: false, functions: [], context, success: false, error: '未解析到任何可执行命令' };
    }
    
    const executedFunctions = [];
    const failedFunctions = [];
    let lastError = null;
    
    for (const func of functions) {
      try {
        // info: 函数执行是重要的业务操作
        BotUtil.makeLog('info', `[执行] ${func.type}(${JSON.stringify(func.params)})`, 'WorkflowManager');
        const result = await this.executeSingleFunction(func, context);
        
        if (result.executed) {
          executedFunctions.push(func.type);
          BotUtil.makeLog('info', `[执行] ✓ ${func.type} 成功`, 'WorkflowManager');
        } else {
          failedFunctions.push(func.type);
          BotUtil.makeLog('warn', `[执行] ✗ ${func.type} 失败`, 'WorkflowManager');
        }
        
        if (result.error) lastError = result.error;
      } catch (error) {
        failedFunctions.push(func.type);
        lastError = error;
        BotUtil.makeLog('error', `[执行] ✗ ${func.type} 异常: ${error.message}`, 'WorkflowManager');
      }
    }

    const success = executedFunctions.length === functions.length && !lastError;
    const successRate = functions.length > 0 ? executedFunctions.length / functions.length : 0;
    
    // info: 执行结果是重要的业务信息
    BotUtil.makeLog('info', `[执行] 结果: ${executedFunctions.length}/${functions.length} 成功 (${(successRate * 100).toFixed(0)}%)`, 'WorkflowManager');

    return {
      executed: executedFunctions.length > 0,
      functions: executedFunctions,
      failedFunctions,
      context,
      success,
      successRate,
      error: lastError?.message || null
    };
  }

  /**
   * 收集所有相关的stream（统一方法，避免重复代码）
   */
  _collectAllStreams() {
    const streamSet = new Set();
    
    // 添加主stream及其合并的stream
    const addStreamAndMerged = (stream) => {
      if (!stream) return;
      streamSet.add(stream);
      if (Array.isArray(stream._mergedStreams)) {
        stream._mergedStreams.forEach(s => s && streamSet.add(s));
      }
    };
    
    if (this.stream) {
      addStreamAndMerged(this.stream);
      if (this.stream._parentStream) {
        addStreamAndMerged(this.stream._parentStream);
      }
    }
    
    // 添加所有其他stream
    try {
      StreamLoader.getAllStreams().forEach(stream => {
        if (stream?.functions && stream !== this.stream) {
          streamSet.add(stream);
        }
      });
    } catch (error) {
      BotUtil.makeLog('warn', `[解析] 获取所有stream失败: ${error.message}`, 'WorkflowManager');
    }
    
    return Array.from(streamSet);
  }

  parseWorkflowFunctions(actionText, context = {}) {
    if (!actionText || typeof actionText !== 'string') {
      return { functions: [], cleanText: '' };
    }

    let cleanText = actionText.trim();
    const allFunctions = [];
    const isInWorkflow = !!context.workflowId;

    if (isInWorkflow) {
      cleanText = cleanText.replace(/\[启动工作流:[^\]]+\]/g, '').trim();
    }

    const streams = this._collectAllStreams();
    if (streams.length === 0) {
      BotUtil.makeLog('warn', `[解析] 没有可用的stream: ${this.truncateText(actionText, 50)}`, 'WorkflowManager');
      return { functions: [], cleanText };
    }

    let totalParsers = 0;
    let attemptedParsers = 0;

    for (const stream of streams) {
      if (!stream?.functions?.size) continue;

      const streamName = stream?.name || stream?.constructor?.name || 'unknown';

      for (const func of stream.functions.values()) {
        if (isInWorkflow && (func.type === 'start_workflow' || func.onlyTopLevel)) continue;
        if (!func.enabled || !func.parser) continue;

        totalParsers++;
        attemptedParsers++;

        try {
          const result = func.parser(cleanText, context);
          if (result?.functions?.length) {
            result.functions.forEach(f => {
              f._sourceStream = stream;
              allFunctions.push(f);
            });
            // debug: 解析过程是技术细节
            BotUtil.makeLog('debug', `[解析] ${streamName}.${func.type} 匹配到 ${result.functions.length} 个函数`, 'WorkflowManager');
          }
          if (result?.cleanText !== undefined) {
            cleanText = result.cleanText;
          }
        } catch (error) {
          BotUtil.makeLog('warn', `解析函数失败[${streamName}.${func.type}]: ${error.message}`, 'WorkflowManager');
        }
      }
    }

    const filteredFunctions = isInWorkflow
      ? allFunctions.filter(fn => fn.type !== 'start_workflow')
      : allFunctions;

    const orderedFunctions = [
      ...filteredFunctions.filter(f => typeof f.order === 'number').sort((a, b) => a.order - b.order),
      ...filteredFunctions.filter(f => typeof f.order !== 'number')
    ];

    if (orderedFunctions.length > 0) {
      // info: 解析结果是重要的业务信息
      BotUtil.makeLog('info', `[解析] 总计: ${orderedFunctions.length} 个函数 [${orderedFunctions.map(f => f.type).join(', ')}]`, 'WorkflowManager');
    } else if (actionText.trim()) {
      // debug: 未匹配到函数是技术细节
      BotUtil.makeLog('debug', `[解析] 未匹配到函数 (${attemptedParsers}/${totalParsers}, streams: ${streams.map(s => s.name).join(', ')}): ${this.truncateText(actionText, 100)}`, 'WorkflowManager');
    }

    return { functions: orderedFunctions, cleanText };
  }

  async _executeFunctionInStream(stream, func, context) {
    if (!stream?.functions?.has(func.type)) return null;
    const result = await stream.executeFunction(func.type, func.params, context);
    return { executed: result?.success || false, error: result?.error || null };
  }

  async executeSingleFunction(func, context) {
    try {
      const targetStream = func._sourceStream || this.stream;
      
      const result = await this._executeFunctionInStream(targetStream, func, context);
      if (result) return result;
      
      if (targetStream?._mergedStreams) {
        for (const mergedStream of targetStream._mergedStreams) {
          const result = await this._executeFunctionInStream(mergedStream, func, context);
          if (result) return result;
        }
      }
      
      for (const stream of StreamLoader.getAllStreams()) {
        const result = await this._executeFunctionInStream(stream, func, context);
        if (result) return result;
      }
      
      BotUtil.makeLog('warn', `函数未找到: ${func.type}`, 'WorkflowManager');
      return { executed: false, error: `函数未找到: ${func.type}` };
    } catch (error) {
      this.handleFunctionError(context, func, error);
      BotUtil.makeLog('error', `工作流函数执行失败[${func.type}]: ${error.message}`, 'WorkflowManager');
      return { executed: false, error };
    }
  }

  handleFunctionError(context, func, error) {
    context.commandError = context.commandError || error.message;
  }

  getWorkflow(workflowId) {
    return this.activeWorkflows.get(workflowId);
  }

  stopWorkflow(workflowId) {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) return;
    workflow.status = WORKFLOW_STATUS.PAUSED;
  }

  /**
   * 移除工作流
   */
  removeWorkflow(workflowId) {
    this.activeWorkflows.delete(workflowId);
  }

  /**
   * 记录决策阶段的 AI 调用
   */
  recordDecisionStep(workflow, { type, prompt, messages, aiResponse, timestamp }) {
    if (!workflow) return;
    if (!workflow.decisionSteps) {
      workflow.decisionSteps = [];
    }

    const decisionRecord = {
      type,
      prompt,
      messages: Array.isArray(messages) ? messages : [],
      aiResponse: aiResponse || '',
      timestamp: timestamp || Date.now()
    };

    workflow.decisionSteps.push(decisionRecord);
  }

  /**
   * 记录单步调试信息（完整、不截断）
   */
  recordDebugStep(workflow, todo, { prompt, messages, response, parsed, notes, result, completion }) {
    if (!workflow) return;
    if (!workflow.debugSteps) {
      workflow.debugSteps = [];
    }

    const safeResult = result ? {
      executed: !!result.executed,
      functions: Array.isArray(result.functions) ? result.functions : [],
      success: !!result.success,
      error: result.error || null,
      context: this.buildContextSummary(result.context)
    } : null;

    const stepRecord = {
      todoId: todo.id,
      todoContent: todo.content,
      iteration: workflow.iteration,
      status: todo.status,
      timestamp: Date.now(),
      prompt,
      messages,
      aiResponse: response,
      parsed: {
        commands: parsed.commands || [],
        hasCompleteCommand: parsed.hasCompleteCommand || false
      },
      completion: completion || null,
      notesSnapshot: Array.isArray(notes) ? notes : [],
      todoNotes: Array.isArray(todo.notes) ? todo.notes : [],
      executionResult: safeResult
    };

    workflow.debugSteps.push(stepRecord);
  }

  /**
   * 提取可序列化的上下文摘要，避免循环引用
   */
  buildContextSummary(context) {
    if (!context || typeof context !== 'object') return null;

    const summary = {};
    const allowedKeys = [
      'workflowId',
      'question',
      'fileSearchResult',
      'fileContent',
      'fileName',
      'filePath',
      'commandOutput',
      'commandSuccess',
      'commandError',
      'fileError',
      'error'
    ];

    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(context, key)) {
        // 截断过长的内容以减小日志大小
        if (key === 'fileContent' && typeof context[key] === 'string' && context[key].length > 10000) {
          summary[key] = context[key].slice(0, 10000) + '\n...(内容已截断)';
        } else if (key === 'commandOutput' && typeof context[key] === 'string' && context[key].length > 5000) {
          summary[key] = context[key].slice(0, 5000) + '\n...(输出已截断)';
        } else {
          summary[key] = context[key];
        }
      }
    }

    // 追加其他基础类型字段（排除事件对象 e 及复杂对象）
    for (const [key, value] of Object.entries(context)) {
      if (summary[key] !== undefined) continue;
      if (key === 'e') continue;
      if (value === null ||
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean') {
        summary[key] = value;
      }
    }

    return summary;
  }

  /**
   * 将工作流的完整信息写入 data/debug 目录（包括所有 prompt 和 AI 回应）
   */
  async saveDebugLog(workflow) {
    if (!workflow) return;

    const steps = Array.isArray(workflow.debugSteps) ? workflow.debugSteps : [];
    const totalTodos = Array.isArray(workflow.todos) ? workflow.todos.length : 0;

    // 记录所有工作流，包括单步工作流，确保所有 prompt 和 AI 回应都被记录
    // 移除之前的限制条件，现在所有工作流都会被记录

    const debugDir = path.join(paths.data, 'debug');
    // 确保 debug 目录存在
    try {
      const fs = await import('fs/promises');
      await fs.mkdir(debugDir, { recursive: true });
    } catch (err) {
      BotUtil.makeLog('error', `创建 debug 目录失败: ${err.message}`, 'WorkflowManager');
    }
    
    const filePath = path.join(debugDir, `workflow-${workflow.id}.json`);

    const safeTodos = (workflow.todos || []).map(todo => ({
      id: todo.id,
      content: todo.content,
      status: todo.status,
      error: todo.error || null,
      completedAt: todo.completedAt || null
    }));

    const payload = {
      id: workflow.id,
      goal: workflow.goal,
      status: workflow.status,
      iteration: workflow.iteration,
      maxIterations: workflow.maxIterations,
      createdAt: workflow.createdAt || null,
      completedAt: workflow.completedAt || null,
      error: workflow.error || null,
      todos: safeTodos,
      notes: workflow.notes || [],
      history: workflow.history || [],
      steps,
      // 记录决策阶段的 AI 调用
      decisionSteps: Array.isArray(workflow.decisionSteps) ? workflow.decisionSteps : []
    };

    const json = JSON.stringify(payload, null, 2);
    await BotUtil.writeFile(filePath, json, { encoding: 'utf8' });
    BotUtil.makeLog('info', `工作流调试日志已保存: ${filePath}`, 'WorkflowManager');
  }
}