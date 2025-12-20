import BotUtil from '#utils/botutil.js';

export class WorkflowManager {
  constructor(streamInstance) {
    this.stream = streamInstance;
    this.activeWorkflows = new Map();
  }

  async decideWorkflowMode(e, goal) {
    const decisionPrompt = `【任务分析】
用户请求：${goal}

【你的任务】
分析这个任务是否需要多步骤完成。

【判断标准】
- 简单任务（单步可完成）：如"打开计算器"、"截屏"、"查看系统信息"等 → 不需要TODO工作流
- 复杂任务（需要多步）：如"打开微信并发送消息"、"生成Word文档并打开"、"查看桌面文件然后打开某个软件"等 → 需要TODO工作流

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
    this.executeWorkflow(workflowId).catch(err => {
      BotUtil.makeLog('error', `工作流执行失败[${workflowId}]: ${err.message}`, 'WorkflowManager');
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
          await this.sendWorkflowUpdate(workflow, '所有任务已完成！');
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

      const errorMsg = result.error || result.context?.commandError || result.context?.fileError;
      if (!result.success && errorMsg) {
        await this.storeNote(workflow, todo.id, `执行错误: ${errorMsg}。请检查命令是否正确，文件是否存在。`);
        todo.status = 'pending';
        todo.error = errorMsg;
        await this.sendWorkflowUpdate(workflow, `任务 "${todo.content}" 执行失败，将重试`);
        return;
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
    if (completionRate >= 0.8) {
      todo.status = 'completed';
      this.sendWorkflowUpdate(workflow, `任务 "${todo.content}" 已完成`);
    } else if (completionRate >= 0.5) {
      this.sendWorkflowUpdate(workflow, `任务 "${todo.content}" 进行中 (完成度: ${(completionRate * 100).toFixed(0)}%)`);
    } else {
      this.sendWorkflowUpdate(workflow, `任务 "${todo.content}" 需要更多步骤`);
    }
  }

  buildTodoPrompt(workflow, todo, notesText = '') {
    const errorNotes = notesText ? notesText.split('\n').filter(n => n.includes('执行错误') || n.includes('错误')).slice(0, 3).join('\n') : '';
    const recentNotes = notesText ? notesText.split('\n').slice(0, 5).join('\n') : '';
    const hasErrors = errorNotes.length > 0;
    const completedCount = workflow.todos.filter(t => t.status === 'completed').length;
    const totalCount = workflow.todos.length;

    return `【目标】${workflow.goal}
【任务】${todo.content}
【进度】${completedCount}/${totalCount}已完成
${hasErrors ? `【错误】（需修复）\n${errorNotes}\n` : ''}${recentNotes ? `【笔记】\n${recentNotes}\n` : ''}【要求】
1. ${hasErrors ? '**优先修复错误**，然后继续' : '分析任务→执行操作→评估完成度'}
2. 执行操作使用命令格式
3. 输出：完成度评估/执行动作/下一步建议/笔记`;
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
- 执行多步骤工作流：分析→执行→评估
- 笔记功能：记录重要信息供后续步骤共享（格式：笔记: [内容]）
- 错误处理：执行失败时记录错误到笔记，下次调用会看到错误并重试

${functionsPrompt ? `${functionsPrompt}\n\n` : ''}【输出格式】
完成度评估: [0-1]
执行动作: [命令格式]
下一步建议: [描述/无]
笔记: [内容/无]`;
  }

  parseAIResponse(response, workflow, todo) {
    const completionMatch = response.match(/完成度评估:\s*([0-9.]+)/);
    const completion = completionMatch ? parseFloat(completionMatch[1]) : 0.5;

    const nextStepMatch = response.match(/下一步建议:\s*(.+?)(?:\n|$)/);
    const nextStep = nextStepMatch && !nextStepMatch[1].includes('无') ? nextStepMatch[1].trim() : null;

    const noteMatch = response.match(/笔记:\s*(.+?)(?:\n\n|\n完成度|\n执行动作|\n下一步|$)/s);
    const note = noteMatch && !noteMatch[1].includes('无') ? noteMatch[1].trim() : null;

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
    const completedKeywords = ['完成', '成功', '已', 'done', 'success', 'finished'];
    const failedKeywords = ['失败', '错误', '无法', 'failed', 'error', 'cannot'];
    const lowerResponse = response.toLowerCase();
    let score = 0.5;

    if (completedKeywords.some(kw => lowerResponse.includes(kw))) score += 0.3;
    if (failedKeywords.some(kw => lowerResponse.includes(kw))) score -= 0.3;
    if (todo.result?.executed) score += 0.2;
    if (todo.error) score -= 0.3;

    return Math.max(0, Math.min(1, score));
  }

  async sendWorkflowUpdate(workflow, message) {
    if (!workflow.context.e) return;
    try {
      const statusText = this.getWorkflowStatusText(workflow);
      await workflow.context.e.reply(`[工作流更新]\n${statusText}\n\n${message}`);
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

