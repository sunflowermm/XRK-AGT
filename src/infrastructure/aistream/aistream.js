import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs';
import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';
import cfg from '#infrastructure/config/config.js';
import LLMFactory from '#factory/llm/LLMFactory.js';
/**
 * 轻量级文本相似度计算器（BM25算法）
 */
class LightweightSimilarity {
  constructor() {
    this.idf = new Map();
    this.avgDocLength = 0;
    this.k1 = 1.5;
    this.b = 0.75;
  }

  tokenize(text) {
    const chars = text.split('');
    const bigrams = [];
    for (let i = 0; i < chars.length - 1; i++) {
      bigrams.push(chars[i] + chars[i + 1]);
    }
    return [...chars, ...bigrams];
  }

  calculateIDF(documents) {
    const docCount = documents.length;
    const termDocCount = new Map();

    for (const doc of documents) {
      const tokens = new Set(this.tokenize(doc));
      for (const token of tokens) {
        termDocCount.set(token, (termDocCount.get(token) || 0) + 1);
      }
    }

    for (const [term, count] of termDocCount) {
      this.idf.set(term, Math.log((docCount - count + 0.5) / (count + 0.5) + 1));
    }

    this.avgDocLength = documents.reduce((sum, doc) =>
      sum + this.tokenize(doc).length, 0) / docCount;
  }

  score(query, document) {
    const queryTokens = this.tokenize(query);
    const docTokens = this.tokenize(document);
    const docLength = docTokens.length;

    const termFreq = new Map();
    for (const token of docTokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }

    let score = 0;
    for (const token of queryTokens) {
      const tf = termFreq.get(token) || 0;
      const idf = this.idf.get(token) || 0;
      const numerator = tf * (this.k1 + 1);
      const denominator = tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));
      score += idf * (numerator / denominator);
    }

    return score;
  }
}

/**
 * AI工作流基类
 * 
 * 提供AI对话、函数调用、Embedding等核心功能的统一接口。
 * 支持本地（BM25）和远程（API）两种Embedding模式。
 * 包含上下文增强、相似度计算、函数注册等功能。
 * 
 * @abstract
 * @class AIStream
 * @example
 * // 继承AIStream创建自定义工作流
 * class MyStream extends AIStream {
 *   constructor() {
 *     super({
 *       name: 'my-stream',
 *       description: '我的工作流',
 *       version: '1.0.0',
 *       priority: 100,
 *       config: {
 *         temperature: 0.7,
 *         maxTokens: 4000
 *       },
 *       embedding: {
 *         enabled: true
 *         // mode 自动从 cfg.aistream.embedding.mode 读取（local 或 remote）
 *       }
 *     });
 *   }
 *   
 *   async buildSystemPrompt(context) {
 *     return '你是一个智能助手...';
 *   }
 * }
 */
export default class AIStream {
  constructor(options = {}) {
    // 基础信息
    this.name = options.name || 'base-stream';
    this.description = options.description || '基础工作流';
    this.version = options.version || '1.0.0';
    this.author = options.author || 'unknown';
    this.priority = options.priority || 100;

    // AI配置
    this.config = {
      enabled: true,
      temperature: 0.8,
      maxTokens: 6000,
      topP: 0.9,
      presencePenalty: 0.6,
      frequencyPenalty: 0.6,
      ...options.config
    };

    // 功能开关
    this.functionToggles = options.functionToggles || {};

    // Embedding配置（从 cfg 自动读取，无需手动指定）
    this.embeddingConfig = this.buildEmbeddingConfig(options.embedding);

    // 初始化状态
    this._initialized = false;
    this._embeddingInitialized = false;
  }

  /**
   * 初始化工作流（只执行一次）
   */
  async init() {
    if (this._initialized) {
      return;
    }

    if (!this.functions) {
      this.functions = new Map();
    }

    if (this.embeddingModel === undefined) {
      this.embeddingModel = null;
      this.embeddingReady = false;
      this.similarityCalculator = null;
    }

    this._initialized = true;
  }

  /**
   * 初始化Embedding（带防重复保护）
   */
  async initEmbedding() {
    if (!this.embeddingConfig.enabled) {
      return;
    }

    if (this._embeddingInitialized && this.embeddingReady) {
      return;
    }

    const mode = this.embeddingConfig.mode || 'local';

    try {
      await this.tryInitProvider(mode);
      this.embeddingReady = true;
      this._embeddingInitialized = true;
    } catch (e) {
      BotUtil.makeLog('warn', `[${this.name}] Embedding初始化失败，回退到本地模式: ${e.message}`, 'AIStream');
      // 失败时回退到本地模式
      try {
        await this.initLightweightEmbedding();
        this.embeddingConfig.mode = 'local';
        this.embeddingReady = true;
        this._embeddingInitialized = true;
      } catch (fallbackError) {
      this.embeddingConfig.enabled = false;
      this.embeddingReady = false;
      throw new Error('Embedding初始化失败');
      }
    }
  }

  /**
   * 尝试初始化指定提供商
   */
  async tryInitProvider(mode) {
    switch (mode) {
      case 'local':
        await this.initLightweightEmbedding();
        break;
      case 'remote':
        await this.initRemoteEmbedding();
        break;
      default:
        // 默认使用本地模式
        await this.initLightweightEmbedding();
    }
  }

  /**
   * Embedding 初始化（仅支持本地和远程两种模式）
   */
  async initLightweightEmbedding() {
    this.similarityCalculator = new LightweightSimilarity();
  }

  async initRemoteEmbedding() {
    const config = this.embeddingConfig;

    if (!config.apiUrl || !config.apiKey) {
      throw new Error('远程模式需要配置 apiUrl 和 apiKey');
    }

    await this.testAPIConnection();
  }

  /**
   * 测试远程 API 连接
   */
  async testAPIConnection() {
    const testVector = await this.generateRemoteEmbedding('test');
    if (!testVector || !Array.isArray(testVector) || testVector.length === 0) {
      throw new Error('API返回无效向量');
    }
  }

  /**
   * 生成Embedding向量
   */
  async generateEmbedding(text) {
    if (!this.embeddingConfig.enabled || !text) {
      return null;
    }

    if (!this.embeddingReady) {
      return null;
    }

    try {
      const mode = this.embeddingConfig.mode || 'local';
      if (mode === 'local') {
        // 本地模式返回文本本身（用于 BM25 算法）
        return text;
      } else if (mode === 'remote') {
        // 远程模式调用 API
        return await this.generateRemoteEmbedding(text);
      }
      return null;
    } catch (error) {
      BotUtil.makeLog('debug',
        `[${this.name}] 生成Embedding失败: ${error.message}`,
        'AIStream'
      );
      return null;
    }
  }

