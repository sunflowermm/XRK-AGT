import BotUtil from '#utils/botutil.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import LLMFactory from '#factory/llm/LLMFactory.js';
import MemoryManager from '#infrastructure/aistream/memory-manager.js';
import PromptEngine from '#infrastructure/aistream/prompt-engine.js';
import MonitorService from '#infrastructure/aistream/monitor-service.js';
import { appendAgentWorkspaceToPrompt } from '#utils/agent-workspace.js';
import { estimateTokensMixed } from '#utils/token-estimate.js';
import { applyPromptCachePolicy } from '#utils/llm/prompt-cache-policy.js';
import { getStreamRequestContext } from '#infrastructure/aistream/stream-request-context.js';
import { collectAuxiliaryStreamPrompts, resolveToolStreamNames } from '#infrastructure/aistream/chat-tool-streams.js';
import { unpackFactoryChatRaw } from '#utils/llm/llm-nonstream-reply.js';
import { previewLlmMessages } from '#infrastructure/aistream/chat-pipeline.js';

function shallowMergePlain(...sources) {
  const out = {};
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    for (const [k, v] of Object.entries(src)) {
      if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = { ...(out[k] || {}), ...v };
      } else if (v !== undefined) {
        out[k] = v;
      }
    }
  }
  return out;
}

