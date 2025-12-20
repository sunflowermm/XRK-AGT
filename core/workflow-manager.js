import BotUtil from '#utils/botutil.js';

// 全局工作流管理器（单例模式）
let globalWorkflowManager = null;

export class WorkflowManager {
  constructor(streamInstance) {
    if (globalWorkflowManager && globalWorkflowManager.stream === streamInstance) {
      return globalWorkflowManager;
    }
    
    this.stream = streamInstance;
    this.activeWorkflows = new Map();
    this.workflowLock = new Map(); // 工作流创建锁，防止重复创建
    
    globalWorkflowManager = this;
  }

  /**
   * 获取全局单例实例
   */
  static getInstance(streamInstance) {
    if (!globalWorkflowManager || (streamInstance && globalWorkflowManager.stream !== streamInstance)) {
      globalWorkflowManager = new WorkflowManager(streamInstance);
    }
    return globalWorkflowManager;
  }

  /**
   * 检查并清理已完成的工作流
   */
  cleanupCompletedWorkflows() {
    for (const [id, workflow] of this.activeWorkflows.entries()) {
      if (workflow.status === 'completed' || workflow.status === 'failed') {
        // 30秒后清理已完成的工作流
        if (Date.now() - (workflow.completedAt || 0) > 30000) {
          this.activeWorkflows.delete(id);
        }
      }
    }
  }

  async decideWorkflowMode(e, goal) {
    // 预检查：明确是简单任务的情况（只包含一个操作）
    // 注意：如果包含"并"、"然后"、"接着"等连接词，通常是多步骤任务
    const isMultiStep = /并|然后|接着|之后|接下来|同时/i.test(goal);
    
    // 只有明确是单个操作的简单任务才跳过
    const simpleSingleTasks = [
      /^(打开|启动).*(计算器|记事本|软件|程序)$/i,
      /^(截屏|截图)$/i,
      /^(查看|显示).*系统信息$/i,
      /^(回|显示).*桌面$/i,
      /^磁盘空间$/i,
      /^(查看|读取|打开|查找).*文件$/i // 只读取一个文件，不做其他操作
    ];
    
    // 如果包含"并"等连接词，或者是复杂的文件操作，都需要工作流
    if (!isMultiStep && simpleSingleTasks.some(pattern => pattern.test(goal.trim()))) {
      return { shouldUseTodo: false, response: '简单任务，直接执行', todos: [] };
    }

    // 检查是否有相似的工作流正在运行（避免重复创建工作流）
    const activeWorkflowGoals = Array.from(this.activeWorkflows.values())
      .filter(w => w.status === 'running')
      .map(w => w.goal);
    
    const similarWorkflow = activeWorkflowGoals.find(activeGoal => {
      // 简单的相似度判断：包含相同关键词
      const goalWords = goal.split(/[\s，。！？,.!?]+/).filter(w => w.length > 1);
      const activeWords = activeGoal.split(/[\s，。！？,.!?]+/).filter(w => w.length > 1);
      const commonWords = goalWords.filter(w => activeWords.includes(w));
      return commonWords.length >= 2; // 至少2个相同关键词
    });
    
    if (similarWorkflow) {
      return { shouldUseTodo: false, response: `已有相似工作流运行中: ${similarWorkflow}`, todos: [] };
    }

    const decisionPrompt = `【任务分析】
用户请求：${goal}

【你的任务】
分析这个任务是否需要多步骤完成。

【判断标准】
- 简单任务（单步可完成）：只包含一个操作的简单命令，如"打开计算器"、"截屏"、"读取文件X"（仅读取）等 → 不需要TODO工作流
- 复杂任务（需要多步）：包含多个操作或需要分步处理，如"读取文件X并生成Excel"、"打开微信并发送消息"、"读取文件并创建表格"等 → 需要TODO工作流

【特别注意】
- 如果任务包含"并"、"然后"、"接着"等连接词，通常需要多步骤，应该创建工作流
- 如果任务需要先执行一个操作，然后基于结果执行另一个操作（如：读取文件→分析内容→创建Excel），必须使用工作流
- 只有明确是单个命令可以直接完成的简单任务才不需要工作流

【输出格式】
请按以下格式输出：
是否需要TODO工作流: [是/否]
理由: [简要说明]
${this.stream.buildFunctionsPrompt()}

如果选择"是"，请继续输出：
TODO列表:
1. [第一步]
2. [第二步]
3. [第三步]
...`;

    const messages = [
      {
        role: 'system',
        content: `你是一个智能任务分析助手。你需要分析用户请求，判断是否需要多步骤工作流。

${this.stream.buildFunctionsPrompt()}

【重要】
- 如果任务简单，直接执行即可，不需要TODO工作流
- 如果任务复杂，需要规划TODO列表`
      },
      {
        role: 'user',
        content: decisionPrompt
      }
    ];

    const response = await this.stream.callAI(messages, this.stream.config);
    if (!response) {
      return { shouldUseTodo: false, response: '', todos: [] };
    }

    const shouldUseTodo = /是否需要TODO工作流:\s*是/i.test(response);
    const todos = shouldUseTodo ? this.extractTodos(response) : [];
    
    if (shouldUseTodo && todos.length === 0) {
      todos.push(...await this.generateInitialTodos(goal));
    }

    return {
      shouldUseTodo,
      response,
      todos
    };
  }

