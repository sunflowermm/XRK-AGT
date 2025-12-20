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
 * 支持多种Embedding提供商（ONNX、HuggingFace、FastText、API、Lightweight）。
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
 *         enabled: true,
 *         provider: 'lightweight'
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

    // Embedding配置（支持全局档位）
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
      this.embeddingSession = null;
      this.tokenizer = null;
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

    const provider = this.embeddingConfig.provider;

    try {
      await this.tryInitProvider(provider);
      this.embeddingReady = true;
      this._embeddingInitialized = true;
    } catch (e) {
      this.embeddingConfig.enabled = false;
      this.embeddingReady = false;
      throw new Error('Embedding初始化失败');
    }
  }

  /**
   * 尝试初始化指定提供商
   */
  async tryInitProvider(provider) {
    switch (provider) {
      case 'lightweight':
        await this.initLightweightEmbedding();
        break;
      case 'onnx':
        await this.initONNXEmbedding();
        break;
      case 'hf':
        await this.initHFEmbedding();
        break;
      case 'fasttext':
        await this.initFastTextEmbedding();
        break;
      case 'api':
        await this.initAPIEmbedding();
        break;
      default:
        throw new Error(`未知提供商: ${provider}`);
    }
  }

  /**
   * 各种Embedding提供商初始化
   */
  async initLightweightEmbedding() {
    this.similarityCalculator = new LightweightSimilarity();
  }

  async initONNXEmbedding() {
    const ort = await import('onnxruntime-node');

    const modelName = this.embeddingConfig.onnxModel;
    const cachePath = this.embeddingConfig.cachePath;

    if (!fs.existsSync(cachePath)) {
      fs.mkdirSync(cachePath, { recursive: true });
    }

    const modelPath = await this.downloadONNXModel(modelName);

    this.embeddingSession = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all'
    });

    await this.loadONNXTokenizer(modelName);
    await this.testEmbeddingModel();
  }

  async downloadONNXModel(modelName) {
    const cachePath = this.embeddingConfig.cachePath;
    const modelDir = path.join(cachePath, modelName.replace('/', '_'));
    const modelPath = path.join(modelDir, 'model_quantized.onnx');

    if (fs.existsSync(modelPath)) {
      return modelPath;
    }

    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }

    const modelUrl = `https://huggingface.co/${modelName}/resolve/main/onnx/model_quantized.onnx`;

    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`下载失败: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(modelPath, Buffer.from(buffer));

    return modelPath;
  }

  async loadONNXTokenizer(modelName) {
    this.tokenizer = {
      encode: (text) => {
        const tokens = text.split('').map(c => c.charCodeAt(0));
        return tokens.slice(0, 512);
      }
    };
  }

  async initHFEmbedding() {
    const config = this.embeddingConfig;

    if (!config.hfToken) {
      throw new Error('未配置HF Token');
    }

    const { HfInference } = await import('@huggingface/inference');
    this.embeddingModel = new HfInference(config.hfToken);

    await this.testHFConnection();
  }

  async initFastTextEmbedding() {
    const FastText = await import('fasttext.js');

    const modelName = this.embeddingConfig.fasttextModel;
    const modelPath = path.join(this.embeddingConfig.cachePath, modelName);

    if (!fs.existsSync(modelPath)) {
      await this.downloadFastTextModel(modelName);
    }

    this.embeddingModel = new FastText.FastText();
    await this.embeddingModel.load(modelPath);
    await this.testEmbeddingModel();
  }

  async downloadFastTextModel(modelName) {
    const cachePath = this.embeddingConfig.cachePath;
    const modelPath = path.join(cachePath, modelName);

    if (!fs.existsSync(cachePath)) {
      fs.mkdirSync(cachePath, { recursive: true });
    }

    const modelUrl = `https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/${modelName}`;

    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`下载失败: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(modelPath, Buffer.from(buffer));
  }

  async initAPIEmbedding() {
    const config = this.embeddingConfig;

    if (!config.apiUrl || !config.apiKey) {
      throw new Error('未配置API');
    }

    await this.testAPIConnection();
  }

  /**
   * 测试方法
   */
  async testEmbeddingModel() {
    const vector = await this.generateEmbedding('测试');
    if (!vector || !Array.isArray(vector) || vector.length === 0) {
      throw new Error('模型返回无效向量');
    }
  }

  async testHFConnection() {
    const testVector = await this.generateHFEmbedding('test');
    if (!testVector || !Array.isArray(testVector) || testVector.length === 0) {
      throw new Error('HF API返回无效向量');
    }
  }

  async testAPIConnection() {
    const testVector = await this.generateAPIEmbedding('test');
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
      switch (this.embeddingConfig.provider) {
        case 'lightweight':
          return text;
        case 'onnx':
          return await this.generateONNXEmbedding(text);
        case 'hf':
          return await this.generateHFEmbedding(text);
        case 'fasttext':
          return await this.generateFastTextEmbedding(text);
        case 'api':
          return await this.generateAPIEmbedding(text);
        default:
          return null;
      }
    } catch (error) {
      BotUtil.makeLog('debug',
        `[${this.name}] 生成Embedding失败: ${error.message}`,
        'AIStream'
      );
      return null;
    }
  }

  async generateONNXEmbedding(text) {
    if (!this.embeddingSession || !this.tokenizer) {
      throw new Error('ONNX模型未加载');
    }

    const ort = await import('onnxruntime-node');

    const inputIds = this.tokenizer.encode(text);
    const attentionMask = new Array(inputIds.length).fill(1);

    const maxLength = 512;
    while (inputIds.length < maxLength) {
      inputIds.push(0);
      attentionMask.push(0);
    }

    const inputIdsTensor = new ort.Tensor('int64', BigInt64Array.from(inputIds.map(id => BigInt(id))), [1, maxLength]);
    const attentionMaskTensor = new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(m => BigInt(m))), [1, maxLength]);

    const feeds = {
      input_ids: inputIdsTensor,
      attention_mask: attentionMaskTensor
    };

    const results = await this.embeddingSession.run(feeds);
    const outputTensor = results[Object.keys(results)[0]];

    const embeddings = Array.from(outputTensor.data);
    const embeddingDim = embeddings.length / maxLength;
    const meanEmbedding = new Array(embeddingDim).fill(0);

    let validTokens = 0;
    for (let i = 0; i < maxLength; i++) {
      if (attentionMask[i] === 1) {
        for (let j = 0; j < embeddingDim; j++) {
          meanEmbedding[j] += embeddings[i * embeddingDim + j];
        }
        validTokens++;
      }
    }

    const result = meanEmbedding.map(v => v / validTokens);
    const norm = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
    return result.map(v => v / norm);
  }

  async generateHFEmbedding(text) {
    if (!this.embeddingModel) {
      throw new Error('HF模型未加载');
    }

    const result = await this.embeddingModel.featureExtraction({
      model: this.embeddingConfig.hfModel,
      inputs: text
    });

    return Array.isArray(result) ? result : Array.from(result);
  }

  async generateFastTextEmbedding(text) {
    if (!this.embeddingModel) {
      throw new Error('FastText模型未加载');
    }

    const vector = await this.embeddingModel.getSentenceVector(text);
    return Array.from(vector);
  }

  async generateAPIEmbedding(text) {
    const config = this.embeddingConfig;

    if (!config.apiUrl || !config.apiKey) {
      throw new Error('未配置API');
    }

    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.apiModel,
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
    return denominator === 0 ? 0 : dotProduct / denominator;
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
    } catch (e) { }
  }

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
          if (data && typeof data.message === 'string') parsedMessages.push(data);
        } catch (e) { }
      }

      if (parsedMessages.length === 0) return [];

      const now = Date.now();
      const halfLifeDays = this.embeddingConfig.timeHalfLifeDays || 3;
      const idealLen = this.embeddingConfig.idealTextLength || 40;
      const qTokens = Array.from(new Set(query.split(/[\s，。！？,.!?]/).filter(Boolean)));

      const scoreItem = (baseSim, data) => {
        const text = data.message || '';

        const ageMs = Math.max(0, now - (data.time || 0));
        const ageDays = ageMs / (24 * 60 * 60 * 1000);
        const timeDecay = Math.exp(-Math.log(2) * (ageDays / halfLifeDays));

        let keywordBoost = 0;
        if (qTokens.length && text) {
          const dTokens = Array.from(new Set(text.split(/[\s，。！？,.!?]/).filter(Boolean)));
          if (dTokens.length) {
            const overlap = qTokens.filter(t => dTokens.includes(t));
            const overlapRatio = overlap.length / qTokens.length;
            keywordBoost = overlapRatio * 0.3;
          }
        }

        const len = text.length || 1;
        const lengthRatio = len / idealLen || 1;
        const lengthPenalty = Math.exp(-Math.pow(Math.log(lengthRatio), 2));

        const simPart = Math.max(baseSim, 0);
        const finalScore = (simPart + keywordBoost) * timeDecay * (0.5 + 0.5 * lengthPenalty);

        return {
          message: text,
          similarity: finalScore,
          baseSimilarity: baseSim,
          time: data.time,
          userId: data.userId,
          nickname: data.nickname
        };
      };

      let scored = [];

      if (this.embeddingConfig.provider === 'lightweight') {
        const documents = parsedMessages.map(m => m.message);
        this.similarityCalculator.calculateIDF(documents);
        scored = parsedMessages.map(data => {
          const bm25Score = this.similarityCalculator.score(query, data.message);
          const baseSim = bm25Score / (10 + bm25Score);
          return scoreItem(baseSim, data);
        });
      } else {
        const queryEmbedding = await this.generateEmbedding(query);
        if (!queryEmbedding) return [];

        scored = parsedMessages
          .filter(data => Array.isArray(data.embedding))
          .map(data => {
            const baseSim = this.cosineSimilarity(queryEmbedding, data.embedding);
            return scoreItem(baseSim, data);
          });
      }

      const threshold = this.embeddingConfig.similarityThreshold ?? 0.1;
      const preFiltered = scored.filter(s => s.baseSimilarity >= threshold / 2);
      preFiltered.sort((a, b) => b.similarity - a.similarity);

      return preFiltered.slice(0, this.embeddingConfig.maxContexts || 8);
    } catch (e) {
      return [];
    }
  }

  async buildEnhancedContext(e, question, baseMessages) {
    if (!this.embeddingConfig.enabled || !this.embeddingReady) {
      return baseMessages;
    }

    const groupId = e ? (e.group_id || `private_${e.user_id}`) : 'default';

    // 如果question是字符串，直接使用；如果是对象，提取text/content；如果为null，尝试从messages提取
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
      const relevantContexts = await this.retrieveRelevantContexts(groupId, query);

      if (relevantContexts.length === 0) {
        return baseMessages;
      }

      const enhanced = [...baseMessages];
      const contextPrompt = [
        '\n【相关历史对话】',
        relevantContexts.map((ctx, i) =>
          `${i + 1}. ${ctx.message.substring(0, 100)} (相关度: ${(ctx.similarity * 100).toFixed(0)}%)`
        ).join('\n'),
        '\n以上是相关历史对话，可参考但不要重复。\n'
      ].join('\n');

      if (enhanced[0]?.role === 'system') {
        enhanced[0].content += contextPrompt;
      } else {
        enhanced.unshift({
          role: 'system',
          content: contextPrompt
        });
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

    this.functions.set(name, {
      name,
      handler,
      prompt,
      parser,
      enabled: this.functionToggles[name] ?? enabled,
      permission,
      description
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
   * 构建系统提示词（抽象方法，必须实现）
   * 
   * 子类必须实现此方法，用于构建AI的系统提示词。
   * 
   * @abstract
   * @param {Object} context - 上下文对象
   * @returns {string|Promise<string>} 系统提示词
   * @throws {Error} 如果子类未实现此方法
   * @example
   * async buildSystemPrompt(context) {
   *   return `你是一个智能助手。
   * 当前用户：${context.user}
   * 当前时间：${new Date().toLocaleString()}`;
   * }
   */
  buildSystemPrompt(context) {
    throw new Error('buildSystemPrompt需要子类实现');
  }

  buildFunctionsPrompt() {
    const enabledFuncs = this.getEnabledFunctions();
    if (enabledFuncs.length === 0) return '';

    const prompts = enabledFuncs
      .filter(f => f.prompt)
      .map(f => f.prompt)
      .join('\n');

    return prompts ? `\n【功能列表】\n${prompts}` : '';
  }

  /**
   * 构建对话上下文（抽象方法，必须实现）
   * 
   * 子类必须实现此方法，用于根据事件和问题构建完整的对话上下文。
   * 
   * @abstract
   * @param {Object} e - 事件对象（可选）
   * @param {string|Object} question - 用户问题或消息对象
   *   - 字符串：直接作为用户消息
   *   - 对象：{ text: string, persona?: string }
   * @returns {Promise<Array<Object>>} 消息数组
   *   - 格式: [{ role: 'system'|'user'|'assistant', content: string }]
   * @throws {Error} 如果子类未实现此方法
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
    throw new Error('buildChatContext需要子类实现');
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
    // 尝试在当前工作流执行
    if (this.functions && this.functions.has(func.type)) {
      await this.executeFunction(func.type, func.params, context);
      return true;
    }

    // 如果是合并工作流，尝试在合并的工作流中执行
    if (this._mergedStreams) {
      for (const mergedStream of this._mergedStreams) {
        if (mergedStream.functions && mergedStream.functions.has(func.type)) {
          await mergedStream.executeFunction(func.type, func.params, context);
          return true;
        }
      }
    }

    BotUtil.makeLog('warn', `函数未找到: ${func.type}`, 'AIStream');
    return false;
  }

  async executeFunction(type, params, context) {
    const func = this.functions.get(type);

    if (!func || !func.enabled) {
      return;
    }

    if (func.permission && !(await this.checkPermission(func.permission, context))) {
      return;
    }

    if (func.handler) {
      await func.handler(params, context);
    }
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
   * AI调用
   */
  async callAI(messages, apiConfig = {}) {
    const config = this.resolveLLMConfig(apiConfig);

    // 调试日志：记录调用信息
    const messagesPreview = messages.map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
      return `${m.role}: ${preview}`;
    }).join('\n');
    
    BotUtil.makeLog('info', 
      `[${this.name}] 调用LLM工厂\nProvider: ${config.provider || 'unknown'}\nModel: ${config.model || 'unknown'}\n消息:\n${messagesPreview}`,
      'AIStream'
    );

    try {
      const client = LLMFactory.createClient(config);
      const response = await client.chat(messages, config);
      
      // 调试日志：记录响应结果
      const responsePreview = response && response.length > 500 
        ? response.substring(0, 500) + '...' 
        : (response || '(空响应)');
      
      BotUtil.makeLog('info',
        `[${this.name}] LLM响应\n长度: ${response?.length || 0}字符\n内容: ${responsePreview}`,
        'AIStream'
      );
      
      return response;
    } catch (error) {
      BotUtil.makeLog('error', `AI调用失败: ${error.message}`, 'AIStream');
      return null;
    }
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
    const client = LLMFactory.createClient(config);

    // 调试日志：记录调用信息
    const messagesPreview = messages.map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
      return `${m.role}: ${preview}`;
    }).join('\n');
    
    BotUtil.makeLog('info',
      `[${this.name}] 调用LLM工厂(流式)\nProvider: ${config.provider || 'unknown'}\nModel: ${config.model || 'unknown'}\n消息:\n${messagesPreview}`,
      'AIStream'
    );

    let fullText = '';

    const wrapDelta = (delta) => {
      if (!delta) return;
      fullText += delta;
      if (typeof onDelta === 'function') onDelta(delta);
    };

    try {
      await client.chatStream(messages, wrapDelta, config);
      
      // 调试日志：记录流式响应结果
      const responsePreview = fullText && fullText.length > 500 
        ? fullText.substring(0, 500) + '...' 
        : (fullText || '(空响应)');
      
      BotUtil.makeLog('info',
        `[${this.name}] LLM流式响应完成\n长度: ${fullText?.length || 0}字符\n内容: ${responsePreview}`,
        'AIStream'
      );
    } catch (error) {
      BotUtil.makeLog('error', `AI调用失败: ${error.message}`, 'AIStream');
      throw error;
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
    const defaults = runtime.defaults || {};
    const profiles = runtime.profiles || {};

    const explicitProfile =
      overrides.profile ||
      overrides.profileKey ||
      overrides.embeddingProfile ||
      runtime.defaultProfile ||
      overrides.provider;

    const selectedKey = profiles[explicitProfile]
      ? explicitProfile
      : (runtime.defaultProfile && profiles[runtime.defaultProfile]
        ? runtime.defaultProfile
        : Object.keys(profiles)[0]);

    const selectedProfile = selectedKey ? (profiles[selectedKey] || {}) : {};

    const result = {
      profile: selectedKey,
      // enabled 优先级：显式覆盖 > 全局开关 > 档位开关 > 默认启用
      enabled: overrides.enabled ?? runtime.enabled ?? selectedProfile.enabled ?? true,
      ...defaults,
      ...selectedProfile,
      ...overrides
    };

    result.provider = result.provider || selectedProfile.provider || defaults.provider || 'lightweight';
    result.cachePath = result.cachePath || defaults.cachePath || paths.dataModels;

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
    const merged = { ...this.config, ...apiConfig };
    const runtime = cfg.aistream || {};
    const llm = runtime.llm || {};
    const vision = runtime.vision || {};

    const provider = merged.provider || llm.Provider || 'gptgod';
    // 识图运营商：可单独配置，否则默认与 LLM Provider 一致
    const visionProvider = (merged.visionProvider || vision.Provider || provider).toLowerCase();

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

    if (!LLMFactory.hasProvider(provider)) {
      BotUtil.makeLog('error', `不支持的LLM提供商: ${provider}，已回退到gptgod`, 'AIStream');
      const fallbackProvider = 'gptgod';
      const fallbackConfigKey = llmConfigMap[fallbackProvider] || 'god';
      const fallbackConfig = cfg[fallbackConfigKey] || {};
      return {
        ...fallbackConfig,
        ...merged,
        provider: fallbackProvider,
        visionProvider: visionProvider
      };
    }

    // 动态获取 LLM 配置
    const llmConfigKey = llmConfigMap[provider];
    const providerConfig = llmConfigKey ? (cfg[llmConfigKey] || {}) : {};

    // 动态获取 Vision 配置（一个工厂一个配置文件）
    let visionConfig = {};
    const visionConfigKey = visionConfigMap[visionProvider];
    if (visionConfigKey) {
      visionConfig = cfg[visionConfigKey] || {};
    }

    const finalConfig = {
      ...providerConfig,
      ...merged,
      provider,
      visionProvider,
      visionConfig
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

      // 执行函数（支持合并工作流）
      for (let i = 0; i < functions.length; i++) {
        const func = functions[i];
        await this._executeFunctionWithMerge(func, context);

        if (i < functions.length - 1 && !func.noDelay) {
          await BotUtil.sleep(2500);
        }
      }

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
   * @param {Object} e - 事件对象
   * @param {string|Object} question - 用户问题
   * @param {Object} options - 处理选项
   *   - mergeStreams: Array<string> - 要合并的工作流名称列表
   *   - enableTodo: boolean - 是否启用TODO智能决策
   *   - enableMemory: boolean - 是否启用记忆系统
   *   - apiConfig: Object - LLM配置
   * @returns {Promise<string|null>} 响应文本
   */
  async process(e, question, options = {}) {
    try {
      const {
        mergeStreams = [],
        enableTodo = false,
        enableMemory = false,
        ...apiConfig
      } = options;

      let StreamLoader = null;
      if (mergeStreams.length > 0 || enableTodo) {
        StreamLoader = (await import('#infrastructure/aistream/loader.js')).default;
      }

      let stream = this;
      if (mergeStreams.length > 0) {
        const mergedName = `${this.name}-${mergeStreams.join('-')}`;
        stream = StreamLoader.getStream(mergedName) ||
          StreamLoader.mergeStreams({
            name: mergedName,
            main: this.name,
            secondary: mergeStreams,
            prefixSecondary: true
          });

        if (!stream.workflowManager) {
          const todoStream = StreamLoader.getStream('todo');
          if (todoStream?.workflowManager) {
            todoStream.injectWorkflowManager(stream);
          }
        } else {
          stream.workflowManager.stream = stream;
        }
      }

      if (enableTodo) {
        if (!stream.workflowManager) {
          const todoStream = StreamLoader.getStream('todo');
          if (todoStream?.workflowManager) {
            todoStream.injectWorkflowManager(stream);
          }
        }

        if (stream.workflowManager) {
          const questionText = typeof question === 'string' ? question : (question?.content || question?.text || '');
          const decision = await stream.workflowManager.decideWorkflowMode(e, questionText);

          if (decision.shouldUseTodo && decision.todos.length > 0) {
            await stream.workflowManager.createWorkflow(e, questionText, decision.todos);
            // 工作流已启动，会自己负责所有reply，返回null让插件不处理
            return null;
          }
        }
      }

      const finalQuestion = typeof question === 'string'
        ? question
        : (question?.content || question?.text || question);
      try {
        const response = await stream.execute(e, finalQuestion, apiConfig);
        if (enableTodo && response && e?.reply) {
          await e.reply(response);
          return null;
        }
        return response;
      } catch (error) {
        BotUtil.makeLog('error', `工作流处理失败[${this.name}]: ${error.message}`, 'AIStream');
        return null;
      }
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
        enabled: this.embeddingConfig.enabled,
        provider: this.embeddingConfig.provider,
        ready: this.embeddingReady,
        model: this.embeddingConfig.onnxModel || this.embeddingConfig.hfModel || this.embeddingConfig.apiModel,
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

  async cleanup() {
    BotUtil.makeLog('debug', `[${this.name}] 清理资源`, 'AIStream');

    if (this.embeddingSession) {
      this.embeddingSession = null;
    }

    if (this.embeddingModel && typeof this.embeddingModel.dispose === 'function') {
      try {
        await this.embeddingModel.dispose();
      } catch (error) {
        // 静默处理
      }
    }

    this.embeddingModel = null;
    this.embeddingReady = false;
    this.tokenizer = null;
    this._initialized = false;
    this._embeddingInitialized = false;
  }
}