  async generateRemoteEmbedding(text) {
    const config = this.embeddingConfig;
    if (!config.apiUrl || !config.apiKey) {
      throw new Error('远程模式需要配置 apiUrl 和 apiKey');
    }

    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.apiModel || 'text-embedding-3-small',
        input: text,
        encoding_format: 'float'
      }),
      timeout: 10000
    });

    if (!response.ok) {
      throw new Error(`API错误 ${response.status}`);
    }

    const result = await response.json();
    const embedding = result.data?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('API返回无效数据');
    }

    return embedding;
  }

  /**
   * Token 计数（简单估算：中文按字符，英文按单词）
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    // 简单估算：中文字符按1.5 token，英文单词按1.3 token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return Math.ceil(chineseChars * 1.5 + englishWords * 1.3 + text.length * 0.3);
  }

  /**
   * 压缩文本（智能截断，保留关键信息）
   */
  compressText(text, maxLength = 150) {
    if (!text || text.length <= maxLength) return text;
    
    // 尝试在句号、问号、感叹号处截断
    const sentences = text.split(/[。！？.!?]/);
    let compressed = '';
    for (const sentence of sentences) {
      if ((compressed + sentence).length > maxLength) break;
      compressed += sentence;
    }
    
    // 如果还是太长，直接截断
    if (compressed.length === 0 || compressed.length > maxLength) {
      compressed = text.substring(0, maxLength - 3) + '...';
    }
    
    return compressed;
  }

  /**
   * 去重上下文（保留向后兼容，内部调用改进版本）
   */
  deduplicateContexts(contexts, similarityThreshold = 0.9) {
    return this.deduplicateContextsAdvanced(contexts, similarityThreshold);
  }

  /**
   * 基于注意力机制的上下文优化（神经网络启发式算法）
   */
  async optimizeContextsWithAttention(contexts, query, maxTokens = 1500) {
    if (!contexts || contexts.length === 0) return contexts;
    
    // 1. 去重（使用改进的相似度算法）
    let optimized = this.deduplicateContextsAdvanced(contexts);
    
    // 2. 计算注意力分数
    const queryTokens = query.toLowerCase().split(/[\s，。！？,.!?]/).filter(Boolean);
    optimized = optimized.map(ctx => {
      const text = ctx.message || ctx.content || '';
      const attentionScore = this.calculateContextAttention(text, queryTokens, ctx.similarity || 0);
      return { ...ctx, attentionScore };
    });
    
    // 3. 按注意力分数排序
    optimized.sort((a, b) => (b.attentionScore || 0) - (a.attentionScore || 0));
    
    // 4. 使用贪心算法选择最优上下文组合
    const selected = this.selectOptimalContexts(optimized, maxTokens);
    
    return selected;
  }

  /**
   * 计算上下文的注意力分数
   */
  calculateContextAttention(text, queryTokens, baseSimilarity) {
    if (!text || !queryTokens || queryTokens.length === 0) return baseSimilarity;
    
    const textTokens = text.toLowerCase().split(/[\s，。！？,.!?]/).filter(Boolean);
    const textTokenSet = new Set(textTokens);
    
    // 1. 关键词匹配分数
    const matchedTokens = queryTokens.filter(t => textTokenSet.has(t));
    const keywordScore = matchedTokens.length / queryTokens.length;
    
    // 2. 位置权重（查询词在文本中的位置越靠前，权重越高）
    let positionScore = 0;
    if (matchedTokens.length > 0) {
      const firstMatchIndex = textTokens.findIndex(t => matchedTokens.includes(t));
      positionScore = firstMatchIndex >= 0 ? Math.exp(-firstMatchIndex / 10) : 0;
    }
    
    // 3. 综合注意力分数（结合基础相似度、关键词匹配、位置权重）
    const attentionScore = baseSimilarity * 0.5 + keywordScore * 0.3 + positionScore * 0.2;
    
    return attentionScore;
  }

  /**
   * 选择最优上下文组合（0/1 背包问题的贪心近似解）
   */
  selectOptimalContexts(contexts, maxTokens) {
    const selected = [];
    let currentTokens = 0;
    
    for (const ctx of contexts) {
      const text = ctx.message || ctx.content || '';
      const tokens = this.estimateTokens(text);
      
      if (currentTokens + tokens <= maxTokens) {
        selected.push(ctx);
        currentTokens += tokens;
      } else {
        // 尝试压缩后加入
        const remainingTokens = maxTokens - currentTokens;
        if (remainingTokens > 50) {
          const compressedText = this.compressText(text, Math.floor(remainingTokens * 2));
          if (compressedText.length > 0) {
            selected.push({ ...ctx, message: compressedText, compressed: true });
            break;
          }
        }
      }
    }
    
    return selected;
  }

  /**
   * 改进的去重算法（使用 Jaccard 相似度）
   */
  deduplicateContextsAdvanced(contexts, similarityThreshold = 0.85) {
    if (!contexts || contexts.length <= 1) return contexts;
    
    const unique = [];
    for (const ctx of contexts) {
      let isDuplicate = false;
      const content1 = (ctx.message || ctx.content || '').toLowerCase();
      const tokens1 = new Set(content1.split(/[\s，。！？,.!?]/).filter(Boolean));
      
      for (const existing of unique) {
        const content2 = (existing.message || existing.content || '').toLowerCase();
        const tokens2 = new Set(content2.split(/[\s，。！？,.!?]/).filter(Boolean));
        
        // 使用 Jaccard 相似度
        const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
        const union = new Set([...tokens1, ...tokens2]);
        const jaccard = union.size > 0 ? intersection.size / union.size : 0;
        
        if (jaccard > similarityThreshold) {
          isDuplicate = true;
          // 保留相似度更高的
          if ((ctx.similarity || 0) > (existing.similarity || 0)) {
            const index = unique.indexOf(existing);
            unique[index] = ctx;
          }
          break;
        }
      }
      
      if (!isDuplicate) {
        unique.push(ctx);
      }
    }
    
    return unique;
  }

  /**
   * 计算自适应阈值（基于分数分布的统计方法）
   */
  /**
   * 计算自适应阈值（基于分数分布的统计方法 + 分位数方法）
   */
  calculateAdaptiveThreshold(scores, baseThreshold) {
    if (!scores || scores.length === 0) return baseThreshold;
    
    // 过滤无效分数
    const validScores = scores
      .map(s => s && typeof s.similarity === 'number' && isFinite(s.similarity) ? s.similarity : null)
      .filter(s => s !== null);
    
    if (validScores.length === 0) return baseThreshold;
    
    // 方法1：基于均值和标准差
    const mean = validScores.reduce((a, b) => a + b, 0) / validScores.length;
    const variance = validScores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / validScores.length;
    const stdDev = Math.sqrt(variance);
    const threshold1 = Math.max(baseThreshold, mean - 0.5 * stdDev);
    
    // 方法2：基于分位数（保留前75%）
    const sorted = [...validScores].sort((a, b) => a - b);
    const percentile25 = sorted[Math.floor(sorted.length * 0.25)];
    const threshold2 = Math.max(baseThreshold, percentile25);
    
    // 取两种方法的较小值（更保守）
    const adaptiveThreshold = Math.min(threshold1, threshold2);
    
    return Math.min(1, Math.max(0, adaptiveThreshold));
  }

  /**
   * 优化上下文 Token 使用（保留向后兼容）
   */
  async optimizeContexts(contexts, maxTokens = 1500) {
    if (!contexts || contexts.length === 0) return contexts;
    
    // 1. 去重
    let optimized = this.deduplicateContexts(contexts);
    
    // 2. 计算当前 token 数
    let totalTokens = optimized.reduce((sum, ctx) => {
      const text = ctx.message || ctx.content || '';
      return sum + this.estimateTokens(text);
    }, 0);
    
    // 3. 如果超限，按优先级压缩
    if (totalTokens > maxTokens) {
      // 按相似度排序，保留最相关的
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
          // 尝试压缩后加入
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
   * 注意力机制加权相似度（Attention-based Similarity）
   * 使用注意力权重增强重要特征的相似度计算
   */
  attentionWeightedSimilarity(queryVec, docVec, attentionWeights = null) {
    // 防御性检查
    if (!queryVec || !docVec || !Array.isArray(queryVec) || !Array.isArray(docVec)) {
      return 0;
    }
    if (queryVec.length !== docVec.length || queryVec.length === 0) {
      return 0;
    }

    const baseSimilarity = this.cosineSimilarity(queryVec, docVec);
    
    // 如果没有提供注意力权重，使用均匀权重
    if (!attentionWeights || !Array.isArray(attentionWeights) || attentionWeights.length === 0) {
      return baseSimilarity;
    }

    // 计算加权相似度
    let weightedDot = 0;
    let weightedNorm1 = 0;
    let weightedNorm2 = 0;
    const minLen = Math.min(queryVec.length, docVec.length, attentionWeights.length);

    for (let i = 0; i < minLen; i++) {
      const weight = Math.max(0, attentionWeights[i] || 1.0); // 确保权重非负
      const v1 = queryVec[i] || 0;
      const v2 = docVec[i] || 0;
      
      weightedDot += weight * v1 * v2;
      weightedNorm1 += weight * v1 * v1;
      weightedNorm2 += weight * v2 * v2;
    }

    const denominator = Math.sqrt(weightedNorm1) * Math.sqrt(weightedNorm2);
    if (denominator < 1e-8) return baseSimilarity;
    
    const weightedSim = weightedDot / denominator;
    if (!isFinite(weightedSim)) return baseSimilarity;
    
    // 结合基础相似度和加权相似度
    const normalizedWeightedSim = Math.max(0, (weightedSim + 1) / 2);
    return 0.7 * baseSimilarity + 0.3 * normalizedWeightedSim;
  }

  /**
   * 计算查询的注意力权重（基于 TF-IDF 启发式 + 神经网络思想）
   */
  calculateAttentionWeights(queryTokens, allDocuments) {
    // 防御性检查
    if (!queryTokens || !Array.isArray(queryTokens) || queryTokens.length === 0) {
      return null;
    }
    if (!allDocuments || !Array.isArray(allDocuments) || allDocuments.length === 0) {
      return null;
    }

    try {
      // 简单的 TF-IDF 启发式注意力权重
      const tokenFreq = new Map();
      const docFreq = new Map();
      
      // 统计词频和文档频率
      queryTokens.forEach(token => {
        if (token && typeof token === 'string' && token.trim().length > 0) {
          const normalizedToken = token.toLowerCase().trim();
          tokenFreq.set(normalizedToken, (tokenFreq.get(normalizedToken) || 0) + 1);
          docFreq.set(normalizedToken, 0);
        }
      });

      if (docFreq.size === 0) return null;

      allDocuments.forEach(doc => {
        if (!doc || typeof doc !== 'string') return;
        const docTokens = doc.toLowerCase().split(/[\s，。！？,.!?]/).filter(Boolean);
        const docTokenSet = new Set(docTokens);
        docFreq.forEach((_, token) => {
          if (docTokenSet.has(token)) {
            docFreq.set(token, docFreq.get(token) + 1);
          }
        });
      });

      // 计算 TF-IDF 权重
      const totalDocs = Math.max(1, allDocuments.length);
      const weights = queryTokens.map(token => {
        if (!token || typeof token !== 'string') return 0;
        const normalizedToken = token.toLowerCase().trim();
        const tf = tokenFreq.get(normalizedToken) || 0;
        const df = docFreq.get(normalizedToken) || 0;
        // 使用平滑的 IDF 计算，避免除零
        const idf = Math.log((totalDocs + 1) / (df + 1));
        return tf * idf;
      }).filter(w => isFinite(w) && w > 0);

      if (weights.length === 0) return null;

      // 归一化权重（使用 softmax 思想）
      const maxWeight = Math.max(...weights);
      const expWeights = weights.map(w => Math.exp(w - maxWeight)); // 数值稳定性
      const sum = expWeights.reduce((a, b) => a + b, 0);
      
      return sum > 0 
        ? expWeights.map(w => w / sum)
        : weights.map(() => 1 / weights.length);
    } catch (error) {
      BotUtil.makeLog('debug', `[AIStream] 计算注意力权重失败: ${error.message}`, 'AIStream');
      return null;
    }
  }

  /**
   * 相似度计算
   */
  cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || !Array.isArray(vec1) || !Array.isArray(vec2)) {
      return 0;
    }

    if (vec1.length !== vec2.length) {
      return 0;
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    if (denominator < 1e-8) return 0; // 避免除零
    
    const similarity = dotProduct / denominator;
    // 归一化到 [0, 1] 范围（余弦相似度范围是 [-1, 1]）
    return Math.max(0, (similarity + 1) / 2);
  }

  /**
   * 统一记忆系统（使用全局redis）
   * 支持消息记忆、笔记记忆、工作流记忆等
   */

  /**
   * 存储消息记忆（带embedding）
   */
  async storeMessageWithEmbedding(groupId, message) {
    if (!this.embeddingConfig.enabled || typeof redis === 'undefined' || !redis) {
      return;
    }

    if (!this.embeddingReady) {
      return;
    }

    try {
      const key = `ai:memory:${this.name}:${groupId}`;
      const messageText = `${message.nickname}: ${message.message}`;

      const embedding = await this.generateEmbedding(messageText);
      if (!embedding) {
        return;
      }

      const data = {
        type: 'message',
        message: messageText,
        embedding: embedding,
        userId: message.user_id,
        nickname: message.nickname,
        time: message.time || Date.now(),
        messageId: message.message_id
      };

      await redis.lPush(key, JSON.stringify(data));
      // 只保留最近 50 条，避免占用过多空间
      await redis.lTrim(key, 0, 49);
      await redis.expire(key, this.embeddingConfig.cacheExpiry || 2592000); // 默认30天
    } catch (e) {
      BotUtil.makeLog('debug', `[AIStream] 存储消息失败: ${e.message}`, 'AIStream');
    }
  }

  /**
   * 存储笔记到工作流（统一方法）
   * @param {string} workflowId - 工作流ID
   * @param {string} content - 笔记内容
   * @param {string} source - 来源
   * @param {boolean} isTemporary - 是否临时
   */
  async storeNote(workflowId, content, source = '', isTemporary = true) {
    if (typeof redis === 'undefined' || !redis) return false;

    try {
      const key = `ai:notes:${workflowId}`;
      const note = { content, source, time: Date.now(), temporary: isTemporary };
      await redis.lPush(key, JSON.stringify(note));
      await redis.expire(key, isTemporary ? 1800 : 86400 * 3);
      await redis.lTrim(key, 0, 99);
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `存储笔记失败: ${error.message}`, 'AIStream');
      return false;
    }
  }

  /**
   * 存储笔记（如果工作流存在）
   * 辅助方法，简化workflowId检查
   * @param {Object} context - 上下文对象
   * @param {string} content - 笔记内容
   * @param {string} source - 来源
   * @param {boolean} isTemporary - 是否临时
   */
  async storeNoteIfWorkflow(context, content, source = '', isTemporary = true) {
    if (context?.workflowId) {
      return await this.storeNote(context.workflowId, content, source, isTemporary);
    }
    return false;
  }

  async getNotes(workflowId) {
    if (typeof redis === 'undefined' || !redis) return [];

    try {
      const key = `ai:notes:${workflowId}`;
      const notes = await redis.lRange(key, 0, -1);
      const now = Date.now();
      const validNotes = [];

      for (const noteStr of notes) {
        try {
          const note = JSON.parse(noteStr);
          if (note.temporary && (now - (note.time || 0)) > 1800000) continue;
          validNotes.push(note);
        } catch (e) {
          continue;
        }
      }

      return validNotes;
    } catch (e) {
      return [];
    }
  }

  async storeWorkflowMemory(workflowId, data) {
    if (typeof redis === 'undefined' || !redis) return false;

    try {
      const key = `ai:workflow:${workflowId}`;
      const memory = { ...data, time: Date.now() };
      await redis.setEx(key, 86400 * 3, JSON.stringify(memory));
      return true;
    } catch (error) {
      BotUtil.makeLog('error', `存储工作流记忆失败: ${error.message}`, 'AIStream');
      return false;
    }
  }

  async getWorkflowMemory(workflowId) {
    if (typeof redis === 'undefined' || !redis) return null;

    try {
      const key = `ai:workflow:${workflowId}`;
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  async retrieveRelevantContexts(groupId, query, includeNotes = false, workflowId = null) {
    if (!this.embeddingConfig.enabled || typeof redis === 'undefined' || !redis) return [];
    if (!this.embeddingReady || !query) return [];

    try {
      const streamName = this.name;
      const key = `ai:memory:${streamName}:${groupId}`;
      const messages = await redis.lRange(key, 0, -1);

      if (includeNotes && workflowId) {
        const notes = await this.getNotes(workflowId);
        notes.forEach(note => {
          messages.push(JSON.stringify({
            type: 'note',
            message: `[笔记] ${note.content}`,
            time: note.time,
            source: note.source
          }));
        });
      }
      if (!messages || messages.length === 0) return [];

      const parsedMessages = [];
      for (const msg of messages) {
        try {
          const data = JSON.parse(msg);
          if (data && typeof data.message === 'string' && data.message.trim().length > 0) {
            parsedMessages.push(data);
          }
        } catch (e) {
          // 静默忽略无效的 JSON，但记录调试信息
          BotUtil.makeLog('debug', `[AIStream] 解析消息失败: ${e.message}`, 'AIStream');
        }
      }

      if (parsedMessages.length === 0) return [];

      const now = Date.now();
      const halfLifeDays = this.embeddingConfig.timeHalfLifeDays || 3;
      const idealLen = this.embeddingConfig.idealTextLength || 40;
      const qTokens = Array.from(new Set(query.split(/[\s，。！？,.!?]/).filter(Boolean)));

      /**
       * 优化的评分函数（使用神经网络启发式算法）
       * 结合语义相似度、时间衰减、关键词匹配、长度惩罚等多因素
       */
      const scoreItem = (baseSim, data, attentionWeights = null, queryEmbedding = null) => {
        // 防御性检查
        if (!data || typeof baseSim !== 'number' || !isFinite(baseSim)) {
          return null;
        }
        const text = data.message || '';

        // 1. 时间衰减（指数衰减模型）
        const ageMs = Math.max(0, now - (data.time || 0));
        const ageDays = ageMs / (24 * 60 * 60 * 1000);
        const timeDecay = Math.exp(-Math.log(2) * (ageDays / halfLifeDays));

        // 2. 关键词增强（使用改进的 Jaccard 相似度）
        let keywordBoost = 0;
        if (qTokens.length && text) {
          const dTokens = Array.from(new Set(text.toLowerCase().split(/[\s，。！？,.!?]/).filter(Boolean)));
          if (dTokens.length) {
            const qTokenSet = new Set(qTokens.map(t => t.toLowerCase()));
            const intersection = dTokens.filter(t => qTokenSet.has(t));
            const union = new Set([...qTokens.map(t => t.toLowerCase()), ...dTokens]);
            const jaccard = union.size > 0 ? intersection.length / union.size : 0;
            // 使用 sigmoid 函数平滑关键词增强
            keywordBoost = 0.3 * (1 / (1 + Math.exp(-5 * (jaccard - 0.3))));
          }
        }

        // 3. 长度惩罚（使用高斯函数，更平滑）
        const len = text.length || 1;
        const lengthRatio = len / idealLen || 1;
        // 使用改进的高斯惩罚函数
        const lengthPenalty = Math.exp(-0.5 * Math.pow(Math.log(Math.max(lengthRatio, 0.1)), 2));

        // 4. 语义相似度（基础分数）
        const semanticScore = Math.max(baseSim, 0);

        // 5. 注意力加权（如果提供了注意力权重）
        let finalSemanticScore = semanticScore;
        if (attentionWeights && data.embedding && queryEmbedding) {
          finalSemanticScore = this.attentionWeightedSimilarity(
            queryEmbedding,
            data.embedding,
            attentionWeights
          );
        }

        // 6. 综合评分（使用加权组合）
        // 语义相似度权重: 0.6, 关键词增强权重: 0.2, 时间衰减权重: 1.0, 长度惩罚权重: 0.8
        const finalScore = (finalSemanticScore * 0.6 + keywordBoost * 0.2) * 
                          timeDecay * 
                          (0.5 + 0.5 * lengthPenalty);

        return {
          message: text,
          similarity: Math.min(1, Math.max(0, finalScore)), // 限制在 [0, 1]
          baseSimilarity: baseSim,
          semanticScore: finalSemanticScore,
          keywordBoost,
          timeDecay,
          lengthPenalty,
          time: data.time,
          userId: data.userId,
          nickname: data.nickname
        };
      };

      let scored = [];
      let queryEmbedding = null;
      let attentionWeights = null;

      const mode = this.embeddingConfig.mode || 'local';
      const documents = parsedMessages.map(m => m.message || '').filter(Boolean);
      
      if (documents.length === 0) return [];

      try {
        if (mode === 'local') {
          // 本地模式：优化的 BM25 + 注意力机制
          if (!this.similarityCalculator) {
            BotUtil.makeLog('warn', '[AIStream] 相似度计算器未初始化', 'AIStream');
            return [];
          }
          
        this.similarityCalculator.calculateIDF(documents);
          
          // 计算注意力权重（基于查询词的重要性）
          if (qTokens.length > 0) {
            attentionWeights = this.calculateAttentionWeights(qTokens, documents);
          }
          
          scored = parsedMessages
            .filter(data => data && data.message)
            .map(data => {
              try {
          const bm25Score = this.similarityCalculator.score(query, data.message);
                // 改进的 BM25 归一化（使用 sigmoid 函数）
                const baseSim = 1 / (1 + Math.exp(-Math.max(bm25Score, -10) / 5)); // 防止溢出
                return scoreItem(baseSim, data, attentionWeights, queryEmbedding);
              } catch (err) {
                BotUtil.makeLog('debug', `[AIStream] BM25计算失败: ${err.message}`, 'AIStream');
                return null;
              }
            })
            .filter(Boolean);
      } else {
          // 远程模式：向量相似度 + 注意力机制
          queryEmbedding = await this.generateEmbedding(query);
          if (!queryEmbedding || !Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
            BotUtil.makeLog('debug', '[AIStream] 无法生成查询向量', 'AIStream');
            return [];
          }

          // 计算注意力权重（基于向量维度的重要性）
          if (qTokens.length > 0) {
            attentionWeights = this.calculateAttentionWeights(qTokens, documents);
          }

        scored = parsedMessages
            .filter(data => {
              if (!data) return false;
              const embedding = data.embedding;
              return Array.isArray(embedding) && embedding.length > 0 && embedding.length === queryEmbedding.length;
            })
          .map(data => {
              try {
            const baseSim = this.cosineSimilarity(queryEmbedding, data.embedding);
                if (isNaN(baseSim) || !isFinite(baseSim)) {
                  return null;
                }
                return scoreItem(baseSim, data, attentionWeights, queryEmbedding);
              } catch (err) {
                BotUtil.makeLog('debug', `[AIStream] 相似度计算失败: ${err.message}`, 'AIStream');
                return null;
              }
            })
            .filter(Boolean);
        }

        // 使用自适应阈值（基于分数分布）
        const threshold = this.calculateAdaptiveThreshold(scored, this.embeddingConfig.similarityThreshold ?? 0.1);
        const preFiltered = scored.filter(s => s && s.similarity >= threshold);
        preFiltered.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

      return preFiltered.slice(0, this.embeddingConfig.maxContexts || 8);
      } catch (error) {
        BotUtil.makeLog('error', `[AIStream] 检索上下文失败: ${error.message}`, 'AIStream', error);
        return [];
      }
    } catch (e) {
      return [];
    }
  }

  /**
   * 检索知识库上下文（自动集成到 RAG 流程）
   */
  async retrieveKnowledgeContexts(query) {
    // 检查是否有合并的 database stream
    if (this._mergedStreams) {
      for (const stream of this._mergedStreams) {
        if (stream.name === 'database' && typeof stream.retrieveKnowledgeContexts === 'function') {
          return await stream.retrieveKnowledgeContexts(query, this.embeddingConfig.maxContexts || 3);
        }
      }
    }
    return [];
  }

  /**
   * 构建增强上下文（完整 RAG 流程：历史对话 + 知识库）
   */
  async buildEnhancedContext(e, question, baseMessages) {
    const groupId = e ? (e.group_id || `private_${e.user_id}`) : 'default';

    // 提取查询文本
    let query = '';
    if (typeof question === 'string') {
      query = question;
    } else if (question && typeof question === 'object') {
      query = question.content || question.text || '';
    }

    // 如果query为空，尝试从baseMessages中提取
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
      // 1. 检索历史对话上下文
      const historyContexts = this.embeddingConfig.enabled && this.embeddingReady
        ? await this.retrieveRelevantContexts(groupId, query)
        : [];

      // 2. 检索知识库上下文（自动集成）
      const knowledgeContexts = await this.retrieveKnowledgeContexts(query);

      // 3. 合并所有上下文
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

      // 4. Token 优化（使用注意力机制优化上下文选择）
      const maxContextTokens = Math.floor((this.config.maxTokens || 6000) * 0.2);
      const optimizedContexts = await this.optimizeContextsWithAttention(allContexts, query, maxContextTokens);

      if (optimizedContexts.length === 0) {
        return baseMessages;
      }

      // 5. 构建上下文提示词
      const enhanced = [...baseMessages];
      const contextParts = [];
      
      // 分组显示
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
   * 注册函数（Function Calling）
   * 
   * 注册一个可被AI调用的函数，支持权限控制、启用/禁用等。
   * 
   * @param {string} name - 函数名称（必填）
   * @param {Object} options - 函数配置
   *   - handler: 函数处理函数 (params) => {}
   *   - prompt: 函数描述（用于AI理解函数用途）
   *   - parser: 参数解析器函数（可选）
   *   - enabled: 是否启用（默认true）
   *   - permission: 权限要求（可选）
   *   - description: 函数描述
   * @example
   * this.registerFunction('get_weather', {
   *   handler: async (params) => {
   *     return { weather: '晴天', temp: 25 };
   *   },
   *   prompt: '获取指定城市的天气信息',
   *   description: '获取天气'
   * });
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

    // 支持prompt为函数类型，用于动态生成（如包含知识库列表）
    const resolvedPrompt = typeof prompt === 'function' ? prompt() : prompt;

    this.functions.set(name, {
      name,
      handler,
      prompt: resolvedPrompt,
      parser,
      enabled: this.functionToggles[name] ?? enabled,
      permission,
      description,
      // 保存所有其他选项（如 requireAdmin, requireOwner 等）
      ...Object.fromEntries(
        Object.entries(options).filter(([key]) => 
          !['handler', 'prompt', 'parser', 'enabled', 'permission', 'description'].includes(key)
        )
      )
    });
  }

  isFunctionEnabled(name) {
    const func = this.functions.get(name);
    return func?.enabled ?? false;
  }

  toggleFunction(name, enabled) {
    const func = this.functions.get(name);
    if (func) {
      func.enabled = enabled;
      this.functionToggles[name] = enabled;
    }
  }

  getEnabledFunctions() {
    return Array.from(this.functions.values()).filter(f => f.enabled);
  }

  /**
   * 合并另一个 Stream 的函数到当前 Stream
   * 
   * @param {AIStream} stream - 要合并的 Stream 实例
   * @param {Object} options - 合并选项
   *   - overwrite: 是否覆盖已存在的函数（默认false）
   *   - prefix: 为合并的函数添加前缀（可选）
   * @example
   * const toolsStream = new ToolsStream();
   * await toolsStream.init();
   * this.merge(toolsStream);
   */
  merge(stream, options = {}) {
    const { overwrite = false, prefix = '' } = options;

    if (!stream || !stream.functions) {
      throw new Error('无效的 Stream 实例');
    }

    // 初始化 _mergedStreams 数组
    if (!this._mergedStreams) {
      this._mergedStreams = [];
    }

    // 添加到合并列表
    if (!this._mergedStreams.includes(stream)) {
      this._mergedStreams.push(stream);
    }

    // 复制函数
    let mergedCount = 0;
    let skippedCount = 0;

    for (const [name, func] of stream.functions.entries()) {
      const newName = prefix ? `${prefix}${name}` : name;

      if (this.functions.has(newName) && !overwrite) {
        skippedCount++;
        continue;
      }

      this.functions.set(newName, func);
      mergedCount++;
    }

    BotUtil.makeLog('debug', `[${this.name}] 合并 ${stream.name}: 成功 ${mergedCount}, 跳过 ${skippedCount}`, 'AIStream');

    return { mergedCount, skippedCount };
  }

  /**
   * 构建系统提示词（可选实现）
   * 
   * 子类可选择实现此方法，用于构建AI的系统提示词。
   * 如果未实现，将返回空字符串。
   * 
   * @param {Object} context - 上下文对象
   * @returns {string|Promise<string>} 系统提示词
   * @example
   * async buildSystemPrompt(context) {
   *   return `你是一个智能助手。
   * 当前用户：${context.user}
   * 当前时间：${new Date().toLocaleString()}`;
   * }
   */
  buildSystemPrompt(context) {
    return '';
  }


  buildFunctionsPrompt() {
    const enabledFuncs = this.getEnabledFunctions();
    if (enabledFuncs.length === 0) return '';

    // 动态解析prompt（如果为函数类型）
    const prompts = enabledFuncs
      .filter(f => f.prompt)
      .map(f => typeof f.prompt === 'function' ? f.prompt() : f.prompt)
      .join('\n');

    return prompts ? `\n【功能列表】\n${prompts}` : '';
  }

  /**
   * 构建对话上下文（可选实现）
   * 
   * 子类可选择实现此方法，用于根据事件和问题构建完整的对话上下文。
   * 如果未实现，将返回空数组。
   * 
   * @param {Object} e - 事件对象（可选）
   * @param {string|Object} question - 用户问题或消息对象
   *   - 字符串：直接作为用户消息
   *   - 对象：{ text: string, persona?: string }
   * @returns {Promise<Array<Object>>} 消息数组
   *   - 格式: [{ role: 'system'|'user'|'assistant', content: string }]
   * @example
   * async buildChatContext(e, question) {
   *   const systemPrompt = await this.buildSystemPrompt({ e, question });
   *   return [
   *     { role: 'system', content: systemPrompt },
   *     { role: 'user', content: typeof question === 'string' ? question : question.text }
   *   ];
   * }
   */
  async buildChatContext(e, question) {
    return [];
  }

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

    // 优先按 AI 文本中的位置（order）排序，保证执行顺序与模型输出一致
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
   * 执行函数（增强版：支持验证和反思）
   */
  async executeFunction(type, params, context) {
    const func = this.functions.get(type);

    if (!func || !func.enabled) {
      return { success: false, error: '函数不存在或已禁用' };
    }

    // 参数验证
    const validation = await this.validateFunctionParams(func, params, context);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // 权限检查
    if (func.permission && !(await this.checkPermission(func.permission, context))) {
      return { success: false, error: '权限不足' };
    }

    // 执行函数（带错误处理和反思）
    try {
      const result = func.handler ? await func.handler(validation.params || params, context) : null;
      
      // 结果验证
      const verified = await this.verifyFunctionResult(func, result, context);
      if (!verified.valid) {
        return { success: true, result, verified: false, warning: verified.reason };
      }
      
      return { success: true, result, verified: true };
    } catch (error) {
      // 错误反思和重试
      const reflection = await this.reflectOnError(func, params, error, context);
      if (reflection.shouldRetry && reflection.adjustedParams) {
        try {
          const retryResult = func.handler ? await func.handler(reflection.adjustedParams, context) : null;
          return { success: true, result: retryResult, retried: true };
        } catch (retryError) {
          return { success: false, error: retryError.message, reflection: reflection.reason };
        }
      }
      
      return { success: false, error: error.message, reflection: reflection.reason };
    }
  }

  /**
   * 验证函数参数（增强版：Schema Validation）
   */
  async validateFunctionParams(func, params, context) {
    // 1. 必需参数检查
    if (func.requiredParams) {
      for (const required of func.requiredParams) {
        if (params[required] === undefined || params[required] === null) {
          return { valid: false, error: `缺少必需参数: ${required}` };
        }
      }
    }

    // 2. Schema 验证（如果定义了）
    if (func.schema && func.schema.properties) {
      const schemaErrors = [];
      for (const [key, value] of Object.entries(params)) {
        const propSchema = func.schema.properties[key];
        if (propSchema) {
          const validation = this.validateParamBySchema(key, value, propSchema);
          if (!validation.valid) {
            schemaErrors.push(validation.error);
          }
        }
      }
      if (schemaErrors.length > 0) {
        return { valid: false, error: `参数验证失败: ${schemaErrors.join(', ')}` };
      }
    }

    // 3. 参数修正（自动修正常见错误）
    const correctedParams = await this.autoCorrectParams(func, params, context);
    
    return { valid: true, params: correctedParams };
  }

  /**
   * 根据 Schema 验证参数
   */
  validateParamBySchema(key, value, schema) {
    // 类型检查
    if (schema.type === 'string' && typeof value !== 'string') {
      return { valid: false, error: `${key} 必须是字符串` };
    }
    if (schema.type === 'number' && typeof value !== 'number') {
      return { valid: false, error: `${key} 必须是数字` };
    }
    if (schema.type === 'boolean' && typeof value !== 'boolean') {
      return { valid: false, error: `${key} 必须是布尔值` };
    }
    if (schema.type === 'array' && !Array.isArray(value)) {
      return { valid: false, error: `${key} 必须是数组` };
    }
    if (schema.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      return { valid: false, error: `${key} 必须是对象` };
    }

    // 枚举检查
    if (schema.enum && !schema.enum.includes(value)) {
      return { valid: false, error: `${key} 必须是以下值之一: ${schema.enum.join(', ')}` };
    }

    // 范围检查
    if (schema.type === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        return { valid: false, error: `${key} 必须 >= ${schema.minimum}` };
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        return { valid: false, error: `${key} 必须 <= ${schema.maximum}` };
      }
    }

    // 长度检查
    if (schema.type === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        return { valid: false, error: `${key} 长度必须 >= ${schema.minLength}` };
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        return { valid: false, error: `${key} 长度必须 <= ${schema.maxLength}` };
      }
    }

    return { valid: true };
  }

  /**
   * 自动修正参数
   */
  async autoCorrectParams(func, params, context) {
    const corrected = { ...params };
    
    // 修正常见错误
    for (const [key, value] of Object.entries(corrected)) {
      // 字符串去空格
      if (typeof value === 'string') {
        corrected[key] = value.trim();
      }
      
      // 路径修正（Windows/Unix 兼容）
      if (key.includes('path') || key.includes('file') || key.includes('dir')) {
        corrected[key] = value.replace(/\\/g, '/');
      }
      
      // 数字转换
      const propSchema = func.schema?.properties?.[key];
      if (propSchema?.type === 'number' && typeof value === 'string') {
        const num = parseFloat(value);
        if (!isNaN(num)) {
          corrected[key] = num;
        }
      }
    }
    
    return corrected;
  }

  /**
   * 验证函数结果
   */
  async verifyFunctionResult(func, result, context) {
    if (result === null || result === undefined) {
      return { valid: false, reason: '函数返回空结果' };
    }
    return { valid: true };
  }

  /**
   * 错误反思
   */
  async reflectOnError(func, params, error, context) {
    const errorType = this.analyzeErrorType(error);
    const shouldRetry = errorType === 'network' || errorType === 'timeout';
    return {
      shouldRetry,
      adjustedParams: shouldRetry ? params : null,
      reason: `错误类型: ${errorType}`
    };
  }

  /**
   * 分析错误类型
   */
  analyzeErrorType(error) {
    const message = error.message?.toLowerCase() || '';
    if (message.includes('timeout') || message.includes('网络')) return 'timeout';
    if (message.includes('network') || message.includes('连接')) return 'network';
    if (message.includes('参数') || message.includes('invalid')) return 'invalid_params';
    if (message.includes('权限') || message.includes('permission')) return 'permission';
    return 'unknown';
  }

  /**
   * ReAct 模式执行函数（思考-行动-观察循环）
   */
  async executeFunctionsWithReAct(functions, context, question, maxIterations = 3) {
    if (!functions || functions.length === 0) return;

    const executionGroups = this.analyzeFunctionDependencies(functions);
    
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const results = [];
      
      for (const group of executionGroups) {
        if (group.length === 1) {
          const result = await this.executeFunctionWithReAct(group[0], context, question, iteration);
          results.push(result);
        } else {
          const groupResults = await Promise.allSettled(
            group.map(func => this.executeFunctionWithReAct(func, context, question, iteration))
          );
          results.push(...groupResults.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason }));
        }
      }
      
      const observation = this.observeResults(results, question);
      if (observation.completed || iteration >= maxIterations - 1) break;
      
      if (observation.needsMoreActions) {
        const nextActions = await this.thinkNextActions(question, results, observation, context);
        if (!nextActions || nextActions.length === 0) break;
        executionGroups.push(...this.analyzeFunctionDependencies(nextActions));
      }
    }
  }

  /**
   * ReAct 模式执行单个函数（增强版：Chain-of-Thought）
   */
  async executeFunctionWithReAct(func, context, question, iteration) {
    // 1. Thought: Chain-of-Thought 推理
    const thought = await this.reasonWithChainOfThought(func, question, context, iteration);
    
    // 2. Action: 执行函数
    const actionResult = await this._executeFunctionWithMerge(func, context);
    
    // 3. Observation: 观察结果（Self-Consistency 检查）
    const observation = await this.observeWithConsistency(func, actionResult, thought, context);
    
    return { func, thought, actionResult, observation, iteration };
  }

  /**
   * Chain-of-Thought 推理
   */
  async reasonWithChainOfThought(func, question, context, iteration) {
    // 构建思维链
    const reasoningSteps = [
      `步骤 ${iteration + 1}: 分析用户需求`,
      `用户问题: ${question}`,
      `需要执行的函数: ${func.type}`,
      `函数参数: ${JSON.stringify(func.params)}`,
      `执行原因: 这个函数可以帮助${this.explainFunctionPurpose(func)}`
    ];

    return {
      reason: `执行 ${func.type} 以完成用户请求`,
      reasoningChain: reasoningSteps,
      confidence: this.estimateConfidence(func, question),
      iteration
    };
  }

  /**
   * 解释函数目的
   */
  explainFunctionPurpose(func) {
    const funcDesc = func.description || func.prompt || '';
    if (funcDesc.includes('读取') || funcDesc.includes('read')) return '读取信息';
    if (funcDesc.includes('写入') || funcDesc.includes('write')) return '保存信息';
    if (funcDesc.includes('搜索') || funcDesc.includes('search')) return '搜索内容';
    if (funcDesc.includes('执行') || funcDesc.includes('execute')) return '执行操作';
    return '完成任务';
  }

  /**
   * 估计执行信心度
   */
  estimateConfidence(func, question) {
    // 简单的信心度估计
    const hasParams = func.params && Object.keys(func.params).length > 0;
    const questionMatches = question.toLowerCase().includes(func.type.toLowerCase());
    return hasParams && questionMatches ? 0.9 : 0.7;
  }

  /**
   * 一致性观察（Self-Consistency）
   */
  async observeWithConsistency(func, actionResult, thought, context) {
    const success = actionResult?.success !== false;
    const hasResult = actionResult?.result !== null && actionResult?.result !== undefined;
    
    // 一致性检查：结果是否符合预期
    const isConsistent = success && hasResult;
    
    // 验证结果质量
    const qualityCheck = await this.checkResultQuality(func, actionResult?.result, context);
    
    return {
      success,
      result: actionResult?.result,
      isConsistent,
      qualityScore: qualityCheck.score,
      needsMoreActions: !isConsistent || qualityCheck.score < 0.5,
      observation: qualityCheck.observation
    };
  }

  /**
   * 检查结果质量（增强版：多维度评估）
   */
  async checkResultQuality(func, result, context) {
    if (!result) {
      return { score: 0, observation: '结果为空' };
    }

    // 多维度质量评估
    let score = 0.5;
    const checks = [];
    
    // 1. 类型检查
    if (typeof result === 'object' && !Array.isArray(result)) {
      const keys = Object.keys(result);
      if (keys.length > 0) {
        score += 0.2;
        checks.push('对象结构完整');
      }
      // 检查是否有错误字段
      if (result.error) {
        score -= 0.3;
        checks.push('包含错误信息');
      }
    } else if (typeof result === 'string') {
      if (result.length > 0) {
        score += 0.2;
        checks.push('字符串非空');
        // 检查是否包含错误关键词
        const errorKeywords = ['错误', '失败', 'error', 'failed', 'exception'];
        if (errorKeywords.some(kw => result.toLowerCase().includes(kw))) {
          score -= 0.2;
          checks.push('可能包含错误信息');
        }
      }
    } else if (Array.isArray(result)) {
      if (result.length > 0) {
        score += 0.15;
        checks.push('数组非空');
      }
    } else if (typeof result === 'number') {
      if (isFinite(result)) {
        score += 0.1;
        checks.push('数值有效');
      }
    } else if (typeof result === 'boolean') {
      score += 0.1;
      checks.push('布尔值有效');
    }
    
    // 2. 完整性检查（如果函数定义了期望的结果结构）
    if (func.expectedResult) {
      const expectedType = func.expectedResult.type;
      if (expectedType && typeof result !== expectedType) {
        score -= 0.2;
        checks.push('类型不匹配');
      }
    }
    
    // 限制分数范围
    score = Math.min(1, Math.max(0, score));

    return {
      score,
      observation: score >= 0.7 ? '结果质量良好' : score >= 0.5 ? '结果质量一般' : '结果质量较差',
      checks
    };
  }

  /**
   * 观察所有结果
   */
  observeResults(results, question) {
    const allSuccess = results.every(r => r.success !== false);
    const hasErrors = results.some(r => r.success === false);
    return {
      completed: allSuccess && !hasErrors,
      needsMoreActions: hasErrors || results.length === 0,
      results,
      errorCount: results.filter(r => r.success === false).length
    };
  }

  /**
   * 思考下一步动作（增强版：Chain-of-Thought + Self-Consistency）
   */
  async thinkNextActions(question, results, observation, context) {
    if (observation.errorCount > 0) {
      // 错误反思：分析失败原因并生成修正动作
      return await this.reflectAndPlanCorrection(question, results, observation, context);
    }
    
    // 检查是否真的完成（Self-Consistency 检查）
    const consistencyCheck = await this.checkTaskCompletion(question, results, context);
    if (!consistencyCheck.completed) {
      // 生成补充动作
      return await this.planAdditionalActions(question, results, consistencyCheck, context);
    }
    
    return [];
  }

  /**
   * 错误反思和修正计划（Reflexion）
   */
  async reflectAndPlanCorrection(question, results, observation, context) {
    const failedActions = results.filter(r => r.success === false);
    if (failedActions.length === 0) return [];

    // 分析失败原因
    const reflections = await Promise.all(
      failedActions.map(async (failed) => {
        const reflection = await this.deepReflect(failed, question, context);
        return {
          originalAction: failed.func,
          reflection,
          correctedAction: await this.generateCorrectedAction(failed, reflection, context)
        };
      })
    );

    return reflections
      .filter(r => r.correctedAction)
      .map(r => r.correctedAction);
  }

  /**
   * 深度反思（Reflexion）
   */
  async deepReflect(failedResult, question, context) {
    const error = failedResult.error || failedResult.actionResult?.error;
    const func = failedResult.func;
    
    // 分析错误类型和原因
    const errorAnalysis = {
      type: this.analyzeErrorType(error),
      message: error?.message || '未知错误',
      function: func.type,
      params: func.params
    };

    // 生成反思提示
    const reflectionPrompt = `分析以下错误并思考如何修正：

用户问题：${question}
执行的函数：${func.type}
函数参数：${JSON.stringify(func.params)}
错误信息：${errorAnalysis.message}
错误类型：${errorAnalysis.type}

请思考：
1. 错误的原因是什么？
2. 如何修正参数或策略？
3. 是否需要先执行其他操作？`;

    // 这里可以调用 AI 进行深度反思（简化实现）
    return {
      reason: `函数 ${func.type} 执行失败：${errorAnalysis.message}`,
      suggestion: `建议检查参数是否正确，或尝试其他方法`,
      shouldRetry: errorAnalysis.type === 'network' || errorAnalysis.type === 'timeout',
      adjustedParams: errorAnalysis.type === 'invalid_params' ? this.adjustParamsForError(func, error) : null
    };
  }

  /**
   * 生成修正后的动作
   */
  async generateCorrectedAction(failedResult, reflection, context) {
    if (!reflection.shouldRetry && !reflection.adjustedParams) {
      return null;
    }

    return {
      type: failedResult.func.type,
      params: reflection.adjustedParams || failedResult.func.params,
      dependsOn: failedResult.func.dependsOn || [],
      retry: true
    };
  }

  /**
   * 检查任务完成度（Self-Consistency + 质量评估）
   */
  async checkTaskCompletion(question, results, context) {
    if (!results || results.length === 0) {
      return { completed: false, missingResults: [], reason: '没有执行任何动作' };
    }

    // 检查所有动作是否成功
    const allSuccess = results.every(r => r && r.success !== false);
    
    // 检查结果是否满足用户需求
    const resultSummary = results
      .filter(r => r && r.func)
      .map(r => ({
        function: r.func.type,
        success: r.success !== false,
        hasResult: r.actionResult?.result !== null && r.actionResult?.result !== undefined,
        qualityScore: r.observation?.qualityScore || 0
      }));

    // 一致性检查：结果是否完整且质量良好
    const hasCompleteResults = resultSummary.every(r => r.success && r.hasResult);
    const hasGoodQuality = resultSummary.every(r => r.qualityScore >= 0.5);
    
    // 综合判断
    const completed = allSuccess && hasCompleteResults && hasGoodQuality;
    
    return {
      completed,
      missingResults: resultSummary.filter(r => !r.hasResult).map(r => r.function),
      lowQualityResults: resultSummary.filter(r => r.qualityScore < 0.5).map(r => r.function),
      reason: completed 
        ? '任务已完成且质量良好' 
        : !hasCompleteResults 
          ? '部分结果缺失' 
          : !hasGoodQuality 
            ? '部分结果质量不佳' 
            : '部分动作执行失败'
    };
  }

  /**
   * 规划补充动作（增强版：智能规划）
   */
  async planAdditionalActions(question, results, consistencyCheck, context) {
    const actions = [];
    
    // 1. 处理缺失的结果
    const missingFunctions = consistencyCheck.missingResults || [];
    for (const funcType of missingFunctions) {
      const originalResult = results.find(r => r && r.func && r.func.type === funcType);
      if (originalResult && originalResult.func) {
        actions.push({
          type: funcType,
          params: originalResult.func.params,
          dependsOn: originalResult.func.dependsOn || [],
          retry: true,
          reason: '结果缺失，重新执行'
        });
      }
    }
    
    // 2. 处理质量不佳的结果
    const lowQualityFunctions = consistencyCheck.lowQualityResults || [];
    for (const funcType of lowQualityFunctions) {
      const originalResult = results.find(r => r && r.func && r.func.type === funcType);
      if (originalResult && originalResult.func) {
        // 尝试调整参数以提高质量
        const adjustedParams = await this.improveParamsForQuality(originalResult.func, originalResult.actionResult, context);
        actions.push({
          type: funcType,
          params: adjustedParams || originalResult.func.params,
          dependsOn: originalResult.func.dependsOn || [],
          retry: true,
          reason: '质量不佳，优化后重试'
        });
      }
    }
    
    return actions;
  }

  /**
   * 改进参数以提高结果质量
   */
  async improveParamsForQuality(func, actionResult, context) {
    if (!func || !func.params || !actionResult) {
      return null;
    }

    const params = { ...func.params };
    const result = actionResult.result;
    let improved = false;
    
    // 如果结果是空或质量低，尝试调整参数
    if (!result || (typeof result === 'object' && Object.keys(result).length === 0)) {
      // 可以尝试添加更多参数或调整参数值
      // 例如：增加搜索范围、添加更多过滤条件等
    }
    
    return improved ? params : null;
  }

  /**
   * 调整参数以修正错误（增强版：智能错误修正）
   */
  adjustParamsForError(func, error) {
    if (!func || !func.params) {
      return null;
    }

    const params = { ...func.params };
    const errorMsg = error?.message?.toLowerCase() || '';
    let adjusted = false;
    
    // 1. 路径错误修正
    if (errorMsg.includes('not found') || errorMsg.includes('不存在') || errorMsg.includes('no such file')) {
      for (const [key, value] of Object.entries(params)) {
        if ((key.includes('path') || key.includes('file') || key.includes('dir')) && typeof value === 'string') {
          // 尝试修正路径格式
          let correctedPath = value.replace(/\\/g, '/');
          // 移除多余的斜杠
          correctedPath = correctedPath.replace(/\/+/g, '/');
          // 如果是相对路径，尝试添加当前工作目录
          if (!correctedPath.startsWith('/') && !correctedPath.match(/^[A-Z]:/i)) {
            // 可以尝试添加默认路径前缀
          }
          params[key] = correctedPath;
          adjusted = true;
        }
      }
    }
    
    // 2. 参数类型错误修正
    if (errorMsg.includes('invalid') || errorMsg.includes('类型') || errorMsg.includes('type')) {
      const propSchema = func.schema?.properties;
      if (propSchema) {
        for (const [key, value] of Object.entries(params)) {
          const schema = propSchema[key];
          if (schema) {
            // 尝试类型转换
            if (schema.type === 'number' && typeof value === 'string') {
              const num = parseFloat(value);
              if (!isNaN(num)) {
                params[key] = num;
                adjusted = true;
              }
            } else if (schema.type === 'string' && typeof value !== 'string') {
              params[key] = String(value);
              adjusted = true;
            }
          }
        }
      }
    }
    
    // 3. 权限错误（无法修正，但记录）
    if (errorMsg.includes('permission') || errorMsg.includes('权限')) {
      // 权限错误通常无法通过调整参数解决
      return null;
    }
    
    return adjusted ? params : null;
  }

  /**
   * 分析函数依赖关系，分组以便并行执行（优化版：拓扑排序）
   */
  analyzeFunctionDependencies(functions) {
    if (!functions || functions.length === 0) {
      return [];
    }

    // 构建依赖图
    const graph = new Map();
    const inDegree = new Map();
    
    functions.forEach(func => {
      const funcType = func.type;
      graph.set(funcType, func);
      inDegree.set(funcType, (func.dependsOn || []).length);
    });
    
    // 拓扑排序分组
    const groups = [];
    const queue = [];
    const executed = new Set();
    
    // 初始化：找到所有无依赖的函数
    inDegree.forEach((degree, funcType) => {
      if (degree === 0) {
        queue.push(funcType);
      }
    });
    
    while (queue.length > 0 || executed.size < functions.length) {
      // 当前层（可以并行执行的函数）
      const currentLevel = [];
      
      // 处理所有无依赖的函数
      while (queue.length > 0) {
        const funcType = queue.shift();
        if (executed.has(funcType)) continue;
        
        const func = graph.get(funcType);
        if (func) {
          currentLevel.push(func);
          executed.add(funcType);
        }
      }
      
      if (currentLevel.length > 0) {
        groups.push(currentLevel);
      }
      
      // 更新依赖计数，找到新的可执行函数
      functions.forEach(func => {
        if (executed.has(func.type)) return;
        
        const dependsOn = func.dependsOn || [];
        const canExecute = dependsOn.every(dep => executed.has(dep));
        
        if (canExecute && !queue.includes(func.type)) {
          queue.push(func.type);
        }
      });
      
      // 防止死循环
      if (queue.length === 0 && executed.size < functions.length) {
        // 处理循环依赖：强制执行剩余函数
        const remaining = functions.filter(f => !executed.has(f.type));
        if (remaining.length > 0) {
          groups.push(remaining);
          remaining.forEach(f => executed.add(f.type));
        }
        break;
      }
    }
    
    return groups.length > 0 ? groups : functions.map(f => [f]);
  }

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
   * 获取重试配置（从aistream.yaml读取）
   * @returns {Object} 重试配置对象
   */
  /**
   * 获取重试配置（从aistream.yaml读取，增强版：指数退避）
   */
  getRetryConfig() {
    const runtime = (cfg && cfg.aistream) ? cfg.aistream : {};
    const llm = (runtime && runtime.llm) ? runtime.llm : {};
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
   * 计算重试延迟（指数退避算法 + Jitter）
   */
  calculateRetryDelay(attempt, retryConfig) {
    const baseDelay = retryConfig.delay || 2000;
    const multiplier = retryConfig.backoffMultiplier || 2;
    const maxDelay = retryConfig.maxDelay || 10000;
    
    // 指数退避：delay = baseDelay * (multiplier ^ (attempt - 1))
    const delay = Math.min(baseDelay * Math.pow(multiplier, attempt - 1), maxDelay);
    
    // 添加随机抖动（Jitter），避免雷群效应
    const jitter = delay * 0.1 * (Math.random() * 2 - 1); // ±10% 随机抖动
    
    return Math.max(0, delay + jitter);
  }

  /**
   * 判断错误类型
   * @param {Error} error - 错误对象
   * @returns {Object} 错误类型信息
   */
  /**
   * 判断错误类型（增强版：更精确的错误分类）
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
   * @param {Object} errorInfo - 错误类型信息
   * @param {Object} retryConfig - 重试配置
   * @param {number} attempt - 当前尝试次数
   * @returns {boolean} 是否应该重试
   */
  /**
   * 判断是否应该重试（增强版：支持更多错误类型）
   */
  shouldRetry(errorInfo, retryConfig, attempt) {
    if (!retryConfig.enabled || attempt >= retryConfig.maxAttempts) {
      return false;
    }
    
    // 认证错误不重试
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

  /**
   * 格式化超时时间（毫秒转秒）
   * @param {Object} config - 配置对象
   * @returns {number} 超时秒数
   */
  getTimeoutSeconds(config) {
    const timeout = config.timeout || this.config?.timeout || 360000;
    return Math.round(timeout / 1000);
  }

  /**
   * 格式化消息预览（用于日志记录）
   * @param {Array} messages - 消息数组
   * @returns {string} 格式化后的消息预览
   */
  formatMessagesPreview(messages) {
    return messages.map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
      return `${m.role}: ${preview}`;
    }).join('\n');
  }

  /**
   * 记录AI调用日志
   * @param {string} type - 调用类型（'normal' 或 'stream'）
   * @param {Object} config - 配置对象
   * @param {Array} messages - 消息数组
   */
  logAICall(type, config, messages) {
    const messagesPreview = this.formatMessagesPreview(messages);
    const typeLabel = type === 'stream' ? '(流式)' : '';
    BotUtil.makeLog('info', 
      `[${this.name}] 调用LLM工厂${typeLabel}\nProvider: ${config.provider || 'unknown'}\n消息:\n${messagesPreview}`,
      'AIStream'
    );
  }

  /**
   * 记录AI响应日志
   * @param {string} response - 响应文本
   * @param {boolean} isStream - 是否为流式响应
   */
  logAIResponse(response, isStream = false) {
    const responsePreview = response && response.length > 500 
      ? response.substring(0, 500) + '...' 
      : (response || '(空响应)');
    const typeLabel = isStream ? '流式' : '';
    BotUtil.makeLog('info',
      `[${this.name}] LLM${typeLabel}响应${isStream ? '完成' : ''}\n长度: ${response?.length || 0}字符\n内容: ${responsePreview}`,
      'AIStream'
    );
  }

  /**
   * AI调用
   */
  async callAI(messages, apiConfig = {}) {
    const config = this.resolveLLMConfig(apiConfig);
    const retryConfig = this.getRetryConfig();
    this.logAICall('normal', config, messages);

    let lastError = null;
    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const client = LLMFactory.createClient(config);
        const response = await client.chat(messages, config);
        this.logAIResponse(response, false);
        return response;
      } catch (error) {
        lastError = error;
        const errorInfo = this.classifyError(error);
        const timeoutSeconds = this.getTimeoutSeconds(config);
        const shouldRetry = this.shouldRetry(errorInfo, retryConfig, attempt);
        
        // 记录警告日志
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
        
        // 如果需要重试，等待后继续
        if (shouldRetry) {
          await BotUtil.sleep(retryConfig.delay);
          continue;
        }
        
        // 不需要重试或已达到最大重试次数
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
    
    // 所有重试都失败
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
   * 调用AI（流式输出）
   *
   * 调用AI接口并实时返回增量响应，支持SSE（Server-Sent Events）协议。
   * 可选在流式结束后对完整结果进行函数解析与执行，用于桌面/设备等带指令能力的工作流。
   *
   * @param {Array<Object>} messages - 消息数组
   * @param {Object} apiConfig - API配置（可选）
   * @param {Function} onDelta - 增量回调函数 (delta: string) => {}
   *   - delta: 本次增量文本
   * @param {Object} [options] - 额外控制参数
   *   - {boolean} enableFunctionCalling 是否在流结束后执行函数解析（默认 false）
   *   - {Object} context 传递给函数执行的上下文对象（如 { e, question, config }）
   * @returns {Promise<string>} 完整响应文本（如果未启用函数解析则为原始文本）
   */
  async callAIStream(messages, apiConfig = {}, onDelta, options = {}) {
    const config = this.resolveLLMConfig(apiConfig);
    const retryConfig = this.getRetryConfig();
    this.logAICall('stream', config, messages);

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
        this.logAIResponse(fullText, true);
        break; // 成功，退出重试循环
      } catch (error) {
        lastError = error;
        const errorInfo = this.classifyError(error);
        const timeoutSeconds = this.getTimeoutSeconds(config);
        const shouldRetry = this.shouldRetry(errorInfo, retryConfig, attempt);
        
        // 记录警告日志
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
        
        // 如果需要重试，重置fullText并等待后继续
        if (shouldRetry) {
          fullText = ''; // 重置文本，准备重试
          await BotUtil.sleep(retryConfig.delay);
          continue;
        }
        
        // 不需要重试或已达到最大重试次数
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
    
    // 所有重试都失败
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
   * 根据运行时配置与外部参数解析 LLM 配置
   * @param {Object} apiConfig - 自定义配置
   * @returns {Object} LLM配置
   */
  buildEmbeddingConfig(overrides = {}) {
    const runtime = cfg.aistream?.embedding || {};
    
    // 简化配置：只有 local 和 remote 两种模式
    const mode = overrides.mode || runtime.mode || 'local';
    const remoteConfig = runtime.remote || {};

    const result = {
      // 默认启用
      enabled: overrides.enabled ?? runtime.enabled ?? true,
      // 模式：local 或 remote
      mode: mode,
      // 通用配置
      maxContexts: overrides.maxContexts || runtime.maxContexts || 5,
      similarityThreshold: overrides.similarityThreshold || runtime.similarityThreshold || 0.6,
      cacheExpiry: overrides.cacheExpiry || runtime.cacheExpiry || 86400,
      // 远程模式配置
      apiUrl: overrides.apiUrl || remoteConfig.apiUrl || '',
      apiKey: overrides.apiKey || remoteConfig.apiKey || '',
      apiModel: overrides.apiModel || remoteConfig.apiModel || 'text-embedding-3-small',
      // 兼容旧配置
      ...overrides
    };

    return result;
  }

  applyEmbeddingOverrides(overrides = {}) {
    this.embeddingConfig = this.buildEmbeddingConfig({
      ...this.embeddingConfig,
      ...overrides
    });
    return this.embeddingConfig;
  }

  /**
   * 根据运行时配置与外部参数解析 LLM 配置
   * 
   * 配置优先级（从低到高）：
   * 1. llm.defaults - 全局默认配置
   * 2. llm.profiles[selectedProfile] - 选中的配置档位（如 balanced, fast, long）
   * 3. llm.workflows[workflowName].overrides - 工作流覆盖配置
   * 4. apiConfig - 代码传入的配置（最高优先级）
   * 
   * 提供商选择逻辑：
   * - 如果 apiConfig 中指定了 provider，使用指定的提供商
   * - 如果从配置文件读取，使用配置中的 provider（默认 gptgod）
   * - 如果都没有，默认使用 gptgod 提供商
   * 
   * @param {Object} apiConfig - 自定义配置
   *   - baseUrl: API 基础地址
   *   - apiKey: API 密钥
   *   - provider: LLM 提供商名称（如 'gptgod', 'volcengine' 等）
   *   - model: 模型名称
   *   - profile: 配置档位名称（如 'balanced', 'fast', 'long'）
   *   - 其他 LLM 参数（temperature, maxTokens 等）
   * @returns {Object} LLM配置
   */
  resolveLLMConfig(apiConfig = {}) {
    // 使用安全的配置读取，确保有默认值
    const merged = { ...this.config, ...apiConfig };
    const runtime = (cfg && cfg.aistream) ? cfg.aistream : {};
    const llm = (runtime && runtime.llm) ? runtime.llm : {};
    const vision = (runtime && runtime.vision) ? runtime.vision : {};
    const global = (runtime && runtime.global) ? runtime.global : {};

    // Provider配置：优先级 apiConfig > llm.Provider > 默认值
    const provider = merged.provider || llm.Provider || 'gptgod';
    // 识图运营商：可单独配置，否则默认与 LLM Provider 一致
    const visionProvider = (merged.visionProvider || vision.Provider || provider).toLowerCase();
    
    // 从aistream.yaml的global配置中读取timeout（优先使用全局配置）
    // 优先级：apiConfig.timeout > llm.timeout > global.maxTimeout > this.config.timeout > 默认360000
    const timeout = merged.timeout || 
                    (llm.timeout && typeof llm.timeout === 'number' ? llm.timeout : null) ||
                    (global.maxTimeout && typeof global.maxTimeout === 'number' ? global.maxTimeout : null) ||
                    (this.config && this.config.timeout && typeof this.config.timeout === 'number' ? this.config.timeout : null) ||
                    360000;

    // LLM Provider 到配置名的映射（可扩展）
    const llmConfigMap = {
      'gptgod': 'god',
      'volcengine': 'volcengine_llm',
      'xiaomimimo': 'xiaomimimo_llm'
    };

    // Vision Provider 到配置名的映射（可扩展）
    const visionConfigMap = {
      'gptgod': 'god_vision',
      'volcengine': 'volcengine_vision'
    };

    // 检查Provider是否支持
    if (!LLMFactory.hasProvider(provider)) {
      BotUtil.makeLog('error', `不支持的LLM提供商: ${provider}，已回退到gptgod`, 'AIStream');
      const fallbackProvider = 'gptgod';
      const fallbackConfigKey = llmConfigMap[fallbackProvider] || 'god';
      // 安全读取配置，确保cfg存在
      const fallbackConfig = (cfg && cfg[fallbackConfigKey] && typeof cfg[fallbackConfigKey] === 'object') 
        ? cfg[fallbackConfigKey] 
        : {};
      return {
        ...fallbackConfig,
        ...merged,
        provider: fallbackProvider,
        visionProvider: visionProvider,
        timeout // 确保timeout被传递
      };
    }

    // 动态获取 LLM 配置（安全读取）
    const llmConfigKey = llmConfigMap[provider];
    const providerConfig = (llmConfigKey && cfg && cfg[llmConfigKey] && typeof cfg[llmConfigKey] === 'object') 
      ? cfg[llmConfigKey] 
      : {};

    // 动态获取 Vision 配置（一个工厂一个配置文件，安全读取）
    let visionConfig = {};
    const visionConfigKey = visionConfigMap[visionProvider];
    if (visionConfigKey && cfg && cfg[visionConfigKey] && typeof cfg[visionConfigKey] === 'object') {
      visionConfig = cfg[visionConfigKey];
    }

    const finalConfig = {
      ...providerConfig,
      ...merged,
      provider,
      visionProvider,
      visionConfig,
      timeout // 确保timeout被正确传递
    };

    return finalConfig;
  }


  /**
   * 执行工作流
   */
  async execute(e, question, config) {
    try {
      const context = { e, question, config };
      
      // 如果stream有tools，注入到context中
      if (this.tools) {
        context.tools = this.tools;
      }
      
      const baseMessages = await this.buildChatContext(e, question);
      const messages = await this.buildEnhancedContext(e, question, baseMessages);
      
      const response = await this.callAI(messages, config);

      if (!response) {
        return null;
      }

      const { functions, cleanText } = this.parseFunctions(response, context);

      // 先发送自然语言回复（如果有），然后再执行函数
      // 这样可以确保用户先看到AI的自然语言回复，然后才看到工作流启动等操作
      if (cleanText && cleanText.trim() && e?.reply) {
        await e.reply(cleanText.trim()).catch(err => {
          BotUtil.makeLog('debug', `发送自然语言回复失败: ${err.message}`, 'AIStream');
        });
      }

      // 执行函数（支持 ReAct 模式和并行执行）
      await this.executeFunctionsWithReAct(functions, context, question);

      // 执行完成后，自动清理进程（如果启用了工具系统）
      if (context.tools && typeof context.tools.cleanupProcesses === 'function') {
        try {
          await context.tools.cleanupProcesses();
        } catch (err) {
          // 静默处理清理错误
        }
      }

      // 返回AI的原始回复，不做额外处理
      const finalResponse = cleanText || '';

      // 存储AI响应到记忆系统（包含执行的函数信息）
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

      return finalResponse;
    } catch (error) {
      BotUtil.makeLog('error',
        `工作流执行失败[${this.name}]: ${error.message}`,
        'AIStream'
      );
      return null;
    }
  }

  /**
   * 处理工作流（支持合并工作流和TODO决策）
   * 优化：简化调用方式，支持丰富的参数配置
   * @param {Object} e - 事件对象
   * @param {string|Object} question - 用户问题
   * @param {Object} options - 处理选项
   *   - mergeStreams: Array<string> - 要合并的工作流名称列表
   *   - enableTodo: boolean - 是否启用TODO智能决策
   *   - enableMemory: boolean - 是否启用记忆系统
   *   - enableDatabase: boolean - 是否启用知识库系统
   *   - apiConfig: Object - LLM配置
   * @returns {Promise<string|null>} 响应文本
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
      
      // 自动合并辅助工作流（如果启用）
      if (enableMemory || enableDatabase) {
        await this.autoMergeAuxiliaryStreams(stream, { enableMemory, enableDatabase });
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

        this.ensureWorkflowManager(stream);
      }

      // 步骤1: 执行AI调用（带人设）
      const finalQuestion = typeof question === 'string' 
        ? question 
        : (question?.content || question?.text || question);
      
      const response = await stream.execute(e, finalQuestion, apiConfig);
      
      // 步骤2: 检查是否需要自动启动工作流
      // 只有在AI明确输出了工作流命令时才启动工作流
      // 如果AI输出了其他命令，说明AI认为这是简单任务，不需要工作流
      // 如果AI没有输出任何命令，说明AI可能还在等待信息或认为需要更多信息，不应该自动启动工作流
      if (enableTodo && response && this.hasWorkflowCommand(response)) {
        // AI已经明确要求启动工作流，不需要再调用任务分析助手
        // 工作流会在execute中通过start_workflow handler自动启动
      }
      
      return response;
    } catch (error) {
      BotUtil.makeLog('error', `工作流处理失败[${this.name}]: ${error.message}`, 'AIStream');
      return null;
    }
  }

  /**
   * 获取工作流描述信息（标准化注册方法）
   * @returns {Object} 工作流描述信息
   */
  getInfo() {
    return {
      name: this.name,
      description: this.description,
      version: this.version,
      author: this.author,
      priority: this.priority,
      embedding: {
        enabled: this.embeddingConfig.enabled,
        mode: this.embeddingConfig.mode || 'local',
        ready: this.embeddingReady,
        maxContexts: this.embeddingConfig.maxContexts,
        threshold: this.embeddingConfig.similarityThreshold
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
   * 获取工作流描述信息（别名，兼容性）
   * @returns {Object} 工作流描述信息
   */
  getDescriptor() {
    return this.getInfo();
  }

  /**
   * 确保stream有workflowManager
   */
  ensureWorkflowManager(stream) {
    if (stream.workflowManager) {
      stream.workflowManager.stream = stream;
      return;
    }
    
    const todoStream = StreamLoader.getStream('todo');
    if (todoStream?.workflowManager) {
      todoStream.injectWorkflowManager(stream);
    }
  }

  /**
   * 检查响应中是否包含工作流命令
   */
  hasWorkflowCommand(response) {
    return response && /\[启动工作流:[^\]]+\]/.test(response);
  }

  /**
   * 自动合并辅助工作流（简化调用方式）
   * @param {Object} stream - 主工作流
   * @param {Object} options - 选项
   *   - enableMemory: boolean - 是否启用记忆系统
   *   - enableDatabase: boolean - 是否启用知识库
   */
  async autoMergeAuxiliaryStreams(stream, options = {}) {
    const { enableMemory = false, enableDatabase = false } = options;
    const StreamLoader = (await import('#infrastructure/aistream/loader.js')).default;
    
    const auxiliaryStreams = [];
    if (enableMemory) auxiliaryStreams.push('memory');
    if (enableDatabase) auxiliaryStreams.push('database');
    
    for (const streamName of auxiliaryStreams) {
      try {
        let auxStream = StreamLoader.getStream(streamName);
        
        // 如果stream不存在，尝试通过 StreamLoader 获取类并创建
        if (!auxStream) {
          const StreamClass = StreamLoader.getStreamClass(streamName);
          if (StreamClass) {
            auxStream = new StreamClass();
            await auxStream.init();
            StreamLoader.streams.set(streamName, auxStream);
          }
        }
        
        if (auxStream) {
          // 合并辅助工作流的功能
          const result = stream.merge(auxStream, { prefix: '' });
          BotUtil.makeLog('debug', `[${stream.name}] 自动合并辅助工作流 ${streamName}: +${result.mergedCount} 个函数`, 'AIStream');
          
          // 特殊处理：memory stream需要注入记忆到context
          if (streamName === 'memory' && auxStream.getMemoriesForContext) {
            const memories = await auxStream.getMemoriesForContext({ e: stream.context?.e });
            if (memories.length > 0) {
              if (!stream._auxiliaryContext) {
                stream._auxiliaryContext = {};
              }
              stream._auxiliaryContext.memories = memories;
            }
          }
        }
      } catch (error) {
        BotUtil.makeLog('warn', `[${stream.name}] 自动合并辅助工作流 ${streamName} 失败: ${error.message}`, 'AIStream');
      }
    }
  }


  /**
   * 提取问题文本
   */
  extractQuestionText(question) {
    if (typeof question === 'string') return question;
    return question?.content || question?.text || '';
  }

  async cleanup() {
    BotUtil.makeLog('debug', `[${this.name}] 清理资源`, 'AIStream');

    if (this.embeddingModel && typeof this.embeddingModel.dispose === 'function') {
      try {
        await this.embeddingModel.dispose();
      } catch (error) {
        // 静默处理
      }
    }

    this.embeddingModel = null;
    this.embeddingReady = false;
    this.similarityCalculator = null;
    this._initialized = false;
    this._embeddingInitialized = false;
  }
}