  extractTodos(text) {
    const todos = [];
    const todoMatch = text.match(/TODO列表:\s*([\s\S]+?)(?:\n\n|$)/);
    if (todoMatch) {
      const todoLines = todoMatch[1].split('\n');
      for (const line of todoLines) {
        const match = line.match(/^\d+[\.、]\s*(.+)$/);
        if (match) todos.push(match[1].trim());
      }
    }
    return todos;
  }

  async generateInitialTodos(goal) {
    const planningPrompt = `请将以下任务分解为3-5个具体的执行步骤：

任务：${goal}

要求：
1. 每个步骤应该是可执行的、清晰的操作
2. 步骤之间应该有逻辑顺序
3. 输出格式：每行一个步骤，用数字编号

示例：
任务：帮我打开微信并发送消息给张三
步骤：
1. 查看桌面文件，找到微信快捷方式
2. 打开微信软件
3. 等待微信启动完成
4. 查找联系人张三
5. 发送消息给张三`;

    const messages = [
      {
        role: 'system',
        content: '你是一个任务规划助手。将复杂任务分解为具体步骤。'
      },
      {
        role: 'user',
        content: planningPrompt
      }
    ];

    const response = await this.stream.callAI(messages, this.stream.config);
    const todos = response ? this.extractTodos(response) : [];
    return todos.length > 0 ? todos : ['分析任务', '执行操作', '验证结果'];
  }

