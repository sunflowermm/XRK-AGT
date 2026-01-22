import BotUtil from '#utils/botutil.js';
import cfg from '#infrastructure/config/config.js';
import LLMFactory from '#factory/llm/LLMFactory.js';
import MemoryManager from '#infrastructure/aistream/memory-manager.js';
import ToolRegistry from '#infrastructure/aistream/tool-registry.js';
import PromptEngine from '#infrastructure/aistream/prompt-engine.js';
import MonitorService from '#infrastructure/aistream/monitor-service.js';

export default class AIStream {
  /**
   * 构造函数
   * @param {Object} options - 选项
   * @param {string} options.name - 工作流名称
   * @param {string} options.description - 描述
   * @param {string} options.version - 版本
   * @param {string} options.author - 作者
   * @param {number} options.priority - 优先级
   * @param {Object} options.config - 配置
   * @param {Object} options.embedding - Embedding配置
   */
  constructor(options = {}) {
    this.name = options.name || 'base-stream';
    this.description = options.description || '基础工作流';
    this.version = options.version || '1.0.0';
    this.author = options.author || 'unknown';
    this.priority = options.priority || 100;

    this.config = {
      enabled: true,
      temperature: 0.8,
      maxTokens: 6000,
      topP: 0.9,
      presencePenalty: 0.6,
      frequencyPenalty: 0.6,
      ...options.config
    };

    this.functionToggles = options.functionToggles || {};

    this.embeddingConfig = {
      enabled: options.embedding?.enabled ?? true,
      maxContexts: options.embedding?.maxContexts || 5
    };

    this._initialized = false;
  }

  /**
   * 初始化工作流
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initialized) {
      return;
    }

    if (!this.functions) {
      this.functions = new Map();
    }

    if (!this.mcpTools) {
      this.mcpTools = new Map();
    }

    this._initialized = true;
  }

  /**
   * 初始化Embedding（子类可重写）
   * @returns {Promise<void>}
   */
  async initEmbedding() {
    return;
  }

  /**
   * 生成文本向量嵌入
   * @param {string} text - 待向量化的文本
   * @returns {Promise<Array<number>|null>} 向量数组或null
   */
  async generateEmbedding(text) {
    if (!text) return null;
    try {
      const result = await Bot.callSubserver('/api/vector/embed', { body: { texts: [text] } });
      return result.embeddings?.[0]?.embedding || null;
    } catch (error) {
      BotUtil.makeLog('debug', `[${this.name}] 生成Embedding失败: ${error.message}`, 'AIStream');
      return null;
    }
  }

  /**
   * 估算文本token数量
   * @param {string} text - 待估算的文本
   * @returns {number} token数量
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return Math.ceil(chineseChars * 1.5 + englishWords * 1.3 + text.length * 0.3);
  }

  /**
   * 压缩文本到指定长度
   * @param {string} text - 待压缩的文本
   * @param {number} maxLength - 最大长度
   * @returns {string} 压缩后的文本
   */
  compressText(text, maxLength = 150) {
    if (!text || text.length <= maxLength) return text;
    
    const sentences = text.split(/[。！？.!?]/);
    let compressed = '';
    for (const sentence of sentences) {
      if ((compressed + sentence).length > maxLength) break;
      compressed += sentence;
    }
    
    if (compressed.length === 0 || compressed.length > maxLength) {
      compressed = text.substring(0, maxLength - 3) + '...';
    }
    
    return compressed;
  }

  /**
   * 计算两个向量的余弦相似度
   * @param {Array<number>} vecA - 向量A
   * @param {Array<number>} vecB - 向量B
   * @returns {number} 相似度值 (0-1)
   */
  cosineSimilarity(vecA, vecB) {
    if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) {
      return 0;
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * 去重上下文列表
   * @param {Array<Object>} contexts - 上下文列表
   * @returns {Array<Object>} 去重后的上下文列表
   */
  deduplicateContexts(contexts) {
    if (!contexts || contexts.length <= 1) return contexts;
    const seen = new Set();
    return contexts.filter(ctx => {
      const text = (ctx.message || ctx.content || '').toLowerCase();
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    });
  }

  /**
   * 优化上下文列表（去重、压缩、按相似度排序）
   * @param {Array<Object>} contexts - 上下文列表
   * @param {number} maxTokens - 最大token数
   * @returns {Promise<Array<Object>>} 优化后的上下文列表
   */
  async optimizeContexts(contexts, maxTokens = 1500) {
    if (!contexts || contexts.length === 0) return contexts;
    
    let optimized = this.deduplicateContexts(contexts);
    let totalTokens = optimized.reduce((sum, ctx) => {
      const text = ctx.message || ctx.content || '';
      return sum + this.estimateTokens(text);
    }, 0);
    
    if (totalTokens > maxTokens) {
      optimized.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
      
      const compressed = [];
      let currentTokens = 0;
      
      for (const ctx of optimized) {
        const text = ctx.message || ctx.content || '';
        const tokens = this.estimateTokens(text);
        
        if (currentTokens + tokens <= maxTokens) {
          compressed.push(ctx);
          currentTokens += tokens;
        } else {
          const compressedText = this.compressText(text, Math.floor((maxTokens - currentTokens) / 1.5));
          if (compressedText.length > 0) {
            compressed.push({
              ...ctx,
              message: compressedText,
              content: compressedText,
              compressed: true
            });
            break;
          }
        }
      }
      
      optimized = compressed;
    }
    
    return optimized;
  }

  /**
   * 存储消息并生成向量嵌入
   * @param {string} groupId - 群组ID
   * @param {Object} message - 消息对象
   * @returns {Promise<void>}
   */
  async storeMessageWithEmbedding(groupId, message) {
    if (!this.embeddingConfig?.enabled) return;

    const messageText = `${message.nickname}: ${message.message}`;
    const userId = message.user_id || groupId;

    try {
      MemoryManager.addShortTermMemory(userId, {
        role: 'user',
        content: messageText,
        metadata: {
          groupId,
          nickname: message.nickname,
          time: message.time || Date.now(),
          messageId: message.message_id
    }
      });

      await Bot.callSubserver('/api/vector/upsert', {
        body: {
          collection: `memory_${groupId}`,
          documents: [{
            text: messageText,
            metadata: {
              userId,
              nickname: message.nickname,
              time: message.time || Date.now(),
              messageId: message.message_id
            }
          }]
        }
      }).catch(() => {});
    } catch (e) {
      BotUtil.makeLog('debug', `[${this.name}] 存储消息失败: ${e.message}`, 'AIStream');
    }
  }

  /**
   * 存储工作流笔记
   * @param {string} workflowId - 工作流ID
   * @param {string} content - 笔记内容
   * @param {string} source - 来源
   * @param {boolean} isTemporary - 是否临时
   * @returns {Promise<boolean>}
   */
  async storeNote(workflowId, content, source = '', isTemporary = true) {
    if (!global.redis) return false;

    try {
      const key = `ai:notes:${workflowId}`;
      const note = { content, source, time: Date.now(), temporary: isTemporary };
      await global.redis.lPush(key, JSON.stringify(note));
      await global.redis.expire(key, isTemporary ? 1800 : 86400 * 3);
      await global.redis.lTrim(key, 0, 99);
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `存储笔记失败: ${error.message}`, 'AIStream');
      return false;
    }
  }

