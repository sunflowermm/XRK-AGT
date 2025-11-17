import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';
import BotUtil from '../../utils/botutil.js';
import cfg from '../config/config.js';

const _path = process.cwd();
const STREAMS_DIR = path.join(_path, 'core/stream');

/**
 * AI工作流加载器
 * 标准化初始化流程，避免重复加载
 */
class StreamLoader {
  constructor() {
    this.streams = new Map();
    this.streamClasses = new Map();
    this.loaded = false;
    this.embeddingConfigured = false;
    this.embeddingConfig = null;
    this.loadStats = {
      streams: [],
      totalLoadTime: 0,
      startTime: 0,
      totalStreams: 0,
      failedStreams: 0
    };
  }

  /**
   * 配置Embedding设置（只配置，不初始化）
   */
  configureEmbedding(config = {}) {
    if (this.embeddingConfigured) {
      BotUtil.makeLog('debug', '⚠️ Embedding已配置，跳过重复配置', 'StreamLoader');
      return;
    }

    this.embeddingConfig = {
      enabled: config.enabled || false,
      provider: config.provider || 'lightweight',
      
      // ONNX Runtime 配置
      onnxModel: config.onnxModel || 'Xenova/all-MiniLM-L6-v2',
      onnxQuantized: config.onnxQuantized !== false,
      
      // Hugging Face API 配置
      hfToken: config.hfToken || null,
      hfModel: config.hfModel || 'sentence-transformers/all-MiniLM-L6-v2',
      
      // FastText 配置
      fasttextModel: config.fasttextModel || 'cc.zh.300.bin',
      
      // 自定义 API 配置
      apiUrl: config.apiUrl || null,
      apiKey: config.apiKey || null,
      apiModel: config.apiModel || 'text-embedding-3-small',
      
      // 通用配置
      maxContexts: config.maxContexts || 5,
      similarityThreshold: config.similarityThreshold || 0.6,
      cacheExpiry: config.cacheExpiry || 86400,
      cachePath: config.cachePath || path.join(_path, 'data/models')
    };

    this.embeddingConfigured = true;

    BotUtil.makeLog('debug', `Embedding配置: ${this.embeddingConfig.enabled ? '启用' : '禁用'}, 提供商: ${this.embeddingConfig.provider}`, 'StreamLoader');
  }

  /**
   * 加载所有工作流（标准化流程）
   */
  async load(isRefresh = false) {
    if (!isRefresh && this.loaded) {
      BotUtil.makeLog('debug', '⚠️ 工作流已加载，跳过', 'StreamLoader');
      return;
    }

    try {
      this.loadStats.startTime = Date.now();
      this.loadStats.streams = [];
      this.loadStats.failedStreams = 0;

      if (!isRefresh) {
        this.streams.clear();
        this.streamClasses.clear();
      }

      BotUtil.makeLog('info', '开始加载工作流...', 'StreamLoader');

      // 确保目录存在
      if (!fs.existsSync(STREAMS_DIR)) {
        fs.mkdirSync(STREAMS_DIR, { recursive: true });
        BotUtil.makeLog('debug', '创建工作流目录', 'StreamLoader');
      }

      // 获取所有工作流文件（兼容Windows路径分隔符）
      const pattern = path.posix.join(STREAMS_DIR.replace(/\\/g, '/'), '*.js');
      const files = await BotUtil.glob(pattern);
      
      if (files.length === 0) {
        BotUtil.makeLog('warn', '未找到工作流文件', 'StreamLoader');
        this.loaded = true;
        return;
      }

      BotUtil.makeLog('debug', `发现 ${files.length} 个工作流文件`, 'StreamLoader');

      // 阶段1: 加载工作流类（不初始化Embedding）
      for (const file of files) {
        await this.loadStreamClass(file);
      }

      // 阶段2: 应用Embedding配置
      if (this.embeddingConfig && this.embeddingConfig.enabled) {
        BotUtil.makeLog('debug', '配置Embedding...', 'StreamLoader');
        await this.applyEmbeddingConfig();
      }

      this.loadStats.totalLoadTime = Date.now() - this.loadStats.startTime;
      this.loadStats.totalStreams = this.streams.size;
      this.loaded = true;

      // 显示加载结果
      this.displayLoadSummary();
    } catch (error) {
      BotUtil.makeLog('error', `工作流加载失败: ${error.message}`, 'StreamLoader', error);
      throw error;
    }
  }