export default class AIStream {
  /** @type {Map<string, object>} MCP 工具注册表 */
  mcpTools = new Map();
  /** @type {AIStream[]} 已 merge 的子工作流 */
  _mergedStreams = [];
  _initialized = false;

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
    this.version = options.version || '1.0.5';
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
  }

  /**
   * 初始化工作流
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initialized) {
      return;
    }

    this._initialized = true;
  }

  /**
   * 估算文本token数量
   * @param {string} text - 待估算的文本
   * @returns {number} token数量
   */
  estimateTokens(text) {
    return estimateTokensMixed(text);
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
   * 存储消息到 MemoryManager（短期记忆）
   * @param {string} groupId - 群组ID
   * @param {Object} message - 消息对象
   * @returns {Promise<void>}
   */
  async storeMessageMemory(groupId, message) {
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
      const groupIdStr = String(groupId || '');
      const userId = groupIdStr.replace(/^memory_/, '');
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

      return [];
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

    if (!this._mergedStreams.includes(stream)) {
      this._mergedStreams.push(stream);
    }

    let mergedCount = 0;
    let skippedCount = 0;

    // 合并MCP工具
    if (stream.mcpTools) {
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
  buildSystemPrompt() {
    return '';
  }

  /**
   * 在 system 文案末尾注入工作区上下文（agents/workspace 模板、overlay、rules、skills、MEMORY、subagents），
   * 受 `aistream.agentWorkspace` 控制。
   * 覆盖 buildChatContext 的子类若自行组装 system，应调用本方法以保持一致行为。
   * @param {string} text
   * @returns {Promise<string>}
   */
  async finalizeSystemPromptContent(text) {
    if (text == null || text === '') text = '';
    const streamKey = String(this.name || '').replace(/-merged$/, '') || this.name;
    const aux = collectAuxiliaryStreamPrompts(this);
    const merged = aux ? `${text}${aux}` : text;
    return appendAgentWorkspaceToPrompt(merged, getAistreamConfigOptional(), streamKey);
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
      const content = await this.finalizeSystemPromptContent(rendered);
      return [{ role: 'system', content }];
    }

    if (systemPrompt) {
      const content = await this.finalizeSystemPromptContent(systemPrompt);
      return [{ role: 'system', content: content }];
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
    const runtime = getAistreamConfigOptional();
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

  _getDefaultProvider() {
    return LLMFactory.resolveProvider({}) ?? LLMFactory.listProviders()[0] ?? null;
  }

  /** chat 白名单：合并副流 + web/browser 等框架自研 + remote-mcp.* */
  _getToolStreamNames() {
    if (this._cachedToolStreamNames) {
      return this._cachedToolStreamNames;
    }
    this._cachedToolStreamNames = resolveToolStreamNames(this);
    BotUtil.makeLog('debug', `[AIStream] 工具白名单 ${this.name}: [${this._cachedToolStreamNames.join(', ')}]`, 'AIStream');
    return this._cachedToolStreamNames;
  }

  /**
   * 调用AI（非流式，支持tool calling）
   * @returns {Promise<{ content: string, executedToolNames: string[], usedReplyTool?: boolean, toolRoundsExhausted?: boolean }|null>}
   */
  async callAI(messages, apiConfig = {}) {
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      BotUtil.makeLog('warn', '[AIStream] callAI 消息数组为空', 'AIStream');
      return null;
    }

    const config = applyPromptCachePolicy(this.resolveLLMConfig(apiConfig), {
      stream: this,
      e: getStreamRequestContext()?.e ?? null,
    });
    const retryConfig = this.getRetryConfig();

    const inputTokens = messages.reduce((sum, m) => {
      const content = typeof m.content === 'string' ? m.content : (m.content?.text || '');
      return sum + this.estimateTokens(content);
    }, 0);
    MonitorService.recordTokens(`${this.name}.callAI`, { input: inputTokens });

    let lastError = null;
    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const client = LLMFactory.createClient(config);
        const overrides = { ...config, stream: false, streams: this._getToolStreamNames() };
        const raw = await client.chat(messages, overrides);
        const { text, usedReplyTool, toolRoundsExhausted, executedToolNames } = unpackFactoryChatRaw(raw);
        const content = text != null ? String(text) : '';
        MonitorService.recordTokens(`${this.name}.callAI`, { output: this.estimateTokens(content) });

        if (toolRoundsExhausted) {
          return { content, executedToolNames, usedReplyTool, toolRoundsExhausted: true };
        }
        if (content.trim()) {
          return { content, executedToolNames, usedReplyTool };
        }
        if (usedReplyTool || executedToolNames.length > 0) {
          return { content: '', executedToolNames, usedReplyTool };
        }
        return null;
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

        BotUtil.makeLog('error', `[${this.name}] AI调用失败: ${error.message}`, 'AIStream');
        throw error;
      }
    }

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
    const config = applyPromptCachePolicy(this.resolveLLMConfig(apiConfig), {
      stream: this,
      e: getStreamRequestContext()?.e ?? null,
    });
    const retryConfig = this.getRetryConfig();

    let fullText = '';
    const wrapDelta = (delta) => {
      if (!delta) return;
      fullText += delta;
      if (typeof onDelta === 'function') onDelta(delta);
    };

    // 若该 provider 明确禁用流式，则退化为非流式调用，并一次性输出
    // 这样可以保持上游“期望流式”的接口不报错，同时尊重配置 enableStream=false
    if (config.enableStream === false) {
      const result = await this.callAI(messages, apiConfig);
      if (result?.content) wrapDelta(result.content);
      return result?.content || '';
    }

    let lastError = null;
    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const client = LLMFactory.createClient(config);
        const overrides = { ...config, stream: true, streams: this._getToolStreamNames() };
        await client.chatStream(messages, wrapDelta, overrides);
        return fullText;
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
    const ai = getAistreamConfigOptional();
    const llm = ai.llm || {};
    const pick = (...vals) => vals.find((v) => v !== undefined);
    const pickTrim = (...vals) => {
      const v = vals.find((x) => x !== undefined);
      return v != null && v !== '' ? String(v).trim() : undefined;
    };
    const pickUrl = (...vals) => vals.find((v) => v != null && v !== '' && String(v).trim() !== '');

    const providerRaw = (apiConfig.provider || this.config?.provider || llm.Provider || llm.provider || '').toLowerCase();
    const provider = providerRaw || this._getDefaultProvider();
    if (providerRaw && !LLMFactory.hasProvider(providerRaw)) {
      BotUtil.makeLog('warn', `[AIStream] 不支持的 LLM 提供商: ${providerRaw}`, 'AIStream');
    }

    const providerConfig = LLMFactory.getProviderConfig(provider) || {};

    const timeout = pick(
      apiConfig.timeout,
      apiConfig.timeoutMs,
      this.config?.timeout,
      providerConfig.timeout,
      llm.timeout,
      ai.global?.maxTimeout
    );
    const apiKey = pickTrim(
      apiConfig.apiKey,
      apiConfig.api_key,
      this.config?.apiKey,
      this.config?.api_key,
      providerConfig.apiKey,
      providerConfig.api_key
    );
    const baseUrl = pickUrl(
      apiConfig.baseUrl,
      apiConfig.base_url,
      this.config?.baseUrl,
      this.config?.base_url,
      providerConfig.baseUrl,
      providerConfig.base_url
    );
    const model = pick(
      apiConfig.model,
      apiConfig.chatModel,
      this.config?.model,
      this.config?.chatModel,
      providerConfig.model,
      providerConfig.chatModel
    );
    const maxTokens = pick(
      apiConfig.maxTokens,
      apiConfig.max_tokens,
      apiConfig.max_completion_tokens,
      apiConfig.maxCompletionTokens,
      this.config?.maxTokens,
      this.config?.max_tokens,
      providerConfig.maxTokens,
      providerConfig.max_tokens,
      llm.maxTokens,
      llm.max_tokens
    );
    const topP = pick(
      apiConfig.topP,
      apiConfig.top_p,
      this.config?.topP,
      this.config?.top_p,
      providerConfig.topP,
      providerConfig.top_p,
      llm.topP,
      llm.top_p
    );
    const presencePenalty = pick(
      apiConfig.presencePenalty,
      apiConfig.presence_penalty,
      this.config?.presencePenalty,
      this.config?.presence_penalty,
      providerConfig.presencePenalty,
      providerConfig.presence_penalty,
      llm.presencePenalty,
      llm.presence_penalty
    );
    const frequencyPenalty = pick(
      apiConfig.frequencyPenalty,
      apiConfig.frequency_penalty,
      this.config?.frequencyPenalty,
      this.config?.frequency_penalty,
      providerConfig.frequencyPenalty,
      providerConfig.frequency_penalty,
      llm.frequencyPenalty,
      llm.frequency_penalty
    );
    const temperature = pick(
      apiConfig.temperature,
      this.config?.temperature,
      providerConfig.temperature,
      llm.temperature
    );
    const enableTools = pick(
      apiConfig.enableTools,
      apiConfig.enable_tools,
      this.config?.enableTools,
      this.config?.enable_tools,
      providerConfig.enableTools,
      providerConfig.enable_tools,
      llm.enableTools,
      llm.enable_tools,
      true
    );
    const enableStream = pick(
      apiConfig.enableStream,
      apiConfig.enable_stream,
      this.config?.enableStream,
      this.config?.enable_stream,
      providerConfig.enableStream,
      providerConfig.enable_stream,
      llm.enableStream,
      llm.enable_stream
    );
    const toolChoice = pick(
      apiConfig.tool_choice,
      apiConfig.toolChoice,
      this.config?.tool_choice,
      this.config?.toolChoice,
      providerConfig.tool_choice,
      providerConfig.toolChoice,
      llm.tool_choice,
      llm.toolChoice
    );
    const parallelToolCalls = pick(
      apiConfig.parallel_tool_calls,
      apiConfig.parallelToolCalls,
      this.config?.parallel_tool_calls,
      this.config?.parallelToolCalls,
      providerConfig.parallel_tool_calls,
      providerConfig.parallelToolCalls,
      llm.parallel_tool_calls,
      llm.parallelToolCalls
    );
    const maxToolRounds = pick(
      apiConfig.maxToolRounds,
      this.config?.maxToolRounds,
      providerConfig.maxToolRounds,
      llm.maxToolRounds
    );
    const mcpToolMode = pick(
      apiConfig.mcpToolMode,
      this.config?.mcpToolMode,
      providerConfig.mcpToolMode,
      llm.mcpToolMode
    );
    const promptCache = pick(
      apiConfig.promptCache,
      this.config?.promptCache,
      llm.promptCache
    );

    const headers = shallowMergePlain(providerConfig.headers, this.config?.headers, apiConfig.headers);
    const extraBody = shallowMergePlain(providerConfig.extraBody, this.config?.extraBody, apiConfig.extraBody);
    const proxy = shallowMergePlain(providerConfig.proxy, this.config?.proxy, apiConfig.proxy);

    const merged = {
      ...providerConfig,
      ...this.config,
      ...apiConfig,
      apiKey,
      baseUrl,
      model,
      maxTokens,
      topP,
      presencePenalty,
      frequencyPenalty,
      provider,
      timeout,
      enableTools,
      temperature,
      enableStream,
      tool_choice: toolChoice,
      toolChoice,
      parallel_tool_calls: parallelToolCalls,
      parallelToolCalls,
      maxToolRounds,
      mcpToolMode
    };
    if (promptCache) merged.promptCache = promptCache;
    if (Object.keys(headers).length) merged.headers = headers;
    if (Object.keys(extraBody).length) merged.extraBody = extraBody;
    if (Object.keys(proxy).length) merged.proxy = proxy;

    const { _clientClass, factoryType, ...out } = merged;
    return out;
  }

  getProviderConfig(provider) {
    return LLMFactory.getProviderConfig(provider) || {};
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

      // 调试：打印给 LLM 的消息概要（所有工作流通用），方便查看最终 prompt 结构
      try {
        BotUtil.makeLog(
          'debug',
          `[AIStream.execute] LLM消息预览[${this.name}]: ${JSON.stringify(previewLlmMessages(messages), null, 2)}`,
          'AIStream'
        );
      } catch {
        // 调试日志失败直接忽略
      }

      const result = await this.callAI(messages, config);
      const responseText = result?.content ?? '';
      MonitorService.addStep(traceId, { step: 'ai_call', responseLength: responseText?.length || 0 });

      if (!responseText?.trim()) {
        MonitorService.endTrace(traceId, { success: false, error: 'No response' });
        return null;
      }

      if (e?.reply) {
        await e.reply(responseText.trim()).catch(err => {
          BotUtil.makeLog('debug', `发送回复失败: ${err.message}`, 'AIStream');
        });
      }

      if (this.embeddingConfig.enabled && e) {
        const groupId = e.group_id || `private_${e.user_id}`;
        this.storeMessageMemory(groupId, {
          user_id: e.self_id,
          nickname: e.bot?.nickname || e.bot?.info?.nickname || 'Bot',
          message: responseText,
          message_id: Date.now().toString(),
          time: Date.now()
        }).catch(() => { });
      }

      MonitorService.endTrace(traceId, { success: true, response: responseText });
      return responseText;
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
        enableTools = false,
        ...apiConfig
      } = options;

      let stream = this;
      const StreamLoader = (mergeStreams.length > 0 || enableMemory || enableDatabase || enableTools)
        ? (await import('#infrastructure/aistream/loader.js')).default
        : null;
      
      if (enableMemory || enableDatabase || enableTools) {
        await this.autoMergeAuxiliaryStreams(stream, { enableMemory, enableDatabase, enableTools });
      }
      
      // 构建streams列表：主工作流 + mergeStreams
      const streams = [this.name];
      if (mergeStreams.length > 0) {
        streams.push(...mergeStreams);
      }
      
      if (mergeStreams.length > 0 && StreamLoader) {
        const mergedName = `${this.name}-${mergeStreams.join('-')}`;
        stream = StreamLoader.getStream(mergedName) ||
          StreamLoader.mergeStreams({
            name: mergedName,
            main: this.name,
            secondary: mergeStreams,
            prefixSecondary: true
          });
      }

      // 传递streams参数给LLM，用于工具权限控制
      if (!apiConfig.streams) {
        apiConfig.streams = streams;
      }

      return await stream.execute(e, question, apiConfig);
    } catch (error) {
      BotUtil.makeLog('error', `工作流处理失败[${this.name}]: ${error.message}`, 'AIStream');
      return null;
    }
  }

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

  async autoMergeAuxiliaryStreams(stream, options = {}) {
    const StreamLoader = (await import('#infrastructure/aistream/loader.js')).default;
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

  extractStreamNames(options) {
    const names = [];
    if (options.enableMemory) names.push('memory');
    if (options.enableDatabase) names.push('database');
    if (options.enableTools) names.push('tools');
    return [...new Set(names)];
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