  /**
   * 如果存在工作流ID则存储笔记
   * @param {Object} context - 上下文
   * @param {string} content - 笔记内容
   * @param {string} source - 来源
   * @param {boolean} isTemporary - 是否临时
   * @returns {Promise<boolean>}
   */
  async storeNoteIfWorkflow(context, content, source = '', isTemporary = true) {
    if (context?.workflowId) {
      return await this.storeNote(context.workflowId, content, source, isTemporary);
    }
    return false;
  }

  /**
   * 获取工作流笔记
   * @param {string} workflowId - 工作流ID
   * @returns {Promise<Array<Object>>}
   */
  async getNotes(workflowId) {
    try {
      const userId = workflowId || 'default';
      const shortTerm = MemoryManager.getShortTermMemories(userId, 100);
      return shortTerm
        .filter(m => m.metadata?.workflowId === workflowId)
        .map(m => ({
          content: m.content,
          source: m.metadata?.source || '',
          time: m.timestamp,
          temporary: m.metadata?.temporary || false
        }));
    } catch (e) {
      return [];
    }
  }

  /**
   * 存储工作流记忆
   * @param {string} workflowId - 工作流ID
   * @param {Object} data - 数据
   * @returns {Promise<boolean>}
   */
  async storeWorkflowMemory(workflowId, data) {
    try {
      const userId = workflowId || 'default';
      await MemoryManager.addLongTermMemory(userId, {
        content: JSON.stringify(data),
        type: 'workflow',
        importance: 0.6,
        metadata: { workflowId, ...data }
      });
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `存储工作流记忆失败: ${error.message}`, 'AIStream');
      return false;
    }
  }

  /**
   * 获取工作流记忆
   * @param {string} workflowId - 工作流ID
   * @returns {Promise<Object|null>}
   */
  async getWorkflowMemory(workflowId) {
    try {
      const userId = workflowId || 'default';
      const memories = await MemoryManager.searchLongTermMemories(userId, workflowId, 1);
      if (memories.length > 0 && memories[0].metadata?.workflowId === workflowId) {
        return memories[0].metadata;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 检索相关上下文（历史对话）
   * @param {string} groupId - 群组ID
   * @param {string} query - 查询文本
   * @param {boolean} includeNotes - 是否包含笔记
   * @param {string|null} workflowId - 工作流ID
   * @returns {Promise<Array<Object>>}
   */
  async retrieveRelevantContexts(groupId, query, includeNotes = false, workflowId = null) {
    if (!query) return [];

    try {
      const userId = groupId.replace(/^memory_/, '');
      const memories = await MemoryManager.searchLongTermMemories(userId, query, 5);
      
      if (memories.length > 0) {
        return memories.map(m => ({
          message: m.content,
          similarity: m.importance || 0.8,
          time: m.timestamp,
          userId: m.userId,
          nickname: ''
        }));
      }

      const result = await Bot.callSubserver('/api/vector/search', {
        body: { query, collection: `memory_${groupId}`, top_k: 5 }
      }).catch(() => ({ results: [] }));
      
      return result.results?.map(r => ({
        message: r.text,
        similarity: r.score || 0,
        time: r.metadata?.time || Date.now(),
        userId: r.metadata?.userId,
        nickname: r.metadata?.nickname
      })) || [];
    } catch (error) {
      BotUtil.makeLog('debug', `[${this.name}] 检索上下文失败: ${error.message}`, 'AIStream');
      return [];
    }
  }

  /**
   * 检索知识库上下文
   * @param {string} query - 查询文本
   * @returns {Promise<Array<Object>>}
   */
  async retrieveKnowledgeContexts(query) {
    if (!this._mergedStreams || !query) return [];

    // 从合并的工作流中查找支持知识检索的工作流
    for (const stream of this._mergedStreams) {
      if (typeof stream.retrieveKnowledgeContexts === 'function') {
        const maxContexts = this.embeddingConfig?.maxContexts || 3;
        const contexts = await stream.retrieveKnowledgeContexts(query, maxContexts);
        if (contexts && contexts.length > 0) {
          return contexts;
        }
      }
    }
    return [];
  }

  /**
   * 构建增强上下文（RAG）
   * @param {Object} e - 事件对象
   * @param {string|Object} question - 问题
   * @param {Array<Object>} baseMessages - 基础消息列表
   * @returns {Promise<Array<Object>>}
   */
  async buildEnhancedContext(e, question, baseMessages) {
    const groupId = e ? (e.group_id || `private_${e.user_id}`) : 'default';

    let query = '';
    if (typeof question === 'string') {
      query = question;
    } else if (question && typeof question === 'object') {
      query = question.content || question.text || '';
    }

    if (!query && Array.isArray(baseMessages)) {
      for (let i = baseMessages.length - 1; i >= 0; i--) {
        const msg = baseMessages[i];
        if (msg.role === 'user') {
          if (typeof msg.content === 'string') {
            query = msg.content;
            break;
          } else if (msg.content?.text) {
            query = msg.content.text;
            break;
          }
        }
      }
    }

    if (!query) {
      return baseMessages;
    }

    try {
      const historyContexts = this.embeddingConfig?.enabled
        ? await this.retrieveRelevantContexts(groupId, query)
        : [];

      const knowledgeContexts = await this.retrieveKnowledgeContexts(query);
      const allContexts = [
        ...historyContexts.map(ctx => ({
          type: 'history',
          message: ctx.message,
          similarity: ctx.similarity || 0,
          source: '历史对话'
        })),
        ...knowledgeContexts.map(ctx => ({
          type: 'knowledge',
          message: ctx.content,
          similarity: ctx.similarity || 0.5,
          source: ctx.source || '知识库'
        }))
      ];

      const optimizedContexts = allContexts.slice(0, 5);
      if (optimizedContexts.length === 0) return baseMessages;

      const enhanced = [...baseMessages];
      const contextParts = [];
      const historyItems = optimizedContexts.filter(c => c.type === 'history');
      const knowledgeItems = optimizedContexts.filter(c => c.type === 'knowledge');

      if (historyItems.length > 0) {
        contextParts.push(
          '【相关历史对话】',
          historyItems.map((ctx, i) =>
            `${i + 1}. ${this.compressText(ctx.message, 120)}${ctx.similarity ? ` (相关度: ${(ctx.similarity * 100).toFixed(0)}%)` : ''}`
          ).join('\n')
        );
      }

      if (knowledgeItems.length > 0) {
        contextParts.push(
          '【相关知识库】',
          knowledgeItems.map((ctx, i) =>
            `${i + 1}. [${ctx.source}] ${this.compressText(ctx.message, 120)}`
          ).join('\n')
        );
      }

      if (contextParts.length > 0) {
        const contextPrompt = contextParts.join('\n\n') + '\n\n以上是相关上下文，可参考但不要重复。\n';

        if (enhanced[0]?.role === 'system') {
          enhanced[0].content += contextPrompt;
        } else {
          enhanced.unshift({
            role: 'system',
            content: contextPrompt
          });
        }
      }

      return enhanced;
    } catch (error) {
      BotUtil.makeLog('debug',
        `[${this.name}] 构建上下文失败: ${error.message}`,
        'AIStream'
      );
      return baseMessages;
    }
  }

  /**
   * 注册函数（Call Function，用于AI调用）
   * @param {string} name - 函数名称
   * @param {Object} options - 选项
   * @param {Function} options.handler - 处理函数
   * @param {string|Function} options.prompt - 提示文本
   * @param {Function} options.parser - 解析函数
   * @param {boolean} options.enabled - 是否启用
   * @param {string} options.permission - 权限要求
   * @param {string} options.description - 描述
   */
  registerFunction(name, options = {}) {
    const {
      handler,
      prompt = '',
      parser = null,
      enabled = true,
      permission = null,
      description = ''
    } = options;

    const resolvedPrompt = typeof prompt === 'function' ? prompt() : prompt;

    const funcDef = {
      name,
      handler,
      prompt: resolvedPrompt,
      parser,
      enabled: this.functionToggles[name] ?? enabled,
      permission,
      description,
      ...Object.fromEntries(
        Object.entries(options).filter(([key]) => 
          !['handler', 'prompt', 'parser', 'enabled', 'permission', 'description'].includes(key)
        )
      )
    };

    this.functions.set(name, funcDef);

    // 注册到 ToolRegistry（用于AI调用）
    // ToolRegistry.registerTool 内部已有重复检查，这里直接注册即可
    if (handler) {
      ToolRegistry.registerTool(`${this.name}.${name}`, {
        description: description || resolvedPrompt,
        schema: options.schema || {},
        handler: async (args, ctx) => {
          return await handler(args, { ...ctx, stream: this });
        },
        category: this.name,
        permissions: permission ? { roles: [permission] } : { public: true }
      });
    }
  }

  /**
   * 注册MCP工具（MCP Protocol，用于外部工具调用）
   * @param {string} name - 工具名称
   * @param {Object} options - 选项
   * @param {Function} options.handler - 处理函数
   * @param {string} options.description - 描述
   * @param {Object} options.inputSchema - 输入Schema（JSON Schema格式）
   * @param {boolean} options.enabled - 是否启用
   */
  registerMCPTool(name, options = {}) {
    const {
      handler,
      description = '',
      inputSchema = {},
      enabled = true
    } = options;

    const toolDef = {
      name,
      handler,
      description,
      inputSchema,
      enabled: this.functionToggles[name] ?? enabled
    };

    this.mcpTools.set(name, toolDef);
  }

  /**
   * 检查函数是否启用
   * @param {string} name - 函数名称
   * @returns {boolean}
   */
  isFunctionEnabled(name) {
    const func = this.functions.get(name);
    return func?.enabled ?? false;
  }

  /**
   * 切换函数启用状态
   * @param {string} name - 函数名称
   * @param {boolean} enabled - 是否启用
   */
  toggleFunction(name, enabled) {
    const func = this.functions.get(name);
    if (func) {
      func.enabled = enabled;
      this.functionToggles[name] = enabled;
    }
  }

  /**
   * 获取所有启用的函数
   * @returns {Array<Object>}
   */
  getEnabledFunctions() {
    return Array.from(this.functions.values()).filter(f => f.enabled);
  }

  /**
   * 合并工作流
   * @param {Object} stream - 要合并的工作流
   * @param {Object} options - 选项
   * @param {boolean} options.overwrite - 是否覆盖
   * @param {string} options.prefix - 前缀
   * @returns {Object}
   */
  merge(stream, options = {}) {
    const { overwrite = false, prefix = '' } = options;

    if (!stream) {
      throw new Error('无效的 Stream 实例');
    }

    if (!this._mergedStreams) {
      this._mergedStreams = [];
    }
    if (!this._mergedStreams.includes(stream)) {
      this._mergedStreams.push(stream);
    }

    let mergedCount = 0;
    let skippedCount = 0;

    // 合并函数（Call Functions）
    if (stream.functions) {
      for (const [name, func] of stream.functions.entries()) {
        const newName = prefix ? `${prefix}${name}` : name;

        if (this.functions.has(newName) && !overwrite) {
          skippedCount++;
          continue;
        }

        this.functions.set(newName, func);
        mergedCount++;
      }
    }

    // 合并MCP工具
    if (stream.mcpTools) {
      if (!this.mcpTools) {
        this.mcpTools = new Map();
      }

      for (const [name, tool] of stream.mcpTools.entries()) {
        const newName = prefix ? `${prefix}${name}` : name;

        if (this.mcpTools.has(newName) && !overwrite) {
          skippedCount++;
          continue;
        }

        this.mcpTools.set(newName, tool);
        mergedCount++;
      }
    }

    BotUtil.makeLog('debug', `[${this.name}] 合并 ${stream.name}: 成功 ${mergedCount}, 跳过 ${skippedCount}`, 'AIStream');

    return { mergedCount, skippedCount };
  }

  /**
   * 构建系统提示（子类可重写）
   * @param {Object} context - 上下文
   * @returns {string}
   */
  buildSystemPrompt(context) {
    return '';
  }

  /**
   * 构建函数提示列表
   * @returns {string}
   */
  buildFunctionsPrompt() {
    const enabledFuncs = this.getEnabledFunctions();
    const toolPrompts = ToolRegistry.getAllTools({ enabled: true })
      .map(t => `- ${t.name}: ${t.description}`)
      .join('\n');

    if (enabledFuncs.length === 0 && !toolPrompts) return '';

    const prompts = enabledFuncs
      .filter(f => f.prompt)
      .map(f => typeof f.prompt === 'function' ? f.prompt() : f.prompt)
      .join('\n');

    const combined = [prompts, toolPrompts].filter(Boolean).join('\n');
    return combined ? `\n【功能列表】\n${combined}` : '';
  }

  /**
   * 构建聊天上下文
   * @param {Object} e - 事件对象
   * @param {string|Object} question - 问题
   * @returns {Promise<Array<Object>>}
   */
  async buildChatContext(e, question) {
    const systemPrompt = await this.buildSystemPrompt({ e, question });
    const promptTemplate = PromptEngine.getTemplate(this.name);
    
    if (promptTemplate) {
      const rendered = PromptEngine.render(this.name, {
        systemPrompt,
        userQuestion: typeof question === 'string' ? question : question?.text || question?.content || ''
      });
      return [{ role: 'system', content: rendered }];
    }

    if (systemPrompt) {
      return [{ role: 'system', content: systemPrompt }];
    }

    return [];
  }

  /**
   * 解析文本中的函数调用
   * @param {string} text - 文本
   * @param {Object} context - 上下文
   * @returns {Object} {functions, cleanText}
   */
  parseFunctions(text, context = {}) {
    let cleanText = text;
    const allFunctions = [];

    for (const func of this.functions.values()) {
      if (!func.enabled || !func.parser) continue;

      const result = func.parser(cleanText, context);
      if (result.functions && result.functions.length > 0) {
        allFunctions.push(...result.functions);
      }
      if (result.cleanText !== undefined) {
        cleanText = result.cleanText;
      }
    }

    const withOrder = [];
    const withoutOrder = [];

    for (const fn of allFunctions) {
      if (typeof fn.order === 'number') {
        withOrder.push(fn);
      } else {
        withoutOrder.push(fn);
      }
    }

    withOrder.sort((a, b) => a.order - b.order);
    const orderedFunctions = withOrder.concat(withoutOrder);

    return { functions: orderedFunctions, cleanText };
  }


  /**
   * 执行函数（支持合并工作流）
   * @private
   * @param {Object} func - 函数对象
   * @param {Object} context - 上下文
   * @returns {Promise<Object>}
   */
  async _executeFunctionWithMerge(func, context) {
    if (this.functions && this.functions.has(func.type)) {
      return await this.executeFunction(func.type, func.params, context);
    }

    if (this._mergedStreams) {
      for (const mergedStream of this._mergedStreams) {
        if (mergedStream.functions && mergedStream.functions.has(func.type)) {
          return await mergedStream.executeFunction(func.type, func.params, context);
        }
      }
    }

    BotUtil.makeLog('warn', `函数未找到: ${func.type}`, 'AIStream');
    return { success: false, error: `函数未找到: ${func.type}` };
  }

  /**
   * 执行函数
   * @param {string} type - 函数类型
   * @param {Object} params - 参数
   * @param {Object} context - 上下文
   * @returns {Promise<Object>}
   */
  async executeFunction(type, params, context) {
    const func = this.functions.get(type);

    if (!func || !func.enabled) {
      return { success: false, error: '函数不存在或已禁用' };
    }

    const validation = await this.validateFunctionParams(func, params, context);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    if (func.permission && !(await this.checkPermission(func.permission, context))) {
      return { success: false, error: '权限不足' };
    }

    try {
      const traceId = MonitorService.startTrace(`${this.name}.${type}`, {
        agentId: context.e?.user_id,
        workflow: this.name,
        userId: context.e?.user_id
      });

      const result = func.handler ? await func.handler(validation.params || params, context) : null;
      
      MonitorService.recordToolCall(traceId, { name: type, params, result });
      MonitorService.endTrace(traceId, { success: true, result });

      const toolStats = ToolRegistry.toolStats?.get(type);
      if (toolStats) toolStats.callCount++;
      
      return { success: true, result };
    } catch (error) {
      MonitorService.recordError(`${this.name}.${type}`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 验证函数参数
   * @param {Object} func - 函数定义
   * @param {Object} params - 参数
   * @param {Object} context - 上下文
   * @returns {Promise<Object>}
   */
  async validateFunctionParams(func, params, context) {
    if (func.requiredParams) {
      for (const required of func.requiredParams) {
        if (params[required] === undefined || params[required] === null) {
          return { valid: false, error: `缺少必需参数: ${required}` };
        }
      }
    }
    return { valid: true, params };
  }

  /**
   * 执行函数列表（ReAct模式）
   * @param {Array<Object>} functions - 函数列表
   * @param {Object} context - 上下文
   * @param {string|Object} question - 问题
   * @returns {Promise<void>}
   */
  async executeFunctionsWithReAct(functions, context, question) {
    if (!functions || functions.length === 0) return;
    for (const func of functions) {
      await this._executeFunctionWithMerge(func, context);
    }
  }

  /**
   * 检查权限
   * @param {string} permission - 权限类型
   * @param {Object} context - 上下文
   * @returns {Promise<boolean>}
   */
  async checkPermission(permission, context) {
    const { e } = context;
    if (!e?.isGroup) return false;
    if (e.isMaster) return true;

    try {
      const member = e.group?.pickMember(e.self_id);
      let info = null;
      if (member) {
        try {
          info = await member.getInfo();
        } catch (e) {
          info = null;
        }
      }
      const role = info?.role || 'member';

      switch (permission) {
        case 'admin':
        case 'mute':
          return role === 'owner' || role === 'admin';
        case 'owner':
          return role === 'owner';
        default:
          return true;
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取重试配置
   * @returns {Object}
   */
  getRetryConfig() {
    const runtime = cfg.aistream || {};
    const llm = runtime.llm || {};
    const retryConfig = llm.retry || {};
    return {
      enabled: retryConfig.enabled !== false, // 默认启用
      maxAttempts: retryConfig.maxAttempts || 3,
      delay: retryConfig.delay || 2000,
      maxDelay: retryConfig.maxDelay || 10000, // 最大延迟
      backoffMultiplier: retryConfig.backoffMultiplier || 2, // 指数退避倍数
      retryOn: retryConfig.retryOn || ['timeout', 'network', '5xx', 'rate_limit']
    };
  }

  /**
   * 计算重试延迟（指数退避）
   * @param {number} attempt - 重试次数
   * @param {Object} retryConfig - 重试配置
   * @returns {number}
   */
  calculateRetryDelay(attempt, retryConfig) {
    const baseDelay = retryConfig.delay || 2000;
    const multiplier = retryConfig.backoffMultiplier || 2;
    const maxDelay = retryConfig.maxDelay || 10000;
    
    const delay = Math.min(baseDelay * Math.pow(multiplier, attempt - 1), maxDelay);
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    
    return Math.max(0, delay + jitter);
  }

  /**
   * 分类错误类型
   * @param {Error} error - 错误对象
   * @returns {Object}
   */
  classifyError(error) {
    if (!error) {
      return {
        isTimeout: false,
        isNetwork: false,
        is5xx: false,
        is4xx: false,
        isRateLimit: false,
        isAuth: false,
        originalError: error
      };
    }

    const message = error?.message?.toLowerCase() || '';
    const code = error?.code?.toLowerCase() || '';
    const status = error?.status || error?.statusCode || 0;
    const name = error?.name?.toLowerCase() || '';
    
    return {
      isTimeout: name === 'aborterror' || 
                 name === 'timeouterror' ||
                 message.includes('timeout') || 
                 message.includes('超时') || 
                 message.includes('timed out') ||
                 code === 'timeout' || 
                 code === 'etimedout',
      isNetwork: message.includes('network') || 
                 message.includes('网络') || 
                 message.includes('连接') || 
                 message.includes('connection') ||
                 code === 'econnrefused' ||
                 code === 'enotfound' ||
                 code === 'econnreset',
      is5xx: /^5\d{2}$/.test(status) || 
             code === '5xx' ||
             (status >= 500 && status < 600),
      is4xx: /^4\d{2}$/.test(status) || 
             code === '4xx' ||
             (status >= 400 && status < 500),
      isRateLimit: status === 429 || 
                   message.includes('rate limit') ||
                   message.includes('限流') ||
                   message.includes('too many requests'),
      isAuth: status === 401 || 
              status === 403 ||
              message.includes('unauthorized') ||
              message.includes('forbidden') ||
              message.includes('认证') ||
              message.includes('权限'),
      originalError: error
    };
  }

  /**
   * 判断是否应该重试
   * @param {Object} errorInfo - 错误信息
   * @param {Object} retryConfig - 重试配置
   * @param {number} attempt - 当前重试次数
   * @returns {boolean}
   */
  shouldRetry(errorInfo, retryConfig, attempt) {
    if (!retryConfig.enabled || attempt >= retryConfig.maxAttempts) {
      return false;
    }
    
    if (errorInfo.isAuth) {
      return false;
    }
    
    const { isTimeout, isNetwork, is5xx, isRateLimit } = errorInfo;
    const { retryOn } = retryConfig;
    
    return (
      (isTimeout && retryOn.includes('timeout')) ||
      (isNetwork && retryOn.includes('network')) ||
      (is5xx && retryOn.includes('5xx')) ||
      (isRateLimit && retryOn.includes('rate_limit')) ||
      (retryOn.includes('all'))
    );
  }

  getTimeoutSeconds(config) {
    const timeout = config.timeout || this.config?.timeout || 360000;
    return Math.round(timeout / 1000);
  }

  /**
   * 调用AI（非流式）
   * @param {Array<Object>} messages - 消息列表
   * @param {Object} apiConfig - API配置
   * @returns {Promise<string>}
   */
  async callAI(messages, apiConfig = {}) {
    const config = this.resolveLLMConfig(apiConfig);
    
    try {
      const payload = {
        messages,
        model: config.chatModel || config.model || config.provider,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: false
      };

      const response = await Bot.callSubserver('/api/langchain/chat', {
        body: payload
      });

      return response.choices?.[0]?.message?.content || response.content || '';
    } catch (error) {
      BotUtil.makeLog('warn', `子服务端调用失败，回退到LLM工厂: ${error.message}`, 'AIStream');
    }
    const retryConfig = this.getRetryConfig();

    const inputTokens = messages.reduce((sum, m) => sum + this.estimateTokens(m.content || ''), 0);
    MonitorService.recordTokens(`${this.name}.callAI`, { input: inputTokens });

    let lastError = null;
    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const client = LLMFactory.createClient(config);
        const response = await client.chat(messages, config);
        
        const outputTokens = this.estimateTokens(response);
        MonitorService.recordTokens(`${this.name}.callAI`, { output: outputTokens });
        
        return response;
      } catch (error) {
        lastError = error;
        const errorInfo = this.classifyError(error);
        const timeoutSeconds = this.getTimeoutSeconds(config);
        const shouldRetry = this.shouldRetry(errorInfo, retryConfig, attempt);
        
        if (errorInfo.isTimeout) {
          BotUtil.makeLog('warn', 
            `[${this.name}] AI调用超时（${timeoutSeconds}秒）${shouldRetry ? `，正在重试 (${attempt}/${retryConfig.maxAttempts})` : ''}: ${error.message || '请求被中止'}`,
            'AIStream'
          );
        } else {
          BotUtil.makeLog('warn', 
            `[${this.name}] AI调用失败${shouldRetry ? `，正在重试 (${attempt}/${retryConfig.maxAttempts})` : ''}: ${error.message || '未知错误'}`,
            'AIStream'
          );
        }
        
        if (shouldRetry) {
          await BotUtil.sleep(retryConfig.delay);
          continue;
        }
        
        if (errorInfo.isTimeout) {
          BotUtil.makeLog('error', 
            `[${this.name}] AI调用超时（${timeoutSeconds}秒），已重试${attempt}次`,
            'AIStream'
          );
          throw new Error(`AI调用超时（${timeoutSeconds}秒），已重试${attempt}次，请稍后重试`);
        }
        
        BotUtil.makeLog('error', 
          `[${this.name}] AI调用失败: ${error.message || '未知错误'}`,
          'AIStream'
        );
        
        return null;
      }
    }
    
    if (lastError) {
      const timeoutSeconds = this.getTimeoutSeconds(config);
      BotUtil.makeLog('error', 
        `[${this.name}] AI调用失败，已重试${retryConfig.maxAttempts}次: ${lastError.message || '未知错误'}`,
        'AIStream'
      );
      throw new Error(`AI调用失败，已重试${retryConfig.maxAttempts}次，请检查网络连接或稍后重试`);
    }
    
    return null;
  }

  /**
   * 调用AI（流式）
   * @param {Array<Object>} messages - 消息列表
   * @param {Object} apiConfig - API配置
   * @param {Function} onDelta - 增量回调
   * @param {Object} options - 选项
   * @returns {Promise<string>}
   */
  async callAIStream(messages, apiConfig = {}, onDelta, options = {}) {
    const config = this.resolveLLMConfig(apiConfig);
    
    try {
      const payload = {
        messages,
        model: config.chatModel || config.model || config.provider,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: true
      };

      const response = await Bot.callSubserver('/api/langchain/chat', {
        body: payload,
        rawResponse: true
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') break;
            
            try {
              const json = JSON.parse(dataStr);
              const delta = json.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullText += delta;
                if (typeof onDelta === 'function') onDelta(delta);
              }
            } catch (e) {}
          }
        }
      }

      return fullText;
    } catch (error) {
      BotUtil.makeLog('warn', `子服务端流式调用失败，回退到LLM工厂: ${error.message}`, 'AIStream');
    }
    const retryConfig = this.getRetryConfig();

    let fullText = '';
    const wrapDelta = (delta) => {
      if (!delta) return;
      fullText += delta;
      if (typeof onDelta === 'function') onDelta(delta);
    };

    let lastError = null;
    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const client = LLMFactory.createClient(config);
        await client.chatStream(messages, wrapDelta, config);
        break; // 成功，退出重试循环
      } catch (error) {
        lastError = error;
        const errorInfo = this.classifyError(error);
        const timeoutSeconds = this.getTimeoutSeconds(config);
        const shouldRetry = this.shouldRetry(errorInfo, retryConfig, attempt);
        
        if (errorInfo.isTimeout) {
          BotUtil.makeLog('warn', 
            `[${this.name}] AI流式调用超时（${timeoutSeconds}秒）${shouldRetry ? `，正在重试 (${attempt}/${retryConfig.maxAttempts})` : ''}: ${error.message || '请求被中止'}`,
            'AIStream'
          );
        } else {
          BotUtil.makeLog('warn', 
            `[${this.name}] AI流式调用失败${shouldRetry ? `，正在重试 (${attempt}/${retryConfig.maxAttempts})` : ''}: ${error.message || '未知错误'}`,
            'AIStream'
          );
        }
        
        if (shouldRetry) {
          fullText = '';
          await BotUtil.sleep(retryConfig.delay);
          continue;
        }
        
        if (errorInfo.isTimeout) {
          BotUtil.makeLog('error', 
            `[${this.name}] AI流式调用超时（${timeoutSeconds}秒），已重试${attempt}次`,
            'AIStream'
          );
          throw new Error(`AI流式调用超时（${timeoutSeconds}秒），已重试${attempt}次，请稍后重试`);
        }
        
        BotUtil.makeLog('error', 
          `[${this.name}] AI流式调用失败: ${error.message || '未知错误'}`,
          'AIStream'
        );
        throw error;
      }
    }
    
    if (lastError) {
      const timeoutSeconds = this.getTimeoutSeconds(config);
      BotUtil.makeLog('error', 
        `[${this.name}] AI流式调用失败，已重试${retryConfig.maxAttempts}次: ${lastError.message || '未知错误'}`,
        'AIStream'
      );
      throw new Error(`AI流式调用失败，已重试${retryConfig.maxAttempts}次，请检查网络连接或稍后重试`);
    }

    if (!options.enableFunctionCalling || !fullText) {
      return fullText;
    }

    const context = options.context || {};
    const { functions, cleanText } = this.parseFunctions(fullText, context);

    for (const func of functions) {
      await this.executeFunction(func.type, func.params, context);
    }

    return cleanText || fullText;
  }

  /**
   * 解析LLM配置（标准化配置合并）
   * @param {Object} apiConfig - API配置
   * @returns {Object}
   */
  resolveLLMConfig(apiConfig = {}) {
    const runtime = cfg.aistream || {};
    const llm = runtime.llm || {};
    const vision = runtime.vision || {};
    const global = runtime.global || {};

    // 获取提供商名称（支持从多个来源获取）
    const provider = (apiConfig.provider || this.config.provider || llm.provider || llm.Provider || '').toLowerCase();
    const visionProvider = (apiConfig.visionProvider || this.config.visionProvider || vision.provider || vision.Provider || provider).toLowerCase();
    
    // 动态获取提供商配置（从配置系统）
    const providerConfig = this.getProviderConfig(provider, llm);
    const visionConfig = this.getProviderConfig(visionProvider, vision, true);

    // 验证提供商是否支持
    if (provider && !LLMFactory.hasProvider(provider)) {
      BotUtil.makeLog('error', `不支持的LLM提供商: ${provider}`, 'AIStream');
      throw new Error(`不支持的LLM提供商: ${provider}`);
    }

    // 解析超时配置（支持多级回退）
    const timeout = apiConfig.timeout || 
                    this.config.timeout ||
                    (llm.timeout && typeof llm.timeout === 'number' ? llm.timeout : null) ||
                    (global.maxTimeout && typeof global.maxTimeout === 'number' ? global.maxTimeout : null) ||
                    360000;

    // 标准化配置合并：优先级 apiConfig > this.config > providerConfig
    // 确保关键字段（apiKey、chatModel、visionModel）不被空值覆盖
    const finalConfig = {
      ...providerConfig,
      ...this.config,
      ...apiConfig,
      // 确保apiKey不被空值或空字符串覆盖
      apiKey: (apiConfig.apiKey && apiConfig.apiKey.trim()) || 
              (providerConfig.apiKey && providerConfig.apiKey.trim()) || 
              (this.config.apiKey && this.config.apiKey.trim()) || 
              undefined,
      // 确保模型名称正确传递（支持 chatModel 和 model 两种字段名）
      model: apiConfig.model || apiConfig.chatModel || this.config.model || this.config.chatModel || providerConfig.chatModel || providerConfig.model,
      chatModel: apiConfig.chatModel || this.config.chatModel || providerConfig.chatModel || apiConfig.model || this.config.model || providerConfig.model,
      provider,
      visionProvider,
      visionConfig,
      timeout
    };

    return finalConfig;
  }

  /**
   * 获取提供商配置（标准化配置解析）
   * @param {string} provider - 提供商名称
   * @param {Object} runtimeConfig - 运行时配置（已废弃，保留以兼容旧代码）
   * @param {boolean} isVision - 是否为视觉配置
   * @returns {Object} 提供商配置
   */
  getProviderConfig(provider, runtimeConfig = {}, isVision = false) {
    if (!provider) return {};

    // 从全局配置获取（支持命名约定：{provider}_llm 或 {provider}_vision）
    const configKey = isVision 
      ? `${provider}_vision` 
      : `${provider}_llm`;
    
    if (cfg[configKey] && typeof cfg[configKey] === 'object') {
      return cfg[configKey];
    }

    return {};
  }

  /**
   * 执行工作流
   * @param {Object} e - 事件对象
   * @param {string|Object} question - 问题
   * @param {Object} config - 配置
   * @returns {Promise<string|null>}
   */
  async execute(e, question, config) {
    const traceId = MonitorService.startTrace(this.name, {
      agentId: e?.user_id,
      workflow: this.name,
      userId: e?.user_id
    });

    try {
      const context = { e, question, config };
      if (this.tools) {
        context.tools = this.tools;
      }
      
      const baseMessages = await this.buildChatContext(e, question);
      const messages = await this.buildEnhancedContext(e, question, baseMessages);
      
      MonitorService.addStep(traceId, { step: 'build_context', messages: messages.length });
      
      const response = await this.callAI(messages, config);
      MonitorService.addStep(traceId, { step: 'ai_call', responseLength: response?.length || 0 });

      if (!response) {
        MonitorService.endTrace(traceId, { success: false, error: 'No response' });
        return null;
      }

      const { functions, cleanText } = this.parseFunctions(response, context);

      if (cleanText && cleanText.trim() && e?.reply) {
        await e.reply(cleanText.trim()).catch(err => {
          BotUtil.makeLog('debug', `发送自然语言回复失败: ${err.message}`, 'AIStream');
        });
      }

      if (functions.length > 0) {
        MonitorService.addStep(traceId, { step: 'execute_functions', count: functions.length });
        await this.executeFunctionsWithReAct(functions, context, question);
      }

      if (context.tools && typeof context.tools.cleanupProcesses === 'function') {
        try {
          await context.tools.cleanupProcesses();
        } catch (err) {}
      }

      const finalResponse = cleanText || '';

      if (this.embeddingConfig.enabled && finalResponse && e) {
        const groupId = e.group_id || `private_${e.user_id}`;
        const executedFunctions = functions.length > 0
          ? `[执行了: ${functions.map(f => f.type).join(', ')}] `
          : '';
        this.storeMessageWithEmbedding(groupId, {
          user_id: e.self_id,
          nickname: e.bot?.nickname || e.bot?.info?.nickname || 'Bot',
          message: `${executedFunctions}${finalResponse}`,
          message_id: Date.now().toString(),
          time: Date.now()
        }).catch(() => { });
      }

      MonitorService.endTrace(traceId, { success: true, response: finalResponse });
      return finalResponse;
    } catch (error) {
      MonitorService.recordError(traceId, error);
      MonitorService.endTrace(traceId, { success: false, error: error.message });
      BotUtil.makeLog('error',
        `工作流执行失败[${this.name}]: ${error.message}`,
        'AIStream'
      );
      return null;
    }
  }

  /**
   * 处理请求（支持工作流合并）
   * @param {Object} e - 事件对象
   * @param {string|Object} question - 问题
   * @param {Object} options - 选项
   * @returns {Promise<string|null>}
   */
  async process(e, question, options = {}) {
    try {
      const {
        mergeStreams = [],
        enableTodo = false,
        enableMemory = false,
        enableDatabase = false,
        ...apiConfig
      } = options;

      let StreamLoader = null;
      if (mergeStreams.length > 0 || enableTodo || enableMemory || enableDatabase) {
        StreamLoader = (await import('#infrastructure/aistream/loader.js')).default;
      }

      let stream = this;
      
      // 提取需要自动合并的工作流
      const auxiliaryOptions = {};
      if (enableMemory) auxiliaryOptions.enableMemory = true;
      if (enableDatabase) auxiliaryOptions.enableDatabase = true;
      
      if (Object.keys(auxiliaryOptions).length > 0) {
        await this.autoMergeAuxiliaryStreams(stream, auxiliaryOptions);
      }
      
      if (mergeStreams.length > 0) {
        const mergedName = `${this.name}-${mergeStreams.join('-')}`;
        stream = StreamLoader.getStream(mergedName) ||
          StreamLoader.mergeStreams({
            name: mergedName,
            main: this.name,
            secondary: mergeStreams,
            prefixSecondary: true
          });
        await this.ensureWorkflowManager(stream, { workflowManagerSource: 'todo' });
      }

      const finalQuestion = typeof question === 'string' 
        ? question 
        : (question?.content || question?.text || question);
      
      return await stream.execute(e, finalQuestion, apiConfig);
    } catch (error) {
      BotUtil.makeLog('error', `工作流处理失败[${this.name}]: ${error.message}`, 'AIStream');
      return null;
    }
  }

  /**
   * 获取工作流信息
   * @returns {Object}
   */
  getInfo() {
    return {
      name: this.name,
      description: this.description,
      version: this.version,
      author: this.author,
      priority: this.priority,
      embedding: {
        enabled: this.embeddingConfig?.enabled || false,
        maxContexts: this.embeddingConfig?.maxContexts || 5
      },
      functions: Array.from(this.functions.values()).map(f => ({
        name: f.name,
        description: f.description,
        enabled: f.enabled,
        permission: f.permission
      }))
    };
  }

  /**
   * 确保工作流管理器存在
   * @param {Object} stream - 工作流实例
   * @param {Object} options - 选项
   * @param {string} options.workflowManagerSource - 工作流管理器来源工作流名称
   * @returns {Promise<void>}
   */
  async ensureWorkflowManager(stream, options = {}) {
    if (stream.workflowManager) {
      stream.workflowManager.stream = stream;
      return;
    }
    
    const StreamLoader = (await import('#infrastructure/aistream/loader.js')).default;
    const sourceStreamName = options.workflowManagerSource || 'todo';
    
    // 从指定工作流或合并的工作流中查找工作流管理器
    const sourceStream = StreamLoader.getStream(sourceStreamName);
    if (sourceStream?.workflowManager && typeof sourceStream.injectWorkflowManager === 'function') {
      sourceStream.injectWorkflowManager(stream);
      return;
    }
    
    // 从合并的工作流中查找
    if (this._mergedStreams) {
      for (const mergedStream of this._mergedStreams) {
        if (mergedStream.workflowManager && typeof mergedStream.injectWorkflowManager === 'function') {
          mergedStream.injectWorkflowManager(stream);
          return;
        }
      }
    }
  }


  /**
   * 自动合并辅助工作流
   * @param {Object} stream - 工作流实例
   * @param {Object} options - 选项
   * @returns {Promise<void>}
   */
  async autoMergeAuxiliaryStreams(stream, options = {}) {
    const StreamLoader = (await import('#infrastructure/aistream/loader.js')).default;
    
    // 从选项中提取要合并的工作流名称（支持字符串或数组）
    const streamNames = this.extractStreamNames(options);
    
    for (const streamName of streamNames) {
      try {
        let auxStream = StreamLoader.getStream(streamName);
        
        if (!auxStream) {
          const StreamClass = StreamLoader.getStreamClass(streamName);
          if (StreamClass) {
            auxStream = new StreamClass();
            await auxStream.init();
            StreamLoader.streams.set(streamName, auxStream);
          } else {
            BotUtil.makeLog('debug', `[${stream.name}] 工作流 ${streamName} 不存在，跳过`, 'AIStream');
            continue;
          }
        }
        
        stream.merge(auxStream, { prefix: '' });
      } catch (error) {
        BotUtil.makeLog('warn', `[${stream.name}] 自动合并辅助工作流 ${streamName} 失败: ${error.message}`, 'AIStream');
      }
    }
  }

  /**
   * 从选项中提取工作流名称
   * @param {Object} options - 选项对象
   * @returns {Array<string>} 工作流名称列表
   */
  extractStreamNames(options) {
    const names = [];
    
    // 支持多种格式：
    // 1. enableMemory/enableDatabase 等布尔标志
    // 2. streams 数组
    // 3. streamNames 数组
    
    if (options.streams && Array.isArray(options.streams)) {
      names.push(...options.streams);
    }
    
    if (options.streamNames && Array.isArray(options.streamNames)) {
      names.push(...options.streamNames);
    }
    
    // 兼容旧的布尔标志格式
    const booleanFlags = ['memory', 'database', 'todo', 'chat'];
    for (const flag of booleanFlags) {
      const enableKey = `enable${flag.charAt(0).toUpperCase() + flag.slice(1)}`;
      if (options[enableKey] === true) {
        names.push(flag);
      }
    }
    
    return [...new Set(names)]; // 去重
  }

  /**
   * 提取问题文本
   * @param {string|Object} question - 问题
   * @returns {string}
   */
  extractQuestionText(question) {
    if (typeof question === 'string') return question;
    return question?.content || question?.text || '';
  }

  /**
   * 清理资源
   * @returns {Promise<void>}
   */
  async cleanup() {
    BotUtil.makeLog('debug', `[${this.name}] 清理资源`, 'AIStream');
    this._initialized = false;
  }
}