  /**
   * 加载单个工作流类（只加载，不初始化Embedding）
   */
  async loadStreamClass(file) {
    const streamName = path.basename(file, '.js');
    const startTime = Date.now();

    try {
      // 动态导入
      const fileUrl = pathToFileURL(file).href;
      const timestamp = Date.now();
      const module = await import(`${fileUrl}?t=${timestamp}`);
      const StreamClass = module.default;

      if (!StreamClass || typeof StreamClass !== 'function') {
        throw new Error('无效的工作流文件');
      }

      // 创建实例
      const stream = new StreamClass();
      
      if (!stream.name) {
        throw new Error('工作流缺少name属性');
      }

      // 应用Embedding配置（但禁用自动初始化）
      if (this.embeddingConfig) {
        stream.embeddingConfig = {
          ...stream.embeddingConfig,
          ...this.embeddingConfig,
          enabled: false // 暂时禁用，稍后统一初始化
        };
      }

      // 调用基础init（不包括Embedding初始化）
      if (typeof stream.init === 'function') {
        await stream.init();
      }

      // 保存
      this.streams.set(stream.name, stream);
      this.streamClasses.set(stream.name, StreamClass);

      const loadTime = Date.now() - startTime;
      this.loadStats.streams.push({
        name: stream.name,
        version: stream.version,
        loadTime: loadTime,
        success: true,
        priority: stream.priority,
        functions: stream.functions?.size || 0
      });

      BotUtil.makeLog('debug', 
        `加载工作流: ${stream.name} v${stream.version} (${loadTime}ms)`, 
        'StreamLoader'
      );
    } catch (error) {
      this.loadStats.failedStreams++;
      const loadTime = Date.now() - startTime;
      
      this.loadStats.streams.push({
        name: streamName,
        loadTime: loadTime,
        success: false,
        error: error.message
      });

      BotUtil.makeLog('error', 
        `工作流加载失败: ${streamName} - ${error.message}`, 
        'StreamLoader'
      );
    }
  }

  /**
   * 统一应用Embedding配置并初始化
   */
  async applyEmbeddingConfig() {
    let successCount = 0;
    let failCount = 0;

    for (const stream of this.streams.values()) {
      // 启用Embedding
      stream.embeddingConfig.enabled = true;

      try {
        // 初始化Embedding
        await stream.initEmbedding();
        const provider = stream.embeddingConfig.provider;
        BotUtil.makeLog('debug', 
          `Embedding初始化: ${stream.name} - ${provider}`, 
          'StreamLoader'
        );
        successCount++;
      } catch (err) {
        failCount++;
        BotUtil.makeLog('warn', 
          `Embedding初始化失败: ${stream.name} - ${err.message}`, 
          'StreamLoader'
        );
      }
    }

    if (failCount > 0) {
      BotUtil.makeLog('warn', 
        `Embedding初始化: 成功${successCount}个, 失败${failCount}个`, 
        'StreamLoader'
      );
    }
  }

  /**
   * 显示加载摘要
   */
  displayLoadSummary() {
    const successCount = this.streams.size;
    const failedCount = this.loadStats.failedStreams;
    const totalTime = (this.loadStats.totalLoadTime / 1000).toFixed(2);

    if (failedCount > 0) {
      BotUtil.makeLog('info', `工作流加载完成: 成功${successCount}个, 失败${failedCount}个, 耗时${totalTime}秒`, 'StreamLoader');
    } else {
      BotUtil.makeLog('info', `工作流加载完成: ${successCount}个, 耗时${totalTime}秒`, 'StreamLoader');
    }

    // 列出工作流（仅在debug模式下）
    if (cfg?.debug) {
      this.listStreamsQuiet();
    }
  }

