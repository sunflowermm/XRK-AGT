import path from 'path';
import { pathToFileURL } from 'url';
import { spawn } from 'child_process';
import BotUtil from '#utils/botutil.js';
import cfg from '#infrastructure/config/config.js';
import paths from '#utils/paths.js';
import { MCPServer } from '#utils/mcp-server.js';

/**
 * AI工作流加载器
 * 标准化初始化流程，避免重复加载
 */
class StreamLoader {
  constructor() {
    this.streams = new Map();
    this.streamClasses = new Map();
    this.remoteMCPServers = new Map();
    this.loaded = false;
    this.watcher = null;
    this.loadStats = {
      streams: [],
      totalLoadTime: 0,
      startTime: 0,
      totalStreams: 0,
      failedStreams: 0
    };
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

      // 获取所有 core 目录下的 stream 目录
      const streamDirs = await paths.getCoreSubDirs('stream');
      
      // 如果没有 stream 目录，说明开发者可能不开发工作流，这是正常的
      if (streamDirs.length === 0) {
        BotUtil.makeLog('info', '未找到工作流目录，跳过加载', 'StreamLoader');
        this.loaded = true;
        return;
      }

      // 获取所有工作流文件
      const files = [];
      for (const streamDir of streamDirs) {
        try {
          const pattern = path.posix.join(streamDir.replace(/\\/g, '/'), '*.js');
          const dirFiles = await BotUtil.glob(pattern);
          files.push(...dirFiles);
        } catch {
          BotUtil.makeLog('warn', `读取工作流目录失败: ${streamDir}`, 'StreamLoader');
        }
      }
      
      if (files.length === 0) {
        BotUtil.makeLog('warn', '未找到工作流文件', 'StreamLoader');
        this.loaded = true;
        return;
      }


      // 阶段1: 加载工作流类（不初始化Embedding）
      for (const file of files) {
        await this.loadStreamClass(file);
      }

      // 阶段2: 应用Embedding配置（直接从 cfg 读取）
      const embeddingConfig = cfg.aistream?.embedding || {};
      if (embeddingConfig.enabled !== false) {
        await this.applyEmbeddingConfig(embeddingConfig);
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

      // Embedding配置从 cfg 自动读取，无需手动配置

      // 初始化
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
        loadTime,
        success: true,
        priority: stream.priority,
        mcpTools: stream.mcpTools?.size || 0
      });

