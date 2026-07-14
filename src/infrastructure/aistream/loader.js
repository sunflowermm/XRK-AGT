import path from 'path';
import { spawn } from 'child_process';
import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';
import { resolveQualifiedCoreModuleKey } from '#utils/core-fs.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import { getStreamRequestContext } from './stream-request-context.js';
import { MCPServer } from '#utils/mcp-server.js';
import { FileLoader } from '#utils/file-loader.js';
import { HotReloadBase } from '#utils/hot-reload-base.js';
import { LOADER_BATCH_SIZE } from '#utils/loader-constants.js';
import MonitorService from '#infrastructure/aistream/monitor-service.js';

/**
 * AI工作流加载器
 * 标准化初始化流程，避免重复加载
 */
class StreamLoader {
  streams = new Map();
  streamClasses = new Map();
  remoteMCPServers = new Map();
  mcpPluginServers = new Map();
  _loadedPluginServers = new Set();
  loaded = false;
  _hotReload = null;
  loadStats = {
    streams: [],
    totalLoadTime: 0,
    startTime: 0,
    totalStreams: 0,
    failedStreams: 0
  };
  /** 文件 basename（无 .js）→ stream.name，热重载清理用 */
  fileKeyToStreamName = new Map();

  _nextRemoteRequestId = 1;

  _makeRemoteRequestId() {
    // 保持为安全整数，避免长时间运行溢出
    const id = this._nextRemoteRequestId++;
    if (this._nextRemoteRequestId > 1_000_000_000) this._nextRemoteRequestId = 1;
    return id;
  }

