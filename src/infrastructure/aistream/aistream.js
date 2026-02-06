import BotUtil from '#utils/botutil.js';
import cfg from '#infrastructure/config/config.js';
import LLMFactory from '#factory/llm/LLMFactory.js';
import MemoryManager from '#infrastructure/aistream/memory-manager.js';
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
    const totalTokens = optimized.reduce((sum, ctx) => {
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
   * 检索相关上下文（历史对话）
   * @param {string} groupId - 群组ID
   * @param {string} query - 查询文本
   * @returns {Promise<Array<Object>>}
   */
  async retrieveRelevantContexts(groupId, query) {
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
  buildSystemPrompt(_context) {
    return '';
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
        } catch {
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
    } catch {
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
   * 调用AI（非流式，支持tool calling）
   * @param {Array<Object>} messages - 消息列表
   * @param {Object} apiConfig - API配置
   * @returns {Promise<string>}
   */
  async callAI(messages, apiConfig = {}) {
    const config = this.resolveLLMConfig(apiConfig);
    const retryConfig = this.getRetryConfig();

    // 优先使用 Python 子服务端（LangChain生态），失败时回退到 NodeJS LLMFactory
    try {
      const payload = {
        messages,
        model: config.chatModel || config.model || config.provider,
        provider: config.provider,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: false,
        enableTools: config.enableTools !== false
      };
      const response = await Bot.callSubserver('/api/langchain/chat', { body: payload });
      const content = response?.choices?.[0]?.message?.content || response?.content || '';
      if (content) {
        return content;
      }
    } catch (error) {
      BotUtil.makeLog('warn', `[${this.name}] 子服务端调用失败，回退到LLM工厂: ${error.message}`, 'AIStream');
    }

    const inputTokens = messages.reduce((sum, m) => {
      const content = typeof m.content === 'string' ? m.content : (m.content?.text || '');
      return sum + this.estimateTokens(content);
    }, 0);
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
        const shouldRetry = this.shouldRetry(errorInfo, retryConfig, attempt);
        
        if (shouldRetry) {
          const delay = this.calculateRetryDelay(attempt, retryConfig);
          BotUtil.makeLog('warn', 
            `[${this.name}] AI调用失败，${attempt}/${retryConfig.maxAttempts}次重试中: ${error.message}`,
            'AIStream'
          );
          await BotUtil.sleep(delay);
          continue;
        }
        
        // 不再重试，抛出错误
        BotUtil.makeLog('error', 
          `[${this.name}] AI调用失败: ${error.message}`,
          'AIStream'
        );
        throw error;
      }
    }
    
    // 所有重试都失败
    BotUtil.makeLog('error', 
      `[${this.name}] AI调用失败，已重试${retryConfig.maxAttempts}次: ${lastError?.message || '未知错误'}`,
      'AIStream'
    );
    throw new Error(`AI调用失败，已重试${retryConfig.maxAttempts}次: ${lastError?.message || '未知错误'}`);
  }

  /**
   * 调用AI（流式）
   * @param {Array<Object>} messages - 消息列表
   * @param {Object} apiConfig - API配置
   * @param {Function} onDelta - 增量回调
   * @returns {Promise<string>}
   */
  async callAIStream(messages, apiConfig = {}, onDelta, _options = {}) {
    const config = this.resolveLLMConfig(apiConfig);
    const retryConfig = this.getRetryConfig();

    let fullText = '';
    const wrapDelta = (delta) => {
      if (!delta) return;
      fullText += delta;
      if (typeof onDelta === 'function') onDelta(delta);
    };

    // 优先使用 Python 子服务端流式（SSE透传），失败时回退到 NodeJS LLMFactory
    try {
      const payload = {
        messages,
        model: config.chatModel || config.model || config.provider,
        provider: config.provider,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: true,
        enableTools: config.enableTools !== false
      };
      const response = await Bot.callSubserver('/api/langchain/chat', {
        body: payload,
        rawResponse: true
      });

      if (!response || !response.body) {
        throw new Error('子服务端响应无效');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') {
            return fullText;
          }
          
          try {
            const json = JSON.parse(dataStr);
            const delta = json?.choices?.[0]?.delta?.content || '';
            if (delta) {
              wrapDelta(delta);
            }
          } catch {
            // 忽略JSON解析错误，继续处理下一行
          }
        }
      }
      
      return fullText;
    } catch (error) {
      BotUtil.makeLog('warn', `[${this.name}] 子服务端流式调用失败，回退到LLM工厂: ${error.message}`, 'AIStream');
      fullText = '';
    }

    let lastError = null;
    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const client = LLMFactory.createClient(config);
        await client.chatStream(messages, wrapDelta, config);
        return fullText; // 成功，返回结果
      } catch (error) {
        lastError = error;
        const errorInfo = this.classifyError(error);
        const shouldRetry = this.shouldRetry(errorInfo, retryConfig, attempt);
        
        if (shouldRetry) {
          const delay = this.calculateRetryDelay(attempt, retryConfig);
          BotUtil.makeLog('warn', 
            `[${this.name}] AI流式调用失败，${attempt}/${retryConfig.maxAttempts}次重试中: ${error.message}`,
            'AIStream'
          );
          fullText = '';
          await BotUtil.sleep(delay);
          continue;
        }
        
        // 不再重试，抛出错误
        BotUtil.makeLog('error', 
          `[${this.name}] AI流式调用失败: ${error.message}`,
          'AIStream'
        );
        throw error;
      }
    }
    
    // 所有重试都失败
    BotUtil.makeLog('error', 
      `[${this.name}] AI流式调用失败，已重试${retryConfig.maxAttempts}次: ${lastError?.message || '未知错误'}`,
      'AIStream'
    );
    throw new Error(`AI流式调用失败，已重试${retryConfig.maxAttempts}次: ${lastError?.message || '未知错误'}`);
  }

  /**
   * 解析LLM配置（标准化配置合并）
   * @param {Object} apiConfig - API配置
   * @returns {Object}
   */
  resolveLLMConfig(apiConfig = {}) {
    const runtime = cfg.aistream || {};
    const llm = runtime.llm || {};

    const pickFirst = (...vals) => {
      for (const v of vals) {
        if (v !== undefined && v !== null) return v;
      }
      return undefined;
    };
    const pickTrimmed = (...vals) => {
      for (const v of vals) {
        if (v === undefined || v === null) continue;
        const s = String(v).trim();
        if (s) return s;
      }
      return undefined;
    };

    // 获取提供商名称（仅保留 LLM 提供商概念）
    const provider = (apiConfig.provider || this.config.provider || llm.provider || llm.Provider || '').toLowerCase();

    // 获取提供商配置
    const providerConfig = this.getProviderConfig(provider);

    // 验证提供商是否支持
    if (provider && !LLMFactory.hasProvider(provider)) {
      throw new Error(`不支持的LLM提供商: ${provider}`);
    }

    // 解析超时配置
    const timeout = apiConfig.timeout || apiConfig.timeoutMs || this.config.timeout || llm.timeout || 360000;

    // 有意义的别名兼容：同义字段归一到内部字段（各厂商 client 再按自身协议映射）
    const apiKey = pickTrimmed(apiConfig.apiKey, apiConfig.api_key, providerConfig.apiKey, providerConfig.api_key, this.config.apiKey, this.config.api_key);
    const baseUrl = pickFirst(apiConfig.baseUrl, apiConfig.base_url, this.config.baseUrl, this.config.base_url, providerConfig.baseUrl, providerConfig.base_url);
    const model = pickFirst(apiConfig.model, apiConfig.chatModel, this.config.model, this.config.chatModel, providerConfig.model, providerConfig.chatModel);
    const chatModel = pickFirst(apiConfig.chatModel, this.config.chatModel, providerConfig.chatModel, apiConfig.model, this.config.model, providerConfig.model);

    const maxTokens = pickFirst(
      apiConfig.maxTokens, apiConfig.max_tokens, apiConfig.max_completion_tokens, apiConfig.maxCompletionTokens, apiConfig.maxCompletionTokens,
      this.config.maxTokens, this.config.max_tokens,
      providerConfig.maxTokens, providerConfig.max_tokens
    );
    const topP = pickFirst(apiConfig.topP, apiConfig.top_p, this.config.topP, this.config.top_p, providerConfig.topP, providerConfig.top_p);
    const presencePenalty = pickFirst(apiConfig.presencePenalty, apiConfig.presence_penalty, this.config.presencePenalty, this.config.presence_penalty, providerConfig.presencePenalty, providerConfig.presence_penalty);
    const frequencyPenalty = pickFirst(apiConfig.frequencyPenalty, apiConfig.frequency_penalty, this.config.frequencyPenalty, this.config.frequency_penalty, providerConfig.frequencyPenalty, providerConfig.frequency_penalty);
    const enableTools = pickFirst(apiConfig.enableTools, apiConfig.enable_tools, providerConfig.enableTools, providerConfig.enable_tools, this.config.enableTools, this.config.enable_tools, true);

    // 配置合并：优先级 apiConfig > this.config > providerConfig
    const finalConfig = {
      ...providerConfig,
      ...this.config,
      ...apiConfig,
      // 统一后的关键字段（同义字段兼容）
      apiKey,
      baseUrl,
      model,
      chatModel,
      maxTokens,
      topP,
      presencePenalty,
      frequencyPenalty,
      provider,
      timeout,
      enableTools
    };

    return finalConfig;
  }

  /**
   * 获取提供商配置
   * @param {string} provider - 提供商名称（LLM 提供商）
   * @returns {Object} 提供商配置
   */
  getProviderConfig(provider) {
    if (!provider) return {};

    const configKey = `${provider}_llm`;
    return cfg[configKey] || {};
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
      const baseMessages = await this.buildChatContext(e, question);
      const messages = await this.buildEnhancedContext(e, question, baseMessages);
      
      MonitorService.addStep(traceId, { step: 'build_context', messages: messages.length });
      
      const response = await this.callAI(messages, config);
      MonitorService.addStep(traceId, { step: 'ai_call', responseLength: response?.length || 0 });

      if (!response) {
        MonitorService.endTrace(traceId, { success: false, error: 'No response' });
        return null;
      }

      // tool calling现在由LLM客户端自动处理，无需手动解析函数调用
      if (response && response.trim() && e?.reply) {
        await e.reply(response.trim()).catch(err => {
          BotUtil.makeLog('debug', `发送回复失败: ${err.message}`, 'AIStream');
        });
      }

      if (this.embeddingConfig.enabled && response && e) {
        const groupId = e.group_id || `private_${e.user_id}`;
        this.storeMessageWithEmbedding(groupId, {
          user_id: e.self_id,
          nickname: e.bot?.nickname || e.bot?.info?.nickname || 'Bot',
          message: response,
          message_id: Date.now().toString(),
          time: Date.now()
        }).catch(() => { });
      }

      MonitorService.endTrace(traceId, { success: true, response });
      return response;
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
        enableMemory = false,
        enableDatabase = false,
        ...apiConfig
      } = options;

      let StreamLoader = null;
      if (mergeStreams.length > 0 || enableMemory || enableDatabase) {
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
      mcpTools: Array.from(this.mcpTools.values()).map(t => ({
        name: t.name,
        description: t.description,
        enabled: t.enabled
      }))
    };
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
    // 支持 streams 或 streamNames 数组格式
    if (options.streams && Array.isArray(options.streams)) {
      names.push(...options.streams);
    }
    if (options.streamNames && Array.isArray(options.streamNames)) {
      names.push(...options.streamNames);
    }
    return [...new Set(names)]; // 去重
  }


  /**
   * 统一错误处理（子类可重写）
   * @param {Error} error - 错误对象
   * @param {string} operation - 操作名称
   * @param {Object} context - 上下文
   * @returns {Error} 处理后的错误
   */
  handleError(error, operation, _context = {}) {
    const errorMessage = error?.message || String(error);
    BotUtil.makeLog('error', 
      `[${this.name}] ${operation}失败: ${errorMessage}`, 
      'AIStream'
    );
    return error;
  }

  /**
   * 统一成功响应格式（用于MCP工具）
   * @param {Object} data - 响应数据
   * @returns {Object}
   */
  successResponse(data) {
    return {
      success: true,
      data: {
        ...data,
        timestamp: Date.now()
      }
    };
  }

  /**
   * 统一错误响应格式（用于MCP工具）
   * @param {string} code - 错误代码
   * @param {string} message - 错误消息
   * @returns {Object}
   */
  errorResponse(code, message) {
    return {
      success: false,
      error: { code, message }
    };
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