  /**
   * 安静地列出工作流（简洁版）
   */
  listStreamsQuiet() {
    if (this.streams.size === 0) return;

    BotUtil.makeLog('debug', '工作流列表:', 'StreamLoader');
    
    const streams = this.getStreamsByPriority();
    for (const stream of streams) {
      const status = stream.config.enabled ? '启用' : '禁用';
      const funcCount = stream.functions?.size || 0;
      
      let embStatus = '';
      if (stream.embeddingConfig?.enabled && stream.embeddingReady) {
        embStatus = ` [${stream.embeddingConfig.provider}]`;
      }
      
      BotUtil.makeLog('debug', 
        `  ${stream.name} v${stream.version} (${funcCount}功能, ${status})${embStatus}`, 
        'StreamLoader'
      );
    }
  }

  /**
   * 重新加载工作流
   */
  async reload() {
    BotUtil.makeLog('info', '🔄 开始重新加载...', 'StreamLoader');
    
    // 清理
    for (const stream of this.streams.values()) {
      if (typeof stream.cleanup === 'function') {
        await stream.cleanup().catch(() => {});
      }
    }

    this.streams.clear();
    this.streamClasses.clear();
    this.loaded = false;
    this.embeddingConfigured = false;
    
    // 重新加载
    await this.load();
    BotUtil.makeLog('success', '✅ 重新加载完成', 'StreamLoader');
  }

  /**
   * 切换所有工作流的Embedding
   */
  async toggleAllEmbedding(enabled) {
    if (!this.embeddingConfig) {
      BotUtil.makeLog('warn', '⚠️ Embedding未配置', 'StreamLoader');
      return false;
    }

    BotUtil.makeLog('info', `🔄 ${enabled ? '启用' : '禁用'}Embedding...`, 'StreamLoader');

    this.embeddingConfig.enabled = enabled;
    let successCount = 0;
    let failCount = 0;

    for (const stream of this.streams.values()) {
      stream.embeddingConfig.enabled = enabled;
      
      if (enabled) {
        try {
          await stream.initEmbedding();
          successCount++;
        } catch (err) {
          failCount++;
        }
      } else if (stream.embeddingReady) {
        await stream.cleanup().catch(() => {});
        successCount++;
      }
    }

    BotUtil.makeLog('success', 
      `✅ ${enabled ? '启用' : '禁用'}完成: ${successCount}成功, ${failCount}失败`, 
      'StreamLoader'
    );
    
    return true;
  }

  /**
   * 获取工作流
   */
  getStream(name) {
    return this.streams.get(name);
  }

  getStreamClass(name) {
    return this.streamClasses.get(name);
  }

  getAllStreams() {
    return Array.from(this.streams.values());
  }

  getEnabledStreams() {
    return this.getAllStreams().filter(s => s.config.enabled);
  }

  getStreamsByPriority() {
    return this.getAllStreams().sort((a, b) => a.priority - b.priority);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const total = this.streams.size;
    const enabled = this.getEnabledStreams().length;
    const totalFunctions = this.getAllStreams().reduce(
      (sum, s) => sum + (s.functions?.size || 0), 0
    );
    const embeddingEnabled = this.getAllStreams().filter(
      s => s.embeddingConfig?.enabled
    ).length;
    const embeddingReady = this.getAllStreams().filter(
      s => s.embeddingReady
    ).length;

    return {
      total,
      enabled,
      disabled: total - enabled,
      totalFunctions,
      embedding: {
        enabled: embeddingEnabled,
        ready: embeddingReady,
        provider: this.embeddingConfig?.provider || 'none',
        configured: this.embeddingConfigured
      },
      loadStats: this.loadStats
    };
  }