  _createDeferred() {
    /** @type {(value:any)=>void} */
    let resolve;
    /** @type {(reason:any)=>void} */
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  _disposeRemoteMCPServer(serverName) {
    const server = this.remoteMCPServers.get(serverName);
    if (!server) return;

    if (server.type === 'stdio' && server.process) {
      const client = server._stdioClient;
      if (client?.pending) {
        for (const [, pending] of client.pending.entries()) {
          if (pending.timeout) clearTimeout(pending.timeout);
          try { pending.reject(new Error('远程MCP已卸载')); } catch {}
        }
        client.pending.clear();
      }
      if (client?.onData) {
        try { server.process.stdout?.removeListener('data', client.onData); } catch {}
      }
      try {
        server.process.stdin?.end?.();
        server.process.kill('SIGTERM');
      } catch {}
    }

    this.remoteMCPServers.delete(serverName);
    this._loadedPluginServers.delete(serverName);
  }

  async _disposeAllRemoteMCPServers() {
    for (const name of [...this.remoteMCPServers.keys()]) {
      this._disposeRemoteMCPServer(name);
    }
    this._loadedPluginServers.clear();
  }

  _ensureStdioClient(_serverName, entry) {
    if (!entry || entry.type !== 'stdio' || !entry.process) return null;
    if (entry._stdioClient) return entry._stdioClient;

    const child = entry.process;
    const client = {
      buffer: '',
      pending: new Map(),
      onData: null,
      closed: false
    };

    const flushPending = (errMsg) => {
      for (const [_id, p] of client.pending.entries()) {
        try { p.reject(new Error(errMsg)); } catch {}
      }
      client.pending.clear();
    };

    client.onData = (data) => {
      if (client.closed) return;
      client.buffer += data?.toString?.() || '';
      const lines = client.buffer.split('\n');
      client.buffer = lines.pop() || '';

      for (const line of lines) {
        const s = String(line || '').trim();
        if (!s) continue;
        let msg;
        try { msg = JSON.parse(s); } catch { continue; }
        const id = msg?.id;
        if (!id) continue;
        const pending = client.pending.get(id);
        if (!pending) continue;
        client.pending.delete(id);
        if (pending.timeout) clearTimeout(pending.timeout);
        if (msg.error) {
          pending.reject(new Error(msg.error?.message || '远程MCP返回错误'));
        } else {
          pending.resolve(msg.result);
        }
      }
    };

    child.stdout?.on('data', client.onData);
    child.on('exit', () => {
      client.closed = true;
      try { child.stdout?.removeListener('data', client.onData); } catch {}
      flushPending('远程MCP进程已退出');
    });
    child.on('error', (err) => {
      client.closed = true;
      try { child.stdout?.removeListener('data', client.onData); } catch {}
      flushPending(err?.message || '远程MCP进程错误');
    });

    entry._stdioClient = client;
    return client;
  }

  async _stdioRequest(serverName, entry, method, params, { timeoutMs = 15000 } = {}) {
    const client = this._ensureStdioClient(serverName, entry);
    if (!client || client.closed) {
      throw new Error(`远程MCP服务器 ${serverName} 不可用`);
    }
    const id = this._makeRemoteRequestId();
    const deferred = this._createDeferred();
    const timeout = setTimeout(() => {
      client.pending.delete(id);
      deferred.reject(new Error('调用超时'));
    }, Math.max(1000, Number(timeoutMs) || 15000));

    client.pending.set(id, { ...deferred, timeout });

    const request = { jsonrpc: '2.0', id, method, params: params || {} };
    entry.process.stdin.write(JSON.stringify(request) + '\n');
    return deferred.promise;
  }


  /**
   * 加载所有工作流（标准化流程）
   */
  async load(isRefresh = false) {
    if (!isRefresh && this.loaded) {
      BotUtil.makeLog('debug', '工作流已加载，跳过', 'StreamLoader');
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
      const files = await FileLoader.getCoreSubDirFiles('stream', {
        ext: '.js',
        recursive: false
      });
      
      if (files.length === 0) {
        BotUtil.makeLog('info', '未找到工作流，跳过加载', 'StreamLoader');
        this.loaded = true;
        return;
      }

      this._streamDirsCache = await paths.getCoreSubDirs('stream');
      // 阶段1: 加载工作流类
      await FileLoader.forEachBatch(files, LOADER_BATCH_SIZE, (file) => this.loadStreamClass(file));
      this._streamDirsCache = null;

      // 阶段2: 合并 Embedding/RAG 配置到各工作流
      this.applyEmbeddingConfig(getAistreamConfigOptional().embedding || {});

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
   * 加载单个工作流类
   */
  async loadStreamClass(file) {
    const streamName = path.basename(file, '.js');
    const startTime = Date.now();

    try {
      const module = await FileLoader.importFresh(file);
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

      // 文件键同时记 basename 与 Core 限定名，供热重载精确清理
      const qualifiedFileKey = resolveQualifiedCoreModuleKey(
        file,
        this._streamDirsCache || [],
        'stream'
      );
      this.fileKeyToStreamName.set(streamName, stream.name);
      if (qualifiedFileKey && qualifiedFileKey !== streamName) {
        this.fileKeyToStreamName.set(qualifiedFileKey, stream.name);
      }
      if (this.streams.has(stream.name)) {
        BotUtil.makeLog(
          'warn',
          `工作流名冲突，后加载覆盖: ${stream.name} ← ${qualifiedFileKey || streamName}`,
          'StreamLoader'
        );
      }
      this.streams.set(stream.name, stream);
      this.streamClasses.set(stream.name, StreamClass);

      // 若模块导出 getMcpServers，则记录插件提供的远程 MCP 服务器配置（插件式 MCP）
      if (typeof module.getMcpServers === 'function') {
        try {
          const servers = module.getMcpServers();
          if (servers && typeof servers === 'object') {
            const names = Object.keys(servers).filter(Boolean);
            if (names.length > 0) {
              BotUtil.makeLog(
                'info',
                `检测到 MCP 插件服务器: ${names.join(', ')} (来自 stream: ${stream.name})`,
                'StreamLoader'
              );
              for (const [name, cfg] of Object.entries(servers)) {
                if (!name) continue;
                this.mcpPluginServers.set(String(name), cfg || {});
              }
            }
          }
        } catch (e) {
          BotUtil.makeLog('warn', `加载 MCP 插件服务器失败: ${e.message}`, 'StreamLoader');
        }
      }

      const loadTime = Date.now() - startTime;
      this.loadStats.streams.push({
        name: stream.name,
        version: stream.version,
        loadTime,
        success: true,
        priority: stream.priority,
        mcpTools: stream.mcpTools?.size || 0
      });

      if (getAistreamConfigOptional().global?.debug) {
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

  /** 将 aistream.embedding 合并到各工作流 embeddingConfig（无外部向量服务初始化） */
  applyEmbeddingConfig(embeddingConfig = null) {
    const config = embeddingConfig || getAistreamConfigOptional().embedding || {};

    for (const stream of this.streams.values()) {
      if (stream.embeddingConfig?.enabled === false) continue;
      if (config.enabled === false) {
        stream.embeddingConfig = { ...stream.embeddingConfig, enabled: false };
        continue;
      }
      stream.embeddingConfig = { ...stream.embeddingConfig, ...config };
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
    if (getAistreamConfigOptional().global?.debug) {
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
      
      const ragTag = stream.embeddingConfig?.enabled ? ' RAG' : '';
      BotUtil.makeLog('debug',
        `  ${stream.name} v${stream.version} (${toolCount}工具, ${status}${ragTag})`,
        'StreamLoader'
      );
    }
  }

  /**
   * 重新加载工作流
   */
  async reload() {
    BotUtil.makeLog('info', '开始重新加载...', 'StreamLoader');
    
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
    BotUtil.makeLog('success', '重新加载完成', 'StreamLoader');
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

    return {
      total,
      enabled,
      disabled: total - enabled,
      totalTools,
      embedding: { enabled: embeddingEnabled },
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
    // 禁止沿用主流失效的工具白名单缓存
    merged._cachedToolStreamNames = null;

    const adoptMCPTools = (source, isPrimary) => {
      if (!source.mcpTools) return;
      for (const [tname, tconfig] of source.mcpTools.entries()) {
        const newName = (!isPrimary && prefixSecondary) ? `${source.name}.${tname}` : tname;
        if (merged.mcpTools.has(newName)) continue;
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
   * 为单个工作流注册 MCP 工具（供插件 init 等动态合并后调用）
   * 跳过合成实例；工具名已含 `.` 前缀时不再二次加 stream.name
   */
  registerStreamTools(stream) {
    if (!this.mcpServer || !stream?.mcpTools?.size) return;
    if (Array.isArray(stream._mergedStreams) && stream._mergedStreams.length > 0) {
      BotUtil.makeLog('debug', `跳过合成流 registerStreamTools: ${stream.name}`, 'StreamLoader');
      return;
    }
    for (const [toolName, tool] of stream.mcpTools.entries()) {
      this._registerTool(this.mcpServer, stream, toolName, tool);
    }
  }

  /**
   * 清理所有资源
   */
  async cleanupAll() {
    BotUtil.makeLog('info', '清理资源...', 'StreamLoader');
    
    await this._hotReload?.stop();
    this._hotReload = null;
    
    for (const stream of this.streams.values()) {
      if (typeof stream.cleanup === 'function') {
        await stream.cleanup().catch(() => {});
      }
    }

    await this._disposeAllRemoteMCPServers();

    MonitorService.reset();

    this.streams.clear();
    this.streamClasses.clear();
    this.fileKeyToStreamName.clear();
    this.loaded = false;

    BotUtil.makeLog('success', '清理完成', 'StreamLoader');
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
    for (const [fileKey, name] of this.fileKeyToStreamName) {
      if (name === streamName) this.fileKeyToStreamName.delete(fileKey)
    }
  }

  _streamNameForFile(filePath) {
    const fileKey = path.basename(filePath, '.js')
    const qualified = resolveQualifiedCoreModuleKey(filePath, [], 'stream')
    return this.fileKeyToStreamName.get(qualified)
      ?? this.fileKeyToStreamName.get(fileKey)
      ?? fileKey
  }

  /**
   * 重新加载工作流（优化：统一重载逻辑）
   * @private
   */
  async _reloadStream(filePath) {
    await this.loadStreamClass(filePath)
    this.applyEmbeddingConfig(getAistreamConfigOptional().embedding || {})
    await this.initMCP()
  }

  /**
   * 启用文件监视（热加载）
   * @param {boolean} enable - 是否启用
   */
  async watch(enable = true) {
    if (!enable) {
      await this._hotReload?.stop();
      this._hotReload = null;
      return;
    }

    if (this._hotReload?.watcher) return;

    try {
      const hotReload = new HotReloadBase({ loggerName: 'StreamLoader' });
      
      const streamDirs = await paths.getCoreSubDirs('stream');
      if (streamDirs.length === 0) return;

      const started = await hotReload.watch(true, {
        dirs: streamDirs,
        onAdd: async (filePath) => {
          const streamName = hotReload.getFileKey(filePath);
          BotUtil.makeLog('debug', `检测到新工作流: ${streamName}`, 'StreamLoader');
          await this._reloadStream(filePath);
        },
        onChange: async (filePath) => {
          const streamName = this._streamNameForFile(filePath);
          BotUtil.makeLog('debug', `检测到工作流变更: ${streamName}`, 'StreamLoader');
          await this._cleanupStream(streamName);
          await this._reloadStream(filePath);
        },
        onUnlink: async (filePath) => {
          const streamName = this._streamNameForFile(filePath);
          BotUtil.makeLog('debug', `检测到工作流删除: ${streamName}`, 'StreamLoader');
          await this._cleanupStream(streamName);
          await this.initMCP();
        }
      });

      if (started) this._hotReload = hotReload;
    } catch (error) {
      BotUtil.makeLog('error', '启动工作流文件监视失败', 'StreamLoader', error);
    }
  }

  _registerTool(mcpServer, stream, toolName, tool) {
    if (!tool?.enabled || !mcpServer?.registerTool) return false;
    // 已是 stream.tool 或 remote 前缀则不再二次加名
    const alreadyQualified = String(toolName).includes('.');
    const fullToolName = stream.name === 'mcp' || alreadyQualified
      ? toolName
      : `${stream.name}.${toolName}`;
    const loader = this;
    mcpServer.registerTool(fullToolName, {
      description: tool.description || `执行${toolName}操作`,
      inputSchema: tool.inputSchema || {},
      handler: async (args) => {
        const context = {
          get e() {
            return getStreamRequestContext()?.e ?? args.e ?? loader.currentEvent ?? null;
          },
          get turnState() {
            return getStreamRequestContext()?.turnState ?? null;
          },
          question: null,
          stream
        };
        try {
          if (!tool.handler) {
            return { success: false, error: 'Handler not found' };
          }
          const result = await tool.handler(args, { ...context, stream });
          let normalized;
          if (result === undefined) normalized = { success: true, message: '操作已执行' };
          else if (typeof result === 'object' && ('success' in result || 'error' in result)) normalized = result;
          else normalized = { success: true, data: result };

          // 非对外可视工具摘要写入会话历史，供下一轮 prompt（见 ChatStream.recordToolCallResult）
          if (typeof stream.recordToolCallResult === 'function') {
            try {
              const ev = context.e;
              if (ev) stream.recordToolCallResult(ev, fullToolName, normalized, args || {});
            } catch (recErr) {
              BotUtil.makeLog('debug', `recordToolCallResult: ${recErr.message}`, 'StreamLoader');
            }
          }
          return normalized;
        } catch (error) {
          BotUtil.makeLog('error', `MCP工具调用失败[${fullToolName}]: ${error.message}`, 'StreamLoader');
          const fail = { success: false, error: error.message };
          if (typeof stream.recordToolCallResult === 'function') {
            try {
              const ev = context.e;
              if (ev) stream.recordToolCallResult(ev, fullToolName, fail, args || {});
            } catch (recErr) {
              BotUtil.makeLog('debug', `recordToolCallResult on error: ${recErr.message}`, 'StreamLoader');
            }
          }
          return fail;
        }
      }
    });
    return true;
  }

  registerMCP(mcpServer) {
    if (!mcpServer) return;
    const seen = new Set();
    for (const stream of this.streams.values()) {
      // 合成实例工具已带二次前缀风险；只从成分流注册，LLM 白名单按成分流名匹配
      if (Array.isArray(stream?._mergedStreams) && stream._mergedStreams.length > 0) continue;
      if (!stream?.mcpTools?.size) continue;
      for (const [toolName, tool] of stream.mcpTools.entries()) {
        const alreadyQualified = String(toolName).includes('.');
        const full = stream.name === 'mcp' || alreadyQualified
          ? toolName
          : `${stream.name}.${toolName}`;
        if (seen.has(full)) continue;
        if (this._registerTool(mcpServer, stream, toolName, tool)) seen.add(full);
      }
    }
    this.mcpServer = mcpServer;
  }

  /**
   * 初始化MCP服务（如果配置启用）
   */
  async initMCP() {
    const mcpConfig = getAistreamConfigOptional().mcp || {};
    if (mcpConfig.enabled === false) return;

    if (!this.mcpServer) {
      this.mcpServer = new MCPServer();
    }

    // 清空已注册工具（含远程 MCP，支持热重载）
    const existingTools = Array.from(this.mcpServer.tools.keys());
    for (const toolName of existingTools) {
      this.mcpServer.tools.delete(toolName);
    }
    
    // 重新注册所有工作流的工具
    this.registerMCP(this.mcpServer);
    const localCount = this.mcpServer.tools.size;
    
    // 加载远程MCP服务器（如果启用）
    await this.loadRemoteMCPServers();
    
    // 标记MCP服务已初始化
    this.mcpServer.initialized = true;
    const remoteCount = this.mcpServer.tools.size - localCount;
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
    const remoteConfig = getAistreamConfigOptional().mcp?.remote || {};
    if (!remoteConfig.enabled) return null;
    const blocks = Array.isArray(remoteConfig.mcpServers) ? remoteConfig.mcpServers : [];
    if (!blocks.length) return null;

    const merged = {};
    const mergeServers = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      const map = obj.mcpServers && typeof obj.mcpServers === 'object' && !Array.isArray(obj.mcpServers)
        ? obj.mcpServers
        : null;
      if (!map) return;
      for (const [name, cfg] of Object.entries(map)) {
        const n = String(name || '').trim();
        if (!n || !cfg || typeof cfg !== 'object') continue;
        merged[n] = cfg;
      }
    };

    for (const block of blocks) {
      let obj = block?.config ?? block;
      if (typeof obj === 'string') {
        try { obj = JSON.parse(obj); } catch { obj = null; }
      }
      mergeServers(obj);
    }

    const servers = Object.entries(merged)
      .map(([name, cfg]) => ({ name, cfg }))
      .filter(item => item.name && item.cfg && typeof item.cfg === 'object');

    return servers.length ? { servers } : null;
  }

  /**
   * 加载远程MCP服务器并注册工具
   */
  async loadRemoteMCPServers() {
    if (!this.mcpServer) return [];
    if (process.env.XRK_TEST === '1') return [];

    const loadedServers = [];

    // 1) 先加载由 stream 插件提供的 MCP 服务器（安装插件即自动注册）
    for (const [serverName, cfg] of this.mcpPluginServers.entries()) {
      if (this._loadedPluginServers.has(serverName)) continue;
      try {
        await this._createRemoteMCPClient(serverName, cfg || {});
        this._loadedPluginServers.add(serverName);
        BotUtil.makeLog('info', `插件 MCP 服务器已加载: ${serverName}`, 'StreamLoader');
        loadedServers.push(serverName);
      } catch (error) {
        BotUtil.makeLog('warn', `加载插件 MCP 服务器 ${serverName} 失败: ${error.message}`, 'StreamLoader');
      }
    }

    // 2) 再加载 aistream.yaml 中配置的远程 MCP 服务器
    const config = this._getRemoteMCPConfig();
    const yamlNames = new Set(
      (config?.servers || []).map((item) => String(item?.name || '').trim()).filter(Boolean)
    );

    for (const name of [...this.remoteMCPServers.keys()]) {
      if (!this._loadedPluginServers.has(name) && !yamlNames.has(name)) {
        this._disposeRemoteMCPServer(name);
      }
    }

    if (!config) return loadedServers;

    const { servers } = config;
    
    for (const serverConfig of servers) {
      const serverName = String(serverConfig.name || '').trim();
      if (!serverName) continue;

      try {
        // 串行逐个加载，避免同时启动大量 stdio 子进程导致 CPU 峰值
        await this._createRemoteMCPClient(serverName, serverConfig.cfg || {});
        loadedServers.push(serverName);
      } catch (error) {
        BotUtil.makeLog('error', `加载远程MCP服务器 ${serverName} 失败: ${error.message}`, 'StreamLoader');
      }
    }
    
    return loadedServers;
  }

  /**
   * 获取已加载的远程 MCP 服务器名称列表
   * 用于在 /api/ai/models 暴露为“可选工作流”，让前端显式勾选启用。
   */
  listRemoteMCPServers() {
    const names = new Set([...this.mcpPluginServers.keys(), ...this.remoteMCPServers.keys()]);
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  /**
   * 创建远程MCP客户端并注册工具
   */
  async _createRemoteMCPClient(serverName, config) {
    const cfg = config && typeof config === 'object' ? config : {};
    this._disposeRemoteMCPServer(serverName);

    if (cfg.command) {
      // stdio 协议：通过子进程启动 MCP 服务器
      // 默认禁 shell（防命令注入）；需管道/特殊 shell 语法时在 mcp 配置显式 shell: true
      const spawnShell = typeof cfg.shell === 'boolean' ? cfg.shell : false;
      const child = spawn(
        String(cfg.command),
        Array.isArray(cfg.args) ? cfg.args : [],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: spawnShell,
          env: { ...process.env, ...(cfg.env && typeof cfg.env === 'object' ? cfg.env : {}) },
          cwd: typeof cfg.cwd === 'string' && cfg.cwd.trim() ? cfg.cwd.trim() : undefined
        }
      );
      const entry = { type: 'stdio', process: child, config: cfg };
      this.remoteMCPServers.set(serverName, entry);

      // 使用单一 stdout listener + pending map，避免超时/并发造成 listener 泄漏
      this._ensureStdioClient(serverName, entry);

      try {
        const initParams = {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'xrk-agt', version: '1.0.0' }
        };
        await this._stdioRequest(serverName, entry, 'initialize', initParams, { timeoutMs: 15000 });
        const listResult = await this._stdioRequest(serverName, entry, 'tools/list', {}, { timeoutMs: 15000 });
        if (listResult?.tools) {
          this._registerRemoteTools(serverName, listResult.tools);
        }
      } catch (error) {
        BotUtil.makeLog('error', `远程MCP服务器 ${serverName} 初始化失败: ${error.message}`, 'StreamLoader');
        throw error;
      }
    } else if (cfg.url) {
      // URL 协议：支持 HTTP / WebSocket 等远程 MCP transport
      const headers = cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {};
      const transport = String(cfg.transport || 'http').toLowerCase();

      if (transport === 'websocket' || transport === 'ws') {
        this.remoteMCPServers.set(serverName, { type: 'ws', url: cfg.url, headers, config: cfg });
        await this._fetchRemoteToolsViaWebSocket(serverName, { url: cfg.url, headers });
      } else {
        // 默认按 HTTP JSON-RPC 处理，包括 transport=http/sse/空
        this.remoteMCPServers.set(serverName, { type: 'http', url: cfg.url, headers, config: cfg });
        await this._fetchRemoteTools(serverName, { ...cfg, headers });
      }
    }
  }

  /**
   * 注册远程MCP工具到主MCP服务器
   */
  _registerRemoteTools(serverName, tools) {
    if (!this.mcpServer || !Array.isArray(tools)) return;
    
    const before = this.mcpServer.tools.size;
    for (const tool of tools) {
      const toolName = `remote-mcp.${serverName}.${tool.name}`;
      // 如果工具已存在，先删除再注册（避免重复警告）
      if (this.mcpServer.tools.has(toolName)) {
        this.mcpServer.tools.delete(toolName);
      }
      this.mcpServer.registerTool(toolName, {
        description: tool.description || '',
        inputSchema: tool.inputSchema || {},
        handler: (args) => this._callRemoteTool(serverName, tool.name, args)
      });
    }
    const added = this.mcpServer.tools.size - before;
    if (added > 0) {
      BotUtil.makeLog('info', `远程 MCP 工具已注册: ${serverName} (${added}个)`, 'StreamLoader');
    }
  }

  /**
   * 归一化远程 MCP 返回结果（stdio / HTTP 共用）
   * @private
   */
  _normalizeRemoteMCPResult(rawResult) {
    try {
      const text = rawResult?.content?.[0]?.text;

      if (typeof text === 'string' && text.trim().length > 0) {
        // 优先尝试把 text 当作 JSON 解析；失败则当作原始字符串返回
        try {
          return JSON.parse(text);
        } catch {
          return { success: true, raw: text };
        }
      }

      if (rawResult !== undefined) {
        return rawResult;
      }

      return { success: false, error: '远程MCP返回空结果' };
    } catch (e) {
      return { success: false, error: `解析远程MCP响应失败: ${e.message || e}` };
    }
  }

  /**
   * 调用远程 MCP 工具（stdio / HTTP / WebSocket）
   */
  async _callRemoteTool(serverName, toolName, args) {
    const server = this.remoteMCPServers.get(serverName);
    if (!server) {
      return { success: false, error: `远程MCP服务器 ${serverName} 未找到` };
    }

    if (server.type === 'stdio') {
      try {
        const result = await this._stdioRequest(
          serverName,
          server,
          'tools/call',
          { name: toolName, arguments: args },
          { timeoutMs: 30000 }
        );
        return this._normalizeRemoteMCPResult(result);
      } catch (error) {
        return { success: false, error: error.message || String(error) };
      }
    } else if (server.type === 'http') {
      try {
        const requestId = this._makeRemoteRequestId();
        const request = { jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name: toolName, arguments: args } };
        const response = await BotUtil.fetch(server.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...server.headers },
          body: JSON.stringify(request)
        });
        const data = await response.json();
        return this._normalizeRemoteMCPResult(data.result);
      } catch (error) {
        return { success: false, error: error.message };
      }
    } else if (server.type === 'ws') {
      // 简单 WebSocket JSON-RPC 客户端：每次调用按需建立连接
      try {
        const { default: WebSocket } = await import('ws');
        const requestId = this._makeRemoteRequestId();
        const request = { jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name: toolName, arguments: args } };
        return await new Promise((resolve) => {
          const ws = new WebSocket(server.url, { headers: server.headers || {} });
          const timeout = setTimeout(() => {
            try { ws.close(); } catch {}
            resolve({ success: false, error: '调用超时' });
          }, 30000);

          ws.on('open', () => {
            ws.send(JSON.stringify(request));
          });

          ws.on('message', (data) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.id !== requestId) return;
              clearTimeout(timeout);
              try { ws.close(); } catch {}
              const finalResult = this._normalizeRemoteMCPResult(msg.result);
              resolve(finalResult);
            } catch {
              // 忽略解析失败，继续等待下一条
            }
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            resolve({ success: false, error: err?.message || String(err) });
          });

          ws.on('close', () => {
            // 如果在超时前关闭且尚未返回，则以通用错误结束
            clearTimeout(timeout);
          });
        });
      } catch (error) {
        return { success: false, error: error.message || String(error) };
      }
    }
  }

  /**
   * 通过 HTTP 获取远程工具列表
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

  /**
   * 通过 WebSocket 获取远程工具列表（MCP JSON-RPC over WS）
   */
  async _fetchRemoteToolsViaWebSocket(serverName, config) {
    try {
      const { default: WebSocket } = await import('ws');
      const request = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

      await new Promise((resolve) => {
        const ws = new WebSocket(config.url, { headers: config.headers || {} });
        const timeout = setTimeout(() => {
          try { ws.close(); } catch {}
          resolve();
        }, 15000);

        ws.on('open', () => {
          ws.send(JSON.stringify(request));
        });

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.id !== 1) return;
            if (msg.result?.tools) {
              this._registerRemoteTools(serverName, msg.result.tools);
            }
          } catch {
            // 忽略解析失败
          } finally {
            clearTimeout(timeout);
            try { ws.close(); } catch {}
            resolve();
          }
        });

        ws.on('error', () => {
          clearTimeout(timeout);
          resolve();
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    } catch (error) {
      BotUtil.makeLog('error', `通过 WebSocket 获取远程MCP工具失败 ${serverName}: ${error.message}`, 'StreamLoader');
    }
  }
}

export default new StreamLoader();