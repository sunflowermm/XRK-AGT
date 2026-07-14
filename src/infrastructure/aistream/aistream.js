import BotUtil from '#utils/botutil.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import LLMFactory from '#factory/llm/LLMFactory.js';
import MemoryManager from '#infrastructure/aistream/memory-manager.js';
import PromptEngine from '#infrastructure/aistream/prompt-engine.js';
import MonitorService from '#infrastructure/aistream/monitor-service.js';
import StreamLoader from '#infrastructure/aistream/loader.js';
import { appendAgentWorkspaceToPrompt } from '#utils/agent-workspace.js';
import { estimateTokensMixed } from '#utils/token-estimate.js';
import { applyPromptCachePolicy } from '#utils/llm/prompt-cache-policy.js';
import { resolveStreamLLMConfig } from '#utils/llm/llm-config-resolve.js';
import { runWithLlmRetry } from '#utils/llm/llm-retry.js';
import {
  getStreamRequestContext,
  runWithStreamRequestContext
} from '#infrastructure/aistream/stream-request-context.js';
import { collectAuxiliaryStreamPrompts, resolveToolStreamNames } from '#infrastructure/aistream/chat-tool-streams.js';
import { unpackFactoryChatRaw } from '#utils/llm/llm-nonstream-reply.js';
import { assembleChatLlmMessages, logLlmMessagePreview } from '#infrastructure/aistream/chat-pipeline.js';

