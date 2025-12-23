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
  async decideWorkflowMode(e, goal) {
    // 查找已存在的相同工作流
    const existing = Array.from(this.activeWorkflows.values())
      .find(w => w.status === WORKFLOW_STATUS.RUNNING && w.goal === goal);
    
    if (existing) {
      return { shouldUseTodo: false, response: '已有相同工作流运行中', todos: [] };
    }

    return await this.aiDecideWorkflow(goal);
  }

  /**
   * AI判断是否需要工作流
   */
  async aiDecideWorkflow(goal) {
    const messages = this.buildDecisionMessages(goal);
    const response = await this.stream.callAI(messages, this.stream.config);
    
    if (!response) {
      return { shouldUseTodo: false, response: '', todos: [] };
    }

    const shouldUseTodo = /是否需要TODO工作流:\s*是/i.test(response);
    const todos = shouldUseTodo ? this.extractTodos(response) : [];
    
    if (!shouldUseTodo || todos.length > 0) {
      return { shouldUseTodo, response, todos };
    }
    
    const generatedTodos = await this.generateInitialTodos(goal);
    return { shouldUseTodo: true, response, todos: generatedTodos };
  }

  /**
   * 构建决策提示和消息
   */
  buildDecisionMessages(goal) {
    const prompt = `【任务分析】
用户请求：${goal}

【你的任务】
分析这个任务是否需要多步骤完成。

【判断标准】
- 简单任务（单步可完成）：只包含一个操作的简单命令 → 不需要TODO工作流
- 复杂任务（需要多步）：包含多个操作或需要分步处理 → 需要TODO工作流

【重要原则】
1. 用户明确说了"工作区的文件"，说明文件路径已知，不需要先列出文件确认
2. 读取文件内容 + 告诉用户 = 两步即可，不要添加多余的确认步骤
3. 步骤要精简高效，避免冗余操作

【输出格式】
是否需要TODO工作流: [是/否]
理由: [简要说明]

如果选择"是"，请继续输出：
TODO列表:
1. [第一步]
2. [第二步]
...`;

    return [
      {
        role: 'system',
        content: `你是一个智能任务分析助手。分析用户请求，判断是否需要多步骤工作流。

${this.stream.buildFunctionsPrompt()}

【重要】
- 简单任务（单步可完成）：直接执行，不需要工作流
- 复杂任务（需要多步）：需要规划TODO列表
- 避免冗余步骤：如果用户已经明确文件位置，不需要先列出文件确认`
      },
      { role: 'user', content: prompt }
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
      const content = match[1].trim();
      if (content) {
        todos.push(content);
      }
    }
    
    return todos;
  }

  /**
   * 生成初始TODO列表
   */
  async generateInitialTodos(goal) {
    const messages = [
      {
        role: 'system',
        content: `你是一个任务规划助手。将复杂任务分解为具体步骤。

【重要原则】
1. 步骤要精简高效，避免冗余操作
2. 如果用户明确说了"工作区的文件"，说明文件路径已知，直接读取即可
3. 不要添加"列出文件"、"确认文件是否存在"等多余步骤
4. 读取文件 + 分析回复 = 2步即可完成`
      },
      {
        role: 'user',
        content: `请将以下任务分解为2-3个具体的执行步骤：

任务：${goal}

要求：
1. 每个步骤应该是可执行的、清晰的操作
2. 步骤之间应该有逻辑顺序
3. 避免冗余步骤（如果文件路径已知，直接读取）
4. 输出格式：每行一个步骤，用数字编号`
      }
    ];
    
    const response = await this.stream.callAI(messages, this.stream.config);
    const todos = response ? this.extractTodos(response) : [];
    return todos.length > 0 ? todos : ['读取文件内容', '分析并回复用户'];
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
      debugSteps: []
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

    // 合并上下文（包括文件内容、命令输出等）
    this.mergeContext(workflow, result.context);
    
    // 如果执行了读取或搜索操作，更新笔记快照
    if (result.executed && (result.functions.includes('read') || result.functions.includes('grep'))) {
      const updatedNotes = await this.stream.getNotes(workflow.id);
      todo.notes = updatedNotes;
      BotUtil.makeLog('info', `[TODO-${todo.id}] 更新笔记: ${updatedNotes.length}条`, 'WorkflowManager');
    }
    
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
    await this.storeNote(workflow, todo.id, `执行错误: ${errorMsg}。请检查命令是否正确，文件是否存在。`);
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
    
    // 通用错误字段提取（按优先级）
    const errorFields = ['commandError', 'fileError', 'error'];
    for (const field of errorFields) {
      if (result.context[field]) {
        return result.context[field];
      }
    }
    
    // 查找所有以Error结尾的字段
    for (const [key, value] of Object.entries(result.context)) {
      if (key.endsWith('Error') && value) {
        return value;
      }
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
   * 构建提示部分
   */
  buildPromptSections(workflow, todo, context, progress, previousTodos, notes) {
    const sections = [];
    
    sections.push(`【工作流目标】${workflow.goal}`);
    sections.push(`【当前任务】${todo.content}`);
    sections.push(`【进度状态】${progress.completed}/${progress.total}任务已完成`);
    
    const completedTasks = this.buildCompletedTasksSection(previousTodos);
    if (completedTasks) sections.push(completedTasks);
    
    const errors = this.buildErrorSection(notes);
    if (errors) sections.push(errors);
    
    const contextSection = this.buildContextSection(context);
    if (contextSection) sections.push(contextSection);
    
    const notesSection = this.buildNotesSection(notes);
    if (notesSection) sections.push(notesSection);
    
    sections.push(this.buildRequirementsSection(context));
    sections.push('【输出格式】\n**第一部分：自然对话**（必须）\n- 先用1-2句话自然地和用户交流，说明你在做什么\n- 语气要像正常聊天一样，可以加点个性、幽默或提醒\n\n**第二部分：格式化输出**（必须包含所有4项）\n完成度评估: [0-1之间的数字，0.8以上表示完成]\n执行动作: [使用的命令]\n下一步建议: [如果完成填"无"，否则描述下一步]\n笔记: [重要信息；read/grep已自动存笔记，无需重复；如果无需记录填"无"]');
    
    return sections;
  }

  /**
   * 构建已完成任务部分
   */
  buildCompletedTasksSection(previousTodos) {
    if (previousTodos.length === 0) return '';
    return `【已完成任务】\n${previousTodos.map(t => `✓ ${t.content}`).join('\n')}\n`;
  }

  /**
   * 构建错误部分
   */
  buildErrorSection(notes) {
    const errorNotes = this.extractErrorNotes(notes);
    if (errorNotes.length === 0) return '';
    return `【⚠️ 错误信息】（需要修复）\n${errorNotes.join('\n')}\n`;
  }

  /**
   * 提取错误笔记
   */
  extractErrorNotes(notes) {
    return notes
      .filter(note => note.content && (
        note.content.includes('执行错误') || 
        note.content.includes('错误') || 
        note.content.includes('失败')
      ))
      .slice(0, 3)
      .map(note => note.content.slice(0, 300));
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
   * 构建文件上下文部分
   */
  buildFileContextSection(context) {
    if (!context.fileContent) return '';
    
    const fileName = context.fileSearchResult?.fileName || context.fileName || '文件';
    const filePath = context.fileSearchResult?.path || context.filePath || '';
    const content = context.fileContent.slice(0, 5000);
    const truncated = context.fileContent.length > 5000 ? '\n...(内容已截断，完整内容已保存)' : '';
    
    return `【📄 已读取的文件内容】（重要：必须使用此内容完成当前任务）\n文件名：${fileName}${filePath ? `\n文件路径：${filePath}` : ''}\n\n【完整文件内容】\n${content}${truncated}`;
  }

  /**
   * 构建命令上下文部分
   */
  buildCommandContextSection(context) {
    if (!context.commandOutput || !context.commandSuccess) return '';
    
    const output = context.commandOutput.slice(0, 1000);
    const truncated = context.commandOutput.length > 1000 ? '\n...(输出已截断)' : '';
    
    return `【📋 上一个命令的输出结果】\n${output}${truncated}`;
  }

  /**
   * 构建笔记部分
   */
  buildNotesSection(notes) {
    const otherNotes = this.extractOtherNotes(notes);
    if (otherNotes.length === 0) return '';
    
    const noteLines = [];
    for (let i = 0; i < otherNotes.length; i++) {
      const note = otherNotes[i];
      const content = note.content.slice(0, 300);
      const truncated = note.content.length > 300 ? '...' : '';
      noteLines.push(`${i + 1}. ${content}${truncated}`);
    }
    
    return `【📝 工作流笔记】\n${noteLines.join('\n')}`;
  }

  /**
   * 提取其他笔记
   */
  extractOtherNotes(notes) {
    return notes
      .filter(note => note.content && 
        !note.content.includes('【文件读取结果】') && 
        !note.content.includes('执行错误') && 
        !note.content.includes('失败'))
      .slice(-5);
  }

  /**
   * 构建要求部分
   */
  buildRequirementsSection(context) {
    const requirements = ['分析当前任务，执行必要操作'];
    
    if (context.fileContent) {
      requirements.push('**重要**：必须使用"已读取的文件内容"完成当前任务，不要使用示例数据');
    }
    requirements.push('使用可用命令完成操作');
    if (context.commandOutput) {
      requirements.push('**重要**：可以使用上一个命令的输出结果来完成任务');
    }
    requirements.push('严格按照输出格式回复');
    
    return `【执行要求】\n${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  }

  /**
   * 构建系统提示
   */
  buildSystemPrompt(workflow) {
    const functionsPrompt = this.buildFunctionsPrompt();
    const contextInfo = this.buildContextInfo(workflow.context);

    return `【工作流执行助手】
执行多步骤工作流任务。

【核心工具】（read/grep/write/run）
- [读取:文件路径] - 读取文件（自动存笔记和上下文，优先使用；不要用powershell/cmd读取文件）
- [搜索:关键词:文件路径(可选)] - 搜索文本（自动存笔记和上下文）
- [写入:文件路径:内容] - 写入文件
- [执行:命令] - 执行命令（输出会保存到上下文；禁止用来读取或修改文件内容）
- [笔记:内容] - 手动记录笔记

【工作区说明】
- 工作区默认为桌面目录
- 用户说"工作区的文件"就是指桌面上的文件，直接读取即可
- 不需要先列出文件或确认文件是否存在，直接[读取:文件名]即可

【执行流程】
1. 首先检查"已读取的文件内容"部分，如果有内容说明文件已被读取
2. 如果文件已读取，直接使用该内容完成任务，不要再次读取
3. 如果文件未读取，使用[读取:文件路径]命令读取
4. 评估完成度（0-1，>=0.8表示完成）
5. read/grep命令会自动保存结果到上下文和笔记，无需手动记录

【重要原则】
- 完成度 >= 0.8：任务完成，下一步建议填"无"
- 完成度 < 0.8：任务进行中，可以建议下一步
- **如果看到"已读取的文件内容"，说明文件已被读取，直接使用该内容，不要再次读取**
- **禁止重复读取同一个文件**
- **禁止添加不必要的步骤，避免冗余操作**
- **严禁使用[启动工作流:...]命令！你已经在工作流中执行任务，不要启动新工作流，直接使用可用命令完成任务即可**
- **禁止使用[执行:ls]、[执行:dir]等命令列出文件，直接读取即可**
- **工作流内部只能使用read/grep/write/run等基础命令，不能启动新工作流**
- 读取文件时，一律使用[读取:文件路径]，例如[读取:易忘信息.txt]
- 禁止使用powershell/cmd命令读取文件内容
- 上下文共享：所有步骤共享上下文，文件内容会自动传递给下一个步骤
- **任务完成后，下一步建议必须填"无"或"完成"，不要建议额外操作**
${contextInfo}
${functionsPrompt ? `${functionsPrompt}\n\n` : ''}【输出格式】
**第一部分：自然对话**（必须）
- 先用1-2句话自然地和用户交流，说明你在做什么
- 语气要像正常聊天一样，可以加点个性、幽默或提醒
- 例如："好的，我来帮你读取这个文件看看里面有什么内容~"

**第二部分：格式化输出**（必须包含所有4项）
完成度评估: [0-1之间的数字，0.8以上表示完成]
执行动作: [使用的命令，如[读取:test.txt]]
下一步建议: [如果完成填"无"，否则描述下一步]
笔记: [重要信息；read/grep已自动存笔记，无需重复；如果无需记录填"无"]

**示例输出：**
好的，我先来读取一下这个文件，看看里面都有什么重要信息~

完成度评估: 0.9
执行动作: [读取:易忘信息.txt]
下一步建议: 无
笔记: 无
`;
  }

  /**
   * 构建函数提示（工作流内部专用，过滤顶层命令）
   */
  buildFunctionsPrompt() {
    const allFunctions = this.collectAllFunctions();
    
    if (allFunctions.length === 0) {
      return '';
    }
    
    const enabledPrompts = new Set();
    for (const func of allFunctions) {
      // 过滤仅允许顶层调用的函数（例如启动新工作流）
      if (func.onlyTopLevel) {
        BotUtil.makeLog('debug', `过滤顶层命令: ${func.description}`, 'WorkflowManager');
        continue;
      }
      if (func.enabled && func.prompt) {
        enabledPrompts.add(func.prompt);
      }
    }
    
    if (enabledPrompts.size === 0) {
      return '';
    }
    
    return `【可用命令】\n${Array.from(enabledPrompts).join('\n')}`;
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
   * 构建上下文信息
   */
  buildContextInfo(context) {
    if (!context) return '';
    
    const info = [];
    
    if (context.fileContent) {
      const fileName = context.fileSearchResult?.fileName || context.fileName || '文件';
      info.push(`✅ 上一个步骤已成功读取文件：${fileName}`);
      info.push(`📋 文件内容已保存在工作流上下文中，当前任务可以直接使用该内容`);
      info.push(`⚠️ 请在"已读取的文件内容"部分查看完整内容`);
    }
    
    if (context.commandOutput && context.commandSuccess) {
      info.push('✅ 上一个命令执行成功，输出结果已保存在工作流上下文中');
    }
    
    if (info.length === 0) return '';
    
    return `\n【🔔 重要上下文】\n${info.join('\n')}\n`;
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
  async executeAction(workflow, actionText) {
    const context = this.buildActionContext(workflow);
    
    try {
      return await this.executeFunctions(actionText, context);
    } catch (error) {
      BotUtil.makeLog('error', `执行动作失败: ${error.message}`, 'WorkflowManager');
      return { executed: false, functions: [], context: {}, success: false, error: error.message };
    }
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
      return {
        executed: false,
        functions: [],
        context,
        success: true,
        error: null
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

    // 在工作流内部，直接清理掉所有 [启动工作流:...] 命令文本，避免被解析
    if (context.workflowId) {
      cleanText = cleanText.replace(/\[启动工作流:[^\]]+\]/g, '').trim();
      if (cleanText !== actionText) {
        BotUtil.makeLog('warn', `[解析] 已清理工作流内部的 [启动工作流:...] 命令文本`, 'WorkflowManager');
      }
    }

    const streams = [this.stream, ...(this.stream?._mergedStreams || [])];
    
    BotUtil.makeLog('debug', `[解析] 动作文本: ${actionText.substring(0, 100)}${actionText.length > 100 ? '...' : ''}`, 'WorkflowManager');
    BotUtil.makeLog('debug', `[解析] 可用流: ${streams.map(s => `${s?.name}(${s?.functions?.size || 0})`).join(', ')}`, 'WorkflowManager');

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
          BotUtil.makeLog('debug', `[解析] ${func.description} → ${result.functions.length} 个操作`, 'WorkflowManager');
          allFunctions.push(...result.functions);
        }
        if (result.cleanText !== undefined) {
          cleanText = result.cleanText;
        }
      }
    }

    BotUtil.makeLog('info', `[解析] 总计: ${allFunctions.length} 个函数 [${allFunctions.map(f => f.type).join(', ')}]`, 'WorkflowManager');

    // 在工作流内部，禁止再次启动多步工作流（双重保险）
    const filteredFunctions = allFunctions.filter(fn => {
      if (!context.workflowId) return true;
      if (fn.type === 'start_workflow') {
        BotUtil.makeLog('warn', `[解析] 过滤工作流内部的 start_workflow 命令`, 'WorkflowManager');
        return false;
      }
      return true;
    });

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
    if (this.isFileRelatedFunction(func.type)) {
      context.fileError = context.fileError || error.message;
    }
  }

  /**
   * 判断是否为文件相关函数
   */
  isFileRelatedFunction(funcType) {
    return funcType.includes('read') || funcType.includes('file');
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
   * 将多步工作流的完整信息写入 data/debug 目录
   */
  async saveDebugLog(workflow) {
    if (!workflow) return;

    const steps = Array.isArray(workflow.debugSteps) ? workflow.debugSteps : [];
    const totalTodos = Array.isArray(workflow.todos) ? workflow.todos.length : 0;

    // 仅对多步工作流或实际执行了多步的情况写入调试日志
    if (totalTodos <= 1 && steps.length <= 1) {
      return;
    }

    const debugDir = path.join(paths.data, 'debug');
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
      steps
    };

    const json = JSON.stringify(payload, null, 2);
    await BotUtil.writeFile(filePath, json, { encoding: 'utf8' });
  }
}
