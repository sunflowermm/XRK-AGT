import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';
import path from 'path';

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
   * 清理已完成的工作流（防止内存泄漏）
   */
  cleanupCompletedWorkflows() {
    const now = Date.now();
    const toDelete = [];
    
    for (const [id, workflow] of this.activeWorkflows.entries()) {
      const { status, completedAt } = workflow;
      if ((status === WORKFLOW_STATUS.COMPLETED || status === WORKFLOW_STATUS.FAILED) && 
          completedAt && (now - completedAt) > WORKFLOW_CONFIG.CLEANUP_DELAY) {
        toDelete.push(id);
      }
    }
    
    if (toDelete.length > 0) {
      BotUtil.makeLog('debug', `清理 ${toDelete.length} 个已完成的工作流`, 'WorkflowManager');
      toDelete.forEach(id => this.activeWorkflows.delete(id));
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
   * 格式化步骤文本
   */
  formatStepText(progress, data) {
    const stepNum = data.stepNum || (progress.completed + 1);
    const completion = data.completion || 0.5;
    const status = this.getStepStatusIcon(completion);
    
    // 构建基础状态信息
    let text = `${status} [${stepNum}/${progress.total}] ${data.task || ''}\n执行: ${data.action || ''}`;
    
    // 如果有AI的自然语言回复，添加到消息中
    if (data.aiMessage && data.aiMessage.trim()) {
      text += `\n\n💬 ${data.aiMessage}`;
    }
    
    return text;
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
    // 查找已存在的相同工作流
    const existing = Array.from(this.activeWorkflows.values())
      .find(w => w.status === WORKFLOW_STATUS.RUNNING && w.goal === goal);
    
    if (existing) {
      return { shouldUseTodo: false, response: '已有相同工作流运行中', todos: [] };
    }

    return await this.aiDecideWorkflow(goal, workflow);
  }

  /**
   * AI判断是否需要工作流
   */
  async aiDecideWorkflow(goal, workflow = null) {
    const messages = this.buildDecisionMessages(goal);
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

    const shouldUseTodo = /是否需要TODO工作流:\s*是/i.test(response);
    const todos = shouldUseTodo ? this.extractTodos(response) : [];
    
    if (!shouldUseTodo || todos.length > 0) {
      return { shouldUseTodo, response, todos };
    }
    
    const generatedTodos = await this.generateInitialTodos(goal, workflow);
    return { shouldUseTodo: true, response, todos: generatedTodos };
  }

  /**
   * 构建决策提示和消息
   */
  buildDecisionMessages(goal) {
    return [
      {
        role: 'system',
        content: `你是任务分析助手，只负责评估任务，不执行任何操作。

【重要】
- 这是评估阶段，不是执行阶段
- 不要使用任何命令格式
- 不要执行任何操作
- 只输出分析结果

【判断标准】
- 简单任务（单步可完成）→ 不需要工作流
- 复杂任务（需要多步）→ 需要工作流

【输出格式】
是否需要TODO工作流: [是/否]
理由: [简要说明]

如果选择"是"，输出：
TODO列表:
1. 第一步（任务描述，不要包含命令格式）
2. 第二步（任务描述，不要包含命令格式）`
      },
      {
        role: 'user',
        content: `分析任务：${goal}`
      }
    ];
  }

  /**
   * 提取TODO列表
   */
  extractTodos(text) {
    const todos = [];
    const todoMatch = text.match(/TODO列表:\s*([\s\S]+?)(?:\n\n|$)/);
    if (!todoMatch) return todos;
    
    const todoRegex = /^\d+[\.、]\s*(.+)$/gm;
    let match;
    while ((match = todoRegex.exec(todoMatch[1])) !== null) {
      let content = match[1].trim();
      // 清理命令格式（如果AI错误地包含了）
      content = content.replace(/\[([^\]]+)\]/g, '$1').trim();
      if (content) {
        todos.push(content);
      }
    }
    
    return todos;
  }

  /**
   * 生成初始TODO列表
   */
  async generateInitialTodos(goal, workflow = null) {
    const messages = [
      {
        role: 'system',
        content: `你是任务规划助手，只负责规划步骤，不执行任何操作。

【重要】
- 这是规划阶段，不是执行阶段
- 不要使用任何命令格式
- 不要执行任何操作
- 只输出步骤描述（任务描述，不要包含命令格式）

【要求】
- 步骤要精简高效
- 避免冗余步骤
- 输出格式：每行一个步骤，用数字编号`
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
    
    const todos = response ? this.extractTodos(response) : [];
    return todos.length > 0 ? todos : ['执行第一步', '执行第二步'];
  }

  /**
   * 创建工作流
   */
  async createWorkflow(e, goal, initialTodos = []) {
    this.cleanupCompletedWorkflows();

    const userKey = e?.user_id || e?.sender?.user_id || 'default';
    const workflowKey = `${userKey}:${goal}`;

    const existingId = this.checkExistingWorkflow(workflowKey, goal, userKey);
    if (existingId) return existingId;

    this.workflowLock.set(workflowKey, null);

    const workflowId = `workflow_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const workflow = this.createWorkflowObject(workflowId, goal, initialTodos, e);

    await this.stream.storeWorkflowMemory(workflowId, { goal, createdAt: Date.now() });
    this.activeWorkflows.set(workflowId, workflow);
    this.workflowLock.set(workflowKey, workflowId);
    
    await this.sendReply(workflow, 'start', { todos: initialTodos });
    
    this.executeWorkflow(workflowId).catch(err => {
      BotUtil.makeLog('error', `工作流执行失败[${workflowId}]: ${err.message}`, 'WorkflowManager');
    }).finally(() => {
      setTimeout(() => this.workflowLock.delete(workflowKey), WORKFLOW_CONFIG.LOCK_CLEANUP_DELAY);
    });
    
    return workflowId;
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
    for (const workflow of this.activeWorkflows.values()) {
      if (workflow.status === WORKFLOW_STATUS.RUNNING) {
        const workflowUserKey = workflow.context?.e?.user_id || workflow.context?.e?.sender?.user_id;
        if (workflowUserKey === userKey) {
          BotUtil.makeLog('warn', `[工作流] 用户 ${userKey} 已有运行中的工作流 [${workflow.id}]，拒绝创建新工作流`, 'WorkflowManager');
          return workflow.id;
        }
      }
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
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) {
      throw new Error(`工作流不存在: ${workflowId}`);
    }

    try {
      await this.runWorkflowLoop(workflow);
      this.handleWorkflowCompletion(workflow);
    } catch (error) {
      this.handleWorkflowError(workflow, error);
    } finally {
      await this.saveDebugLog(workflow).catch(err => {
        BotUtil.makeLog('error', `保存工作流调试日志失败[${workflowId}]: ${err.message}`, 'WorkflowManager');
      });
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
    workflow.status = WORKFLOW_STATUS.FAILED;
    workflow.error = error.message;
    BotUtil.makeLog('error', `工作流执行异常[${workflow.id}]: ${error.message}`, 'WorkflowManager');
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
    const notes = await this.stream.getNotes(workflow.id);
    const prompt = await this.buildTodoPrompt(workflow, todo, notes);
    const messages = [
      { role: 'system', content: this.buildSystemPrompt(workflow) },
      { role: 'user', content: prompt }
    ];
    
    const response = await this.callAIWithRetry(messages, workflow, todo);
    const parsed = this.parseAIResponse(response);
    
    await this.handleTodoResponse(workflow, todo, response, parsed, notes);
    
    const result = await this.executeAction(workflow, response);
    todo.result = result;

    // 如果执行失败或格式错误，记录到笔记
    if (!result.executed && result.functions.length === 0) {
      const actionText = this.extractActionText(response);
      const errorMsg = `上一步执行失败：执行动作格式不正确（${actionText}），未解析到任何可执行命令。请使用正确的命令格式，如[读取:文件路径]。`;
      await this.storeNote(workflow, todo.id, errorMsg);
    } else if (result.error) {
      await this.storeNote(workflow, todo.id, `执行错误：${result.error}`);
    }

    // 合并上下文（包括文件内容、命令输出等）
    this.mergeContext(workflow, result.context);
    
    // 更新笔记快照
    const updatedNotes = await this.stream.getNotes(workflow.id);
    todo.notes = updatedNotes;
    
    // 处理执行结果并反馈给用户
    await this.handleExecutionResult(workflow, todo, result, parsed.completion);
    
    // 只有在完成度低于0.8且有明确的下一步建议时才添加新步骤
    if (parsed.completion < WORKFLOW_CONFIG.COMPLETION_THRESHOLD && parsed.nextStep?.trim()) {
      BotUtil.makeLog('info', `工作流[${workflow.id}] 添加新步骤: ${parsed.nextStep}`, 'WorkflowManager');
      this.addNextStep(workflow, parsed.nextStep);
    }

    this.recordDebugStep(workflow, todo, {
      prompt,
      messages,
      response,
      parsed,
      notes,
      result
    });
  }

  /**
   * 处理TODO响应
   */
  async handleTodoResponse(workflow, todo, response, parsed, notes) {
    const actionText = this.extractActionText(response);
    const progress = this.calculateProgress(workflow);
    
    // 提取AI的自然语言回复（去除格式化的输出部分）
    const aiMessage = this.extractAIMessage(response);
    
    await this.sendReply(workflow, 'step', {
      stepNum: progress.completed + 1,
      task: todo.content,
      action: actionText,
      completion: parsed.completion || 0.5,
      aiMessage: aiMessage  // 添加AI的自然语言回复
    });

    if (parsed.note?.trim()) {
      await this.storeNote(workflow, todo.id, parsed.note);
    }

    this.recordHistory(workflow, todo, response, parsed);
  }

  /**
   * 记录历史
   */
  recordHistory(workflow, todo, response, parsed) {
    workflow.history.push({
      todoId: todo.id,
      iteration: workflow.iteration,
      response,
      completion: parsed.completion,
      note: parsed.note || null,
      timestamp: Date.now()
    });
  }

  /**
   * 处理TODO错误
   */
  async handleTodoError(workflow, todo, error) {
    todo.status = TODO_STATUS.FAILED;
    todo.error = error.message;
    BotUtil.makeLog('error', `Todo执行失败[${todo.id}]: ${error.message}`, 'WorkflowManager');
    await this.sendReply(workflow, 'error', { task: todo.content, error: error.message });
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
   * 提取执行动作文本
   */
  extractActionText(response) {
    const actionMatch = response.match(/执行动作:\s*([^\n]+)/);
    return actionMatch ? actionMatch[1].trim() : response.slice(0, 100);
  }

  /**
   * 提取AI的自然语言回复
   * 去除格式化的输出部分（完成度评估、执行动作、下一步建议、笔记）
   */
  extractAIMessage(response) {
    if (!response) return '';
    
    // 找到格式化输出的开始位置
    const formatStart = response.search(/完成度评估:\s*[0-9.]+/);
    
    if (formatStart === -1) {
      // 如果没有找到格式化输出，返回整个响应
      return response.trim();
    }
    
    // 提取格式化输出之前的内容作为AI的自然语言回复
    const aiMessage = response.slice(0, formatStart).trim();
    
    // 如果提取的消息太短或为空，返回一个默认消息
    if (!aiMessage || aiMessage.length < 5) {
      return '';
    }
    
    return aiMessage;
  }

  /**
   * 合并上下文
   */
  mergeContext(workflow, newContext) {
    if (!newContext) return;
    
    // 保留事件对象 e
    const e = workflow.context.e;
    
    // 合并新上下文
    workflow.context = { ...workflow.context, ...newContext };
    
    // 确保事件对象不被覆盖
    if (e) {
      workflow.context.e = e;
    }
    
    // 记录上下文更新日志（仅在有重要数据时）
    if (newContext.fileContent) {
      const fileName = newContext.fileSearchResult?.fileName || newContext.fileName || '未知文件';
      BotUtil.makeLog('debug', `工作流[${workflow.id}]上下文已更新：读取文件 ${fileName}`, 'WorkflowManager');
    }
    if (newContext.commandOutput) {
      BotUtil.makeLog('debug', `工作流[${workflow.id}]上下文已更新：命令输出`, 'WorkflowManager');
    }
  }

  /**
   * 处理执行结果
   */
  async handleExecutionResult(workflow, todo, result, completion) {
    const errorMsg = this.extractErrorMessage(result);
    
    // 如果有错误，处理错误
    if (errorMsg) {
      await this.handleExecutionError(workflow, todo, errorMsg);
      return;
    }
    
    // 没有错误，根据完成度更新状态
    const completionRate = completion || 0.5;
    this.updateTodoStatus(workflow, todo, completionRate);
    
    // 如果任务完成度高但没有执行任何函数，记录警告日志
    if (completionRate >= WORKFLOW_CONFIG.COMPLETION_THRESHOLD && !result.executed) {
      BotUtil.makeLog('warn', `任务[${todo.id}]标记为完成但未执行任何操作`, 'WorkflowManager');
    }
  }

  /**
   * 处理执行错误
   */
  async handleExecutionError(workflow, todo, errorMsg) {
    await this.storeNote(workflow, todo.id, `错误: ${errorMsg}`);
    todo.status = TODO_STATUS.PENDING;
    todo.error = errorMsg;
    await this.sendReply(workflow, 'error', { task: todo.content, error: errorMsg });
  }

  /**
   * 提取错误信息
   */
  extractErrorMessage(result) {
    if (result.error) return result.error;
    if (!result.context) return null;
    
    const errorFields = ['commandError', 'fileError', 'error'];
    for (const field of errorFields) {
      if (result.context[field]) return result.context[field];
    }
    
    return null;
  }

  /**
   * 添加下一步
   */
  addNextStep(workflow, nextStep) {
    workflow.todos.push(this.createTodoObject(workflow.todos.length, nextStep));
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
   * 构建提示部分（通用、简洁）
   */
  buildPromptSections(workflow, todo, context, progress, previousTodos, notes) {
    const sections = [];
    
    sections.push(`【目标】${workflow.goal}`);
    sections.push(`【当前任务】${todo.content}`);
    sections.push(`【进度】${progress.completed}/${progress.total}`);
    
    const completedTasks = this.buildCompletedTasksSection(previousTodos);
    if (completedTasks) {
      sections.push(completedTasks);
      const taskCheck = this.buildTaskCheckSection(workflow, todo, previousTodos);
      if (taskCheck) sections.push(taskCheck);
    }
    
    const contextSection = this.buildContextSection(context);
    if (contextSection) sections.push(contextSection);
    
    const notesSection = this.buildNotesSection(notes);
    if (notesSection) sections.push(notesSection);
    
    sections.push(this.buildRequirementsSection(context));
    
    return sections;
  }

  /**
   * 构建任务检查部分（通用机制）
   */
  buildTaskCheckSection(workflow, todo, previousTodos) {
    const completedOps = [];
    
    for (const prevTodo of previousTodos) {
      if (!prevTodo.result || !prevTodo.result.executed) continue;
      
      const prevResult = prevTodo.result;
      const prevContext = prevResult.context || {};
      const prevFunctions = prevResult.functions || [];
      const relevantContext = this.extractRelevantContext(prevContext);
      
      if (prevFunctions.length > 0 || Object.keys(relevantContext).length > 0) {
        completedOps.push({
          task: prevTodo.content,
          functions: prevFunctions,
          context: relevantContext
        });
      }
    }
    
    if (completedOps.length === 0) return '';
    
    const hints = ['检查上一步已执行的操作和结果：'];
    
    for (const op of completedOps) {
      const details = [];
      if (op.functions.length > 0) {
        details.push(`已执行: ${op.functions.join('、')}`);
      }
      for (const [key, value] of Object.entries(op.context)) {
        const displayValue = typeof value === 'string' && (value.includes('/') || value.includes('\\'))
          ? value.split(/[/\\]/).pop()
          : value;
        details.push(`${key}: ${displayValue}`);
      }
      if (details.length > 0) {
        hints.push(`  ✓ ${op.task} - ${details.join('，')}`);
      }
    }
    
    hints.push('如果上一步已完成当前任务目标，标记完成度=1.0，执行动作="无"');
    hints.push('不要重复执行相同操作');
    
    return `【检查】\n${hints.join('\n')}\n`;
  }

  /**
   * 提取相关上下文（通用方式，提取所有可能相关的信息）
   */
  extractRelevantContext(context) {
    if (!context || typeof context !== 'object') return {};
    
    const relevant = {};
    // 提取所有可能表示操作结果的字段（通用方式）
    const resultFields = [
      'createdExcelDoc', 'createdWordDoc', 'openedUrl',
      'createdFile', 'generatedFile', 'openedFile', 'executedCommand'
    ];
    
    for (const field of resultFields) {
      if (context[field]) {
        relevant[field] = context[field];
      }
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
          details.push(`执行: ${todo.result.functions.join('、')}`);
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
    
    return `【已完成任务】\n${taskLines.join('\n')}\n`;
  }


  /**
   * 构建上下文部分
   */
  buildContextSection(context) {
    const sections = [];
    
    const fileSection = this.buildFileContextSection(context);
    if (fileSection) sections.push(fileSection);
    
    const commandSection = this.buildCommandContextSection(context);
    if (commandSection) sections.push(commandSection);
    
    return sections.join('\n\n');
  }

  /**
   * 构建文件上下文部分（通用）
   */
  buildFileContextSection(context) {
    if (!context.fileContent) return '';
    
    const fileName = context.fileSearchResult?.fileName || context.fileName || '文件';
    const content = context.fileContent.slice(0, 5000);
    const truncated = context.fileContent.length > 5000 ? '\n...(已截断)' : '';
    
    return `【文件内容】\n文件名：${fileName}\n${content}${truncated}`;
  }

  /**
   * 构建命令上下文部分（通用）
   */
  buildCommandContextSection(context) {
    if (!context.commandOutput || !context.commandSuccess) return '';
    
    const output = context.commandOutput.slice(0, 1000);
    const truncated = context.commandOutput.length > 1000 ? '\n...(已截断)' : '';
    
    return `【命令输出】\n${output}${truncated}`;
  }

  /**
   * 构建笔记部分（通用，无特定场景过滤）
   */
  buildNotesSection(notes) {
    if (!notes || notes.length === 0) return '';
    
    const relevantNotes = notes
      .filter(note => note.content && note.content.trim())
      .slice(-3);
    
    if (relevantNotes.length === 0) return '';
    
    return `【笔记】\n${relevantNotes.map((note, i) => `${i + 1}. ${note.content.slice(0, 200)}${note.content.length > 200 ? '...' : ''}`).join('\n')}`;
  }

  /**
   * 构建要求部分（通用）
   */
  buildRequirementsSection(context) {
    const requirements = [
      '只执行当前任务描述的操作',
      '检查已完成任务，避免重复执行',
      '完成度>=0.8表示已执行且成功',
      '使用已有上下文内容'
    ];
    
    return `【要求】\n${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  }

  /**
   * 构建系统提示（完全通用，无特定场景）
   */
  buildSystemPrompt(workflow) {
    const functionsPrompt = this.buildFunctionsPrompt();
    const contextInfo = this.buildContextInfo(workflow.context);

    return `【工作流执行助手】
执行多步骤工作流任务。

【工具】
${functionsPrompt || '- 无可用工具'}

【原则】
1. 只执行当前任务描述的操作
2. 检查已完成任务，避免重复执行
3. 完成度>=0.8表示已执行且成功，<0.8表示未完成或部分完成
4. 使用已有上下文内容，不重复获取
5. 禁止启动新工作流
${contextInfo}
【输出格式】
自然对话（1-2句话）

完成度评估: [0-1]
执行动作: [命令或"无"]
下一步建议: [下一步或"无"]
笔记: [信息或"无"]
`;
  }

  /**
   * 构建函数提示（通用，说明用法）
   */
  buildFunctionsPrompt() {
    const allFunctions = this.collectAllFunctions();
    const prompts = [];
    
    for (const func of allFunctions) {
      if (func.onlyTopLevel || !func.enabled || !func.prompt) continue;
      
      const simplified = this.simplifyPrompt(func.prompt);
      if (simplified && !prompts.includes(simplified)) {
        prompts.push(simplified);
      }
    }
    
    if (prompts.length === 0) return '';
    
    return `【工具使用说明】
要执行某个操作，在回复中直接使用对应的命令格式即可。例如：
- 想要执行回桌面，发送：[回桌面]
- 想要读取文件，发送：[读取:文件路径]
- 想要生成Excel，发送：[生成Excel:文件名:JSON数组]

【可用工具】
${prompts.map(p => `- ${p}`).join('\n')}`;
  }

  /**
   * 简化 prompt 文本
   */
  simplifyPrompt(prompt) {
    if (!prompt) return '';
    const match = prompt.match(/^(\[[^\]]+\])/);
    return match ? match[1] : prompt.split(' - ')[0].trim();
  }

  /**
   * 收集所有函数
   */
  collectAllFunctions() {
    const allFunctions = [];
    
    if (this.stream.functions) {
      for (const func of this.stream.functions.values()) {
        allFunctions.push(func);
      }
    }
    
    if (this.stream._mergedStreams) {
      for (const mergedStream of this.stream._mergedStreams) {
        if (mergedStream.functions) {
          for (const func of mergedStream.functions.values()) {
            allFunctions.push(func);
          }
        }
      }
    }
    
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
   * 解析AI响应
   */
  parseAIResponse(response) {
    return {
      completion: this.extractCompletion(response),
      nextStep: this.extractNextStep(response),
      note: this.extractNote(response)
    };
  }

  /**
   * 提取完成度
   */
  extractCompletion(response) {
    const match = response.match(/完成度评估:\s*([0-9.]+)/);
    if (match) {
      return Math.max(0, Math.min(1, parseFloat(match[1])));
    }
    
    return this.inferCompletionFromText(response);
  }

  /**
   * 从文本推断完成度
   */
  inferCompletionFromText(response) {
    const lower = response.toLowerCase();
    
    // 成功关键词（按优先级）
    if (lower.includes('完成') || lower.includes('成功') || lower.includes('已')) {
      return 0.9;
    }
    
    // 失败关键词
    if (lower.includes('失败') || lower.includes('错误') || lower.includes('无法')) {
      return 0.2;
    }
    
    return 0.5;
  }

  /**
   * 提取下一步
   */
  extractNextStep(response) {
    const match = response.match(/下一步建议:\s*(.+?)(?:\n|$)/);
    if (!match) return null;
    
    const nextStep = match[1].trim();
    if (this.isInvalidNextStep(nextStep)) return null;
    return nextStep;
  }

  /**
   * 判断是否为无效的下一步
   */
  isInvalidNextStep(nextStep) {
    const lower = nextStep.toLowerCase();
    // 更严格的判断：包含"无"、"完成"、"结束"等关键词都视为无效
    return lower.includes('无') || 
           lower.includes('完成') || 
           lower.includes('结束') ||
           lower.includes('已完成') ||
           lower === 'none' ||
           nextStep.length <= 2;
  }

  /**
   * 提取笔记
   */
  extractNote(response) {
    const match = response.match(/笔记:\s*([\s\S]+?)(?:\n\n|\n完成度评估|$)/);
    if (!match) return null;
    
    const note = match[1].trim();
    if (this.isInvalidNote(note)) return null;
    return note;
  }

  /**
   * 判断是否为无效笔记
   */
  isInvalidNote(note) {
    return note.includes('无') || note.length === 0;
  }

  /**
   * 执行动作
   */
  async executeAction(workflow, response) {
    const context = this.buildActionContext(workflow);
    let actionText = this.extractActionText(response);
    
    // 尝试修复格式：如果缺少方括号，尝试添加
    actionText = this.fixActionFormat(actionText);
    
    try {
      return await this.executeFunctions(actionText, context);
    } catch (error) {
      BotUtil.makeLog('error', `执行动作失败: ${error.message}`, 'WorkflowManager');
      return { executed: false, functions: [], context: { ...context, error: error.message }, success: false, error: error.message };
    }
  }

  /**
   * 修复执行动作格式（如果缺少方括号）
   */
  fixActionFormat(actionText) {
    if (!actionText || actionText.trim() === '无') return actionText;
    
    // 如果已经有方括号，直接返回
    if (actionText.includes('[') && actionText.includes(']')) {
      return actionText;
    }
    
    // 尝试修复常见格式：命令:参数 -> [命令:参数]
    const patterns = [
      /^(\w+):(.+)$/,  // 命令:参数
      /^(\w+)$/,       // 单个命令
    ];
    
    for (const pattern of patterns) {
      const match = actionText.match(pattern);
      if (match) {
        const fixed = `[${actionText}]`;
        BotUtil.makeLog('debug', `[格式修复] ${actionText} -> ${fixed}`, 'WorkflowManager');
        return fixed;
      }
    }
    
    return actionText;
  }

  /**
   * 构建动作上下文
   */
  buildActionContext(workflow) {
    return {
      e: workflow.context.e, 
      question: null,
      workflowId: workflow.id,
      ...workflow.context
    };
  }

  /**
   * 执行函数
   */
  async executeFunctions(actionText, context) {
    const { functions } = this.parseWorkflowFunctions(actionText, context);
    
    if (functions.length === 0) {
      BotUtil.makeLog('warn', `[执行] 没有解析到任何函数`, 'WorkflowManager');
      // 记录解析失败信息到上下文，供笔记系统使用
      context.parseError = `执行动作格式不正确：${actionText}`;
      return {
        executed: false,
        functions: [],
        context,
        success: false,
        error: '未解析到任何可执行命令'
      };
    }
    
    const executedFunctions = [];
    let lastError = null;
    
    for (const func of functions) {
      BotUtil.makeLog('info', `[执行] ${func.type}(${JSON.stringify(func.params)})`, 'WorkflowManager');
      const result = await this.executeSingleFunction(func, context);
      if (result.executed) {
        executedFunctions.push(func.type);
        BotUtil.makeLog('info', `[执行] ✓ ${func.type} 成功`, 'WorkflowManager');
      } else {
        BotUtil.makeLog('warn', `[执行] ✗ ${func.type} 失败`, 'WorkflowManager');
      }
      if (result.error) lastError = result.error;
    }

    const success = executedFunctions.length === functions.length && !lastError;
    BotUtil.makeLog('info', `[执行] 结果: ${executedFunctions.length}/${functions.length} 成功`, 'WorkflowManager');

    return {
      executed: executedFunctions.length > 0,
      functions: executedFunctions,
      context,
      success,
      error: lastError?.message || null
    };
  }

  /**
   * 解析工作流中的指令（支持合并工作流），并在工作流内部禁用启动新工作流
   */
  parseWorkflowFunctions(actionText, context = {}) {
    let cleanText = actionText;
    const allFunctions = [];

    // 在工作流内部，直接清理掉所有 [启动工作流:...] 命令文本
    if (context.workflowId) {
      cleanText = cleanText.replace(/\[启动工作流:[^\]]+\]/g, '').trim();
    }

    const streams = [this.stream, ...(this.stream?._mergedStreams || [])];

    for (const s of streams) {
      if (!s?.functions || s.functions.size === 0) continue;

      for (const func of s.functions.values()) {
        // 在工作流内部，直接跳过 start_workflow 的解析，避免AI看到和返回这个命令
        if (context.workflowId && func.type === 'start_workflow') {
          continue;
        }
        // 在工作流内部，跳过所有 onlyTopLevel 的函数
        if (context.workflowId && func.onlyTopLevel) {
          continue;
        }
        
        if (!func.enabled || !func.parser) continue;

        const result = func.parser(cleanText, context);
        if (result.functions && result.functions.length > 0) {
          allFunctions.push(...result.functions);
        }
        if (result.cleanText !== undefined) {
          cleanText = result.cleanText;
        }
      }
    }

    BotUtil.makeLog('info', `[解析] 总计: ${allFunctions.length} 个函数 [${allFunctions.map(f => f.type).join(', ')}]`, 'WorkflowManager');

    // 在工作流内部，禁止再次启动多步工作流
    const filteredFunctions = context.workflowId
      ? allFunctions.filter(fn => fn.type !== 'start_workflow')
      : allFunctions;

    // 按 order 排序
    const withOrder = filteredFunctions.filter(fn => typeof fn.order === 'number');
    const withoutOrder = filteredFunctions.filter(fn => typeof fn.order !== 'number');
    withOrder.sort((a, b) => a.order - b.order);
    
    const orderedFunctions = withOrder.concat(withoutOrder);

    return { functions: orderedFunctions, cleanText };
  }

  /**
   * 执行单个函数
   */
  async executeSingleFunction(func, context) {
    try {
      const executed = await this.stream._executeFunctionWithMerge(func, context);
      return { executed: !!executed, error: null };
    } catch (error) {
      this.handleFunctionError(context, func, error);
      BotUtil.makeLog('error', `工作流函数执行失败[${func.type}]: ${error.message}`, 'WorkflowManager');
      return { executed: false, error };
    }
  }

  /**
   * 处理函数错误
   */
  handleFunctionError(context, func, error) {
    context.commandError = context.commandError || error.message;
  }

  /**
   * 获取工作流
   */
  getWorkflow(workflowId) {
    return this.activeWorkflows.get(workflowId);
  }

  /**
   * 停止工作流
   */
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
  recordDebugStep(workflow, todo, { prompt, messages, response, parsed, notes, result }) {
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
      parsed,
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