export default class AIStream {
  /** @type {Map<string, object>} MCP 工具注册表 */
  mcpTools = new Map();
  /** @type {AIStream[]} 已 merge 的子工作流 */
  _mergedStreams = [];
  _initialized = false;
  _cachedToolStreamNames = null;

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
   * @param {string[]} [options.capabilities] - 能力标签（如 tools/prompt）
   * @param {boolean} [options.frameworkToolSurface] - 是否自动并入 chat 工具白名单
   */
  constructor(options = {}) {
    this.name = options.name || 'base-stream';
    this.description = options.description || '基础工作流';
    this.version = options.version || '1.0.5';
    this.author = options.author || 'unknown';
    this.priority = options.priority || 100;
    this.capabilities = Array.isArray(options.capabilities) ? options.capabilities : [];
    this.frameworkToolSurface = options.frameworkToolSurface === true;

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
   * 存储消息到 MemoryManager（短期记忆）。
   * 注意：retrieveRelevantContexts 不再伪装成「可检索此短期记忆的 embedding RAG」；
   * chat 真实历史由 ChatStream.messageHistory / memory 流负责。
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
   * 检索相关长期记忆（非向量 RAG）。默认关闭自动注入：embedding.enabled 时也只搜长期记忆。
   * 短期记忆与 chat 历史请用各产品流自己的通路，勿假装已实现 embedding 检索。
   */
  async retrieveRelevantContexts(groupId, query) {
    if (!query || !this.embeddingConfig?.enabled) return [];

    try {
      const groupIdStr = String(groupId || '');
      const userId = groupIdStr.replace(/^memory_/, '');
      const memories = await MemoryManager.searchLongTermMemories(userId, query, 5);
      return memories.map((m) => ({
        message: m.content,
        similarity: m.importance || 0.8,
        time: m.timestamp,
        userId: m.userId,
        nickname: ''
      }));
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
   * @deprecated 禁止业务侧原地 merge。请用 `process({ mergeStreams: ['other'] })` 或 `StreamLoader.mergeStreams`。
   * 本方法仍会 mutate 当前实例工具表，仅保留兼容；新代码勿调用。
   */
  merge(stream, options = {}) {
    BotUtil.makeLog(
      'warn',
      `[${this.name}] AIStream.merge() 已废弃，请改用 process({ mergeStreams }) / StreamLoader.mergeStreams`,
      'AIStream'
    );
    const { overwrite = false, prefix = '' } = options;

    if (!stream) {
      throw new Error('无效的 Stream 实例');
    }

    if (!this._mergedStreams.includes(stream)) {
      this._mergedStreams.push(stream);
    }

    let mergedCount = 0;
    let skippedCount = 0;

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

    this._cachedToolStreamNames = null;
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

  /** chat 白名单：合并副流 + frameworkToolSurface 流 + remote-mcp.* */
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

    const inputTokens = messages.reduce((sum, m) => {
      const content = typeof m.content === 'string' ? m.content : (m.content?.text || '');
      return sum + this.estimateTokens(content);
    }, 0);
    const traceId = this.name;
    MonitorService.recordTokens(traceId, { input: inputTokens });

    return runWithLlmRetry({
      label: this.name,
      kind: 'AI调用',
      run: async () => {
        const client = LLMFactory.createClient(config);
        const overrides = this.buildCallOverrides(config, apiConfig, { stream: false });
        const raw = await client.chat(messages, overrides);
        const { text, usedReplyTool, toolRoundsExhausted, executedToolNames } = unpackFactoryChatRaw(raw);
        const content = text != null ? String(text) : '';
        MonitorService.recordTokens(traceId, { output: this.estimateTokens(content) });

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
      }
    });
  }


  /**
   * 调用AI（流式）
   * @param {Array<Object>} messages - 消息列表
   * @param {Object} apiConfig - API配置
   * @param {Function} onDelta - 增量回调
   * @returns {Promise<string>}
   */
  async callAIStream(messages, apiConfig = {}, onDelta, options = {}) {
    const run = async () => {
      const config = applyPromptCachePolicy(this.resolveLLMConfig(apiConfig), {
        stream: this,
        e: getStreamRequestContext()?.e ?? options?.context?.e ?? null,
      });

      let fullText = '';
      const wrapDelta = (delta) => {
        if (!delta) return;
        fullText += delta;
        if (typeof onDelta === 'function') onDelta(delta);
      };

      if (config.enableStream === false) {
        const result = await this.callAI(messages, apiConfig);
        if (result?.content) wrapDelta(result.content);
        return result?.content || '';
      }

      return runWithLlmRetry({
        label: this.name,
        kind: 'AI流式调用',
        run: async () => {
          fullText = '';
          const client = LLMFactory.createClient(config);
          const overrides = this.buildCallOverrides(config, apiConfig, { stream: true });
          await client.chatStream(messages, wrapDelta, overrides);
          return fullText;
        }
      });
    };

    if (getStreamRequestContext()) return run();
    const e = options?.context?.e ?? null;
    return runWithStreamRequestContext({ e, turnState: null }, run);
  }

  resolveLLMConfig(apiConfig = {}) {
    const merged = resolveStreamLLMConfig(this, apiConfig);
    return this.patchLLMConfig(merged, apiConfig);
  }

  /**
   * 工作流级 LLM 配置补丁（业务场景扩展点）。
   * 子类可追加场景字段；request body 仍由各 *LLMClient.buildBody 按官方文档组装。
   * @param {object} merged - resolveStreamLLMConfig 产物
   * @param {object} apiConfig - 本次调用覆盖
   * @returns {object}
   */
  patchLLMConfig(merged, _apiConfig = {}) {
    return merged;
  }

  /**
   * 组装传入 LLMFactory.createClient 的 overrides（工具白名单、流式开关等）。
   * @param {object} resolvedConfig - resolveLLMConfig 结果
   * @param {object} apiConfig - 原始调用参数
   * @param {{ stream?: boolean }} options
   */
  buildCallOverrides(resolvedConfig, apiConfig = {}, { stream = false } = {}) {
    return {
      ...resolvedConfig,
      ...apiConfig,
      stream,
      streams: apiConfig.streams ?? this._getToolStreamNames()
    };
  }

  /**
   * 执行工作流
   * @param {Object} e - 事件对象
   * @param {string|Object} question - 问题
   * @param {Object} config - 配置
   * @returns {Promise<string|null>}
   */
  async execute(e, question, config) {
    const run = async () => {
      const traceId = MonitorService.startTrace(this.name, {
        agentId: e?.user_id,
        workflow: this.name,
        userId: e?.user_id
      });

      try {
        const messages = await assembleChatLlmMessages(this, e, question);
        MonitorService.addStep(traceId, { step: 'build_context', messages: messages.length });
        logLlmMessagePreview(this, messages, 'AIStream');

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
    };

    if (getStreamRequestContext()) return run();
    return runWithStreamRequestContext({ e, turnState: null }, run);
  }

  /**
   * 将 enable* 兼容别名归一为副流名列表（去重）。
   * @param {{ mergeStreams?: string[], enableMemory?: boolean, enableDatabase?: boolean, enableTools?: boolean }} options
   * @returns {string[]}
   */
  static resolveSecondaryStreamNames(options = {}) {
    let secondary = Array.isArray(options.mergeStreams) ? [...options.mergeStreams] : [];
    if (secondary.length === 0) {
      if (options.enableMemory) secondary.push('memory');
      if (options.enableDatabase) secondary.push('database');
      if (options.enableTools) secondary.push('tools');
    }
    return [...new Set(secondary.map((n) => String(n ?? '').trim()).filter(Boolean))];
  }

  /**
   * 处理请求（支持工作流合并）
   * 唯一组合路径：mergeStreams → StreamLoader.mergeStreams。
   * enableMemory/Database/Tools 仅作无 mergeStreams 时的兼容别名，映射为副流列表，不再原地 mutate 单例。
   */
  async process(e, question, options = {}) {
    try {
      const {
        mergeStreams: _ms,
        enableMemory: _em,
        enableDatabase: _ed,
        enableTools: _et,
        ...apiConfig
      } = options;

      const secondary = AIStream.resolveSecondaryStreamNames(options);

      let stream = this;
      if (secondary.length > 0) {
        const mergedName = `${this.name}-${secondary.join('-')}`;
        stream = StreamLoader.getStream(mergedName) ||
          StreamLoader.mergeStreams({
            name: mergedName,
            main: this.name,
            secondary,
            prefixSecondary: true
          });
      }

      if (!apiConfig.streams) {
        apiConfig.streams = [this.name, ...secondary];
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
      capabilities: this.capabilities || [],
      frameworkToolSurface: !!this.frameworkToolSurface,
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