  async createWorkflow(e, goal, initialTodos = []) {
    // 清理已完成的工作流
    this.cleanupCompletedWorkflows();

    // 创建唯一键（基于目标和用户ID）
    const userKey = e?.user_id || e?.sender?.user_id || 'default';
    const workflowKey = `${userKey}:${goal}`;

    // 检查是否有相同的工作流正在创建或运行（防重复创建）
    if (this.workflowLock.has(workflowKey)) {
      BotUtil.makeLog('warn', `工作流正在创建中，跳过重复创建: ${goal}`, 'WorkflowManager');
      return this.workflowLock.get(workflowKey);
    }

    // 检查是否已有相同目标的工作流在运行
    const existingWorkflow = Array.from(this.activeWorkflows.values())
      .find(w => w.status === 'running' && w.goal === goal && 
                 (w.context?.e?.user_id === userKey || !w.context?.e?.user_id));
    
    if (existingWorkflow) {
      BotUtil.makeLog('info', `工作流已存在，跳过创建: ${goal}`, 'WorkflowManager');
      return existingWorkflow.id;
    }

    // 设置创建锁
    this.workflowLock.set(workflowKey, null);

    const workflowId = `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const workflow = {
      id: workflowId,
      goal,
      todos: initialTodos.map((todo, index) => ({
        id: `todo_${index}`,
        content: todo,
        status: 'pending',
        result: null,
        error: null,
        notes: []
      })),
      notes: [],
      currentStep: 0,
      history: [],
      context: { e },
      maxIterations: 20,
      iteration: 0,
      status: 'running'
    };

    await this.stream.storeWorkflowMemory(workflowId, { goal, createdAt: Date.now() });
    this.activeWorkflows.set(workflowId, workflow);
    
    // 更新锁中的workflowId
    this.workflowLock.set(workflowKey, workflowId);
    
    // 发送工作流启动通知
    if (e) {
      try {
        const goalPreview = goal.length > 40 ? goal.substring(0, 40) + '...' : goal;
        await e.reply(`✅ 工作流已启动！\n目标：${goalPreview}\n步骤数：${initialTodos.length}\nID：${workflowId}`);
      } catch (err) {
        BotUtil.makeLog('debug', `发送工作流启动通知失败: ${err.message}`, 'WorkflowManager');
      }
    }
    
    // 异步执行，完成后释放锁
    this.executeWorkflow(workflowId).catch(err => {
      BotUtil.makeLog('error', `工作流执行失败[${workflowId}]: ${err.message}`, 'WorkflowManager');
    }).finally(() => {
      // 5秒后释放锁
      setTimeout(() => {
        this.workflowLock.delete(workflowKey);
      }, 5000);
    });
    
    return workflowId;
  }

  async executeWorkflow(workflowId) {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) throw new Error(`工作流不存在: ${workflowId}`);

    try {
      while (workflow.status === 'running' && workflow.iteration < workflow.maxIterations) {
        workflow.iteration++;

        if (this.isAllCompleted(workflow)) {
          workflow.status = 'completed';
          workflow.completedAt = Date.now();
          const completedCount = workflow.todos.filter(t => t.status === 'completed').length;
          const totalCount = workflow.todos.length;
          await this.sendWorkflowUpdate(workflow, `✅ 工作流完成！(${completedCount}/${totalCount}任务已完成)`);
          if (workflow.context.e) {
            try {
              await workflow.context.e.reply(`🎉 工作流执行完成\n目标：${workflow.goal}\n已完成 ${completedCount}/${totalCount} 个任务`);
            } catch (err) {
              BotUtil.makeLog('debug', `发送完成通知失败: ${err.message}`, 'WorkflowManager');
            }
          }
          break;
        }

        const todo = this.getNextTodo(workflow);
        if (!todo) {
          workflow.status = 'completed';
          break;
        }
        await this.executeTodo(workflow, todo);
        await BotUtil.sleep(1000);
      }

      if (workflow.iteration >= workflow.maxIterations) {
        workflow.status = 'failed';
        workflow.completedAt = Date.now();
        await this.sendWorkflowUpdate(workflow, '工作流达到最大迭代次数，已停止');
      }
    } catch (error) {
      workflow.status = 'failed';
      workflow.error = error.message;
      BotUtil.makeLog('error', `工作流执行异常[${workflowId}]: ${error.message}`, 'WorkflowManager');
    }
  }

  isAllCompleted(workflow) {
    return workflow.todos.every(todo => todo.status === 'completed' || todo.status === 'failed');
  }

  getNextTodo(workflow) {
    return workflow.todos.find(todo => todo.status === 'pending') ||
           workflow.todos.find(todo => todo.status === 'in_progress');
  }

  async executeTodo(workflow, todo) {
    todo.status = 'in_progress';
    
    try {
      const notes = await this.stream.getNotes(workflow.id);
      const notesText = notes.length > 0 
        ? `\n【工作流笔记】（所有步骤共享）\n${notes.map((n, i) => `${i + 1}. ${n.content}`).join('\n')}\n`
        : '';

      const prompt = this.buildTodoPrompt(workflow, todo, notesText);
      const messages = [
        { role: 'system', content: this.buildSystemPrompt(workflow) },
        { role: 'user', content: prompt }
      ];

      const response = await this.stream.callAI(messages, this.stream.config);
      if (!response) throw new Error('AI返回空响应');

      const { action, completion, nextStep, note } = this.parseAIResponse(response, workflow, todo);

      if (note?.trim()) {
        await this.storeNote(workflow, todo.id, note);
      }

      workflow.history.push({
        todoId: todo.id,
        iteration: workflow.iteration,
        prompt,
        response,
        action: action || response,
        completion,
        note: note || null,
        timestamp: Date.now()
      });

      const result = await this.executeAction(workflow, response);
      todo.result = result;

      const errorMsg = result.error || result.context?.commandError || result.context?.fileError || result.context?.excelError;
      if (!result.success && errorMsg) {
        await this.storeNote(workflow, todo.id, `执行错误: ${errorMsg}。请检查命令是否正确，文件是否存在。`);
        todo.status = 'pending';
        todo.error = errorMsg;
        await this.sendWorkflowUpdate(workflow, `✗ 任务失败: ${todo.content}\n错误: ${errorMsg}`);
        // 不要return，让AI继续尝试修复
      }

      const completionRate = completion || this.evaluateCompletion(workflow, todo, response);
      this.updateTodoStatus(workflow, todo, completionRate);

      if (nextStep?.trim()) {
        workflow.todos.push({
          id: `todo_${workflow.todos.length}`,
          content: nextStep,
          status: 'pending',
          result: null,
          error: null,
          notes: []
        });
      }
    } catch (error) {
      todo.status = 'failed';
      todo.error = error.message;
      BotUtil.makeLog('error', `Todo执行失败[${todo.id}]: ${error.message}`, 'WorkflowManager');
    }
  }

  async storeNote(workflow, source, content) {
    await this.stream.storeNote(workflow.id, content, source, true);
    workflow.notes.push({ content, source, time: Date.now(), temporary: true });
  }

  updateTodoStatus(workflow, todo, completionRate) {
    // 确保completionRate是有效数值
    if (typeof completionRate !== 'number' || isNaN(completionRate)) {
      completionRate = 0.5;
    }
    
    if (completionRate >= 0.8) {
      todo.status = 'completed';
      todo.completedAt = Date.now();
      this.sendWorkflowUpdate(workflow, `✓ 任务完成: ${todo.content}`);
    } else if (completionRate >= 0.5) {
      // 保持进行中状态，不改变
      if (todo.status !== 'in_progress') {
        todo.status = 'in_progress';
      }
      this.sendWorkflowUpdate(workflow, `⟳ 进行中 (${(completionRate * 100).toFixed(0)}%): ${todo.content}`);
    } else {
      // 完成度低，标记为待处理以便重试
      todo.status = 'pending';
      this.sendWorkflowUpdate(workflow, `○ 待处理 (${(completionRate * 100).toFixed(0)}%): ${todo.content}`);
    }
  }

  buildTodoPrompt(workflow, todo, notesText = '') {
    const errorNotes = notesText ? notesText.split('\n').filter(n => n.includes('执行错误') || n.includes('错误')).slice(0, 3).join('\n') : '';
    const recentNotes = notesText ? notesText.split('\n').slice(-10).join('\n') : ''; // 获取最近10条笔记
    const hasErrors = errorNotes.length > 0;
    const completedCount = workflow.todos.filter(t => t.status === 'completed').length;
    const totalCount = workflow.todos.length;
    const previousTodos = workflow.todos.filter(t => t.status === 'completed').slice(-3); // 最近完成的3个任务

    return `【工作流目标】${workflow.goal}

【当前任务】${todo.content}

【进度状态】${completedCount}/${totalCount}任务已完成
${previousTodos.length > 0 ? `【已完成任务】\n${previousTodos.map(t => `✓ ${t.content}`).join('\n')}\n` : ''}${hasErrors ? `【⚠️ 错误信息】（需要修复）\n${errorNotes}\n` : ''}${recentNotes ? `【📝 工作流笔记】（所有步骤共享，可查看之前步骤的信息）\n${recentNotes}\n` : ''}

【执行要求】
1. ${hasErrors ? '**优先修复上述错误**，然后继续执行当前任务' : '分析当前任务，执行必要操作'}
2. 使用可用命令完成操作（命令格式：[命令:参数]）
3. 如果当前任务需要从之前步骤获取信息，请查看上述"工作流笔记"
4. 严格按照输出格式回复

【输出格式】（必须包含所有4项）
完成度评估: [0-1之间的数字，0.8以上表示完成]
执行动作: [使用的命令]
下一步建议: [如果完成填"无"，否则描述下一步应该做什么]
笔记: [记录重要信息供后续步骤使用，如文件内容、分析结果、结构化数据等/无]`;
  }

  buildSystemPrompt(workflow) {
    let functionsPrompt = '';
    
    if (this.stream._mergedStreams) {
      const allFunctions = [];
      if (this.stream.functions) {
        allFunctions.push(...Array.from(this.stream.functions.values()));
      }
      for (const mergedStream of this.stream._mergedStreams) {
        if (mergedStream.functions) {
          allFunctions.push(...Array.from(mergedStream.functions.values()));
        }
      }
      const prompts = allFunctions
        .filter(f => f.enabled && f.prompt)
        .map(f => f.prompt);
      if (prompts.length > 0) {
        functionsPrompt = `【可用命令】\n${prompts.join('\n')}`;
      }
    } else {
      functionsPrompt = this.stream.buildFunctionsPrompt();
    }

    return `【工作流执行助手】
你正在执行一个多步骤工作流任务。你的职责是：

1. **分析当前任务**：理解当前步骤需要做什么
2. **查看笔记**：如果提示中有"工作流笔记"，查看之前步骤记录的信息
3. **执行操作**：使用可用命令完成当前任务
4. **评估完成度**：判断任务是否完成（0-1之间的数值）
5. **记录信息**：通过笔记功能记录重要信息供后续步骤使用

【重要原则】
- **完成度 >= 0.8**：任务标记为完成，进入下一步
- **完成度 < 0.8**：任务保持进行中，可能需要更多步骤
- **执行失败**：记录错误信息到笔记，下次调用时会看到并重试
- **笔记共享**：笔记中的信息会传递给后续所有步骤，用于上下文共享
- **信息传递**：如果当前步骤需要之前步骤的结果，查看"工作流笔记"

【工具使用要点】
- 文件操作默认在工作区（桌面）进行
- Excel需要JSON数组格式，不能直接传入文本
- 如果要从文本创建Excel，需要先分析文本，提取数据，转换为JSON数组

${functionsPrompt ? `${functionsPrompt}\n\n` : ''}【输出格式】（必须严格按照此格式，所有4项都要填写）
完成度评估: [0-1之间的数字，如0.9表示90%完成，0.8以上表示完成]
执行动作: [使用的命令，如[读取文件:test.txt]或[生成Excel:表格.xlsx:[{"列":"值"}]]]
下一步建议: [如果完成填"无"；如果需要更多步骤，描述下一步应该做什么]
笔记: [记录重要信息供后续步骤使用，如文件内容、分析结果、JSON数组数据等；如果无需记录填"无"]
`;
  }

  parseAIResponse(response, workflow, todo) {
    // 提取完成度评估
    const completionMatch = response.match(/完成度评估:\s*([0-9.]+)/);
    let completion = completionMatch ? parseFloat(completionMatch[1]) : null;
    
    // 如果没找到完成度，尝试从上下文中推断
    if (completion === null) {
      const lowerResponse = response.toLowerCase();
      if (lowerResponse.includes('完成') || lowerResponse.includes('成功') || lowerResponse.includes('已')) {
        completion = 0.9;
      } else if (lowerResponse.includes('失败') || lowerResponse.includes('错误') || lowerResponse.includes('无法')) {
        completion = 0.2;
      } else {
        completion = 0.5; // 默认中等完成度
      }
    }
    
    // 确保完成度在0-1范围内
    completion = Math.max(0, Math.min(1, completion));

    // 提取下一步建议
    const nextStepMatch = response.match(/下一步建议:\s*(.+?)(?:\n|$)/);
    let nextStep = null;
    if (nextStepMatch) {
      const suggestion = nextStepMatch[1].trim();
      if (!suggestion.includes('无') && suggestion.length > 2) {
        nextStep = suggestion;
      }
    }

    // 提取笔记
    const noteMatch = response.match(/笔记:\s*([\s\S]+?)(?:\n\n|\n完成度评估|$)/);
    let note = null;
    if (noteMatch) {
      const noteContent = noteMatch[1].trim();
      if (!noteContent.includes('无') && noteContent.length > 0) {
        note = noteContent;
      }
    }

    return { action: response, completion, nextStep, note };
  }

  async executeAction(workflow, actionText) {
    const context = { e: workflow.context.e, question: null };
    
    try {
      const { functions } = this.stream.parseFunctions(actionText, context);
      const executedFunctions = [];
      let lastError = null;
      
      for (const func of functions) {
        try {
          const executed = await this.stream._executeFunctionWithMerge(func, context);
          if (executed) executedFunctions.push(func.type);
        } catch (error) {
          lastError = error;
          BotUtil.makeLog('error', `工作流函数执行失败[${func.type}]: ${error.message}`, 'WorkflowManager');
          context.commandError = context.commandError || error.message;
          context.fileError = context.fileError || (func.type.includes('read_file') ? error.message : null);
        }
      }

      return {
        executed: functions.length > 0,
        functions: executedFunctions,
        context,
        success: executedFunctions.length === functions.length && !lastError,
        error: lastError?.message || null
      };
    } catch (error) {
      BotUtil.makeLog('error', `执行动作失败: ${error.message}`, 'WorkflowManager');
      return { executed: false, functions: [], context: {}, success: false, error: error.message };
    }
  }

  evaluateCompletion(workflow, todo, response) {
    // 如果AI已经提供了完成度评估，优先使用
    const completionMatch = response.match(/完成度评估:\s*([0-9.]+)/);
    if (completionMatch) {
      const parsed = parseFloat(completionMatch[1]);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        return parsed;
      }
    }

    // 否则从上下文推断
    const completedKeywords = ['完成', '成功', '已', 'done', 'success', 'finished', '完成度评估'];
    const failedKeywords = ['失败', '错误', '无法', 'failed', 'error', 'cannot', '失败'];
    const lowerResponse = response.toLowerCase();
    let score = 0.5;

    if (completedKeywords.some(kw => lowerResponse.includes(kw))) score += 0.3;
    if (failedKeywords.some(kw => lowerResponse.includes(kw))) score -= 0.3;
    if (todo.result?.executed && todo.result.success) score += 0.3;
    if (todo.result?.executed && !todo.result.success) score -= 0.3;
    if (todo.error) score -= 0.4;

    return Math.max(0, Math.min(1, score));
  }

  async sendWorkflowUpdate(workflow, message) {
    if (!workflow.context.e) return;
    try {
      const statusText = this.getWorkflowStatusText(workflow);
      const goalPreview = workflow.goal.length > 30 ? workflow.goal.substring(0, 30) + '...' : workflow.goal;
      await workflow.context.e.reply(`[工作流更新] ${goalPreview}\n${statusText}\n${message}`);
    } catch (error) {
      BotUtil.makeLog('debug', `发送工作流更新失败: ${error.message}`, 'WorkflowManager');
    }
  }

  getWorkflowStatusText(workflow) {
    const completed = workflow.todos.filter(t => t.status === 'completed').length;
    return `进度: ${completed}/${workflow.todos.length} | 迭代: ${workflow.iteration}/${workflow.maxIterations}`;
  }

  getWorkflow(workflowId) {
    return this.activeWorkflows.get(workflowId);
  }

  stopWorkflow(workflowId) {
    const workflow = this.activeWorkflows.get(workflowId);
    if (workflow) workflow.status = 'paused';
  }

  removeWorkflow(workflowId) {
    this.activeWorkflows.delete(workflowId);
  }
}