  /**
   * 检查Embedding依赖
   */
  async checkEmbeddingDependencies() {
    const result = {
      onnx: false,
      hf: false,
      fasttext: false,
      api: false,
      redis: false,
      lightweight: true, // 总是可用
      errors: []
    };

    BotUtil.makeLog('info', '━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'StreamLoader');
    BotUtil.makeLog('info', '【检查 Embedding 依赖】', 'StreamLoader');

    // ONNX
    try {
      await import('onnxruntime-node');
      result.onnx = true;
      BotUtil.makeLog('success', '├─ ✅ ONNX Runtime', 'StreamLoader');
    } catch (error) {
      result.errors.push('ONNX Runtime 不可用');
      BotUtil.makeLog('warn', '├─ ❌ ONNX Runtime', 'StreamLoader');
      BotUtil.makeLog('info', '│  💡 pnpm add onnxruntime-node -w', 'StreamLoader');
    }

    // HF
    result.hf = !!this.embeddingConfig?.hfToken;
    if (result.hf) {
      BotUtil.makeLog('success', '├─ ✅ HF Token 已配置', 'StreamLoader');
    } else {
      result.errors.push('HF Token 未配置');
      BotUtil.makeLog('warn', '├─ ❌ HF Token 未配置', 'StreamLoader');
    }

    // FastText
    try {
      await import('fasttext.js');
      result.fasttext = true;
      BotUtil.makeLog('success', '├─ ✅ FastText.js', 'StreamLoader');
    } catch (error) {
      result.errors.push('FastText.js 不可用');
      BotUtil.makeLog('warn', '├─ ❌ FastText.js', 'StreamLoader');
    }

    // API
    result.api = !!(this.embeddingConfig?.apiUrl && this.embeddingConfig?.apiKey);
    if (result.api) {
      BotUtil.makeLog('success', '├─ ✅ 自定义 API', 'StreamLoader');
    } else {
      BotUtil.makeLog('warn', '├─ ❌ 自定义 API 未配置', 'StreamLoader');
    }

    // Lightweight
    BotUtil.makeLog('success', '├─ ✅ Lightweight (BM25)', 'StreamLoader');

    // Redis
    result.redis = typeof redis !== 'undefined' && redis !== null;
    if (result.redis) {
      BotUtil.makeLog('success', '└─ ✅ Redis 可用', 'StreamLoader');
    } else {
      result.errors.push('Redis 未启用');
      BotUtil.makeLog('error', '└─ ❌ Redis 不可用 (必需)', 'StreamLoader');
    }

    BotUtil.makeLog('info', '━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'StreamLoader');

    return result;
  }

  /**
   * 获取推荐配置
   */
  async getRecommendedEmbeddingConfig() {
    const deps = await this.checkEmbeddingDependencies();
    
    const recommendations = {
      available: [],
      recommended: null,
      instructions: []
    };

    if (deps.onnx && deps.redis) {
      recommendations.available.push('onnx');
      recommendations.recommended = 'onnx';
      recommendations.instructions.push(
        '🌟 ONNX Runtime（推荐）',
        '  ├─ 高性能，纯JS',
        '  └─ pnpm add onnxruntime-node -w'
      );
    }

    if (deps.hf && deps.redis) {
      recommendations.available.push('hf');
      if (!recommendations.recommended) recommendations.recommended = 'hf';
      recommendations.instructions.push(
        '✅ Hugging Face API',
        '  ├─ 零内存，免费',
        '  └─ Token: https://huggingface.co/settings/tokens'
      );
    }

    if (deps.fasttext && deps.redis) {
      recommendations.available.push('fasttext');
      if (!recommendations.recommended) recommendations.recommended = 'fasttext';
    }

    if (deps.api && deps.redis) {
      recommendations.available.push('api');
      if (!recommendations.recommended) recommendations.recommended = 'api';
    }

    if (deps.redis) {
      recommendations.available.push('lightweight');
      if (!recommendations.recommended) recommendations.recommended = 'lightweight';
      recommendations.instructions.push(
        '✅ Lightweight (BM25)',
        '  ├─ 零依赖，零内存',
        '  └─ 适合依赖安装失败时'
      );
    }

    if (!deps.redis) {
      recommendations.instructions.unshift(
        '❌ Redis 未启用（必需）'
      );
    }

    return recommendations;
  }

  /**
   * 清理所有资源
   */
  async cleanupAll() {
    BotUtil.makeLog('info', '🧹 清理资源...', 'StreamLoader');
    
    for (const stream of this.streams.values()) {
      if (typeof stream.cleanup === 'function') {
        await stream.cleanup().catch(() => {});
      }
    }

    this.streams.clear();
    this.streamClasses.clear();
    this.loaded = false;
    this.embeddingConfigured = false;

    BotUtil.makeLog('success', '✅ 清理完成', 'StreamLoader');
  }
}

export default new StreamLoader();