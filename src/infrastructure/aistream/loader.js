import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';
import BotUtil from '#utils/botutil.js';
import cfg from '#infrastructure/config/config.js';
import paths from '#utils/paths.js';
import { MCPServer } from '#utils/mcp-server.js';

const STREAMS_DIR = paths.coreStream;

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
    this.embeddingConfig = config;
    this.embeddingConfigured = true;
    const status = config.enabled === false ? '禁用' : '覆盖';
    BotUtil.makeLog('debug', `Embedding配置: ${status}`, 'StreamLoader');
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

      // 阶段3: 初始化MCP服务（注册所有工具）
      await this.initMCP();

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
      // 确保文件路径正确转换为 URL（Windows 路径兼容）
      // 使用 pathToFileURL 转换为 URL 对象，这是 Node.js 推荐的方式
      // 可以正确处理 Windows 路径、特殊字符和编码问题
      const normalizedPath = path.resolve(file);
      const fileUrlObj = pathToFileURL(normalizedPath);
      // 添加时间戳避免缓存，使用 .href 获取字符串格式
      const fileUrl = `${fileUrlObj.href}?t=${Date.now()}`;
      const module = await import(fileUrl);
      const StreamClass = module.default;

      if (!StreamClass || typeof StreamClass !== 'function') {
        throw new Error('无效的工作流文件');
      }

      const stream = new StreamClass();
      if (!stream.name) {
        throw new Error('工作流缺少name属性');
      }

      // 应用Embedding配置
      if (this.embeddingConfig) {
        if (typeof stream.applyEmbeddingOverrides === 'function') {
          stream.applyEmbeddingOverrides(this.embeddingConfig);
        } else {
          stream.embeddingConfig = { ...stream.embeddingConfig, ...this.embeddingConfig };
        }
      }

      // 初始化
      if (typeof stream.init === 'function') {
        await stream.init();
      }

      this.injectWorkflowManagerToStreams(stream);

      // 保存
      this.streams.set(stream.name, stream);
      this.streamClasses.set(stream.name, StreamClass);

      const loadTime = Date.now() - startTime;
      this.loadStats.streams.push({
        name: stream.name,
        version: stream.version,
        loadTime,
        success: true,
        priority: stream.priority,
        functions: stream.functions?.size || 0
      });

      BotUtil.makeLog('debug', `加载工作流: ${stream.name} v${stream.version} (${loadTime}ms)`, 'StreamLoader');
    } catch (error) {
      this.loadStats.failedStreams++;
      const loadTime = Date.now() - startTime;
      const errorMessage = error.message || String(error);
      const errorStack = error.stack ? `\n${error.stack}` : '';
      this.loadStats.streams.push({ name: streamName, loadTime, success: false, error: errorMessage });
      BotUtil.makeLog('error', `工作流加载失败: ${streamName} - ${errorMessage}${errorStack}`, 'StreamLoader');
    }
  }

  /**
   * 统一应用Embedding配置并初始化
   */
  async applyEmbeddingConfig() {
    let successCount = 0;
    let failCount = 0;

    for (const stream of this.streams.values()) {
      if (!stream.embeddingConfig) {
        stream.embeddingConfig = { enabled: false };
      }

      if (stream.embeddingConfig.enabled === false) {
        continue;
      }
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
      mcp: {
        toolCount: this.mcpServer?.tools?.size || 0
      },
      loadStats: this.loadStats
    };
  }

  /**
   * 创建合并工作流（主工作流 + 副工作流，仅合并functions）
   */
  mergeStreams(options = {}) {
    const {
      name,
      main,
      secondary = [],
      prefixSecondary = true,
      description
    } = options;

    if (!main || secondary.length === 0) {
      throw new Error('mergeStreams 需要主工作流和至少一个副工作流');
    }

    const mainStream = this.getStream(main);
    if (!mainStream) {
      throw new Error(`主工作流未找到: ${main}`);
    }

    const secondaryStreams = secondary
      .map(n => this.getStream(n))
      .filter(Boolean);

    if (secondaryStreams.length === 0) {
      throw new Error('未找到有效的副工作流');
    }

    const mergedName = name || `${main}-merged`;

    if (this.streams.has(mergedName)) {
      return this.streams.get(mergedName);
    }

    // 构建合并实例：克隆主工作流的原型和核心属性，独立的functions集合
    const merged = Object.create(Object.getPrototypeOf(mainStream));
    Object.assign(merged, mainStream);
    merged.name = mergedName;
    merged.description = description || `${mainStream.description || main} + ${secondary.join(',')}`;
    merged.primaryStream = mainStream.name;
    merged.secondaryStreams = secondaryStreams.map(s => s.name);
    merged._mergedStreams = [mainStream, ...secondaryStreams];
    merged.functions = new Map();

    const adopt = (source, isPrimary) => {
      if (!source.functions) return;
      for (const [fname, fconfig] of source.functions.entries()) {
        const newName = (!isPrimary && prefixSecondary) ? `${source.name}.${fname}` : fname;
        if (merged.functions.has(newName)) continue; // 避免冲突覆盖
        merged.functions.set(newName, {
          ...fconfig,
          source: source.name,
          primary: isPrimary
        });
      }
    };

    adopt(mainStream, true);
    for (const s of secondaryStreams) {
      adopt(s, false);
    }

    this.streams.set(mergedName, merged);
    return merged;
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
    result.redis = !!global.redis;
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

  /**
   * 注册MCP服务（统一入口）
   * @param {MCPServer} mcpServer - MCP服务器实例
   */
  registerMCP(mcpServer) {
    if (!mcpServer) return;

    // 从所有工作流收集工具并注册到MCP服务器
    for (const stream of this.streams.values()) {
      if (stream.functions && stream.functions.size > 0) {
        // 自动注册工作流的函数为MCP工具
        for (const [funcName, func] of stream.functions.entries()) {
          if (func.enabled && mcpServer.registerTool) {
            const toolName = stream.name !== 'mcp' ? `${stream.name}.${funcName}` : funcName;
            mcpServer.registerTool(toolName, {
              description: func.description || func.prompt || `执行${funcName}操作`,
              inputSchema: this.buildMCPInputSchema(func),
              handler: async (args) => {
                const context = { e: args.e || null, question: null };
                if (func.handler) {
                  await func.handler(args, context);
                  return { success: true, context };
                }
                return { success: false, message: '函数处理器未定义' };
              }
            });
          }
        }
      }
    }

    // 保存MCP服务器引用（供HTTP API使用）
    this.mcpServer = mcpServer;
    BotUtil.makeLog('info', `MCP服务已注册，共${mcpServer.tools.size}个工具`, 'StreamLoader');
  }

  /**
   * 初始化MCP服务（如果配置启用）
   */
  async initMCP() {
    const mcpConfig = cfg.aistream?.mcp || {};
    if (mcpConfig.enabled === false) {
      BotUtil.makeLog('debug', 'MCP服务已禁用', 'StreamLoader');
      return;
    }

    // 创建MCP服务器实例
    if (!this.mcpServer) {
      this.mcpServer = new MCPServer();
      BotUtil.makeLog('info', 'MCP服务器已创建', 'StreamLoader');
    }

    // 注册所有工作流的工具
    this.registerMCP(this.mcpServer);
  }

  /**
   * 构建MCP输入schema
   */
  buildMCPInputSchema(func) {
    const schema = {
      type: 'object',
      properties: {},
      required: []
    };

    if (func.prompt) {
      const paramMatches = func.prompt.match(/\[([^\]]+)\]/g);
      if (paramMatches) {
        paramMatches.forEach(match => {
          const parts = match.replace(/[\[\]]/g, '').split(':');
          if (parts.length > 1) {
            const paramName = parts[1].trim();
            schema.properties[paramName] = {
              type: 'string',
              description: `参数: ${paramName}`
            };
            schema.required.push(paramName);
          }
        });
      }
    }

    return schema;
  }

  /**
   * 注入工作流管理器到streams
   */
  injectWorkflowManagerToStreams(stream) {
    if (this.isTodoStream(stream)) {
      this.injectToExistingStreams(stream);
      return;
    }
    
    this.injectFromTodoStream(stream);
  }

  /**
   * 判断是否为todo stream
   */
  isTodoStream(stream) {
    return stream.name === 'todo' && stream.workflowManager;
  }

  /**
   * 注入到已存在的streams
   */
  injectToExistingStreams(todoStream) {
    for (const existingStream of this.streams.values()) {
      if (this.shouldInject(existingStream)) {
        todoStream.injectWorkflowManager(existingStream);
      }
    }
  }

  /**
   * 判断是否应该注入
   */
  shouldInject(stream) {
    return stream.name !== 'todo' && !stream.workflowManager;
  }

  /**
   * 从todo stream注入
   */
  injectFromTodoStream(stream) {
    if (stream.name === 'todo') return;
    
    const todoStream = this.streams.get('todo');
    if (!todoStream?.workflowManager) return;
    
    todoStream.injectWorkflowManager(stream);
  }
}

export default new StreamLoader();