      if (cfg.aistream?.global?.debug) {
        BotUtil.makeLog('debug', `加载工作流: ${stream.name} v${stream.version} (${loadTime}ms)`, 'StreamLoader');
      }
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
   * 统一应用Embedding配置并初始化（从 cfg 读取）
   */
  async applyEmbeddingConfig(embeddingConfig = null) {
    const config = embeddingConfig || cfg.aistream?.embedding || {};
    let successCount = 0;
    let failCount = 0;

    for (const stream of this.streams.values()) {
      // 如果工作流明确禁用 embedding，跳过
      if (stream.embeddingConfig?.enabled === false) {
        continue;
      }
      
      // 应用全局配置
      if (config.enabled !== false) {
        if (typeof stream.applyEmbeddingOverrides === 'function') {
          stream.applyEmbeddingOverrides(config);
        } else {
          stream.embeddingConfig = { ...stream.embeddingConfig, ...config };
        }
      }

      try {
        // 初始化Embedding
        await stream.initEmbedding();
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
      if (failCount > 0) {
        BotUtil.makeLog('warn', `Embedding初始化: 成功${successCount}个, 失败${failCount}个`, 'StreamLoader');
      }
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
    if (cfg.aistream?.global?.debug) {
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
      const toolCount = stream.mcpTools?.size || 0;
      
      let embStatus = '';
      if (stream.embeddingConfig?.enabled) {
        embStatus = ' [子服务端]';
      }
      
      BotUtil.makeLog('debug', 
        `  ${stream.name} v${stream.version} (${toolCount}工具, ${status})${embStatus}`, 
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
    
    // 重新加载
    await this.load();
    BotUtil.makeLog('success', '✅ 重新加载完成', 'StreamLoader');
  }

  /**
   * 切换所有工作流的Embedding（从 cfg 读取配置）
   */
  async toggleAllEmbedding(enabled) {
    const embeddingConfig = cfg.aistream?.embedding || {};

    BotUtil.makeLog('info', `🔄 ${enabled ? '启用' : '禁用'}Embedding...`, 'StreamLoader');

    // 更新全局配置（如果需要持久化，应该更新配置文件）
    embeddingConfig.enabled = enabled;
    let successCount = 0;
    let failCount = 0;

    for (const stream of this.streams.values()) {
      stream.embeddingConfig.enabled = enabled;
      
      if (enabled) {
        try {
          await stream.initEmbedding();
          successCount++;
        } catch {
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

  getStream(name) {
    return this.streams.get(name) || null;
  }

  getStreamClass(name) {
    return this.streamClasses.get(name);
  }

  getAllStreams() {
    return Array.from(this.streams.values());
  }

  getEnabledStreams() {
    return this.getAllStreams().filter(s => s.config?.enabled !== false);
  }

  getStreamsByPriority() {
    return this.getAllStreams().sort((a, b) => (a.priority || 100) - (b.priority || 100));
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const total = this.streams.size;
    const enabled = this.getEnabledStreams().length;
    const totalTools = this.getAllStreams().reduce(
      (sum, s) => sum + (s.mcpTools?.size || 0), 0
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
      totalTools,
      embedding: {
        enabled: embeddingEnabled,
        ready: embeddingReady,
        mode: 'subserver'
      },
      mcp: {
        toolCount: this.mcpServer?.tools?.size || 0
      },
      loadStats: this.loadStats
    };
  }

  /**
   * 创建合并工作流（主工作流 + 副工作流，仅合并 mcpTools）
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

    // 构建合并实例：克隆主工作流的原型和核心属性，独立的 mcpTools 集合
    const merged = Object.create(Object.getPrototypeOf(mainStream));
    Object.assign(merged, mainStream);
    merged.name = mergedName;
    merged.description = description || `${mainStream.description || main} + ${secondary.join(',')}`;
    merged.primaryStream = mainStream.name;
    merged.secondaryStreams = secondaryStreams.map(s => s.name);
    merged._mergedStreams = [mainStream, ...secondaryStreams];
    merged.mcpTools = new Map();

    const adoptMCPTools = (source, isPrimary) => {
      if (!source.mcpTools) return;
      for (const [tname, tconfig] of source.mcpTools.entries()) {
        const newName = (!isPrimary && prefixSecondary) ? `${source.name}.${tname}` : tname;
        if (merged.mcpTools.has(newName)) continue; // 避免冲突覆盖
        merged.mcpTools.set(newName, {
          ...tconfig,
          source: source.name,
          primary: isPrimary
        });
      }
    };

    adoptMCPTools(mainStream, true);
    for (const s of secondaryStreams) {
      adoptMCPTools(s, false);
    }

    this.streams.set(mergedName, merged);
    return merged;
  }


  /**
   * 检查Embedding依赖（已简化：统一由子服务端负责）
   */
  async checkEmbeddingDependencies() {
    const result = {
      embedding: { available: true },
      redis: false,
      errors: []
    };

    BotUtil.makeLog('info', '━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'StreamLoader');
    BotUtil.makeLog('info', '【检查 Embedding 依赖】', 'StreamLoader');

    // Embedding 统一由子服务端负责，只需检查子服务端是否可用
    BotUtil.makeLog('success', '├─ ✅ Embedding: 由子服务端提供向量服务', 'StreamLoader');
    result.embedding = { available: true };

    // Redis（用于短期记忆缓存）
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
   * 获取推荐配置（已简化：统一由子服务端负责）
   */
  async getRecommendedEmbeddingConfig() {
    const deps = await this.checkEmbeddingDependencies();
    
    const recommendations = {
      available: ['subserver'],
      recommended: 'subserver',
      instructions: [
        '✅ 向量服务由子服务端提供',
        '  ├─ 统一通过子服务端向量服务接口',
        '  └─ 配置位于子服务端配置文件'
      ]
    };

    if (!deps.redis) {
      recommendations.instructions.unshift('❌ Redis 未启用（用于短期记忆缓存）');
    }

    return recommendations;
  }

  /**
   * 清理所有资源
   */
  async cleanupAll() {
    BotUtil.makeLog('info', '🧹 清理资源...', 'StreamLoader');
    
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    
    for (const stream of this.streams.values()) {
      if (typeof stream.cleanup === 'function') {
        await stream.cleanup().catch(() => {});
      }
    }

    this.streams.clear();
    this.streamClasses.clear();
    this.loaded = false;

    BotUtil.makeLog('success', '✅ 清理完成', 'StreamLoader');
  }

  /**
   * 清理工作流资源（优化：统一清理逻辑）
   * @private
   */
  async _cleanupStream(streamName) {
    const stream = this.streams.get(streamName)
    if (stream && typeof stream.cleanup === 'function') {
      await stream.cleanup().catch(() => {})
    }
    this.streams.delete(streamName)
    this.streamClasses.delete(streamName)
  }

  /**
   * 重新加载工作流（优化：统一重载逻辑）
   * @private
   */
  async _reloadStream(filePath) {
    await this.loadStreamClass(filePath)
    // 应用 Embedding 配置（applyEmbeddingConfig 会检查 enabled 状态，避免重复初始化）
    await this.applyEmbeddingConfig(cfg.aistream?.embedding || {})
    await this.initMCP()
  }

  /**
   * 启用文件监视（热加载）
   * @param {boolean} enable - 是否启用
   */
  async watch(enable = true) {
    if (!enable) {
      if (this.watcher) {
        await this.watcher.close()
        this.watcher = null
      }
      return
    }

    if (this.watcher) return

    try {
      const { HotReloadBase } = await import('#utils/hot-reload-base.js')
      const hotReload = new HotReloadBase({ loggerName: 'StreamLoader' })
      
      const streamDirs = await paths.getCoreSubDirs('stream')
      if (streamDirs.length === 0) return

      await hotReload.watch(true, {
        dirs: streamDirs,
        onAdd: async (filePath) => {
          const streamName = hotReload.getFileKey(filePath)
          BotUtil.makeLog('debug', `检测到新工作流: ${streamName}`, 'StreamLoader')
          await this._reloadStream(filePath)
        },
        onChange: async (filePath) => {
          const streamName = hotReload.getFileKey(filePath)
          BotUtil.makeLog('debug', `检测到工作流变更: ${streamName}`, 'StreamLoader')
          await this._cleanupStream(streamName)
          await this._reloadStream(filePath)
        },
        onUnlink: async (filePath) => {
          const streamName = hotReload.getFileKey(filePath)
          BotUtil.makeLog('debug', `检测到工作流删除: ${streamName}`, 'StreamLoader')
          await this._cleanupStream(streamName)
          await this.initMCP()
        }
      })

      this.watcher = hotReload.watcher
    } catch (error) {
      BotUtil.makeLog('error', '启动工作流文件监视失败', 'StreamLoader', error)
    }
  }

  /**
   * 注册MCP工具（统一入口，支持热重载）
   * 
   * 功能：
   * - 遍历所有stream的MCP工具，注册到MCP服务器
   * - 工具名称格式：streamName.toolName（避免冲突，便于分组）
   * - 自动去重，避免重复注册
   * - 支持热重载，重新注册时先清空旧工具
   * 
   * @param {MCPServer} mcpServer - MCP服务器实例
   */
  registerMCP(mcpServer) {
    if (!mcpServer) return;
    const loader = this;

    // 清空旧工具（支持热重载）
    const existingTools = Array.from(mcpServer.tools.keys());
    for (const toolName of existingTools) {
      mcpServer.tools.delete(toolName);
    }

    const registeredTools = new Set();
    let registeredCount = 0;

    // 遍历所有工作流，注册工具
    for (const stream of this.streams.values()) {
      if (!stream?.mcpTools || stream.mcpTools.size === 0) continue;

      for (const [toolName, tool] of stream.mcpTools.entries()) {
        if (!tool?.enabled || !mcpServer.registerTool) continue;

        const fullToolName = stream.name !== 'mcp' ? `${stream.name}.${toolName}` : toolName;
        
        if (registeredTools.has(fullToolName)) continue;

        mcpServer.registerTool(fullToolName, {
          description: tool.description || `执行${toolName}操作`,
          inputSchema: tool.inputSchema || {},
          handler: async (args) => {
            const context = {
              // 优先使用显式传入的 e，其次使用当前工作流执行时挂载的全局事件
              e: args.e || loader.currentEvent || null,
              question: null
            };
            try {
              if (tool.handler) {
                const result = await tool.handler(args, { ...context, stream });
                // 确保返回标准格式
                if (result === undefined) {
                  return { success: true, message: '操作已执行' };
                }
                // 如果已经是标准格式，直接返回
                if (typeof result === 'object' && ('success' in result || 'error' in result)) {
                  return result;
                }
                // 否则包装为标准格式
                return { success: true, data: result };
              }
              return { success: false, error: 'Handler not found' };
            } catch (error) {
              BotUtil.makeLog('error', `MCP工具调用失败[${fullToolName}]: ${error.message}`, 'StreamLoader');
              return { success: false, error: error.message };
            }
          }
        });

        registeredTools.add(fullToolName);
        registeredCount++;
      }
    }

    this.mcpServer = mcpServer;
  }

  /**
   * 初始化MCP服务（如果配置启用）
   */
  async initMCP() {
    const mcpConfig = cfg.aistream?.mcp || {};
    if (mcpConfig.enabled === false) return;

    if (!this.mcpServer) {
      this.mcpServer = new MCPServer();
    }

    const beforeCount = this.mcpServer.tools.size;
    
    // 重新注册所有工作流的工具（支持热重载）
    this.registerMCP(this.mcpServer);
    const localCount = this.mcpServer.tools.size - beforeCount;
    
    // 加载远程MCP服务器（如果启用）
    const loadedServers = await this.loadRemoteMCPServers();
    
    // 标记MCP服务已初始化
    this.mcpServer.initialized = true;
    const remoteCount = this.mcpServer.tools.size - beforeCount - localCount;
    const totalCount = this.mcpServer.tools.size;
    
    if (totalCount > 0) {
      const parts = [];
      if (localCount > 0) parts.push(`本地${localCount}个`);
      if (remoteCount > 0) parts.push(`远程${remoteCount}个`);
      const detail = parts.length > 0 ? `: ${parts.join(', ')}` : '';
      BotUtil.makeLog('info', `MCP服务已挂载${detail}, 共${totalCount}个工具`, 'StreamLoader');
    }
  }

  /**
   * 获取远程MCP配置和选中的服务器名称集合
   */
  _getRemoteMCPConfig() {
    const remoteConfig = cfg.aistream?.mcp?.remote || {};
    if (!remoteConfig.enabled || !Array.isArray(remoteConfig.servers)) return null;
    
    const { selected = [], servers = [] } = remoteConfig;
    const selectedNames = Array.isArray(selected) && selected.length > 0 
      ? new Set(selected.map(s => String(s).trim()).filter(Boolean))
      : null;
    
    return { servers, selectedNames };
  }

  /**
   * 加载远程MCP服务器并注册工具
   */
  async loadRemoteMCPServers() {
    if (!this.mcpServer) return;
    
    const config = this._getRemoteMCPConfig();
    if (!config) return;

    const { servers, selectedNames } = config;
    const loadedServers = [];
    
    for (const serverConfig of servers) {
      const serverName = String(serverConfig.name || '').trim();
      if (!serverName || (selectedNames && !selectedNames.has(serverName))) continue;

      try {
        let serverConfigObj = serverConfig.config;
        if (typeof serverConfigObj === 'string') {
          try {
            serverConfigObj = JSON.parse(serverConfigObj);
          } catch {
            BotUtil.makeLog('warn', `远程MCP服务器 ${serverName} 的config字段JSON解析失败`, 'StreamLoader');
            continue;
          }
        }

        if (!serverConfigObj) {
          serverConfigObj = serverConfig.command 
            ? { command: serverConfig.command, args: Array.isArray(serverConfig.args) ? serverConfig.args : [] }
            : serverConfig.url 
              ? { url: serverConfig.url, transport: serverConfig.transport || 'http', headers: serverConfig.headers || {} }
              : null;
          if (!serverConfigObj) continue;
        }

        await this._createRemoteMCPClient(serverName, serverConfigObj);
        loadedServers.push(serverName);
      } catch (error) {
        BotUtil.makeLog('error', `加载远程MCP服务器 ${serverName} 失败: ${error.message}`, 'StreamLoader');
      }
    }
    
    return loadedServers;
  }

  /**
   * 创建远程MCP客户端并注册工具
   */
  async _createRemoteMCPClient(serverName, config) {
    if (config.command) {
      // stdio协议：通过子进程启动MCP服务器
      const child = spawn(config.command, config.args || [], { stdio: ['pipe', 'pipe', 'pipe'] });
      this.remoteMCPServers.set(serverName, { type: 'stdio', process: child, config });
      
      // 发送initialize请求
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'xrk-agt', version: '1.0.0' }
        }
      };
      
      child.stdin.write(JSON.stringify(initRequest) + '\n');
      
      // 监听响应并注册工具
      let buffer = '';
      const responseHandler = (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const response = JSON.parse(line);
            
            if (response.id === 1 && response.result) {
              // 初始化成功后请求工具列表
              child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
            } else if (response.id === 2 && response.result?.tools) {
              this._registerRemoteTools(serverName, response.result.tools);
              child.stdout.removeListener('data', responseHandler);
            }
          } catch {}
        }
      };
      
      child.stdout.on('data', responseHandler);
      child.on('error', (error) => {
        BotUtil.makeLog('error', `远程MCP服务器 ${serverName} 启动失败: ${error.message}`, 'StreamLoader');
      });
    } else if (config.url) {
      // HTTP协议：通过HTTP请求获取工具
      this.remoteMCPServers.set(serverName, { type: 'http', url: config.url, transport: config.transport, headers: config.headers, config });
      await this._fetchRemoteTools(serverName, config);
    }
  }

  /**
   * 注册远程MCP工具到主MCP服务器
   */
  _registerRemoteTools(serverName, tools) {
    if (!this.mcpServer || !Array.isArray(tools)) return;
    
    for (const tool of tools) {
      this.mcpServer.registerTool(`remote-mcp.${serverName}.${tool.name}`, {
        description: tool.description || '',
        inputSchema: tool.inputSchema || {},
        handler: (args) => this._callRemoteTool(serverName, tool.name, args)
      });
    }
  }


  /**
   * 调用远程MCP工具
   */
  async _callRemoteTool(serverName, toolName, args) {
    const server = this.remoteMCPServers.get(serverName);
    if (!server) {
      return { success: false, error: `远程MCP服务器 ${serverName} 未找到` };
    }

    const request = { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: toolName, arguments: args } };

    if (server.type === 'stdio') {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ success: false, error: '调用超时' }), 30000);
        
        let responseBuffer = '';
        const handler = (data) => {
          responseBuffer += data.toString();
          const lines = responseBuffer.split('\n');
          responseBuffer = lines.pop() || '';
          
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const response = JSON.parse(line);
              if (response.id === request.id) {
                clearTimeout(timeout);
                server.process.stdout.removeListener('data', handler);
                const text = response.result?.content?.[0]?.text;
                resolve(text ? JSON.parse(text) : response.result);
              }
            } catch {}
          }
        };
        
        server.process.stdout.on('data', handler);
        server.process.stdin.write(JSON.stringify(request) + '\n');
      });
    } else if (server.type === 'http') {
      try {
        const response = await BotUtil.fetch(server.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...server.headers },
          body: JSON.stringify(request)
        });
        const data = await response.json();
        const text = data.result?.content?.[0]?.text;
        return text ? JSON.parse(text) : data.result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }

  /**
   * 通过HTTP获取远程工具列表
   */
  async _fetchRemoteTools(serverName, config) {
    try {
      const request = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
      const response = await BotUtil.fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
        body: JSON.stringify(request)
      });
      const data = await response.json();
      if (data.result?.tools) {
        this._registerRemoteTools(serverName, data.result.tools);
      }
    } catch (error) {
      BotUtil.makeLog('error', `获取远程MCP工具失败 ${serverName}: ${error.message}`, 'StreamLoader');
    }
  }
}

export default new StreamLoader();