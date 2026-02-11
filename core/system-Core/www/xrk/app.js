function $(selector, context = document) {
  return context.querySelector(selector);
}

function $$(selector, context = document) {
  return context.querySelectorAll(selector);
}

function initLazyLoad(selector = 'img[data-src]') {
  const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
          img.classList.add('loaded');
          observer.unobserve(img);
        }
      }
    });
  }, {
    rootMargin: '50px'
  });

  const images = $$(selector);
  images.forEach(img => imageObserver.observe(img));
}

class App {
  constructor() {
    this.serverUrl = window.location.origin;
    this.currentPage = 'home';
    this.currentAPI = null;
    this.apiConfig = null;
    this.selectedFiles = [];
    this._objectUrls = new Set();
    this.jsonEditor = null;
    this._charts = {};
    this._metricsHistory = { 
      netRx: Array(30).fill(0), 
      netTx: Array(30).fill(0),
      _initialized: false,
      _lastTimestamp: null,
      _lastUpdate: null
    };
    this._eventChatHistory = this._loadChatHistory('event');
    this._aiChatHistory = this._loadChatHistory('ai');
    this._voiceChatHistory = this._loadChatHistory('voice');
    this._isRestoringHistory = false;
    this._chatMessagesCache = { event: null, ai: null, voice: null };
    this._chatStreamState = { running: false, source: null };
    this._deviceWs = null;
    this._wsConnecting = false;
    this._micActive = false;
    this._ttsPlaying = false;
    this._ttsPending = false;
    this._ttsAudioContext = null;
    this._ttsAudioQueue = [];
    this._ttsTextQueue = []; // TTS文本请求队列
    // 用户是否主动点击“停止播报”——用于丢弃之后到达的音频块，避免还在疯狂播放
    this._ttsStoppedManually = false;
    this._ttsSessionActive = false; // 当前是否有活跃的TTS Session
    this._ttsSessionStartTime = null; // Session开始时间
    this._ttsNextPlayTime = 0;
    this._ttsActiveSources = []; // 跟踪活跃的播放源，用于资源管理
    this._ttsRetryTimer = null; // 播放重试定时器
    this._ttsStats = { // TTS统计信息
      totalChunks: 0,      // 接收的音频块总数
      totalBytes: 0,       // 接收的总字节数
      totalDuration: 0,   // 总播放时长（秒）
      sessionStartTime: null, // Session开始时间
      lastChunkTime: null,    // 最后一个块接收时间
      lastChunkReceiveTime: null, // 最后一个块接收的时间戳
      lastPlayTime: null,      // 最后一次播放开始时间
      expectedNextPlayTime: null, // 预期的下次播放时间
      wsMessageCount: 0,      // WebSocket消息接收计数
      processedMessageCount: 0 // 已处理的消息计数
    };
    this._ttsSentTextLength = 0; // 已发送TTS的文本长度（用于增量发送）
    this._ttsQueueWarned = false; // 队列接近上限是否已告警（避免重复日志）
    // 前端TTS队列状态上报（用于后端实时背压）
    this._ttsQueueReportTimer = null;
    this._ttsLastQueueReportAt = 0;
    this._ttsLastReportedQueueLen = -1;
    this._ttsLastReportedPlaying = null;
    this._ttsLastReportedActiveSources = -1;
    this._configState = null;
    this._schemaCache = {};
    this._llmOptions = { profiles: [], defaultProfile: '' };
    this._chatMode = localStorage.getItem('chatMode') || 'event';
    const savedWorkflows = localStorage.getItem('chatWorkflows');
    this._chatSettings = {
      workflows: savedWorkflows ? JSON.parse(savedWorkflows) : [],
      persona: localStorage.getItem('chatPersona') || '',
      provider: localStorage.getItem('chatProvider') || ''
    };
    this._webUserId = localStorage.getItem('webUserId') ?? 'webclient';
    this._activeEventSource = null;
    // ASR相关状态
    this._asrSessionId = null;
    this._asrChunkIndex = 0;
    this._audioBuffer = [];
    this._audioBufferTimer = null;
    this._preAudioBuffer = []; // 预缓冲：在录音开始前收集的音频
    this._asrReady = false; // ASR是否已准备好接收音频
    this._asrStats = {
      totalChunks: 0,
      totalBytes: 0,
      totalSamples: 0,
      sessionStartTime: null,
      lastChunkTime: null
    };
    this._micStarting = false;
    this._micStopping = false;
    this._systemThemeWatcher = null;
    this.theme = 'light';
    this._chatPendingTimer = null;
    this._chatQuickTimeout = null;
    this._heartbeatTimer = null;
    this._lastHeartbeatAt = 0;
    this._lastWsMessageAt = 0;
    this._offlineCheckTimer = null;
    this._processedMessageIds = new Set();
    this._latestSystem = null;
    this._homeDataCache = this._loadHomeDataCache();
    this._chartPluginsRegistered = false;
    // 事件绑定状态跟踪，避免重复绑定
    this._chatEventsBound = false;
    this._chatEventHandlers = new Map();
    
    this.init();
  }

  async init() {
    initLazyLoad();
    await this.loadAPIConfig();
    this.bindEvents();
    this.loadSettings();
    await this.loadLlmOptions();
    this._initMermaid();
    this.checkConnection();
    this.handleRoute();
    this.ensureDeviceWs();
    
    window.addEventListener('hashchange', () => this.handleRoute());
    // 切回浏览器标签页时只做连接检查，不再强制刷新历史/回到底部，避免打断用户阅读
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.checkConnection();
        this.ensureDeviceWs();
      }
    });
    this._statusUpdateTimer = setInterval(() => {
      if (this.currentPage === 'home' && !document.hidden && !this._statusLoading) {
        this.loadSystemStatus().catch(() => {});
      }
    }, 60000);
    
    window.addEventListener('beforeunload', () => {
      if (this._statusUpdateTimer) {
        clearInterval(this._statusUpdateTimer);
      }
      this._unbindChatEvents();
      this._revokeAllObjectUrls();
    });
  }

  _initMermaid() {
    try {
      if (!window.mermaid) return;
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'neutral'
      });
    } catch (e) {
      console.warn('[Mermaid] 初始化失败:', e);
    }
  }

  _renderMermaidIn(container) {
    try {
      if (!container || !window.mermaid) return;
      const nodes = container.querySelectorAll('.mermaid');
      if (!nodes.length) return;
      const targets = Array.from(nodes).filter((n) => !n.dataset.mermaidRendered);
      if (!targets.length) return;
      targets.forEach((n) => { n.dataset.mermaidRendered = '1'; });
      window.mermaid.init(undefined, targets);
      this._bindMermaidToolbar(container);
    } catch (e) {
      console.warn('[Mermaid] 渲染失败:', e);
    }
  }

  _bindMermaidToolbar(root) {
    if (!root) return;
    const wrappers = root.querySelectorAll('.md-mermaid');
    if (!wrappers.length) return;

    wrappers.forEach((wrap) => {
      if (wrap.dataset._toolbarBound) return;
      wrap.dataset._toolbarBound = '1';

      const copyBtn = wrap.querySelector('.md-mermaid-copy');
      const downloadBtn = wrap.querySelector('.md-mermaid-download');

      // 复制 Mermaid 源码
      if (copyBtn && navigator.clipboard) {
        copyBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const raw = wrap.getAttribute('data-mermaid-raw') || '';
          const text = raw
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
          try {
            await navigator.clipboard.writeText(text);
            this.showToast('Mermaid 已复制到剪贴板', 'success');
          } catch {
            this.showToast('复制 Mermaid 失败', 'error');
          }
        });
      }

      // 下载高清 PNG
      if (downloadBtn) {
        downloadBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const svg = wrap.querySelector('svg');
            if (!svg) {
              this.showToast('找不到图表内容', 'warning');
              return;
            }
            // 为了避免导出不完整，使用 SVG 的 viewBox / 边界框精确计算尺寸
            const cloned = svg.cloneNode(true);
            let width = Number(cloned.getAttribute('width')) || 0;
            let height = Number(cloned.getAttribute('height')) || 0;

            const vb = cloned.viewBox && cloned.viewBox.baseVal;
            if (vb && vb.width && vb.height) {
              width = vb.width;
              height = vb.height;
              cloned.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
            } else {
              // 回退：用几何边界框
              const bbox = svg.getBBox();
              width = bbox.width;
              height = bbox.height;
              cloned.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
            }
            if (!width || !height) {
              this.showToast('图表尺寸异常，无法导出', 'error');
              return;
            }
            cloned.setAttribute('width', String(width));
            cloned.setAttribute('height', String(height));

            const xml = new XMLSerializer().serializeToString(cloned);
            const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });

            // 优先尝试导出高清 PNG；如果被跨域安全策略阻止，则优雅回退为下载 SVG
            const tryExportPng = () => new Promise((resolve, reject) => {
              const url = URL.createObjectURL(svgBlob);
              const img = new Image();
              img.onload = () => {
                try {
                  const scale = 2; // 高清倍数
                  const canvas = document.createElement('canvas');
                  canvas.width = width * scale;
                  canvas.height = height * scale;
                  const ctx = canvas.getContext('2d');
                  ctx.setTransform(scale, 0, 0, scale, 0, 0);
                  ctx.clearRect(0, 0, canvas.width, canvas.height);
                  ctx.drawImage(img, 0, 0, width, height);
                  URL.revokeObjectURL(url);

                  try {
                    canvas.toBlob((blob) => {
                      if (!blob) {
                        reject(new Error('toBlob 返回空 blob'));
                        return;
                      }
                      const a = document.createElement('a');
                      a.download = `mermaid-${Date.now()}.png`;
                      a.href = URL.createObjectURL(blob);
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
                      resolve(true);
                    }, 'image/png');
                  } catch (err) {
                    // 例如 SecurityError: tainted canvas
                    reject(err);
                  }
                } catch (err) {
                  URL.revokeObjectURL(url);
                  reject(err);
                }
              };
              img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Image 加载失败'));
              };
              img.src = url;
            });

            let exported = false;
            try {
              exported = await tryExportPng();
            } catch {
              exported = false;
            }

            // 如果 PNG 导出失败（如跨域导致 canvas 污染），回退为下载 SVG 源文件
            if (!exported) {
              const a = document.createElement('a');
              const url = URL.createObjectURL(svgBlob);
              a.download = `mermaid-${Date.now()}.svg`;
              a.href = url;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 2000);
              this.showToast('PNG 导出受限，已改为下载 SVG 原图', 'warning');
            }
          } catch {
            this.showToast('导出 PNG 失败', 'error');
          }
        });
      }
    });
  }

  /**
   * 从 DataTransfer 中提取文件（兼容不同浏览器/客户端：items 与 files）
   * @param {DataTransfer} dt
   * @returns {File[]}
   */
  _extractFilesFromDataTransfer(dt) {
    try {
      if (!dt) return [];
      const out = [];
      const items = Array.from(dt.items ?? []);
      if (items.length) {
        for (const it of items) {
          if (it && it.kind === 'file') {
            const f = it.getAsFile?.();
            if (f) out.push(f);
          }
        }
      }
      if (!out.length && dt.files && dt.files.length) {
        return Array.from(dt.files);
      }
      return out;
    } catch {
      try {
        return Array.from(dt?.files ?? []);
      } catch {
        return [];
      }
    }
  }

  _safeRevokeObjectURL(url) {
    if (!url) return;
    try {
      URL.revokeObjectURL(url);
      this._objectUrls?.delete(url);
    } catch {}
  }

  _createTrackedObjectURL(file) {
    try {
      const url = URL.createObjectURL(file);
      this._objectUrls?.add(url);
      return url;
    } catch {
      return '';
    }
  }

  _revokeAllObjectUrls() {
    if (!this._objectUrls) return;
    try {
      for (const url of this._objectUrls) {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      }
      this._objectUrls.clear();
    } catch {}
  }

  async loadAPIConfig() {
    try {
      const res = await fetch('api-config.json');
      this.apiConfig = await res.json();
    } catch (e) {
      console.error('Failed to load API config:', e);
    }
  }

  async loadLlmOptions() {
    try {
      const res = await fetch(`${this.serverUrl}/api/ai/models`, { headers: this.getHeaders() });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data?.success) {
        throw new Error(data?.message || 'LLM 接口返回异常');
      }
      this._llmOptions = {
        enabled: data.enabled !== false,
        defaultProfile: data.defaultProfile ?? '',
        profiles: data.profiles ?? [],
        workflows: data.workflows ?? []
      };

    } catch (e) {
      console.warn('未能加载 LLM 档位信息:', e.message || e);
    }
  }

  bindEvents() {
    const menuBtn = $('#menuBtn');
    const sidebarClose = $('#sidebarClose');
    const overlay = $('#overlay');
    const apiListBackBtn = $('#apiListBackBtn');
    const themeToggle = $('#themeToggle');
    const saveApiKeyBtn = $('#saveApiKeyBtn');
    const apiKey = $('#apiKey');
    const apiKeyToggleBtn = $('#apiKeyToggleBtn');
    const navContainer = $('#navMenu');
    
    menuBtn.addEventListener('click', () => this.toggleSidebar());
    sidebarClose.addEventListener('click', () => this.closeSidebar());
    overlay.addEventListener('click', () => this.closeSidebar());
    
    apiListBackBtn.addEventListener('click', () => {
      const navMenu = $('#navMenu');
      const apiListContainer = $('#apiListContainer');
        navMenu.style.display = 'flex';
        apiListContainer.style.display = 'none';
    });
    
    themeToggle.addEventListener('click', () => this.toggleTheme());
    
    saveApiKeyBtn.addEventListener('click', () => this.saveApiKey());
    apiKey.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.saveApiKey();
      }
    });
    apiKeyToggleBtn.addEventListener('click', () => this.toggleApiKeyBox());
    
      navContainer.addEventListener('click', (e) => {
        const navItem = e.target.closest('.nav-item');
        if (navItem) {
          e.preventDefault();
          const page = navItem.dataset.page;
          if (page) this.navigateTo(page);
        }
      });
    
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && this.currentAPI) {
        e.preventDefault();
        this.executeRequest();
      }
    });
  }
  
  toggleApiKeyBox() {
    $('#apiKeyBox').classList.toggle('show');
  }

  loadSettings() {
    const savedKey = localStorage.getItem('apiKey');
    if (savedKey) {
      $('#apiKey').value = savedKey;
    }
    
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme === 'dark' || storedTheme === 'light') {
      this.applyTheme(storedTheme);
      this.disableSystemThemeSync();
    } else {
      this.applyTheme(this.detectSystemTheme());
      this.enableSystemThemeSync();
    }
  }

  detectSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  enableSystemThemeSync() {
    if (this._systemThemeWatcher) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event) => {
      if (!localStorage.getItem('theme')) {
        this.applyTheme(event.matches ? 'dark' : 'light');
      }
    };
      mql.addEventListener('change', handler);
    this._systemThemeWatcher = { mql, handler };
  }

  disableSystemThemeSync() {
    if (!this._systemThemeWatcher) return;
    const { mql, handler } = this._systemThemeWatcher;
    mql.removeEventListener('change', handler);
    this._systemThemeWatcher = null;
  }

  applyTheme(theme, { persist = false } = {}) {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    this.theme = nextTheme;
    document.body.classList.toggle('dark', nextTheme === 'dark');
    document.documentElement?.setAttribute('data-theme', nextTheme);
    if (persist) {
      localStorage.setItem('theme', nextTheme);
      this.disableSystemThemeSync();
    }
  }

  toggleTheme() {
    const nextTheme = this.theme === 'dark' ? 'light' : 'dark';
    this.applyTheme(nextTheme, { persist: true });
    this.showToast(nextTheme === 'dark' ? '已切换到暗色主题' : '已切换到亮色主题', 'info');
  }

  toggleSidebar() {
    $('#sidebar').classList.toggle('open');
    $('#overlay').classList.toggle('show');
  }

  openSidebar() {
    $('#sidebar').classList.add('open');
    $('#overlay').classList.add('show');
  }

  closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#overlay').classList.remove('show');
  }

  saveApiKey() {
    const key = $('#apiKey').value.trim();
    if (!key) {
      this.showToast('请输入 API Key', 'warning');
      return;
    }
      localStorage.setItem('apiKey', key);
      this.showToast('API Key 已保存', 'success');
      this.checkConnection();
  }

  getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const key = localStorage.getItem('apiKey');
    if (key) headers['X-API-Key'] = key;
    return headers;
  }

  async checkConnection() {
    // 防止重复请求
    if (this._connectionChecking) return;
    this._connectionChecking = true;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const res = await fetch(`${this.serverUrl}/api/status`, { 
        headers: this.getHeaders(),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const status = $('#connectionStatus');
      if (!status) return;
      
      if (res && res.ok) {
        status.classList.add('online');
        const statusText = status.querySelector('.status-text');
        if (statusText) statusText.textContent = '已连接';
      } else {
        status.classList.remove('online');
        const statusText = status.querySelector('.status-text');
        if (statusText) statusText.textContent = res ? '未授权' : '连接失败';
      }
    } catch (error) {
      const status = $('#connectionStatus');
      if (!status) return;
      
      status.classList.remove('online');
      const statusText = status.querySelector('.status-text');
      if (statusText) {
        const isTimeout = error.name === 'AbortError' || error.name === 'TimeoutError';
        statusText.textContent = isTimeout ? '连接超时' : '连接失败';
      }
    } finally {
      this._connectionChecking = false;
    }
  }

  handleRoute() {
    const hash = location.hash.replace(/^#\/?/, '') || 'home';
    const page = hash.split('?')[0];
    this.navigateTo(page);
  }

  navigateTo(page) {
    this.currentPage = page;
    
    const navItems = $$('.nav-item');
    navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });
    
    const titles = { home: '系统概览', chat: 'AI 对话', config: '配置管理', api: 'API 调试' };
    const headerTitle = $('#headerTitle');
    if (headerTitle) {
      headerTitle.textContent = titles[page] || page;
    }
    
    const navMenu = $('#navMenu');
    const apiListContainer = $('#apiListContainer');
    const isMobile = window.innerWidth <= 768;
    
    if (page === 'api') {
      if (navMenu) navMenu.style.display = 'none';
      if (apiListContainer) apiListContainer.style.display = 'flex';
      this.renderAPIGroups();
      if (isMobile) {
        this.openSidebar();
      }
    } else {
      if (navMenu) navMenu.style.display = 'flex';
      if (apiListContainer) apiListContainer.style.display = 'none';
      if (isMobile) {
        this.closeSidebar();
      }
    }
    
      switch (page) {
        case 'home': this.renderHome(); break;
        case 'chat': this.renderChat(); break;
        case 'config': this.renderConfig(); break;
        case 'api': this.renderAPI(); break;
        default: this.renderHome();
      }
    
    if (location.hash !== `#/${page}`) {
      location.hash = `#/${page}`;
    }
  }

  async renderHome() {
    ['cpu', 'mem', 'net'].forEach(key => {
      if (this._charts[key]) {
        try {
          this._charts[key].destroy();
        } catch (e) {
          console.warn(`Failed to destroy chart ${key}:`, e);
        }
        this._charts[key] = null;
      }
    });
    
    const content = $('#content');
    
    content.innerHTML = `
      <div class="dashboard">
        <div class="dashboard-header">
          <div>
            <h1 class="dashboard-title">系统概览</h1>
            <p class="dashboard-subtitle">实时监控系统运行状态</p>
          </div>
        </div>
        
        <div class="stats-grid" id="statsGrid">
          <div class="stat-card">
            <div class="stat-header">
              <div class="stat-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
              </div>
            </div>
            <div class="stat-value" id="cpuValue">--%</div>
            <div class="stat-label">CPU 使用率</div>
          </div>
          <div class="stat-card">
            <div class="stat-header">
              <div class="stat-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 12H18L15 21L9 3L6 12H2"/>
                </svg>
              </div>
            </div>
            <div class="stat-value" id="memValue">--</div>
            <div class="stat-label">内存使用</div>
          </div>
          <div class="stat-card">
            <div class="stat-header">
              <div class="stat-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <ellipse cx="12" cy="5" rx="9" ry="3"/>
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                </svg>
              </div>
            </div>
            <div class="stat-value" id="diskValue">--</div>
            <div class="stat-label">磁盘使用</div>
          </div>
          <div class="stat-card">
            <div class="stat-header">
              <div class="stat-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12,6 12,12 16,14"/>
                </svg>
              </div>
            </div>
            <div class="stat-value" id="uptimeValue">--</div>
            <div class="stat-label">运行时间</div>
          </div>
        </div>
        
        <div class="chart-grid">
          <div class="chart-card">
            <div class="chart-card-header">
              <span class="chart-card-title">系统资源</span>
            </div>
            <div class="chart-container-dual">
              <div class="chart-item">
                <div class="chart-item-label">CPU</div>
                <div class="chart-item-canvas"><canvas id="cpuChart"></canvas></div>
              </div>
              <div class="chart-item">
                <div class="chart-item-label">内存</div>
                <div class="chart-item-canvas"><canvas id="memChart"></canvas></div>
              </div>
            </div>
          </div>
          <div class="chart-card">
            <div class="chart-card-header">
              <span class="chart-card-title">网络流量 (KB/s)</span>
            </div>
            <div class="chart-container"><canvas id="netChart"></canvas></div>
          </div>
        </div>
        
        <div class="info-grid">
          <div class="card">
            <div class="card-header">
              <span class="card-title">机器人状态</span>
            </div>
            <div id="botsInfo" style="padding:0;color:var(--text-muted);text-align:center">加载中...</div>
          </div>
          
          <div class="card">
            <div class="card-header">
              <span class="card-title">插件信息</span>
            </div>
            <div id="pluginsInfo" style="padding:20px;color:var(--text-muted);text-align:center">加载中...</div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">工作流状态</span>
            </div>
            <div id="workflowInfo" style="padding:20px;color:var(--text-muted);text-align:center">加载中...</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">网络接口</span>
          </div>
          <div id="networkInfo" style="padding:20px;color:var(--text-muted);text-align:center">加载中...</div>
        </div>
        
        <div class="card">
          <div class="card-header">
            <span class="card-title">进程 Top 5</span>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>进程名</th>
                <th>PID</th>
                <th>CPU</th>
                <th>内存</th>
              </tr>
            </thead>
            <tbody id="processTable">
              <tr><td colspan="4" style="text-align:center;color:var(--text-muted)">加载中...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    // 立即应用缓存数据（使用微任务确保 DOM 已渲染）
    const cachedData = this._homeDataCache || this._latestSystem;
    if (cachedData) {
      // 使用微任务确保 DOM 已渲染后再应用数据
      Promise.resolve().then(() => {
        this._applyHomeData(cachedData, true);
      });
    }
    
    // 后台加载最新数据，平滑更新
    this._loadHomeDataAndUpdate();
  }
  
  /**
   * 应用首页数据（支持缓存数据平滑过渡）
   */
  _applyHomeData(data) {
    if (!data) return;
    
    // 更新系统状态（包括统计卡片和图表）- 缓存数据也要显示
    this.updateSystemStatus(data);
    
    // 更新各个面板（平滑过渡）
    this.renderBotsPanel(data.bots ?? []);
    this.renderWorkflowInfo(data.workflows ?? {}, data.panels ?? {});
    this.renderNetworkInfo(data.system?.network ?? {}, data.system?.netRates ?? {});
  }
  
  /**
   * 加载首页数据并更新（后台更新，平滑过渡）
   */
  async _loadHomeDataAndUpdate() {
    try {
      // 并行加载系统状态和插件信息
      await Promise.all([
        this.loadSystemStatus(),
        this.loadPluginsInfo()
      ]);
    } catch (error) {
      console.warn('首页数据加载失败:', error);
    }
  }
  
  /**
   * 从 localStorage 加载首页数据缓存
   */
  _loadHomeDataCache() {
    try {
      const cached = localStorage.getItem('homeDataCache');
      if (!cached) return null;
      
        const data = JSON.parse(cached);
        const cacheTime = data._cacheTime || 0;
      const CACHE_TTL = 5 * 60 * 1000; // 5分钟
      
      if (Date.now() - cacheTime < CACHE_TTL) {
          return data;
      }
    } catch (e) {
      console.warn('[缓存] 加载失败:', e);
    }
    return null;
  }
  
  _saveHomeDataCache(data) {
    try {
      const cacheData = {
        ...data,
        _cacheTime: Date.now()
      };
      localStorage.setItem('homeDataCache', JSON.stringify(cacheData));
      this._homeDataCache = cacheData;
    } catch (e) {
      console.warn('[缓存] 保存失败:', e);
    }
  }

  /**
   * 加载系统状态（企业级统一方法）
   * 从后端获取系统概览数据，包括机器人、工作流、网络等信息
   */
  async loadSystemStatus() {
    // 防止重复请求
    if (this._statusLoading) {
      return this._statusLoadingPromise || Promise.resolve();
    }
    
    this._statusLoading = true;
    this._statusLoadingPromise = (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
      const res = await fetch(`${this.serverUrl}/api/system/overview?withHistory=1`, { 
        headers: this.getHeaders(),
          signal: controller.signal
      });
        
        clearTimeout(timeoutId);
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      
      if (!data.success) {
        throw new Error(data.error || '获取系统状态失败');
      }
      
      this._latestSystem = data;
      this._saveHomeDataCache(data);
      this._applyHomeData(data, false);
      
    } catch (e) {
        if (e.name !== 'AbortError' && e.name !== 'TimeoutError') {
          console.warn('[系统状态] 加载失败:', e.message);
        }
        
        const cachedData = this._latestSystem || this._homeDataCache;
        if (cachedData) {
        this._applyHomeData(cachedData, true);
      }
      } finally {
        this._statusLoading = false;
        this._statusLoadingPromise = null;
    }
    })();
    
    return this._statusLoadingPromise;
  }
  
  renderBotsPanel(bots = []) {
    const botsInfo = document.getElementById('botsInfo');
    if (!botsInfo) return;
    
    // 添加更新标记，用于CSS过渡
    botsInfo.setAttribute('data-updating', 'true');
    
    if (!Array.isArray(bots) || !bots.length) {
      botsInfo.innerHTML = '<div style="color:var(--text-muted);padding:16px">暂无机器人</div>';
      setTimeout(() => botsInfo.removeAttribute('data-updating'), 300);
      return;
    }
      
        botsInfo.innerHTML = `
          <div style="display:grid;gap:0">
        ${bots.map((bot, index) => `
          <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;${index < bots.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}transition:background var(--transition);cursor:pointer" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
            <div style="width:40px;height:40px;border-radius:16px;background:var(--bg-muted);display:flex;align-items:center;justify-content:center;font-weight:600;color:var(--primary)">
              ${(bot.nickname || '').slice(0,2) || (bot.uin || '').slice(-2) || '??'}
            </div>
                <div style="flex:1;min-width:0;text-align:left">
              <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;font-size:14px;text-align:left">${this.escapeHtml(bot.nickname ?? bot.uin)}</div>
                  <div style="font-size:12px;color:var(--text-muted);line-height:1.4;text-align:left">
                    ${bot.tasker || '未知 Tasker'}${bot.device ? '' : ` · ${(bot.stats && bot.stats.friends) || 0} 好友 · ${(bot.stats && bot.stats.groups) || 0} 群组`}
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
                  ${bot.avatar && !bot.device ? `
                    <img src="${bot.avatar}" 
                         alt="${bot.nickname}" 
                         style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid var(--border);background:var(--bg-input);flex-shrink:0"
                         onerror="this.style.display='none'">
                  ` : ''}
                  <div style="width:10px;height:10px;border-radius:50%;background:${bot.online ? 'var(--success)' : 'var(--text-muted)'};flex-shrink:0;box-shadow:0 0 0 2px ${bot.online ? 'var(--success-light)' : 'transparent'}"></div>
                </div>
              </div>
            `).join('')}
          </div>
        `;
    
    requestAnimationFrame(() => {
      botsInfo.removeAttribute('data-updating');
    });
  }
  
  renderWorkflowInfo(workflows = {}, panels = {}) {
    const box = document.getElementById('workflowInfo');
    if (!box) return;
    
    box.setAttribute('data-updating', 'true');
    const workflowData = panels.workflows ?? workflows;
    const stats = workflowData.stats ?? {};
    const items = workflowData.items ?? [];
    const total = stats.total ?? workflowData.total ?? 0;
    
    if (!total && !items.length) {
      box.innerHTML = '<div style="color:var(--text-muted);padding:16px">暂无工作流数据</div>';
      requestAnimationFrame(() => box.removeAttribute('data-updating'));
      return;
    }
    
    const enabled = stats.enabled ?? workflowData.enabled ?? 0;
    const totalCount = total;
    const embeddingReady = stats.embeddingReady ?? workflowData.embeddingReady ?? 0;
    const provider = stats.provider ?? workflowData.provider ?? '默认';
    
    box.innerHTML = `
      <div style="display:flex;gap:24px;flex-wrap:wrap;justify-content:center">
        <div style="text-align:center;min-width:0;flex:1 1 auto">
          <div style="font-size:22px;font-weight:700;color:var(--primary);margin-bottom:6px">${enabled}/${totalCount}</div>
          <div style="font-size:12px;color:var(--text-muted);line-height:1.4">启用 / 总数</div>
        </div>
        <div style="text-align:center;min-width:0;flex:1 1 auto">
          <div style="font-size:22px;font-weight:700;color:var(--success);margin-bottom:6px">${embeddingReady}</div>
          <div style="font-size:12px;color:var(--text-muted);line-height:1.4">Embedding 就绪</div>
        </div>
        <div style="text-align:center;min-width:0;flex:1 1 auto">
          <div style="font-size:22px;font-weight:700;color:var(--warning);margin-bottom:6px">${this.escapeHtml(provider)}</div>
          <div style="font-size:12px;color:var(--text-muted);line-height:1.4">Embedding Provider</div>
        </div>
      </div>
      ${items.length ? `
        <div style="margin-top:16px;font-size:12px;color:var(--text-muted);text-align:center">工作流列表</div>
        <ul style="margin:8px 0 0;padding:0;list-style:none">
          ${items.map(item => `
            <li style="padding:8px 0;border-bottom:1px solid var(--border)">
              <div style="font-weight:600;color:var(--text-primary)">${this.escapeHtml(item.name ?? 'workflow')}</div>
              <div style="font-size:12px;color:var(--text-muted)">${this.escapeHtml(item.description ?? '')}</div>
            </li>
          `).join('')}
        </ul>
      ` : ''}
    `;
  }
  
  renderNetworkInfo(network = {}, rates = {}) {
    const box = document.getElementById('networkInfo');
    if (!box) return;
    
    // 添加更新标记，用于CSS过渡
    box.setAttribute('data-updating', 'true');
    const entries = Object.entries(network ?? {});
    if (!entries.length) {
      box.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; margin: 0 auto 12px; opacity: 0.3;">
            <path d="M21 16V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2h14a2 2 0 002-2z"/>
            <polyline points="23,6 13.5,15.5 8.5,10.5 1,18"/>
            <polyline points="17,6 23,6 23,12"/>
          </svg>
          <p>暂无网络信息</p>
        </div>
      `;
      requestAnimationFrame(() => box.removeAttribute('data-updating'));
      return;
    }
    
    const rxSec = rates.rxSec ?? rates.rx ?? 0;
    const txSec = rates.txSec ?? rates.tx ?? 0;
    const rxFormatted = this.formatBytes(rxSec);
    const txFormatted = this.formatBytes(txSec);
    const rateText = `${rxFormatted}/s ↓ · ${txFormatted}/s ↑`;
    
    box.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;text-align:center;line-height:1.4;padding:8px;background:var(--bg-input);border-radius:var(--radius);border:1px solid var(--border)">
        <span style="color:var(--primary);font-weight:600">${rateText}</span>
      </div>
      ${entries.map(([name, info]) => {
        const address = info.address ?? '';
        const mac = info.mac ?? '';
        return `
        <div style="padding:12px;border-bottom:1px solid var(--border);transition:background var(--transition)" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
          <div style="font-weight:600;color:var(--text-primary);text-align:center;margin-bottom:4px">${this.escapeHtml(name)}</div>
          <div style="font-size:12px;color:var(--text-muted);text-align:center;line-height:1.4">
            <span style="font-family:monospace">IP: ${this.escapeHtml(address)}</span>${mac ? ` <span style="font-family:monospace">· MAC: ${this.escapeHtml(mac)}</span>` : ''}
          </div>
        </div>
      `;
      }).join('')}
    `;
    
    requestAnimationFrame(() => box.removeAttribute('data-updating'));
  }

  renderMarkdown(text) {
    if (!text) return '';
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // GitHub 风格子集：先提取 fenced code blocks（支持 ```lang），避免被其它规则干扰
    const blocks = [];
    const withPlaceholders = String(text).replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      const i = blocks.length;
      blocks.push({ lang: (lang || '').toLowerCase(), code: String(code || '') });
      return `@@MD_BLOCK_${i}@@`;
    });

    // 行级解析：支持列表分组/引用/分隔线/标题/段落/表格
    const lines = withPlaceholders.split(/\r?\n/);
    let out = '';
    let inUl = false;
    let inOl = false;
    let inQuote = false;
    let quoteBuf = [];
    // 表格状态：inTable 表示当前是否在表格块内，tableRows 收集表头和行
    let inTable = false;
    let tableRows = [];

    const flushLists = () => {
      if (inUl) { out += '</ul>'; inUl = false; }
      if (inOl) { out += '</ol>'; inOl = false; }
    };
    const flushQuote = () => {
      if (!inQuote) return;
      const inner = quoteBuf.join('\n');
      out += `<blockquote class="md-quote">${inner}</blockquote>`;
      inQuote = false;
      quoteBuf = [];
    };

    const inline = (s) => {
      let html = esc(s);
      // 图片 ![alt](url)（先于链接）
      html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img class="md-img" alt="$1" src="$2" loading="lazy">');
      // 链接 [text](url)
      html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      // 删除线 ~~text~~
      html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      // 粗体 **text**
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // 行内代码 `code`
      html = html.replace(/`([^`]+)`/g, (_, code) => `<code class="md-inline">${esc(code)}</code>`);
      // 斜体 *text*（放在粗体后）
      html = html.replace(/(^|[^\*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
      // 任务列表 [ ] / [x]
      html = html.replace(/^\s*\[( |x|X)\]\s+/g, (_, c) => {
        const checked = String(c).toLowerCase() === 'x';
        return `<input type="checkbox" class="md-task" ${checked ? 'checked' : ''} disabled> `;
      });
      return html;
    };

    const flushTable = () => {
      if (!inTable || tableRows.length === 0) return;
      const header = tableRows[0];
      const bodyRows = tableRows.slice(1);
      out += '<table class="md-table">';
      if (header) {
        out += '<thead><tr>';
        header.cells.forEach((c) => {
          out += `<th>${inline(c)}</th>`;
        });
        out += '</tr></thead>';
      }
      if (bodyRows.length) {
        out += '<tbody>';
        bodyRows.forEach((row) => {
          out += '<tr>';
          row.cells.forEach((c) => {
            out += `<td>${inline(c)}</td>`;
          });
          out += '</tr>';
        });
        out += '</tbody>';
      }
      out += '</table>';
      inTable = false;
      tableRows = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = String(rawLine ?? '');

      // 空行：结束块
      if (!line.trim()) {
        flushQuote();
        flushLists();
        flushTable();
        continue;
      }

      // 表格处理：匹配形如 | a | b | 的行，并检查下一行是否为 --- 分隔线
      const tableRowMatch = line.match(/^\s*\|(.+)\|\s*$/);
      if (tableRowMatch) {
        const next = lines[i + 1] ?? '';
        const dividerMatch = /^\s*\|?\s*:?-{2,}.*\|\s*$/.test(String(next));
        // 表头 + 分隔线：开始一个表格
        if (!inTable && dividerMatch) {
          flushQuote();
          flushLists();
          flushTable();
          const headerCells = tableRowMatch[1].split('|').map(c => c.trim());
          tableRows.push({ header: true, cells: headerCells });
          inTable = true;
          i += 1; // 跳过分隔线行
          continue;
        }
        // 已在表格中：追加数据行
        if (inTable) {
          const cells = tableRowMatch[1].split('|').map(c => c.trim());
          tableRows.push({ header: false, cells });
          continue;
        }
      } else if (inTable) {
        // 表格结束，刷新为 HTML，再继续按照普通行处理当前行
        flushTable();
      }

      // Mermaid / Code placeholders
      const ph = line.trim().match(/^@@MD_BLOCK_(\d+)@@$/);
      if (ph) {
        flushQuote();
        flushLists();
        out += `@@MD_BLOCK_${ph[1]}@@`;
        continue;
      }

      // 分隔线
      if (/^\s*(---|___|\*\*\*)\s*$/.test(line)) {
        flushQuote();
        flushLists();
        flushTable();
        out += '<hr class="md-hr">';
        continue;
      }

      // 引用 >
      const quoteMatch = line.match(/^\s*>\s?(.*)$/);
      if (quoteMatch) {
        flushLists();
        flushTable();
        inQuote = true;
        quoteBuf.push(`<div class="md-quote-line">${inline(quoteMatch[1])}</div>`);
        continue;
      }
      flushQuote();

      // 标题
      const h3 = line.match(/^\s*###\s+(.*)$/);
      if (h3) { flushLists(); out += `<h3>${inline(h3[1])}</h3>`; continue; }
      const h2 = line.match(/^\s*##\s+(.*)$/);
      if (h2) { flushLists(); out += `<h2>${inline(h2[1])}</h2>`; continue; }

      // 无序列表
      const ul = line.match(/^\s*[-*]\s+(.+)$/);
      if (ul) {
        if (inOl) { out += '</ol>'; inOl = false; }
        flushTable();
        if (!inUl) { out += '<ul class="md-list">'; inUl = true; }
        out += `<li>${inline(ul[1])}</li>`;
        continue;
      }

      // 有序列表
      const ol = line.match(/^\s*\d+\.\s+(.+)$/);
      if (ol) {
        if (inUl) { out += '</ul>'; inUl = false; }
        flushTable();
        if (!inOl) { out += '<ol class="md-list">'; inOl = true; }
        out += `<li>${inline(ol[1])}</li>`;
        continue;
      }

      // 普通段落
      flushLists();
      flushTable();
      out += `<p>${inline(line)}</p>`;
    }

    flushQuote();
    flushLists();
    flushTable();

    // 回填 fenced blocks
    out = out.replace(/@@MD_BLOCK_(\d+)@@/g, (_, idx) => {
      const b = blocks[Number(idx)];
      if (!b) return '';
      const rawCode = b.code.replace(/\s+$/g, '');
      const safeCode = esc(rawCode);
      if (b.lang === 'mermaid') {
        // 为每个 Mermaid 区块生成统一容器，样式由 .md-mermaid 控制
        return `
<div class="md-mermaid" data-mermaid-raw="${safeCode}">
  <div class="md-mermaid-toolbar">
    <button type="button" class="md-mermaid-copy">复制 Mermaid</button>
    <button type="button" class="md-mermaid-download">下载 PNG</button>
  </div>
  <pre class="mermaid">${safeCode}</pre>
</div>`.trim();
      }
      const langAttr = b.lang ? ` data-lang="${esc(b.lang)}"` : '';
      return `<pre class="md-code"${langAttr}><code>${safeCode}</code></pre>`;
    });

    return out;
  }

  /**
   * 为TTS准备的纯文本：彻底去除所有Markdown标记，避免读出符号
   * @param {string} text - 原始Markdown文本
   * @returns {string} 纯文本
   */
  _stripMarkdownForTTS(text = '') {
    if (!text) return '';
    let s = String(text);
    
    // 1. 代码块 ```code``` 或 ```lang code``` - 完全移除
    s = s.replace(/```[\w]*\n?[\s\S]*?```/g, '');
    
    // 2. 行内代码 `code` - 保留内容，去掉反引号
    s = s.replace(/`([^`\n]+)`/g, '$1');
    
    // 3. 链接 [text](url) -> text
    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    
    // 4. 图片 ![alt](url) -> alt（如果有alt文本）
    s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
    
    // 5. 标题 # ## ### 等 - 移除标记，保留文本
    s = s.replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, '$1');
    
    // 6. 粗体 **text** 或 __text__ - 保留内容
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
    s = s.replace(/__([^_]+)__/g, '$1');
    
    // 7. 斜体 *text* 或 _text_ - 保留内容（需在粗体之后处理）
    s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');
    s = s.replace(/(?<!_)_([^_]+)_(?!_)/g, '$1');
    
    // 8. 删除线 ~~text~~ - 保留内容
    s = s.replace(/~~([^~]+)~~/g, '$1');
    
    // 9. 任务列表 - [ ] 或 [x] - 移除标记
    s = s.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '');
    s = s.replace(/^\s*\d+\.\s+\[[ xX]\]\s+/gm, '');
    
    // 10. 无序列表 - * - + - 移除标记
    s = s.replace(/^\s*[-*+]\s+/gm, '');
    
    // 11. 有序列表 1. 2. 等 - 移除标记
    s = s.replace(/^\s*\d+\.\s+/gm, '');
    
    // 12. 引用 > - 移除标记
    s = s.replace(/^\s*>+\s?/gm, '');
    
    // 13. 分隔线 --- 或 *** - 完全移除
    s = s.replace(/^\s*[-*_]{3,}\s*$/gm, '');
    
    // 14. 表格标记 | - 移除表格结构，保留内容
    s = s.replace(/\|/g, ' ');
    s = s.replace(/^\s*:?-+:?\s*$/gm, ''); // 表格分隔行
    
    // 15. HTML标签（如果有） - 移除
    s = s.replace(/<[^>]+>/g, '');
    
    // 16. 多余空白压缩：多个空格/制表符 -> 单个空格
    s = s.replace(/[ \t]+/g, ' ');
    
    // 17. 多个换行 -> 单个空格
    s = s.replace(/\s*\n+\s*/g, ' ');
    
    // 18. 移除行首行尾空白
    return s.trim();
  }
  
  /**
   * 加载插件信息
   */
  async loadPluginsInfo() {
    const pluginsInfo = document.getElementById('pluginsInfo');
    if (!pluginsInfo) return;
    
    // 添加更新标记，用于CSS过渡
    pluginsInfo.setAttribute('data-updating', 'true');
    
    try {
      const res = await fetch(`${this.serverUrl}/api/plugins/summary`, { 
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000) // 5秒超时
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      
      if (!data.success) {
        throw new Error(data.message ?? data.error ?? '获取插件信息失败');
      }
      const summary = data.summary ?? {};
      const totalPlugins = summary.totalPlugins || (data.plugins?.length || 0);
      const pluginsWithRules = summary.withRules || 0;
      const pluginsWithTasks = summary.withTasks || summary.taskCount || 0;
      const loadTime = summary.totalLoadTime || 0;
      const formatLoadTime = (ms) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
        pluginsInfo.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center">
            <div>
              <div style="font-size:22px;font-weight:700;color:var(--primary);margin-bottom:6px;line-height:1.2">${totalPlugins}</div>
              <div style="font-size:12px;color:var(--text-muted);font-weight:500">总插件数</div>
            </div>
            <div>
              <div style="font-size:22px;font-weight:700;color:var(--success);margin-bottom:6px;line-height:1.2">${pluginsWithRules}</div>
              <div style="font-size:12px;color:var(--text-muted);font-weight:500">有规则</div>
            </div>
            <div>
              <div style="font-size:22px;font-weight:700;color:var(--warning);margin-bottom:6px;line-height:1.2">${pluginsWithTasks}</div>
              <div style="font-size:12px;color:var(--text-muted);font-weight:500">定时任务</div>
            </div>
            <div>
              <div style="font-size:22px;font-weight:700;color:var(--info);margin-bottom:6px;line-height:1.2">${formatLoadTime(loadTime)}</div>
              <div style="font-size:12px;color:var(--text-muted);font-weight:500">加载时间</div>
            </div>
          </div>
        `;
    } catch (e) {
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        pluginsInfo.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">加载超时</div>';
      } else {
        console.warn('[插件信息] 加载失败:', e);
        pluginsInfo.innerHTML = `<div style="color:var(--text-muted);padding:16px;text-align:center">加载失败：${this.escapeHtml(e.message || '未知错误')}</div>`;
      }
    } finally {
      setTimeout(() => {
        pluginsInfo.removeAttribute('data-updating');
      }, 50);
    }
  }

  updateSystemStatus(data) {
    const { system } = data;
    const panels = data.panels ?? {};
    const metrics = panels.metrics ?? {};
    
    // 更新统计卡片
    const cpuPercent = metrics.cpu ?? system?.cpu?.percent ?? 0;
    const cpuEl = document.getElementById('cpuValue');
    if (cpuEl) cpuEl.textContent = `${cpuPercent.toFixed(1)}%`;
    
    const memUsed = system?.memory?.used ?? 0;
    const memTotal = system?.memory?.total ?? 1;
    const memPercent = metrics.memory ?? (memTotal > 0 ? ((memUsed / memTotal) * 100).toFixed(1) : 0);
    const memEl = document.getElementById('memValue');
    if (memEl) memEl.textContent = `${memPercent}%`;
    
    const disks = system?.disks ?? [];
    const diskEl = document.getElementById('diskValue');
    if (diskEl) {
      if (typeof metrics.disk === 'number') {
        diskEl.textContent = `${metrics.disk.toFixed(1)}%`;
      } else if (disks.length > 0) {
      const disk = disks[0];
        const diskPercent = disk.size > 0 ? ((disk.used / disk.size) * 100).toFixed(1) : 0;
        diskEl.textContent = `${diskPercent}%`;
      } else {
        diskEl.textContent = '--';
      }
    }
    
    const uptimeEl = document.getElementById('uptimeValue');
    if (uptimeEl) {
      uptimeEl.textContent = this.formatTime((system && system.uptime) || (data.bot && data.bot.uptime) || 0);
    }
    
    // 更新网络历史：优先使用后端返回的实时数据
    const netRecent = system?.netRecent ?? [];
    const currentRxSec = Math.max(0, Number(metrics.net?.rxSec ?? system?.netRates?.rxSec ?? 0)) / 1024;
    const currentTxSec = Math.max(0, Number(metrics.net?.txSec ?? system?.netRates?.txSec ?? 0)) / 1024;
    
    // 如果后端返回了实时数据，直接使用
    if (netRecent.length > 0) {
      // 使用后端返回的实时数据点（每3-5秒一个点）
      this._metricsHistory.netRx = netRecent.map(h => Math.max(0, (h.rxSec || 0) / 1024));
      this._metricsHistory.netTx = netRecent.map(h => Math.max(0, (h.txSec || 0) / 1024));
      this._metricsHistory._initialized = true;
      this._metricsHistory._lastTimestamp = data.timestamp;
    } else {
      // 如果没有实时数据，使用当前速率累积
      const now = Date.now();
      if (!this._metricsHistory._lastUpdate || (now - this._metricsHistory._lastUpdate) >= 3000) {
        // 每3秒添加一个新数据点
        this._metricsHistory.netRx.push(currentRxSec);
        this._metricsHistory.netTx.push(currentTxSec);
        this._metricsHistory._lastUpdate = now;
        // 保留最近60个点
        if (this._metricsHistory.netRx.length > 60) this._metricsHistory.netRx.shift();
        if (this._metricsHistory.netTx.length > 60) this._metricsHistory.netTx.shift();
      } else {
        // 更新最后一个数据点（实时更新当前值）
        if (this._metricsHistory.netRx.length > 0) {
          this._metricsHistory.netRx[this._metricsHistory.netRx.length - 1] = currentRxSec;
          this._metricsHistory.netTx[this._metricsHistory.netTx.length - 1] = currentTxSec;
        } else {
          // 如果数组为空，初始化
          this._metricsHistory.netRx = [currentRxSec];
          this._metricsHistory.netTx = [currentTxSec];
        }
      }
    }
    
    const procTable = document.getElementById('processTable');
    if (procTable) {
      if (Array.isArray(data.processesTop5) && data.processesTop5.length > 0) {
      procTable.innerHTML = data.processesTop5.map(p => `
        <tr>
            <td style="font-weight:500">${p.name || '未知进程'}</td>
            <td style="color:var(--text-muted);font-family:monospace;font-size:12px">${p.pid || '--'}</td>
            <td style="color:${(p.cpu || 0) > 50 ? 'var(--warning)' : 'var(--text-primary)'};font-weight:500">${(p.cpu || 0).toFixed(1)}%</td>
            <td style="color:${(p.mem || 0) > 50 ? 'var(--warning)' : 'var(--text-primary)'};font-weight:500">${(p.mem || 0).toFixed(1)}%</td>
        </tr>
        `).join('');
      } else {
        procTable.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">暂无进程数据</td></tr>';
      }
    }
    
    // 更新图表
    this.updateCharts(cpuPercent, (memUsed / memTotal) * 100);
  }

  /**
   * 注册 Chart 插件（避免重复注册）
   */
  _registerChartPlugins() {
    if (this._chartPluginsRegistered || !window.Chart) return;
    
    // CPU 图表中心标签插件
    const cpuLabelPlugin = {
      id: 'cpuLabel',
      afterDraw: (chart) => {
        if (chart.config.type !== 'doughnut' || chart.canvas.id !== 'cpuChart') return;
        const ctx = chart.ctx;
        const centerX = chart.chartArea.left + (chart.chartArea.right - chart.chartArea.left) / 2;
        const centerY = chart.chartArea.top + (chart.chartArea.bottom - chart.chartArea.top) / 2;
        const value = chart.data.datasets[0].data[0];
        ctx.save();
        ctx.font = 'bold 16px Inter';
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-primary').trim();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${value.toFixed(1)}%`, centerX, centerY);
        ctx.restore();
      }
    };
    
    // 内存图表中心标签插件
    const memLabelPlugin = {
      id: 'memLabel',
      afterDraw: (chart) => {
        if (chart.config.type !== 'doughnut' || chart.canvas.id !== 'memChart') return;
        const ctx = chart.ctx;
        const centerX = chart.chartArea.left + (chart.chartArea.right - chart.chartArea.left) / 2;
        const centerY = chart.chartArea.top + (chart.chartArea.bottom - chart.chartArea.top) / 2;
        const value = chart.data.datasets[0].data[0];
        ctx.save();
        ctx.font = 'bold 16px Inter';
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-primary').trim();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${value.toFixed(1)}%`, centerX, centerY);
        ctx.restore();
      }
    };
    
    Chart.register(cpuLabelPlugin, memLabelPlugin);
    this._chartPluginsRegistered = true;
  }

  updateCharts(cpu, mem) {
    if (!window.Chart) return;
    
    // 注册插件（仅一次）
    this._registerChartPlugins();
    
    const primary = getComputedStyle(document.body).getPropertyValue('--primary').trim() || '#0ea5e9';
    const success = getComputedStyle(document.body).getPropertyValue('--success').trim() || '#22c55e';
    const warning = getComputedStyle(document.body).getPropertyValue('--warning').trim() || '#f59e0b';
    const danger = getComputedStyle(document.body).getPropertyValue('--danger').trim() || '#ef4444';
    const border = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#e2e8f0';
    
    // CPU 图表
    const cpuCtx = document.getElementById('cpuChart');
    if (cpuCtx) {
      if (this._charts.cpu && this._charts.cpu.canvas !== cpuCtx) {
        this._charts.cpu.destroy();
        this._charts.cpu = null;
      }
      
      const cpuColor = cpu > 80 ? danger : cpu > 50 ? warning : primary;
      const cpuFree = 100 - cpu;
      
      if (!this._charts.cpu) {
        this._charts.cpu = new Chart(cpuCtx.getContext('2d'), {
          type: 'doughnut',
          data: {
            labels: ['使用', '空闲'],
            datasets: [{
              data: [cpu, cpuFree],
              backgroundColor: [cpuColor, border],
              borderWidth: 0
            }]
          },
          options: {
            cutout: '75%',
            plugins: {
              legend: { display: false },
              tooltip: { enabled: true }
            }
          }
        });
      } else {
        const cpuColor = cpu > 80 ? danger : cpu > 50 ? warning : primary;
        this._charts.cpu.data.datasets[0].data = [cpu, 100 - cpu];
        this._charts.cpu.data.datasets[0].backgroundColor = [cpuColor, border];
        this._charts.cpu.update('none');
      }
    }
    
    // 内存图表
    const memCtx = document.getElementById('memChart');
    if (memCtx) {
      if (this._charts.mem && this._charts.mem.canvas !== memCtx) {
        this._charts.mem.destroy();
        this._charts.mem = null;
      }
      
      const memColor = mem > 80 ? danger : mem > 50 ? warning : success;
      const memFree = 100 - mem;
      
      if (!this._charts.mem) {
        this._charts.mem = new Chart(memCtx.getContext('2d'), {
          type: 'doughnut',
          data: {
            labels: ['使用', '空闲'],
            datasets: [{
              data: [mem, memFree],
              backgroundColor: [memColor, border],
              borderWidth: 0
            }]
          },
          options: {
            cutout: '75%',
            plugins: {
              legend: { display: false },
              tooltip: { enabled: true }
            }
          }
        });
      } else {
        const memColor = mem > 80 ? danger : mem > 50 ? warning : success;
        this._charts.mem.data.datasets[0].data = [mem, 100 - mem];
        this._charts.mem.data.datasets[0].backgroundColor = [memColor, border];
        this._charts.mem.update('none');
      }
    }
    
    // 网络图表
    const netCtx = document.getElementById('netChart');
    if (netCtx) {
      if (this._charts.net && this._charts.net.canvas !== netCtx) {
        this._charts.net.destroy();
        this._charts.net = null;
      }
      
      const textMuted = getComputedStyle(document.body).getPropertyValue('--text-muted').trim() || '#94a3b8';
      const labels = this._metricsHistory.netRx.map(() => '');
      if (!this._charts.net) {
        this._charts.net = new Chart(netCtx.getContext('2d'), {
          type: 'line',
          data: {
            labels,
            datasets: [
              { 
                label: '下行', 
                data: this._metricsHistory.netRx, 
                borderColor: primary, 
                backgroundColor: `${primary}15`, 
                fill: true, 
                tension: 0.3, 
                pointRadius: 0,
                pointHoverRadius: 4,
                borderWidth: 2,
                spanGaps: true
              },
              { 
                label: '上行', 
                data: this._metricsHistory.netTx, 
                borderColor: warning, 
                backgroundColor: `${warning}15`, 
                fill: true, 
                tension: 0.3, 
                pointRadius: 0,
                pointHoverRadius: 4,
                borderWidth: 2,
                spanGaps: true
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: { 
              legend: { 
                position: 'bottom', 
                display: true,
                labels: { 
                  color: textMuted, 
                  padding: 12,
                  font: { size: 12 },
                  usePointStyle: true,
                  pointStyle: 'line'
                } 
              },
              tooltip: {
                enabled: true,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                padding: 10,
                titleFont: { size: 12 },
                bodyFont: { size: 11 },
                cornerRadius: 6,
                displayColors: true,
                callbacks: {
                  label: function(context) {
                    const value = context.parsed.y;
                    if (value === 0 || value < 0.01) return '';
                    return `${context.dataset.label}: ${value.toFixed(2)} KB/s`;
                  },
                  filter: function(tooltipItem) {
                    return tooltipItem.parsed.y > 0.01;
                  }
                }
              }
            },
            scales: {
              x: { 
                display: false,
                grid: { display: false }
              },
              y: { 
                beginAtZero: true,
                suggestedMax: 10, // 默认最大10 KB/s，会根据实际数据动态调整
                grid: { 
                  color: border,
                  drawBorder: false,
                  lineWidth: 1
                }, 
                ticks: { 
                  display: false,
                  maxTicksLimit: 5
                }
              }
            }
          }
        });
      } else {
        // 更新图表数据
        this._charts.net.data.labels = labels;
        this._charts.net.data.datasets[0].data = this._metricsHistory.netRx;
        this._charts.net.data.datasets[1].data = this._metricsHistory.netTx;
        
        // 动态调整Y轴范围，确保数据可见
        const allValues = [...this._metricsHistory.netRx, ...this._metricsHistory.netTx];
        const maxValue = Math.max(...allValues.filter(v => isFinite(v) && v > 0), 1);
        const yMax = Math.ceil(maxValue * 1.2); // 留20%的顶部空间
        
        if (this._charts.net.options.scales?.y) {
          this._charts.net.options.scales.y.max = yMax;
          if (this._charts.net.options.scales.y.ticks) {
            this._charts.net.options.scales.y.ticks.display = false;
          }
        }
        
        // 更新tooltip配置，过滤0.0值
        if (this._charts.net.options.plugins?.tooltip) {
          this._charts.net.options.plugins.tooltip.callbacks = {
            label: function(context) {
              const value = context.parsed.y;
              if (value === 0 || value < 0.01) return '';
              return `${context.dataset.label}: ${value.toFixed(2)} KB/s`;
            },
            filter: function(tooltipItem) {
              return tooltipItem.parsed.y > 0.01;
            }
          };
        }
        
        // 使用 'default' 动画模式，让图表平滑更新
        this._charts.net.update('default');
      }
    }
  }

  // ========== 聊天 ==========
  async renderChat() {
    const content = document.getElementById('content');
    const isAIMode = this._chatMode === 'ai';
    const isVoiceMode = this._chatMode === 'voice';
    const aiSettings = isAIMode ? await this._renderAISettings() : '';
    content.innerHTML = `
      <div class="chat-container ${isVoiceMode ? 'voice-mode' : ''}">
        <div class="chat-sidebar">
          <div class="chat-mode-selector">
            <button class="chat-mode-btn ${this._chatMode === 'event' ? 'active' : ''}" data-mode="event">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
              <span>Event</span>
            </button>
            <button class="chat-mode-btn ${this._chatMode === 'voice' ? 'active' : ''}" data-mode="voice">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              <span>Voice</span>
            </button>
            <button class="chat-mode-btn ${this._chatMode === 'ai' ? 'active' : ''}" data-mode="ai">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              <span>AI</span>
            </button>
          </div>
          ${aiSettings}
        </div>
        <div class="chat-main">
        ${isVoiceMode ? `
          <div class="voice-chat-center">
            <div class="voice-emotion-display" id="voiceEmotionIcon">😊</div>
            <div class="voice-status" id="voiceStatus">点击麦克风开始对话</div>
            <button class="voice-clear-btn" id="voiceClearBtn" title="清空聊天记录">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
              <span>清空</span>
            </button>
          </div>
        ` : `
        <div class="chat-header">
          <div class="chat-header-title">
            <span class="emotion-display" id="emotionIcon">😊</span>
              <span>${isAIMode ? 'AI 对话' : 'Event 对话'}</span>
          </div>
          <div class="chat-header-actions">
            <button class="btn btn-sm btn-secondary" id="clearChatBtn">清空</button>
          </div>
        </div>
        <div class="chat-settings">
          <span class="chat-stream-status" id="chatStreamStatus">空闲</span>
        </div>
        `}
        <div class="chat-messages ${isVoiceMode ? 'voice-messages' : ''}" id="chatMessages"></div>
        <div class="chat-input-area">
          ${isVoiceMode ? `
          <button class="voice-mic-btn" id="micBtn" title="按住或点击说话">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
              <path d="M19 10v2a7 7 0 01-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
          <input type="text" class="voice-input" id="voiceInput" placeholder="或直接输入文字...">
          <button class="voice-tts-stop-btn" id="voiceTtsStopBtn" title="停止当前播报">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="6" y="6" width="12" height="12" rx="2" ry="2"/>
            </svg>
          </button>
          <button class="voice-send-btn" id="voiceSendBtn" title="发送并触发TTS">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22,2 15,22 11,13 2,9"/>
            </svg>
          </button>
          ` : `
          <button class="mic-btn" id="micBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
              <path d="M19 10v2a7 7 0 01-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
          <button class="image-upload-btn" id="imageUploadBtn" title="${isAIMode ? '上传图片' : '上传文件'}">
            ${isAIMode ? `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            ` : `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
              <polyline points="13 2 13 9 20 9"/>
            </svg>
            `}
          </button>
            <input type="file" class="chat-image-input" id="chatImageInput" accept="${isAIMode ? 'image/*' : '*'}" multiple style="display: none;">
          <input type="text" class="chat-input" id="chatInput" placeholder="输入消息...">
          <button class="chat-send-btn" id="chatSendBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22,2 15,22 11,13 2,9"/>
            </svg>
          </button>
          `}
        </div>
        ${!isVoiceMode ? `<div class="chat-image-preview" id="chatImagePreview" style="display: none;"></div>` : ''}
        </div>
      </div>
    `;
    
    if (isVoiceMode) {
      await this.loadLlmOptions();
    }
    if (!isVoiceMode) {
      this.initChatControls();
    }
    this.restoreChatHistory();
    if (isVoiceMode || !isAIMode) {
      this.ensureDeviceWs();
    }
    this._bindChatEvents();
  }

  async _switchChatMode(mode, oldMode = null) {
    const isAIMode = mode === 'ai';
    const isVoiceMode = mode === 'voice';
    const wasVoiceMode = oldMode === 'voice' || document.querySelector('.voice-chat-center') !== null;
    
    if (isVoiceMode || wasVoiceMode) {
      await this.renderChat();
      return;
    }
    
    const box = document.getElementById('chatMessages');
    if (!box) {
      await this.renderChat();
      return;
    }
    
    const sidebar = document.querySelector('.chat-sidebar');
    const headerTitle = document.querySelector('.chat-header-title span:last-child');
    const imageInput = document.getElementById('chatImageInput');
    const modeBtns = document.querySelectorAll('.chat-mode-btn');
    
    modeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    if (headerTitle) {
      headerTitle.textContent = isAIMode ? 'AI 对话' : 'Event 对话';
    }
    
    if (imageInput) {
      imageInput.setAttribute('accept', isAIMode ? 'image/*' : 'image/*,video/*,audio/*');
    }
    
    if (isAIMode) {
      const aiSettings = await this._renderAISettings();
      if (sidebar && !sidebar.querySelector('.ai-settings-panel')) {
        const settingsDiv = document.createElement('div');
        settingsDiv.innerHTML = aiSettings;
        sidebar.appendChild(settingsDiv.firstElementChild);
      }
      this.initChatControls();
      this.ensureDeviceWs();
    } else {
      const aiSettingsPanel = sidebar?.querySelector('.ai-settings-panel');
      if (aiSettingsPanel) {
        aiSettingsPanel.remove();
      }
      this.ensureDeviceWs();
    }
    
    // 统一绑定事件（_bindChatEvents 内部已处理解绑和重复绑定）
    this._bindChatEvents();
    
    const cached = this._chatMessagesCache[mode];
    if (cached?.html) {
      box.style.overflow = 'hidden';
      box.innerHTML = cached.html;
      box.style.overflow = '';
      box.scrollTop = cached.scrollTop || box.scrollHeight;
      return;
    }
    
    const history = mode === 'ai' ? this._aiChatHistory : this._eventChatHistory;
    if (!Array.isArray(history) || history.length === 0) {
      box.innerHTML = '';
      return;
    }
    
    box.style.overflow = 'hidden';
    box.innerHTML = '';
    this._isRestoringHistory = true;
    
    const sortedHistory = [...history].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    sortedHistory.forEach(m => {
      try {
        if (m.type === 'chat-record' || (m.type === 'record' && m.messages)) {
          this.appendChatRecord(m.messages ?? [], m.title ?? '', m.description ?? '', false);
        } else if (m.segments && Array.isArray(m.segments)) {
          this.appendSegments(m.segments, false, m.role || 'assistant');
        } else if (m.type === 'image' && m.url) {
          this.appendSegments([{ type: 'image', url: m.url }], false, m.role || 'assistant');
        } else if (m.role && m.text) {
          this.appendChat(m.role, m.text, { persist: false, mcpTools: m.mcpTools, messageId: m.id });
        }
      } catch (e) {}
    });
    
    this._isRestoringHistory = false;
    box.style.overflow = '';
    box.scrollTop = box.scrollHeight;
    
    this._chatMessagesCache[mode] = {
      scrollTop: box.scrollTop,
      scrollHeight: box.scrollHeight,
      html: box.innerHTML
    };
  }

  async _renderAISettings() {
    await this.loadLlmOptions();
    const providers = (this._llmOptions?.profiles || []).map(p => ({
      value: p.key || p.provider || p.label || '',
      label: p.label || p.key || p.provider || ''
    })).filter(p => p.value);
    
    // 后端已仅返回“带 MCP 工具”的工作流，这里直接作为 MCP 工具工作流多选
    const allWorkflows = (this._llmOptions?.workflows || []).map(w => ({
      value: w.key || w.name || '',
      label: w.label || w.description || w.key || w.name || ''
    })).filter(w => w.value);
    
    const selectedWorkflows = Array.isArray(this._chatSettings.workflows) 
      ? this._chatSettings.workflows 
      : (this._chatSettings.workflow ? [this._chatSettings.workflow] : []);
    
    return `
      <div class="ai-settings-panel">
        <div class="ai-settings-section">
          <label class="ai-settings-label">运营商</label>
          <select id="aiProviderSelect" class="ai-settings-select">
            <option value="">默认</option>
            ${providers.map(p => `<option value="${p.value}" ${this._chatSettings.provider === p.value ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </div>
        <div class="ai-settings-section">
          <label class="ai-settings-label">人设</label>
          <textarea id="aiPersonaInput" class="ai-settings-textarea" placeholder="自定义人设...">${this._chatSettings.persona || ''}</textarea>
        </div>
        <div class="ai-settings-section">
          <label class="ai-settings-label">MCP 工具工作流</label>
          <div class="ai-settings-checkboxes">
            ${allWorkflows.map(w => `
              <label class="ai-settings-checkbox">
                <input type="checkbox" id="workflow_${w.value}" value="${w.value}" ${selectedWorkflows.includes(w.value) ? 'checked' : ''}>
                <span>${w.label}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="ai-settings-section">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <label class="ai-settings-label" style="margin: 0;">远程 MCP 配置</label>
            <button id="remoteMCPConfigBtn" class="ai-settings-btn" title="管理远程MCP服务器配置（如必应搜索等）">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              <span>配置</span>
            </button>
          </div>
          <p style="margin: 4px 0 0; font-size: 12px; color: var(--text-muted);">
            配置外部MCP服务器（如必应中文搜索），支持原生JSON格式
          </p>
        </div>
      </div>
    `;
  }
  
  /**
   * 解绑聊天相关事件
   */
  _unbindChatEvents() {
    for (const [element, handlers] of this._chatEventHandlers.entries()) {
      if (element && handlers) {
        handlers.forEach(({ event, handler }) => {
          try {
            element.removeEventListener(event, handler);
          } catch (e) {
            // 忽略解绑错误
          }
        });
      }
    }
    this._chatEventHandlers.clear();
    this._chatEventsBound = false;
  }

  /**
   * 绑定聊天相关事件（企业级事件管理，支持解绑）
   */
  _bindChatEvents() {
    // 先解绑旧的事件，避免重复绑定
    this._unbindChatEvents();
    
    const sendBtn = document.getElementById('chatSendBtn');
    const input = document.getElementById('chatInput');
    const micBtn = document.getElementById('micBtn');
    const clearBtn = document.getElementById('clearChatBtn');
    const imageUploadBtn = document.getElementById('imageUploadBtn');
    const imageInput = document.getElementById('chatImageInput');
    if (imageInput) {
      imageInput.setAttribute('accept', this._chatMode === 'ai' ? 'image/*' : 'image/*,video/*,audio/*');
    }
    
    // 辅助函数：安全地绑定事件并记录
    const safeBind = (element, event, handler) => {
      if (!element) return;
      element.addEventListener(event, handler);
      if (!this._chatEventHandlers.has(element)) {
        this._chatEventHandlers.set(element, []);
      }
      this._chatEventHandlers.get(element).push({ event, handler });
    };
    
    // 聊天模式切换按钮 - 使用事件委托（统一交给 _unbindChatEvents 管理，避免 dataset 标记导致失效）
    const modeSelector = document.querySelector('.chat-mode-selector');
    if (modeSelector) {
      const modeHandler = async (e) => {
        const btn = e.target.closest('.chat-mode-btn');
        if (!btn) return;
        const mode = btn.dataset.mode;
        if (this._chatMode === mode) return;
        
        const oldMode = this._chatMode;
        const box = document.getElementById('chatMessages');
        if (box) {
          this._chatMessagesCache[oldMode] = {
            scrollTop: box.scrollTop,
            scrollHeight: box.scrollHeight,
            html: box.innerHTML
          };
        }
        
        this._chatMode = mode;
        localStorage.setItem('chatMode', mode);
        await this._switchChatMode(mode, oldMode);
      };
      safeBind(modeSelector, 'click', modeHandler);
    }

    // AI 模式特定设置
    if (this._chatMode === 'ai') {
      const providerSelect = document.getElementById('aiProviderSelect');
      const personaInput = document.getElementById('aiPersonaInput');

      if (providerSelect) {
        const providerHandler = () => {
          this._chatSettings.provider = providerSelect.value;
          localStorage.setItem('chatProvider', providerSelect.value);
        };
        safeBind(providerSelect, 'change', providerHandler);
      }

      if (personaInput) {
        const personaHandler = () => {
          this._chatSettings.persona = personaInput.value;
          localStorage.setItem('chatPersona', personaInput.value);
        };
        safeBind(personaInput, 'input', personaHandler);
      }

      // MCP 工具工作流多选：使用事件委托（交给 safeBind/_unbindChatEvents 管理，无需 dataset 标记）
      const workflowContainer = document.querySelector('.ai-settings-checkboxes');
      if (workflowContainer) {
        const workflowHandler = () => {
          const workflows = Array.from(document.querySelectorAll('input[id^="workflow_"]:checked'))
            .map(c => c.value);
          this._chatSettings.workflows = workflows;
          localStorage.setItem('chatWorkflows', JSON.stringify(workflows));
        };
        safeBind(workflowContainer, 'change', workflowHandler);
      }

      // 远程MCP配置按钮
      const remoteMCPBtn = document.getElementById('remoteMCPConfigBtn');
      if (remoteMCPBtn) {
        const remoteMCPHandler = () => {
          // 跳转到配置管理页面
          this.navigateTo('config');
          // 等待配置列表加载完成后选中aistream配置
          setTimeout(() => {
            if (this._configState) {
              // 查找system配置
              const systemConfig = this._configState.list.find(cfg => cfg.name === 'system');
              if (systemConfig) {
                // 选中system配置的aistream子配置
                this.selectConfig('system', 'aistream');
                // 等待配置加载后，尝试展开mcp.remote部分（如果支持）
                setTimeout(() => {
                  // 可以在这里添加逻辑来高亮或展开mcp.remote配置项
                  const mcpRemoteField = document.querySelector('[data-path="mcp.remote"]');
                  if (mcpRemoteField) {
                    mcpRemoteField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    mcpRemoteField.style.background = 'var(--primary-50)';
                    setTimeout(() => {
                      if (mcpRemoteField) mcpRemoteField.style.background = '';
                    }, 2000);
                  }
                }, 500);
              }
            }
          }, 300);
        };
        safeBind(remoteMCPBtn, 'click', remoteMCPHandler);
      }
    }
    
    // 发送按钮
    if (sendBtn) {
      safeBind(sendBtn, 'click', () => this.sendChatMessage());
    }
    
    // 输入框
    if (input) {
      const inputHandler = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendChatMessage();
        }
      };
      safeBind(input, 'keypress', inputHandler);
    }
    
    // 麦克风按钮
    if (micBtn) {
      safeBind(micBtn, 'click', () => this.toggleMic());
    }
    
    // 清空按钮
    if (clearBtn) {
      safeBind(clearBtn, 'click', () => this.clearChat());
    }
    
    // 语音模式特定事件
    if (this._chatMode === 'voice') {
      const voiceClearBtn = document.getElementById('voiceClearBtn');
      if (voiceClearBtn) {
        safeBind(voiceClearBtn, 'click', () => this.clearChat());
      }
      
      const voiceInput = document.getElementById('voiceInput');
      const voiceSendBtn = document.getElementById('voiceSendBtn');
      const voiceTtsStopBtn = document.getElementById('voiceTtsStopBtn');
      
      if (voiceInput && voiceSendBtn) {
        const voiceSendHandler = () => {
          const text = voiceInput.value.trim();
          if (text) {
            this.sendVoiceMessage(text).catch(e => {
              this.showToast(`发送失败: ${e.message}`, 'error');
            });
            voiceInput.value = '';
          }
        };
        safeBind(voiceSendBtn, 'click', voiceSendHandler);
        
        const voiceInputHandler = (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            voiceSendBtn.click();
          }
        };
        safeBind(voiceInput, 'keypress', voiceInputHandler);
      }

      // 语音对话模式下的"停止TTS"按钮
      if (voiceTtsStopBtn) {
        const ttsStopHandler = () => {
          this.stopTTS();
          this.clearChatStreamState();
          this.updateVoiceStatus('播报已停止');
        };
        safeBind(voiceTtsStopBtn, 'click', ttsStopHandler);
      }
    }
    
    // 图片上传
    if (imageUploadBtn && imageInput) {
      safeBind(imageUploadBtn, 'click', () => imageInput.click());
      safeBind(imageInput, 'change', (e) => {
        this.handleImageSelect(e.target.files);
      });
    }

    // 拖拽区域绑定（只在首次绑定时执行）
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer && !chatContainer.dataset._dropBound) {
      chatContainer.dataset._dropBound = '1';
      this._bindDropArea(chatContainer, {
        onDragStateChange: (active) => {
          chatContainer?.classList.toggle('is-dragover', Boolean(active));
        },
        onFiles: (files) => {
          if (!files || files.length === 0) return;
          const isAIMode = this._chatMode === 'ai';
          const filteredFiles = isAIMode 
            ? files.filter(f => f?.type?.startsWith('image/'))
            : files;
          if (!filteredFiles.length) {
            this.showToast(isAIMode ? '只能上传图片文件' : '文件格式不支持', 'warning');
            return;
          }
          this.handleImageSelect(filteredFiles);
          this.showToast(`已添加 ${filteredFiles.length} ${isAIMode ? '张图片' : '个文件'}，点击发送即可上传`, 'success');
        }
      });
    }
    
    this._chatEventsBound = true;
  }

  /**
   * 统一绑定拖拽投放区域（减少冗余事件绑定）
   * @param {HTMLElement} el
   * @param {Object} options
   * @param {(active:boolean)=>void} [options.onDragStateChange]
   * @param {(files:File[])=>void} options.onFiles
   */
  _bindDropArea(el, options = {}) {
    if (!el || typeof options.onFiles !== 'function') return;

    let dragDepth = 0;
    const setActive = (active) => {
      options.onDragStateChange?.(active);
    };

    const prevent = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener('dragenter', (e) => {
      prevent(e);
      dragDepth++;
      setActive(true);
    });
    el.addEventListener('dragover', prevent);
    el.addEventListener('dragleave', (e) => {
      prevent(e);
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setActive(false);
    });
    el.addEventListener('drop', (e) => {
      prevent(e);
      dragDepth = 0;
      setActive(false);
      const dropped = this._extractFilesFromDataTransfer(e.dataTransfer);
      options.onFiles(dropped);
    });
  }

  _getCurrentChatHistory() {
    if (this._chatMode === 'ai') return this._aiChatHistory;
    if (this._chatMode === 'voice') return this._voiceChatHistory;
    return this._eventChatHistory;
  }

  _loadChatHistory(mode) {
    try {
      const key = mode === 'ai' ? 'aiChatHistory' : mode === 'voice' ? 'voiceChatHistory' : 'eventChatHistory';
      const cached = localStorage.getItem(key);
      return cached ? JSON.parse(cached) : [];
    } catch (e) {
      console.warn(`[${mode}聊天历史] 加载失败:`, e);
      return [];
    }
  }

  _saveChatHistory() {
    try {
      const MAX_HISTORY = 200;
      const history = this._getCurrentChatHistory();
      const historyToSave = Array.isArray(history) 
        ? history.slice(-MAX_HISTORY) 
        : [];
      const key = this._chatMode === 'ai' ? 'aiChatHistory' : this._chatMode === 'voice' ? 'voiceChatHistory' : 'eventChatHistory';
      localStorage.setItem(key, JSON.stringify(historyToSave));
      
      const box = document.getElementById('chatMessages');
      if (box) {
        this._chatMessagesCache[this._chatMode] = {
          scrollTop: box.scrollTop,
          scrollHeight: box.scrollHeight,
          html: box.innerHTML
        };
      }
    } catch (e) {
      console.warn('[聊天历史] 保存失败:', e);
    }
  }

  restoreChatHistory() {
    const box = document.getElementById('chatMessages');
    if (!box) return;
    
    if (this._isRestoringHistory) return;
    
    const currentHistory = this._getCurrentChatHistory();
    // 没有历史：直接清空并返回
    if (!Array.isArray(currentHistory) || currentHistory.length === 0) {
      box.innerHTML = '';
      return;
    }

    // 已经有内容但不是在恢复流程中：清空后重新渲染
    box.innerHTML = '';

    this._isRestoringHistory = true;
    
    try {
      const originalOverflow = box.style.overflow;
      box.style.overflow = 'hidden';
      
      const sortedHistory = [...currentHistory].sort((a, b) => (a.ts || 0) - (b.ts || 0));
      sortedHistory.forEach(m => {
        try {
          if (m.type === 'chat-record' || (m.type === 'record' && m.messages)) {
            this.appendChatRecord(m.messages ?? [], m.title ?? '', m.description ?? '', false);
          } else if (m.segments && Array.isArray(m.segments)) {
            this.appendSegments(m.segments, false, m.role || 'assistant');
          } else if (m.type === 'image' && m.url) {
            this.appendSegments([{ type: 'image', url: m.url }], false, m.role || 'assistant');
          } else if (m.role && m.text) {
            this.appendChat(m.role, m.text, { persist: false, mcpTools: m.mcpTools, messageId: m.id });
          }
        } catch (e) {
          // 忽略恢复失败的历史项
        }
      });
      
      box.style.overflow = originalOverflow;
      // 恢复历史后强制滚动到底部（含一次补滚，避免仅到 70%）
      this.scrollToBottom(false);
    } finally {
      this._isRestoringHistory = false;
    }
  }

  _applyMessageEnter(div, animate = true) {
    if (!div || this._isRestoringHistory) return;
    if (!animate) {
        div.classList.add('message-enter-active');
    } else {
      requestAnimationFrame(() => {
      div.classList.add('message-enter-active');
      });
    }
  }

  appendChat(role, text, options = {}) {
    const isVoiceMode = this._chatMode === 'voice';
    const { persist = true, mcpTools = null, messageId = null, source = null } = options;
    
    const msgId = messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    if (persist) {
      const history = this._getCurrentChatHistory();
      const historyItem = { role, text, ts: Date.now(), id: msgId };
      if (mcpTools) historyItem.mcpTools = mcpTools;
      if (source) historyItem.source = source;
      history.push(historyItem);
      this._saveChatHistory();
    }
    
    const box = document.getElementById('chatMessages');
    if (!box) return null;
    
    const div = document.createElement('div');
    div.className = `chat-message ${role}${isVoiceMode ? ' voice-message' : ''}${this._isRestoringHistory ? '' : ' message-enter'}`;
    div.dataset.messageId = msgId;
    div.dataset.role = role;
    const contentDiv = document.createElement('div');
    // 统一“MD 显示协议”：所有使用 renderMarkdown 的容器都带上 chat-markdown 样式域
    contentDiv.className = 'chat-content chat-markdown';
    // Voice / AI / Event 使用同一套 Markdown 渲染，保持显示一致
    contentDiv.innerHTML = this.renderMarkdown(text);
    div.appendChild(contentDiv);
    
    if (mcpTools && Array.isArray(mcpTools) && mcpTools.length > 0) {
      this._addMCPToolsInfo(div, mcpTools);
    }
    
    // Voice 模式也需要基础操作（复制/撤回），体验保持一致
    this._addMessageActions(div, role, text, msgId);
    
    box.appendChild(div);
    // Mermaid：只对新增消息做局部渲染
    this._renderMermaidIn(div);
    
    if (!this._isRestoringHistory) {
    this.scrollToBottom();
    }
    
    this._applyMessageEnter(div, persist);
    
    return div;
  }
  
  _addMessageActions(msgElement, role, text, messageId) {
    if (!msgElement) return;
    
    // 检查是否已有操作按钮，避免重复添加
    if (msgElement.querySelector('.chat-message-actions')) return;
    
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'chat-message-actions';
    
    // 提取消息中的所有文本内容（包括markdown渲染后的文本）
    const extractText = (element) => {
      let text = '';
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      let node;
      while (node = walker.nextNode()) {
        text += node.textContent + ' ';
      }
      return text.trim();
    };
    
    const messageText = text || extractText(msgElement);
    
    // 所有消息都有复制按钮
    if (messageText) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'chat-action-btn chat-copy-btn';
      copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg><span>复制</span>';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(messageText).then(() => {
          this.showToast('已复制到剪贴板', 'success');
        }).catch(() => {
          this.showToast('复制失败', 'error');
        });
      });
      actionsContainer.appendChild(copyBtn);
    }
    
    // 用户消息：撤回按钮
    if (role === 'user') {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'chat-action-btn chat-delete-btn';
      deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg><span>撤回</span>';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deleteMessage(messageId);
      });
      actionsContainer.appendChild(deleteBtn);
    }
    
    // AI消息：删除按钮（Event模式不显示重新生成）
    if (role === 'assistant') {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'chat-action-btn chat-delete-btn';
      deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg><span>删除</span>';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deleteMessage(messageId);
      });
      actionsContainer.appendChild(deleteBtn);
      
      // 只在AI模式显示重新生成按钮
      if (this._chatMode === 'ai') {
        const regenBtn = document.createElement('button');
        regenBtn.className = 'chat-action-btn chat-regen-btn';
        regenBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 003.51 15M3.51 9a9 9 0 0016.98 6"/></svg><span>重新生成</span>';
        regenBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._regenerateMessage(messageId);
        });
        actionsContainer.appendChild(regenBtn);
      }
    }
    
    if (actionsContainer.children.length > 0) {
      msgElement.appendChild(actionsContainer);
    }
  }
  
  _addMCPToolsInfo(msgElement, mcpTools) {
    if (!msgElement || !Array.isArray(mcpTools) || mcpTools.length === 0) return;
    
    if (msgElement.querySelector('.chat-mcp-tools')) {
      return;
    }
    
    const mcpContainer = document.createElement('div');
    mcpContainer.className = 'chat-mcp-tools';
    
    const header = document.createElement('div');
    header.className = 'chat-mcp-header';
    header.innerHTML = `<span class="chat-mcp-icon">🔧</span><span class="chat-mcp-title">使用了 ${mcpTools.length} 个 MCP 工具</span><button class="chat-mcp-toggle">展开</button>`;
    
    const content = document.createElement('div');
    content.className = 'chat-mcp-content';
    content.style.display = 'none';
    
    mcpTools.forEach((tool, index) => {
      const toolItem = document.createElement('div');
      toolItem.className = 'chat-mcp-tool-item';
      
      const toolName = tool.name || tool.function?.name || `工具 ${index + 1}`;
      const toolArgs = tool.arguments || tool.function?.arguments || {};
      const toolResult = tool.result || tool.content || '';
      
      let argsText = '';
      try {
        argsText = typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs, null, 2);
      } catch {
        argsText = String(toolArgs);
      }
      
      let resultText = '';
      try {
        if (typeof toolResult === 'string') {
          try {
            const parsed = JSON.parse(toolResult);
            resultText = JSON.stringify(parsed, null, 2);
          } catch {
            resultText = toolResult;
          }
        } else {
          resultText = JSON.stringify(toolResult, null, 2);
        }
      } catch {
        resultText = String(toolResult);
      }
      
      toolItem.innerHTML = `
        <div class="chat-mcp-tool-name">${this.escapeHtml(toolName)}</div>
        <div class="chat-mcp-tool-section">
          <div class="chat-mcp-tool-label">参数:</div>
          <pre class="chat-mcp-tool-code">${this.escapeHtml(argsText)}</pre>
        </div>
        <div class="chat-mcp-tool-section">
          <div class="chat-mcp-tool-label">结果:</div>
          <pre class="chat-mcp-tool-code">${this.escapeHtml(resultText)}</pre>
        </div>
      `;
      
      content.appendChild(toolItem);
    });
    
    const toggleBtn = header.querySelector('.chat-mcp-toggle');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = content.style.display !== 'none';
      content.style.display = isExpanded ? 'none' : 'block';
      toggleBtn.textContent = isExpanded ? '展开' : '收起';
    });
    
    mcpContainer.appendChild(header);
    mcpContainer.appendChild(content);
    msgElement.appendChild(mcpContainer);
  }
  
  
  _deleteMessage(messageId) {
    const box = document.getElementById('chatMessages');
    if (!box) return;
    
    // 查找所有相关的消息元素（包括文字和图片）
    const allMessages = box.querySelectorAll(`[data-message-id="${messageId}"]`);
    if (allMessages.length === 0) return;
    
    const firstMsg = allMessages[0];
    const role = firstMsg.dataset.role;
    
    // 用户消息：只能撤回自己的
    if (role === 'user') {
      // 删除所有相关的消息元素（文字和图片）
      allMessages.forEach(msg => msg.remove());
      
      // 从历史记录中删除所有相关的消息
      const history = this._getCurrentChatHistory();
      let deleted = false;
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.id === messageId) {
          history.splice(i, 1);
          deleted = true;
        }
      }
      
      if (deleted) {
        this._saveChatHistory();
      }
      
      this.showToast('消息已撤回', 'success');
    } else if (role === 'assistant') {
      // AI消息：直接删除
      allMessages.forEach(msg => msg.remove());
      
      // 从历史记录中删除
      const history = this._getCurrentChatHistory();
      let deleted = false;
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.id === messageId) {
          history.splice(i, 1);
          deleted = true;
        }
      }
      
      if (deleted) {
        this._saveChatHistory();
      }
      
      this.showToast('消息已删除', 'success');
    }
  }
  
  _regenerateMessage(messageId) {
    const box = document.getElementById('chatMessages');
    if (!box) return;
    
    const msgElement = box.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgElement) return;
    
    const role = msgElement.dataset.role;
    if (role !== 'assistant') {
      this.showToast('只能重新生成 AI 回复', 'warning');
      return;
    }
    
    const history = this._getCurrentChatHistory();
    const assistantIndex = history.findIndex(m => m.id === messageId);
    if (assistantIndex < 0) return;
    
    const userIndex = assistantIndex - 1;
    if (userIndex < 0 || history[userIndex].role !== 'user') {
      this.showToast('找不到对应的用户消息', 'warning');
      return;
    }
    
    msgElement.remove();
    history.splice(assistantIndex, 1);
    this._saveChatHistory();
    
    const userMessage = history[userIndex];
    const userText = userMessage.text || '';
    
    if (userText.trim()) {
      this.sendAIMessage(userText, []);
    }
    
    this.showToast('正在重新生成...', 'info');
  }

  /**
   * 按顺序渲染 segments（文本和图片混合）
   * @param {Array} segments - 消息段数组
   * @param {boolean} persist - 是否持久化到历史记录
   * @returns {HTMLElement|null} 创建的消息容器
   */
  appendSegments(segments, persist = true, role = 'assistant') {
    if (!segments || segments.length === 0) return;
    
    const box = document.getElementById('chatMessages');
    if (!box) return;
    
    const div = document.createElement('div');
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    div.id = messageId;
    div.className = `chat-message ${role === 'user' ? 'user' : 'assistant'}${this._isRestoringHistory ? '' : ' message-enter'}`;
    div.dataset.messageId = messageId;
    
    const textParts = [];
    const allText = [];
    
    segments.forEach(seg => {
      if (typeof seg === 'string') {
        // 纯文本
        textParts.push(seg);
        allText.push(seg);
      } else if (seg.type === 'text') {
        // 文本段：device.js 已标准化为 seg.text
        const text = seg.text ?? '';
        if (text.trim()) {
          textParts.push(text);
          allText.push(text);
        }
      } else if (seg.type === 'image') {
        // 图片段：先渲染之前的文本，再渲染图片
        if (textParts.length > 0) {
          const textDiv = document.createElement('div');
          // 统一“MD 显示协议”
          textDiv.className = 'chat-text chat-markdown';
          textDiv.innerHTML = this.renderMarkdown(textParts.join(''));
          div.appendChild(textDiv);
          textParts.length = 0;
        }
        
        const url = seg.url;
        if (url) {
          const imgContainer = document.createElement('div');
          imgContainer.className = 'chat-image-container';
          const img = document.createElement('img');
          img.src = url;
          img.alt = '图片';
          img.className = 'chat-image';
          img.loading = 'lazy';
          img.style.cursor = 'pointer';
          img.title = '点击查看大图';
          
          img.onload = () => img.classList.add('loaded');
          img.onerror = () => {
            img.classList.add('loaded');
            img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2RkZCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj7lm77niYfliqDovb3lpLHotKU8L3RleHQ+PC9zdmc+';
            img.alt = '图片加载失败';
          };
          
          // 使用当前 src 打开预览，避免后续更新 src（如从 blob: 替换为服务器 URL）时预览仍指向旧地址
          img.addEventListener('click', () => this.showImagePreview(img.currentSrc || img.src));
          imgContainer.appendChild(img);
          div.appendChild(imgContainer);
        }
      } else if (seg.type === 'video') {
        // 视频段：先渲染之前的文本，再渲染视频
        if (textParts.length > 0) {
          const textDiv = document.createElement('div');
          textDiv.className = 'chat-text chat-markdown';
          textDiv.innerHTML = this.renderMarkdown(textParts.join(''));
          div.appendChild(textDiv);
          textParts.length = 0;
        }
        
        const url = seg.url;
        if (url) {
          const videoContainer = document.createElement('div');
          videoContainer.className = 'chat-video-container';
          const video = document.createElement('video');
          video.src = url;
          video.controls = true;
          video.className = 'chat-video';
          video.preload = 'metadata';
          video.title = seg.name || '视频';
          video.onloadedmetadata = () => {};
          video.onerror = () => {
            videoContainer.innerHTML = '<div class="chat-media-placeholder">视频加载失败</div>';
          };
          videoContainer.appendChild(video);
          div.appendChild(videoContainer);
        }
      } else if (seg.type === 'record') {
        if (textParts.length > 0) {
          const textDiv = document.createElement('div');
          textDiv.className = 'chat-text chat-markdown';
          textDiv.innerHTML = this.renderMarkdown(textParts.join(''));
          div.appendChild(textDiv);
          textParts.length = 0;
        }
        
        const url = seg.url || seg.file || seg.data?.file;
        if (url) {
          const audioContainer = document.createElement('div');
          audioContainer.className = 'chat-audio-container';
          const audio = document.createElement('audio');
          audio.src = url;
          audio.controls = true;
          audio.controlsList = 'nodownload';
          audio.className = 'chat-audio';
          audio.preload = 'metadata';
          audio.title = seg.name || '语音';
          audio.onerror = () => {
            audioContainer.innerHTML = `
              <div class="chat-media-placeholder small">
                <div>音频加载失败（可能由于跨域限制）</div>
                <a href="${url}" target="_blank" style="color: var(--primary); text-decoration: underline; margin-top: 4px; display: inline-block;">点击在新窗口打开</a>
              </div>
            `;
          };
          audioContainer.appendChild(audio);
          div.appendChild(audioContainer);
        }
      } else if (seg.type === 'at') {
        // @ 提及：显示为特殊样式，添加到文本中
        const qq = seg.qq ?? seg.user_id ?? '';
        const name = seg.name ?? '';
        const atText = name ? `@${name}` : (qq ? `@${qq}` : '@未知用户');
        const atHtml = `<span class="chat-at" data-qq="${this.escapeHtml(String(qq))}" data-name="${this.escapeHtml(name)}">${this.escapeHtml(atText)}</span>`;
        textParts.push(atHtml);
        allText.push(atText);
      } else if (seg.type === 'reply') {
        // 回复：显示为引用样式
        if (textParts.length > 0) {
          const textDiv = document.createElement('div');
          textDiv.className = 'chat-text chat-markdown';
          textDiv.innerHTML = this.renderMarkdown(textParts.join(''));
          div.appendChild(textDiv);
          textParts.length = 0;
        }
        
        const replyDiv = document.createElement('div');
        replyDiv.className = 'chat-reply';
        const replyText = seg.text || '引用消息';
        replyDiv.innerHTML = `<div class="chat-reply-content">${this.escapeHtml(replyText)}</div>`;
        div.appendChild(replyDiv);
      } else if (seg.type === 'file') {
        // 文件：显示为下载链接
        if (textParts.length > 0) {
          const textDiv = document.createElement('div');
          textDiv.className = 'chat-text chat-markdown';
          textDiv.innerHTML = this.renderMarkdown(textParts.join(''));
          div.appendChild(textDiv);
          textParts.length = 0;
        }
        
        const url = seg.url || seg.file;
        if (url) {
          const fileDiv = document.createElement('div');
          fileDiv.className = 'chat-file';
          const fileName = seg.name || '文件';
          fileDiv.innerHTML = `
            <a href="${url}" download="${fileName}" class="chat-file-link">
              <span class="chat-file-icon">📎</span>
              <span class="chat-file-name">${this.escapeHtml(fileName)}</span>
            </a>
          `;
          div.appendChild(fileDiv);
        }
      } else if (seg.type === 'markdown' || seg.type === 'raw') {
        // Markdown 或原始内容：直接渲染
        if (textParts.length > 0) {
          const textDiv = document.createElement('div');
          textDiv.className = 'chat-text chat-markdown';
          textDiv.innerHTML = this.renderMarkdown(textParts.join(''));
          div.appendChild(textDiv);
          textParts.length = 0;
        }
        
        const content = seg.data ?? seg.markdown ?? seg.raw ?? '';
        if (content) {
          const contentDiv = document.createElement('div');
          contentDiv.className = seg.type === 'markdown' ? 'chat-markdown' : 'chat-raw';
          contentDiv.innerHTML = seg.type === 'markdown' ? this.renderMarkdown(content) : this.escapeHtml(content);
          div.appendChild(contentDiv);
        }
      } else if (seg.type === 'button') {
        // 按钮：显示为交互按钮
        if (textParts.length > 0) {
          const textDiv = document.createElement('div');
          textDiv.className = 'chat-text chat-markdown';
          textDiv.innerHTML = this.renderMarkdown(textParts.join(''));
          div.appendChild(textDiv);
          textParts.length = 0;
        }
        
        const buttons = Array.isArray(seg.data) ? seg.data : (seg.data ? [seg.data] : []);
        if (buttons.length > 0) {
          const buttonContainer = document.createElement('div');
          buttonContainer.className = 'chat-buttons';
          buttons.forEach((btn, idx) => {
            const button = document.createElement('button');
            button.className = 'chat-button';
            button.textContent = btn.text ?? btn.label ?? `按钮${idx + 1}`;
            button.title = btn.tooltip ?? '';
            if (btn.action || btn.onClick) {
              button.addEventListener('click', () => {
                if (typeof btn.onClick === 'function') {
                  btn.onClick();
                } else if (btn.action) {
                  // 按钮动作处理
                  if (btn.action === 'copy' && btn.data) {
                    navigator.clipboard.writeText(btn.data).then(() => {
                      this.showToast('已复制到剪贴板', 'success');
                    }).catch(() => {});
                  }
                }
              });
            }
            buttonContainer.appendChild(button);
          });
          div.appendChild(buttonContainer);
        }
      } else if (seg.type && seg.type !== 'forward' && seg.type !== 'node') {
        // 自定义类型或其他未知类型：尝试渲染
        if (textParts.length > 0) {
          const textDiv = document.createElement('div');
          textDiv.className = 'chat-text';
          textDiv.innerHTML = this.renderMarkdown(textParts.join(''));
          div.appendChild(textDiv);
          textParts.length = 0;
        }
        
        const customDiv = document.createElement('div');
        customDiv.className = `chat-custom chat-custom-${seg.type}`;
        if (seg.data) {
          if (typeof seg.data === 'string') {
            customDiv.textContent = seg.data;
          } else if (typeof seg.data === 'object') {
            customDiv.textContent = JSON.stringify(seg.data, null, 2);
          }
        } else {
          customDiv.textContent = `[${seg.type}]`;
        }
        div.appendChild(customDiv);
      }
    });
    
    // 渲染剩余的文本
    if (textParts.length > 0) {
      const textDiv = document.createElement('div');
      textDiv.className = 'chat-text';
      textDiv.innerHTML = this.renderMarkdown(textParts.join(''));
      div.appendChild(textDiv);
    }
    
    if (div.children.length === 0) return;
    
    // 统一添加消息操作按钮（复制/删除/重新生成）
    const fullText = allText.join('').trim();
    this._addMessageActions(div, role, fullText, messageId);
    
    box.appendChild(div);
    this._renderMermaidIn(div);
    
    if (!this._isRestoringHistory) {
    this.scrollToBottom();
    }
    
    this._applyMessageEnter(div, persist);
    
    if (persist) {
      const normalizedSegments = segments.map(s => {
        if (typeof s === 'string') return { type: 'text', text: s };
        return s;
      });
      this._getCurrentChatHistory().push({ 
        role: role === 'user' ? 'user' : 'assistant', 
        segments: normalizedSegments,
        ts: Date.now(),
        id: messageId
      });
      this._saveChatHistory();
    }
    
    return div;
  }

  appendImageMessage(url, persist = true) {
    return this.appendSegments([{ type: 'image', url }], persist, 'assistant');
  }

  appendUserImageMessage(url, persist = true) {
    return this.appendSegments([{ type: 'image', url }], persist, 'user');
  }

  showImagePreview(url) {
    // 创建预览模态框
    let modal = document.getElementById('imagePreviewModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'imagePreviewModal';
      modal.className = 'image-preview-modal';
      modal.innerHTML = `
        <div class="image-preview-overlay"></div>
        <div class="image-preview-container">
          <button class="image-preview-close" aria-label="关闭">&times;</button>
          <img class="image-preview-img" src="" alt="预览图片" />
        </div>
      `;
      document.body.appendChild(modal);
      
      // 点击遮罩层或关闭按钮关闭预览
      modal.querySelector('.image-preview-overlay').addEventListener('click', () => this.closeImagePreview());
      modal.querySelector('.image-preview-close').addEventListener('click', () => this.closeImagePreview());
      
      // ESC键关闭预览
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
          this.closeImagePreview();
        }
      });
    }
    
    const img = modal.querySelector('.image-preview-img');
    img.src = url;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  closeImagePreview() {
    const modal = document.getElementById('imagePreviewModal');
    if (modal) {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  appendChatRecord(messages, title = '', description = '', persist = true) {
    const box = document.getElementById('chatMessages');
    if (!box) return;

    const messagesArray = Array.isArray(messages) ? messages : [messages];
    if (messagesArray.length === 0) return;
    
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const recordId = `record_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const div = document.createElement('div');
    div.id = messageId;
    div.className = `chat-message assistant chat-record${this._isRestoringHistory ? '' : ' message-enter'}`;
    div.dataset.recordId = recordId;
    div.dataset.messageId = messageId;

    let content = '';
    // 统一显示header（即使没有title也显示，保持格式一致）
    if (title || description) {
      content += `<div class="chat-record-header">
        ${title ? `<div class="chat-record-title">${this.escapeHtml(title)}</div>` : ''}
        ${description ? `<div class="chat-record-description">${this.escapeHtml(description)}</div>` : ''}
      </div>`;
    }

    content += '<div class="chat-record-content">';
    messagesArray.forEach((msg) => {
      const text = typeof msg === 'string' ? msg : (msg.message || msg.content || String(msg));
      if (text && text.trim()) {
        content += `<div class="chat-record-item">${this.renderMarkdown(text)}</div>`;
      }
    });
    content += '</div>';

    div.innerHTML = content;
    box.appendChild(div);
    // 记录卡片里也可能包含 Mermaid 图表，这里统一触发一次局部渲染
    this._renderMermaidIn(div);
    
    if (!this._isRestoringHistory) {
    this.scrollToBottom();
    }

    this._applyMessageEnter(div, persist);

    // 保存到聊天历史（仅在需要持久化时）
    if (persist) {
      const recordData = {
        role: 'assistant',
        type: 'record',
        title: title ?? '',
        description: description ?? '',
        messages: messagesArray,
        ts: Date.now(),
        recordId
      };
      this._getCurrentChatHistory().push(recordData);
      this._saveChatHistory();
    }
    
    return div;
  }

  escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  /**
   * 格式化字节数
   * @param {number} bytes - 字节数
   * @returns {string} 格式化后的字符串
   */
  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * 格式化时间
   * @param {number} seconds - 秒数
   * @returns {string} 格式化后的时间字符串
   */
  formatTime(seconds) {
    if (!seconds || seconds === 0) return '0秒';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Number((seconds % 60).toFixed(2));
    
    const parts = [];
    if (days > 0) parts.push(`${days}天`);
    if (hours > 0) parts.push(`${hours}时`);
    if (minutes > 0) parts.push(`${minutes}分`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}秒`);
    
    return parts.join('');
  }

  /**
   * 格式化数字（添加千分位）
   * @param {number} num - 数字
   * @returns {string} 格式化后的字符串
   */
  formatNumber(num) {
    if (num == null || isNaN(num)) return '--';
    return Number(num).toLocaleString('zh-CN');
  }

  /**
   * 格式化百分比
   * @param {number} value - 数值
   * @param {number} total - 总数
   * @returns {string} 格式化后的百分比字符串
   */
  formatPercent(value, total) {
    if (!total || total === 0) return '0%';
    const percent = (value / total) * 100;
    return percent.toFixed(1) + '%';
  }

  clearChat() {
    this._revokeAllObjectUrls();
    const history = this._getCurrentChatHistory();
    history.length = 0;
    this._saveChatHistory();
    const box = document.getElementById('chatMessages');
    if (box) box.innerHTML = '';
    this._chatMessagesCache[this._chatMode] = null;
    if (this._chatMode === 'voice') {
      this.updateVoiceEmotion('😊');
      this.updateVoiceStatus('点击麦克风开始对话');
    }
  }

  /**
   * 处理文件选择（AI模式仅图片，Event模式支持所有媒体）
   */
  handleImageSelect(files) {
    if (!files || files.length === 0) return;
    
    const previewContainer = document.getElementById('chatImagePreview');
    if (!previewContainer) return;
    
    const isAIMode = this._chatMode === 'ai';
    this._selectedImages = this._selectedImages ?? [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // AI模式仅支持图片
      if (isAIMode && !file.type.startsWith('image/')) {
        this.showToast('只能上传图片文件', 'warning');
        continue;
      }
      
      // 检查文件大小（限制为 100MB）
      const maxSize = isAIMode ? 10 * 1024 * 1024 : 100 * 1024 * 1024;
      if (file.size > maxSize) {
        this.showToast(`文件 ${file.name} 超过 ${isAIMode ? '10' : '100'}MB 限制`, 'warning');
        continue;
      }

      // 预览使用 objectURL
      const previewUrl = isAIMode && file.type.startsWith('image/') 
        ? this._createTrackedObjectURL(file)
        : null;
      this._selectedImages.push({
        file,
        previewUrl,
        id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      });
      this.updateImagePreview();
    }
    
    const imageInput = document.getElementById('chatImageInput');
    if (imageInput) imageInput.value = '';
  }

  /**
   * 压缩/缩放图片（减少上传体积与多模态 token 消耗，提高响应速度）
   * @returns {Promise<File>}
   */
  async compressImageFile(file) {
    try {
      if (!file || !file.type?.startsWith('image/')) return file;

      // 小图直接走原图（避免无谓的重新编码）
      const SOFT_LIMIT = 900 * 1024; // ~900KB
      if (file.size <= SOFT_LIMIT) return file;

      const maxDim = 1280;
      const quality = 0.82;
      const url = URL.createObjectURL(file);

      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });

      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        URL.revokeObjectURL(url);
        return file;
      }

      const scale = Math.min(1, maxDim / Math.max(w, h));
      const targetW = Math.max(1, Math.round(w * scale));
      const targetH = Math.max(1, Math.round(h * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        URL.revokeObjectURL(url);
        return file;
      }
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const blob = await new Promise((resolve) => {
        // 统一转 jpeg（更小）；如果你更喜欢 webp，可改成 image/webp
        canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
      });

      URL.revokeObjectURL(url);
      if (!blob) return file;

      // 如果压缩后反而更大，就用原图
      if (blob.size >= file.size) return file;

      const name = (file.name || 'image').replace(/\.(png|jpg|jpeg|webp|bmp)$/i, '');
      return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
    } catch {
      return file;
    }
  }
  
  /**
   * 更新文件预览（AI模式显示图片，Event模式显示所有文件）
   */
  updateImagePreview() {
    const previewContainer = document.getElementById('chatImagePreview');
    if (!previewContainer) return;
    
    if (!this._selectedImages || this._selectedImages.length === 0) {
      previewContainer.style.display = 'none';
      previewContainer.innerHTML = '';
      return;
    }
    
    const isAIMode = this._chatMode === 'ai';
    previewContainer.style.display = 'flex';
    previewContainer.innerHTML = this._selectedImages.map((item) => {
      const isImage = item.file.type.startsWith('image/');
      if (isImage && item.previewUrl) {
        return `
        <div class="chat-image-preview-item" data-file-id="${item.id}">
          <img src="${item.previewUrl}" alt="预览">
          <button class="chat-image-preview-remove" data-file-id="${item.id}" title="移除">×</button>
        </div>
        `;
      } else {
        const fileIcon = item.file.type.startsWith('video/') ? '🎥' : 
                        item.file.type.startsWith('audio/') ? '🎵' : '📄';
        const fileSize = (item.file.size / 1024 / 1024).toFixed(2);
        return `
        <div class="chat-image-preview-item" data-file-id="${item.id}">
          <div class="chat-file-preview">
            <div class="chat-file-preview-icon">${fileIcon}</div>
            <div class="chat-file-preview-info">
              <div class="chat-file-preview-name">${this.escapeHtml(item.file.name)}</div>
              <div class="chat-file-preview-size">${fileSize} MB</div>
            </div>
          </div>
          <button class="chat-image-preview-remove" data-file-id="${item.id}" title="移除">×</button>
        </div>
        `;
      }
    }).join('');
    
    previewContainer.querySelectorAll('.chat-image-preview-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const fileId = btn.dataset.fileId;
        this.removeImagePreview(fileId);
      });
    });
  }
  
  /**
   * 移除文件预览
   */
  removeImagePreview(fileId) {
    if (!this._selectedImages) return;
    const item = this._selectedImages.find(img => img.id === fileId);
    if (item?.previewUrl) {
      this._safeRevokeObjectURL(item.previewUrl);
    }
    this._selectedImages = this._selectedImages.filter(img => img.id !== fileId);
    this.updateImagePreview();
  }
  
  /**
   * 清空图片预览
   */
  clearImagePreview(options = {}) {
    const keepUrls = options?.keepUrls instanceof Set
      ? options.keepUrls
      : (Array.isArray(options?.keepUrls) ? new Set(options.keepUrls) : null);
    // 释放所有 objectURL
    (this._selectedImages ?? []).forEach(img => {
      if (img?.previewUrl) {
        if (keepUrls && keepUrls.has(img.previewUrl)) return;
        this._safeRevokeObjectURL(img.previewUrl);
      }
    });
    this._selectedImages = [];
    this.updateImagePreview();
  }

  async sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input?.value?.trim() ?? '';
    const images = this._selectedImages ?? [];
    
    if (!text && images.length === 0) return;
    
    input.value = '';
    
    if (this._chatMode === 'ai') {
      await this.sendAIMessage(text, images);
    } else {
      await this.sendEventMessage(text, images);
    }
  }

  async sendEventMessage(text, images) {
    try {
      if (text) {
        this.appendChat('user', text);
      }
      
      if (images.length > 0) {
        const keepPreviewUrls = new Set();
        const pendingFileNodes = [];
        
        for (const item of images) {
          const file = item.file;
          const fileType = file.type;
          let segmentType = 'file';
          let displayUrl = null;
          
          if (fileType.startsWith('image/')) {
            segmentType = 'image';
            displayUrl = this._createTrackedObjectURL(file) || item.previewUrl;
            if (displayUrl) keepPreviewUrls.add(displayUrl);
          } else if (fileType.startsWith('video/')) {
            segmentType = 'video';
            displayUrl = this._createTrackedObjectURL(file) || item.previewUrl;
            if (displayUrl) keepPreviewUrls.add(displayUrl);
          } else if (fileType.startsWith('audio/')) {
            segmentType = 'record';
            displayUrl = this._createTrackedObjectURL(file) || item.previewUrl;
            if (displayUrl) keepPreviewUrls.add(displayUrl);
          }
          
          const segment = displayUrl ? { type: segmentType, url: displayUrl, name: file.name } : { type: 'file', url: null, name: file.name };
          const node = this.appendSegments([segment], false, 'user');
          pendingFileNodes.push({ node, file, displayUrl, segmentType });
        }
        
        this.clearImagePreview({ keepUrls: keepPreviewUrls });
        
        const uploadedUrls = await this.sendChatMessageWithImages(text, images);

        if (Array.isArray(uploadedUrls) && uploadedUrls.length > 0) {
          for (let i = 0; i < pendingFileNodes.length; i++) {
            const u = uploadedUrls[i];
            if (!u) continue;
            const item = pendingFileNodes[i];
            const file = item.file;
            
            try {
              if (item.segmentType === 'image') {
                const imgEl = item.node?.querySelector('img.chat-image, img');
                if (imgEl) imgEl.src = u;
              } else if (item.segmentType === 'video') {
                const videoEl = item.node?.querySelector('video.chat-video, video');
                if (videoEl) videoEl.src = u;
              } else if (item.segmentType === 'record') {
                const audioEl = item.node?.querySelector('audio.chat-audio, audio');
                if (audioEl) audioEl.src = u;
              }
            } catch {}
            
            if (item.displayUrl && String(item.displayUrl).startsWith('blob:')) {
              this._safeRevokeObjectURL(item.displayUrl);
            }
            
            const segmentType = file.type.startsWith('image/') ? 'image' :
                              file.type.startsWith('video/') ? 'video' :
                              file.type.startsWith('audio/') ? 'record' : 'file';
            this._getCurrentChatHistory().push({ 
              role: 'user', 
              segments: [{ type: segmentType, url: u, name: file.name }], 
              ts: Date.now() + i 
            });
          }
          this._saveChatHistory();
        }
      } else if (text) {
        await this.sendChatMessageWithImages(text, []);
      }
      
      this.scrollToBottom();
    } catch (e) {
      this.showToast('发送失败: ' + e.message, 'error');
    }
  }
  
  /**
   * 更新流式消息的Markdown内容（统一AI和Voice模式的渲染逻辑）
   * @param {HTMLElement} assistantMsg - 消息元素
   * @param {string} fullText - 完整文本
   * @param {Array} mcpTools - MCP工具列表（可选）
   */
  _updateStreamingMarkdown(assistantMsg, fullText, mcpTools = []) {
    const contentDiv = document.createElement('div');
    contentDiv.className = 'chat-content chat-markdown';
    contentDiv.innerHTML = this.renderMarkdown(fullText);
    const existingContent = assistantMsg.querySelector('.chat-content');
    if (existingContent) {
      existingContent.replaceWith(contentDiv);
    } else {
      assistantMsg.innerHTML = '';
      assistantMsg.appendChild(contentDiv);
    }
    if (mcpTools.length > 0) {
      this._addMCPToolsInfo(assistantMsg, mcpTools);
    }
    this.scrollToBottom(true);
  }

  /**
   * 创建流式消息元素
   * @param {string} additionalClass - 额外的CSS类（如'voice-message'）
   * @returns {HTMLElement} 消息元素
   */
  _createStreamingMessage(additionalClass = '') {
    const box = document.getElementById('chatMessages');
    const assistantMsg = document.createElement('div');
    assistantMsg.className = `chat-message assistant streaming ${additionalClass} message-enter`.trim();
    assistantMsg.dataset.messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    assistantMsg.dataset.role = 'assistant';
    box.appendChild(assistantMsg);
    this._applyMessageEnter(assistantMsg, false);
    return assistantMsg;
  }

  /**
   * 发送带图片的消息到后端
   */
  async sendAIMessage(text, images) {
    try {
      // 立即清空图片预览
      if (images.length > 0) {
        this.clearImagePreview();
      }
      
      // 为本次消息创建统一的 messageId，确保文字和图片可以一起撤回
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      if (text) {
        this.appendChat('user', text, { messageId });
      }

      // AI 模式下：图片既要用于识图，也要在聊天记录中显示
      if (images.length > 0) {
        try {
          const urls = await this._uploadImagesCore(images);
          if (Array.isArray(urls) && urls.length > 0) {
            // 为每张图片创建消息，使用相同的 messageId
            urls.forEach((u) => {
              const imgMsg = this.appendSegments([{ type: 'image', url: u }], false, 'user');
              if (imgMsg) {
                imgMsg.dataset.messageId = messageId;
                imgMsg.dataset.role = 'user';
              }
            });
            // 保存到历史记录，使用统一的 messageId
            const history = this._getCurrentChatHistory();
            history.push({
              role: 'user',
              segments: urls.map(u => ({ type: 'image', url: u })),
              ts: Date.now(),
              id: messageId
            });
            this._saveChatHistory();
          }
        } catch (e) {
          // 上传失败不影响后续识图（仍然走 base64），只提示一次
          this.showToast(`图片上传失败: ${e.message}`, 'warning');
        }
      }

      const messages = [];
      const history = this._getCurrentChatHistory().filter(m => m.role && m.text);
      history.forEach(m => {
        messages.push({ role: m.role, content: m.text });
      });
      messages.push({ role: 'user', content: text || '' });

      if (images.length > 0) {
        const imageParts = [];
        for (const img of images) {
          const compressed = await this.compressImageFile(img.file);
          const base64 = await this.fileToBase64(compressed);
          imageParts.push({
            type: 'image_url',
            image_url: { url: base64 }
          });
        }
        const lastMsg = messages[messages.length - 1];
        if (typeof lastMsg.content === 'string') {
          lastMsg.content = [
            { type: 'text', text: lastMsg.content },
            ...imageParts
          ];
        } else if (Array.isArray(lastMsg.content)) {
          lastMsg.content.push(...imageParts);
        }
      }

      const apiKey = localStorage.getItem('apiKey') || BotUtil.apiKey || '';
      const provider = this._chatSettings.provider || '';
      const persona = this._chatSettings.persona || '';

      // 构造消息列表：历史 + 本次用户输入（可选人设）
      let finalMessages = persona
        ? [{ role: 'system', content: persona }, ...messages]
        : [...messages];

      // 如果本轮请求涉及 Mermaid/画图，额外补充一条系统提示，规范图表生成规则
      const mermaidHintNeeded = /```mermaid|mermaid|gantt|flowchart|graph TD|sequenceDiagram|classDiagram/i.test(text || '');
      if (mermaidHintNeeded) {
        const mermaidRules = [
          '你生成 Markdown + Mermaid 图表时必须严格遵守：',
          '1. 每一张图使用单独的 ```mermaid 代码块，不要在一个代码块里混合多张图（例如 gantt 和 graph）。',
          '2. gantt 图必须写在以 “gantt” 开头的代码块中，并包含：',
          '   - 一行 dateFormat YYYY-MM-DD（紧跟在 gantt 后的几行内，不要乱顺序）。',
          '   - 每个任务一行，ID 必须是英文或数字（如 a1、dev1），不能用中文或带空格；引用前置任务用 after ID。',
          '3. 避免在 Mermaid 代码块外部继续追加同一张图的语法；如果要画第二张图，请新开一个 ```mermaid 代码块。',
          '4. 如果只是解释图表含义，请把说明文字写在代码块外面。'
        ].join('\n');
        finalMessages.unshift({ role: 'system', content: mermaidRules });
      }

      // 如果用户选择了provider，使用用户选择的；否则不传model，让后端使用aistream.yaml配置的默认Provider
      const requestBody = {
        messages: finalMessages,
        stream: true,
        apiKey: apiKey
      };
      
      // 只有用户明确选择了provider时才传model参数
      if (provider) {
        requestBody.model = provider;
      }

      // AI 模式下，工作流只用于限定 MCP 工具作用域：
      // - 这里的 workflows 实际表示“启用 MCP 工具的工作流列表”
      // - API 端不再区分主/次工作流，仅按 streams 白名单注入 tools
      const workflows = Array.isArray(this._chatSettings.workflows)
        ? this._chatSettings.workflows.filter(Boolean)
        : [];

      if (workflows.length > 0) {
        requestBody.workflow = {
          workflows
        };
      }

      this._chatStreamState = { running: true, source: 'ai' };
      this.updateChatStatus('AI 生成中...');
      this.setChatInteractionState(true);


      const response = await fetch(`${this.serverUrl}/api/v3/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

        if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
      }

      if (!response.body) {
        throw new Error('响应体为空');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let assistantMsg = null;
      let fullText = '';
      let hasError = false;
      let streamEnded = false;
      let mcpTools = [];

      while (!streamEnded) {
        const { done, value } = await reader.read();
        
        if (done) {
          streamEnded = true;
          break;
        }

        const rawChunk = decoder.decode(value, { stream: true });
        buffer += rawChunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          const data = line.slice(6).trim();
          
          if (data === '[DONE]') {
            streamEnded = true;
            break;
          }

          let json;
          try {
            json = JSON.parse(data);
          } catch (e) {
            continue;
          }

          if (json.error) {
            hasError = true;
            const msg = json.error.message || 'AI 请求失败';
            this.showToast(`AI 请求失败: ${msg}`, 'error');
            streamEnded = true;
            break;
          }

          if (json.mcp_tools && Array.isArray(json.mcp_tools) && json.mcp_tools.length > 0) {
            mcpTools = json.mcp_tools;
            if (assistantMsg) {
              this._addMCPToolsInfo(assistantMsg, mcpTools);
            }
          }

          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            if (!assistantMsg) {
              assistantMsg = this._createStreamingMessage();
            }
            this._updateStreamingMarkdown(assistantMsg, fullText, mcpTools);
          }

          if (json.choices?.[0]?.finish_reason) {
            streamEnded = true;
            break;
          }
        }
      }

      if (!hasError && assistantMsg && fullText) {
        assistantMsg.classList.remove('streaming');
        // 使用统一的Markdown渲染
        this._updateStreamingMarkdown(assistantMsg, fullText, mcpTools);
        this._addMessageActions(assistantMsg, 'assistant', fullText, assistantMsg.dataset.messageId);
        const messageId = assistantMsg.dataset.messageId;
        this._getCurrentChatHistory().push({ role: 'assistant', text: fullText, ts: Date.now(), id: messageId, mcpTools: mcpTools.length > 0 ? mcpTools : undefined });
        this._saveChatHistory();
        // 流式结束后一次性渲染 Mermaid，避免用户手动刷新
        this._renderMermaidIn(assistantMsg);
      }
      
      this.clearChatStreamState();
      this.clearImagePreview();
    } catch (error) {
      this.showToast(`AI 请求失败: ${error.message}`, 'error');
      this.clearChatStreamState();
    }
  }

  async sendVoiceMessage(text) {
    if (this._chatStreamState.running) return;
    
    try {
      this.appendChat('user', text);
      
      const messages = [];
      const history = this._getCurrentChatHistory().filter(m => m.role && m.text && m.role !== 'system');
      history.forEach(m => {
        messages.push({ role: m.role, content: m.text });
      });

      const apiKey = localStorage.getItem('apiKey') || BotUtil.apiKey || '';
      const provider = this._chatSettings.provider || this._llmOptions?.defaultProfile || '';

      const requestBody = {
        messages,
        stream: true,
        apiKey: apiKey
      };
      
      if (provider) {
        requestBody.model = provider;
      }

      this._chatStreamState = { running: true, source: 'voice' };
      this.updateVoiceStatus('AI 思考中...');
      this.updateVoiceEmotion('🤔');

      const response = await fetch(`${this.serverUrl}/api/v3/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
      }

      if (!response.body) {
        throw new Error('响应体为空');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let assistantMsg = null;
      let fullText = '';
      let hasError = false;
      let streamEnded = false;
      this._ttsSentTextLength = 0; // 重置已发送文本长度

      while (!streamEnded) {
        const { done, value } = await reader.read();
        
        if (done) {
          streamEnded = true;
          break;
        }

        const rawChunk = decoder.decode(value, { stream: true });
        buffer += rawChunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          const data = line.slice(6).trim();
          
          if (data === '[DONE]') {
            streamEnded = true;
            break;
          }

          let json;
          try {
            json = JSON.parse(data);
          } catch (e) {
            continue;
          }

          if (json.error) {
            hasError = true;
            const msg = json.error.message || 'AI 请求失败';
            this.showToast(`AI 请求失败: ${msg}`, 'error');
            streamEnded = true;
            break;
          }

          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            
            if (!assistantMsg) {
              assistantMsg = this._createStreamingMessage('voice-message');
            }
            
            // 使用统一的Markdown流式渲染
            this._updateStreamingMarkdown(assistantMsg, fullText);
            this.updateVoiceEmotion('💬');
            
            // 提前发送TTS：优化分句逻辑，减少不必要的分句，支持英文标点与背压
            const currentText = fullText.trim();
            const unsentText = currentText.slice(this._ttsSentTextLength);
            const unsentForTTS = this._stripMarkdownForTTS(unsentText);
            const unsentLength = unsentForTTS.length;
            
            // 中英文句尾标点（含 . ! ? 。！？）
            const hasSentenceEnd = /[。！？.!?]/.test(unsentForTTS);
            const hasNewline = /\n/.test(unsentForTTS);
            const queueLen = (this._ttsAudioQueue && this._ttsAudioQueue.length) || 0;
            const backpressure = queueLen >= 12; // 播放队列积压时减少发送
            
            // 分句策略（偏向“更快开口说话”，降低首句延迟）：
            // 1. 无标点时：累积 35 字再发（减少等待，提升跟手感）
            // 2. 有句尾标点：>=8 字即发
            // 3. 有换行：>=6 字即发
            // 4. 背压时：仅在有句尾/换行且足够长时发，或未发长度>=50 才发
            const charThreshold = backpressure ? 50 : 35;
            const shouldSend = (unsentLength >= charThreshold) ||
              (hasSentenceEnd && unsentLength >= 8) ||
              (hasNewline && unsentLength >= 6);
            
            if (shouldSend && currentText.length > this._ttsSentTextLength) {
              let textToSend = unsentForTTS;
              if (hasSentenceEnd && !hasNewline) {
                const sentenceEndIndex = unsentForTTS.search(/[。！？.!?]/);
                if (sentenceEndIndex >= 0) {
                  textToSend = unsentForTTS.slice(0, sentenceEndIndex + 1);
                }
              } else if (hasNewline) {
                const newlineIndex = unsentForTTS.indexOf('\n');
                if (newlineIndex >= 0) {
                  textToSend = unsentForTTS.slice(0, newlineIndex + 1);
                }
              }
              
              // 确保发送到TTS的文本已去除所有Markdown符号
              const cleanText = this._stripMarkdownForTTS(textToSend.trim());
              if (cleanText) {
                this._sendTTSChunk(cleanText).catch(() => {});
                // 以原始文本的已发送长度推进，保证后续 unsentText 计算正确
                this._ttsSentTextLength = currentText.length;
              }
            }
          }

          if (json.choices?.[0]?.finish_reason) {
            streamEnded = true;
            break;
          }
        }
      }

        if (!hasError && assistantMsg && fullText) {
          assistantMsg.classList.remove('streaming');
          // 使用统一的Markdown渲染
          this._updateStreamingMarkdown(assistantMsg, fullText);
          
          // 发送剩余的文本到TTS
          const currentText = fullText.trim();
          if (currentText.length > this._ttsSentTextLength) {
            const remaining = currentText.slice(this._ttsSentTextLength);
            const ttsRemaining = this._stripMarkdownForTTS(remaining);
            if (ttsRemaining.trim()) {
              this._sendTTSChunk(ttsRemaining.trim()).catch(() => {});
            }
            this._ttsSentTextLength = currentText.length;
          }
          
          // 流式结束后渲染Mermaid，避免用户手动刷新
          this._renderMermaidIn(assistantMsg);
          
          this.updateVoiceEmotion('😊');
          this.updateVoiceStatus('对话完成');
          
          const messageId = assistantMsg.dataset.messageId;
          this._getCurrentChatHistory().push({ role: 'assistant', text: fullText, ts: Date.now(), id: messageId });
          this._saveChatHistory();
          this.scrollToBottom();
        }
      
      this.clearChatStreamState();
      setTimeout(() => {
        this.updateVoiceStatus('点击麦克风开始对话');
      }, 2000);
    } catch (error) {
      this.showToast(`AI 请求失败: ${error.message}`, 'error');
      this.updateVoiceEmotion('😢');
      this.updateVoiceStatus('出错了，请重试');
      this.clearChatStreamState();
      setTimeout(() => {
        this.updateVoiceStatus('点击麦克风开始对话');
        this.updateVoiceEmotion('😊');
      }, 3000);
    }
  }

  async _sendTTSChunk(text) {
    if (!text || !text.trim()) return;
    
    // 一旦有新的TTS文本要播报，认为进入新的会话，允许重新播放语音
    this._ttsStoppedManually = false;
    this._ttsDropLogged = false;

    // 将文本添加到队列
    this._ttsTextQueue.push(text.trim());
    
    // 如果当前没有活跃的Session，立即处理队列
    if (!this._ttsSessionActive) {
      this._processTTSQueue();
    }
  }

  async _processTTSQueue() {
    // 如果队列为空或已有活跃Session，直接返回
    if (this._ttsTextQueue.length === 0 || this._ttsSessionActive) {
      return;
    }

    // 合并队列中的文本：优化合并策略，减少Session数量
    const textsToMerge = [];
    let totalLength = 0;
    const MAX_MERGE_COUNT = 5; // 增加合并数量，减少Session
    const MAX_LENGTH = 150; // 增加最大长度，允许更长的文本合并

    while (this._ttsTextQueue.length > 0 && textsToMerge.length < MAX_MERGE_COUNT && totalLength < MAX_LENGTH) {
      const text = this._ttsTextQueue.shift();
      textsToMerge.push(text);
      totalLength += text.length;
      
      // 如果当前文本以句号/问号/感叹号结尾，且总长度已足够，可以停止合并
      // 这样可以避免在标点符号处产生明显间隔
      if (/[。！？]$/.test(text) && totalLength >= 30) {
        break;
      }
    }

    // 合并时在文本之间添加空格，避免连接处不自然
    const mergedText = textsToMerge.join(' ').replace(/\s+/g, ' ').trim();
    
    if (!mergedText.trim()) {
      // 如果合并后为空，继续处理队列
      this._processTTSQueue();
      return;
    }
    
    // 标记Session为活跃状态
    this._ttsSessionActive = true;
    this._ttsSessionStartTime = Date.now();
    this._ttsPending = true;

    try {
      await fetch(`${this.serverUrl}/api/device/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          device_id: this._webUserId,
          text: mergedText
        })
      });
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (e) {
      // 网络错误时，清理Session状态并重试
      console.warn('[TTS前端] 请求失败:', e);
      this._ttsSessionActive = false;
      this._ttsSessionStartTime = null;
      this._ttsPending = false;
      // 继续处理队列（自动重试）
      this._processTTSQueue();
    } finally {
      this._ttsPending = false;
      // Session状态由WebSocket消息控制，这里不重置
    }
  }

  // 当TTS Session结束时调用（通过检测最后一个音频块或WebSocket消息）
  _onTTSSessionEnd() {
    // 计算Session耗时（仅做简单统计，不再触发超时强制结束）
    if (this._ttsSessionStartTime) {
      this._ttsSessionStartTime = null;
    }
    this._ttsSessionActive = false;
    // 继续处理队列中的下一个请求
    if (this._ttsTextQueue.length > 0) {
      this._processTTSQueue();
    }
  }

  _playTTSAudio(hexData) {
    if (!hexData || typeof hexData !== 'string') {
      console.warn(`[TTS] 收到无效的hexData: ${hexData}, 类型=${typeof hexData}`);
      return;
    }

    // 如果用户已经手动点击“停止播报”，则直接丢弃后续所有音频块，避免需要连点多次按钮
    if (this._ttsStoppedManually) {
      // 仅在首次丢弃时打日志，防止刷屏
      if (!this._ttsDropLogged) {
        this._ttsDropLogged = true;
        console.warn('[TTS前端] 已收到用户手动停止指令，丢弃后续音频块');
      }
      return;
    }
    
    try {
      // 浏览器兼容性检查
      if (!window.AudioContext && !window.webkitAudioContext) {
        console.error('[TTS] 浏览器不支持Web Audio API');
        return;
      }
      
      if (!this._ttsAudioContext) {
        this._ttsAudioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 16000 // 统一采样率为16kHz（ASR/TTS标准）
        });
      }
      
      // 如果AudioContext被暂停，尝试恢复
      if (this._ttsAudioContext.state === 'suspended') {
        this._ttsAudioContext.resume().catch((e) => {
          console.warn('[TTS] AudioContext恢复失败:', e);
        });
      }
      
      // Hex解码
      const hexLen = hexData.length;
      if (hexLen === 0) {
        console.warn(`[TTS] hexData为空，跳过处理`);
        return;
      }
      
      if (hexLen % 2 !== 0) {
        console.error(`[TTS] hexData长度不是偶数: ${hexLen}，可能导致解码错误`);
        return;
      }
      
      const bytes = new Uint8Array(hexLen / 2);
      try {
        for (let i = 0; i < hexLen; i += 2) {
          bytes[i / 2] = parseInt(hexData.slice(i, i + 2), 16);
        }
      } catch (e) {
        console.error(`[TTS] hex解码失败: ${e.message}, hexData长度=${hexLen}`);
        return;
      }
      
      if (bytes.length === 0) {
        console.warn(`[TTS] 解码后字节数为0，跳过处理`);
        return;
      }
      
      // PCM转换
      const sampleCount = bytes.length / 2;
      const view = new DataView(bytes.buffer);
      const audioBuffer = this._ttsAudioContext.createBuffer(1, sampleCount, 16000);
      const channelData = audioBuffer.getChannelData(0);
      const scale = 1.0 / 32768.0;
      
      for (let i = 0; i < sampleCount; i++) {
        channelData[i] = view.getInt16(i * 2, true) * scale;
      }
      
      // 获取音频时长
      const duration = audioBuffer.duration;
      
      // 计算接收间隔
      const now = Date.now();
      let receiveInterval = 0;
      if (this._ttsStats.lastChunkReceiveTime) {
        receiveInterval = now - this._ttsStats.lastChunkReceiveTime;
      }
      this._ttsStats.lastChunkReceiveTime = now;
      
      // 更新统计信息
      this._ttsStats.totalChunks++;
      this._ttsStats.totalBytes += bytes.length;
      this._ttsStats.totalDuration += duration;
      this._ttsStats.lastChunkTime = now;
      this._ttsStats.processedMessageCount++;
      
      // 如果是第一个块，记录Session开始时间并标记Session为活跃
      if (this._ttsStats.totalChunks === 1) {
        this._ttsStats.sessionStartTime = now;
        // 确保Session状态正确（可能在收到第一个块之前就已经标记为活跃）
        if (!this._ttsSessionActive) {
          this._ttsSessionActive = true;
          this._ttsSessionStartTime = now;
        }
      }
      
      // 只在队列积压或接收间隔异常时输出日志
       // 队列告警阈值（不丢弃）
       const WARNING_QUEUE_SIZE = 32;
      
       // 队列管理：不丢弃音频块（用户要求不丢包），仅告警提示积压
       // 允许队列积压到 100 块；超过后继续积压，但会强告警（真正背压在后端发送侧做）
       const HARD_MAX_QUEUE_SIZE = 100;
       if (this._ttsAudioQueue.length >= HARD_MAX_QUEUE_SIZE) {
         console.warn(`[TTS前端] ⚠️ 队列已达上限: ${this._ttsAudioQueue.length}/${HARD_MAX_QUEUE_SIZE}（不丢弃，等待后端背压/前端播放消化）`);
       } else if (this._ttsAudioQueue.length >= WARNING_QUEUE_SIZE && !this._ttsQueueWarned) {
         this._ttsQueueWarned = true;
         console.warn(`[TTS前端] 队列接近上限: ${this._ttsAudioQueue.length}/${HARD_MAX_QUEUE_SIZE}`);
       }
      
      // 加入队列尾部，确保不丢包且有序
      this._ttsAudioQueue.push(audioBuffer);
      // 上报队列状态给后端做实时背压
      this._reportTTSQueueStatus(false, 'enqueue');
      
      // 开始播放（只在第一次时启动）
      if (!this._ttsPlaying) {
        this._ttsPlaying = true;
        this._ttsNextPlayTime = 0; // 重置播放时间
        this._playNext();
      }
    } catch (e) {
      console.error('[TTS] 音频处理失败:', e);
    }
  }

  // 上报前端TTS队列状态到后端（用于闭环背压）
  _reportTTSQueueStatus(force = false, reason = '') {
    try {
      if (!this._deviceWs || this._deviceWs.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      const queueLen = (this._ttsAudioQueue && this._ttsAudioQueue.length) || 0;
      const playing = this._ttsPlaying === true;
      const activeSources = (this._ttsActiveSources && this._ttsActiveSources.length) || 0;

      // 节流：默认 100ms 一次；但跨阈值/状态变化立即上报
      const MIN_INTERVAL_MS = 100;
      const HIGH_WATER = 40;
      const LOW_WATER = 20;
      const crossedHigh = queueLen >= HIGH_WATER && this._ttsLastReportedQueueLen < HIGH_WATER;
      const crossedLow = queueLen <= LOW_WATER && this._ttsLastReportedQueueLen > LOW_WATER;
      const stateChanged = (this._ttsLastReportedPlaying !== null && playing !== this._ttsLastReportedPlaying) ||
        (this._ttsLastReportedActiveSources !== -1 && activeSources !== this._ttsLastReportedActiveSources);

      if (!force && !crossedHigh && !crossedLow && !stateChanged && (now - this._ttsLastQueueReportAt) < MIN_INTERVAL_MS) {
        if (!this._ttsQueueReportTimer) {
          const wait = MIN_INTERVAL_MS - (now - this._ttsLastQueueReportAt);
          this._ttsQueueReportTimer = setTimeout(() => {
            this._ttsQueueReportTimer = null;
            this._reportTTSQueueStatus(true, reason || 'throttle');
          }, Math.max(0, wait));
        }
        return;
      }

      this._ttsLastQueueReportAt = now;
      this._ttsLastReportedQueueLen = queueLen;
      this._ttsLastReportedPlaying = playing;
      this._ttsLastReportedActiveSources = activeSources;

      this._deviceWs.send(JSON.stringify({
        type: 'tts_queue_status',
        device_id: this._webUserId,
        queue_len: queueLen,
        playing,
        active_sources: activeSources,
        ts: now,
        reason
      }));
    } catch {
      // 静默：不影响主流程
    }
  }
  
  _playNext() {
    // 防止重复调用：如果队列为空，停止播放并清理资源
    if (this._ttsAudioQueue.length === 0) {
      this._ttsPlaying = false;
      this._ttsNextPlayTime = 0;
      this._reportTTSQueueStatus(false, 'queue_empty');
      // 注意：不清理 _ttsActiveSources，因为最后一个播放源可能还在播放
      // 等 onended 回调触发时会自动清理
      
      // 如果所有播放源都结束了，输出统计信息
      if (this._ttsActiveSources.length === 0 && this._ttsStats.totalChunks > 0) {
        const sessionDuration = this._ttsStats.lastChunkTime && this._ttsStats.sessionStartTime 
          ? ((this._ttsStats.lastChunkTime - this._ttsStats.sessionStartTime) / 1000).toFixed(2)
          : 'N/A';
        const playDuration = this._ttsStats.totalDuration.toFixed(3);
        const avgChunkSize = (this._ttsStats.totalBytes / this._ttsStats.totalChunks).toFixed(0);
        
        const wsMsgCount = this._ttsStats.wsMessageCount;
        const processedCount = this._ttsStats.processedMessageCount;
        const lostMessages = wsMsgCount - processedCount;
        
        if (lostMessages > 0) {
          console.error(`[TTS] 检测到消息丢失: WebSocket收到${wsMsgCount}条消息，但只处理了${processedCount}条，丢失${lostMessages}条`);
        }
        
        // Session结束，可以处理下一个TTS请求
        this._onTTSSessionEnd();
        this._reportTTSQueueStatus(true, 'session_end');
        
        // 重置统计信息
        this._ttsStats = {
          totalChunks: 0,
          totalBytes: 0,
          totalDuration: 0,
          sessionStartTime: null,
          lastChunkTime: null,
          lastChunkReceiveTime: null,
          lastPlayTime: null,
          expectedNextPlayTime: null,
          wsMessageCount: 0,
          processedMessageCount: 0
        };
        this._ttsSentTextLength = 0; // 重置已发送文本长度
      }
      return;
    }
    
    // 严格顺序播放：只依赖 AudioContext 时间线与 onended，不再引入额外延迟/重试定时器
    const currentTime = this._ttsAudioContext.currentTime;
    
    try {
      // 从队列头部取出一个音频块（FIFO，确保有序）
      const audioBuffer = this._ttsAudioQueue.shift();
      if (this._ttsAudioQueue.length < 15) {
        this._ttsQueueWarned = false;
      }
      const duration = audioBuffer.duration;
      
      // 计算播放开始时间：严格不重叠，按官方推荐写法排队到时间线
      const startTime = this._ttsNextPlayTime === 0
        ? currentTime
        : Math.max(currentTime, this._ttsNextPlayTime);
      
      this._ttsStats.lastPlayTime = startTime;
      this._ttsStats.expectedNextPlayTime = startTime + duration;
      
      // 更新下次播放时间（在 start 之前更新，防止并发问题）
      this._ttsNextPlayTime = startTime + duration;
      this._reportTTSQueueStatus(false, 'dequeue');
      
      // 创建播放源
      const source = this._ttsAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this._ttsAudioContext.destination);
      
      // 添加到活跃源列表，用于资源管理
      this._ttsActiveSources.push(source);
      
      // 播放结束后立即播放下一个（确保连续）
      source.onended = () => {
        // 从活跃源列表中移除
        const index = this._ttsActiveSources.indexOf(source);
        if (index > -1) {
          this._ttsActiveSources.splice(index, 1);
        }
        
        // 释放资源：断开连接
        try {
          source.disconnect();
        } catch (e) {
          // 忽略已断开的错误
        }
        
        // 继续播放下一个
        this._playNext();
      };
      
      // 错误处理
      source.onerror = (e) => {
        console.error('[TTS] 播放源错误:', e);
        // 从活跃源列表中移除
        const index = this._ttsActiveSources.indexOf(source);
        if (index > -1) {
          this._ttsActiveSources.splice(index, 1);
        }
        // 继续播放下一个，避免卡住
        this._playNext();
      };
      
      // 开始播放
      source.start(startTime);
      
       // 不丢弃：队列过长只告警；节流应由后端按 ws.bufferedAmount 背压控制
       if (this._ttsAudioQueue.length > 100) {
         console.warn('[TTS前端] ⚠️ 播放侧队列过长:', this._ttsAudioQueue.length, '（不丢弃）');
       }
    } catch (e) {
      console.error('[TTS] 播放失败:', e);
      this._cleanupTTS();
    }
  }
  
  // 清理TTS资源，防止内存泄漏
  _cleanupTTS() {
    // 停止所有活跃的播放源
    for (const source of this._ttsActiveSources) {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {
        // 忽略已停止或已断开的错误
      }
    }
    this._ttsActiveSources = [];
    
    // 清空队列
    this._ttsAudioQueue = [];
    this._ttsTextQueue = []; // 清空文本队列
    this._reportTTSQueueStatus(true, 'cleanup');
    if (this._ttsQueueReportTimer) {
      clearTimeout(this._ttsQueueReportTimer);
      this._ttsQueueReportTimer = null;
    }
    
    // 重置状态
    this._ttsPlaying = false;
    this._ttsNextPlayTime = 0;
    this._ttsSessionActive = false; // 重置Session状态
    this._ttsSessionStartTime = null; // 重置Session开始时间
    this._ttsQueueWarned = false;
    
    // 重置统计信息
    this._ttsStats = {
      totalChunks: 0,
      totalBytes: 0,
      totalDuration: 0,
      sessionStartTime: null,
      lastChunkTime: null,
      lastChunkReceiveTime: null,
      lastPlayTime: null,
      expectedNextPlayTime: null,
      wsMessageCount: 0,
      processedMessageCount: 0
    };
    this._ttsSentTextLength = 0; // 重置已发送文本长度
  }
  
  // 停止TTS播放（外部调用）
  stopTTS() {
    // 标记为用户手动停止：后续到达的音频块一律丢弃，直到下一次重新发起TTS
    this._ttsStoppedManually = true;
    this._ttsDropLogged = false;
    this._cleanupTTS();
    // 主动上报一次队列状态，帮助后端更快感知到“已经停止”
    try {
      this._reportTTSQueueStatus(true, 'manual_stop');
    } catch {
      // 忽略上报错误
    }
  }

  updateVoiceStatus(text) {
    const statusEl = document.getElementById('voiceStatus');
    if (statusEl) {
      statusEl.textContent = text;
    }
  }

  updateVoiceEmotion(emotion) {
    const emotionEl = document.getElementById('voiceEmotionIcon');
    if (emotionEl) {
      emotionEl.textContent = emotion;
      emotionEl.style.animation = 'none';
      setTimeout(() => {
        emotionEl.style.animation = 'pulse 0.5s ease';
      }, 10);
    }
  }

  async fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async _uploadImagesCore(files) {
    if (!files || files.length === 0) return [];
    const apiKey = localStorage.getItem('apiKey') || '';
    const isAIMode = this._chatMode === 'ai';

    const uploadFd = new FormData();
    for (const item of files) {
      const file = item.file;
      const fileToUpload = isAIMode && file.type.startsWith('image/')
        ? await this.compressImageFile(file)
        : file;
      uploadFd.append('file', fileToUpload);
    }

    const uploadResp = await fetch(`${this.serverUrl}/api/file/upload`, {
      method: 'POST',
      headers: apiKey ? { 'X-API-Key': apiKey } : undefined,
      body: uploadFd
    });

    if (!uploadResp.ok) {
      const raw = await uploadResp.text().catch(() => '');
      let msg = uploadResp.statusText || (isAIMode ? '图片上传失败' : '文件上传失败');
      try {
        const j = raw ? JSON.parse(raw) : null;
        msg = j?.message || j?.error || msg;
      } catch {}
      throw new Error(msg);
    }

    const uploadData = await uploadResp.json().catch(() => null);
    const urls = [];
    if (uploadData?.data?.file_url) urls.push(uploadData.data.file_url);
    if (Array.isArray(uploadData?.data?.files)) {
      uploadData.data.files.forEach(f => f?.file_url && urls.push(f.file_url));
    }
    if (uploadData?.file_url) urls.push(uploadData.file_url);
    if (Array.isArray(uploadData?.files)) {
      uploadData.files.forEach(f => f?.file_url && urls.push(f.file_url));
    }

    if (urls.length === 0) {
      throw new Error(isAIMode ? '图片上传成功但未返回可用的 file_url' : '文件上传成功但未返回可用的 file_url');
    }

    return urls;
  }

  async sendChatMessageWithImages(text, files) {
    if (files.length === 0) {
      this.sendDeviceMessage(text, { source: 'manual' });
      return [];
    }

    const urls = await this._uploadImagesCore(files);

    const segments = [];
    if ((text ?? '').trim()) {
      segments.push({ type: 'text', text: (text ?? '').trim() });
    }
    
    // 根据文件类型创建对应的segment
    urls.forEach((u, index) => {
      const file = files[index]?.file;
      if (!file) return;
      
      const fileType = file.type;
      let segmentType = 'file';
      if (fileType.startsWith('image/')) {
        segmentType = 'image';
      } else if (fileType.startsWith('video/')) {
        segmentType = 'video';
      } else if (fileType.startsWith('audio/')) {
        segmentType = 'record';
      }
      
      segments.push({ 
        type: segmentType, 
        url: u, 
        name: file.name,
        data: { url: u, file: u } 
      });
    });

    this.sendDeviceMessage(text || ' ', { source: 'manual', message: segments });
    return urls;
  }
  
  /**
   * 滚动到底部（企业级统一方法）
   * @param {boolean} smooth - 是否平滑滚动
   */
  scrollToBottom(smooth = false) {
    const box = document.getElementById('chatMessages');
    if (!box) return;
    
    const doScroll = () => {
      if (smooth && box.scrollTo) {
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
      } else {
        box.scrollTop = box.scrollHeight;
      }
    };

    // 先立即滚一次
    doScroll();
    // 再在下一帧（布局/渲染完成后）补一次，避免只到 70%–80% 的问题
    requestAnimationFrame(doScroll);
  }

  /**
   * 初始化聊天控件
   */
  initChatControls() {
    this.updateChatStatus();
    this.setChatInteractionState(this._chatStreamState.running);
  }

  /**
   * 获取当前人设
   * @returns {string} 人设文本
   */
  getCurrentPersona() {
    return this._chatSettings.persona?.trim() ?? '';
  }

  /**
   * 更新聊天状态显示
   * @param {string} message - 状态消息
   */
  updateChatStatus(message) {
    const statusEl = document.getElementById('chatStreamStatus');
    if (!statusEl) return;
    
    const isRunning = this._chatStreamState.running;
    statusEl.textContent = isRunning 
      ? (message || `${this._chatStreamState.source === 'voice' ? '语音' : '文本'}生成中...`)
      : '空闲';
    statusEl.classList.toggle('active', isRunning);
  }
  
  /**
   * 设置聊天交互状态（禁用/启用输入）
   * @param {boolean} streaming - 是否正在流式输出
   */
  setChatInteractionState(streaming) {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');
    
    if (input) {
      input.disabled = streaming;
      input.placeholder = streaming 
        ? (this._chatMode === 'ai' ? 'AI 正在处理...' : '正在处理...')
        : (this._chatMode === 'ai' ? '输入消息...' : '输入消息或发送语音...');
    }
    if (sendBtn) {
      sendBtn.disabled = streaming;
    }
  }
  
  /**
   * 清除聊天流状态
   */
  clearChatStreamState() {
    this._chatStreamState = { running: false, source: null };
    this.updateChatStatus();
    this.setChatInteractionState(false);
    this.clearChatPendingTimer();
  }
  
  /**
   * 清除聊天待处理定时器
   */
  clearChatPendingTimer() {
    if (this._chatPendingTimer) {
      clearTimeout(this._chatPendingTimer);
      this._chatPendingTimer = null;
    }
    if (this._chatQuickTimeout) {
      clearTimeout(this._chatQuickTimeout);
      this._chatQuickTimeout = null;
    }
  }
  
  stopActiveStream() {
    if (this._activeEventSource) {
      try {
        this._activeEventSource.close();
      } catch {}
      this._activeEventSource = null;
    }
    this.clearChatStreamState();
  }
  
  cancelAIStream() {
    if (!this._chatStreamState.running) return;
    this.stopActiveStream();
    const streamingMsg = document.querySelector('.chat-message.assistant.streaming');
    if (streamingMsg) {
      streamingMsg.remove();
    }
    this.showToast('已中断 AI 输出', 'info');
  }

  updateEmotionDisplay(emotion) {
    const map = { happy: '😊', sad: '😢', angry: '😠', surprise: '😮', love: '❤️', cool: '😎', sleep: '😴', think: '🤔' };
    const icon = map[emotion?.toLowerCase()] || map.happy;
    const el = document.getElementById('emotionIcon');
    if (el) el.textContent = icon;
  }

  // ========== 配置管理 ==========
  renderConfig() {
    const content = document.getElementById('content');
    if (!content) return;

    this._configState = {
      list: [],
      filter: '',
      selected: null,
      selectedChild: null,
      flatSchema: [],
      activeSchema: null,
      structureMeta: {},
      arraySchemaMap: {},
      dynamicCollectionsMeta: [],
      values: {},
      original: {},
      rawObject: {},
      dirty: {},
      mode: 'form',
      jsonText: '',
      jsonDirty: false,
      loading: false
    };

    content.innerHTML = `
      <div class="config-page">
        <aside class="config-sidebar">
          <div class="config-sidebar-header">
            <h1 class="dashboard-title">配置管理</h1>
            <p class="dashboard-subtitle">扁平 schema · 严格写入</p>
          </div>
          <div class="config-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input type="search" id="configSearchInput" placeholder="搜索配置 / 描述">
        </div>
        <div class="config-list" id="configList">
          <div class="empty-state">
            <div class="loading-spinner" style="margin:0 auto"></div>
              <p style="margin-top:12px">加载配置中...</p>
          </div>
        </div>
        </aside>
        <section class="config-main" id="configMain">
          ${this.renderConfigPlaceholder()}
        </section>
      </div>
    `;
    
    const searchInput = document.getElementById('configSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
      if (!this._configState) return;
      this._configState.filter = e.target.value.trim().toLowerCase();
      this.renderConfigList();
    });
    }

    // 配置列表事件委托：只绑定一次，避免每次重绘重复绑定
    const listContainer = document.getElementById('configList');
    if (listContainer) {
      listContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.config-item');
        if (!item || !this._configState) return;
        const name = item.dataset.name;
        if (name) this.selectConfig(name);
      });
    }

    this.loadConfigList();
  }

  renderConfigPlaceholder() {
    return `
      <div class="config-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 64px; height: 64px; margin: 0 auto 16px; opacity: 0.3;">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
        <h2 style="margin-bottom: 8px;">选择左侧配置开始</h2>
        <p style="color: var(--text-muted); margin-bottom: 16px;">支持表单 + JSON 双模式，所有提交均通过 ConfigBase schema 严格校验。</p>
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
          <span class="badge badge-info">表单模式</span>
          <span class="badge badge-info">JSON 模式</span>
          <span class="badge badge-info">实时校验</span>
        </div>
      </div>
    `;
  }

  async loadConfigList() {
    const list = document.getElementById('configList');
    try {
      const res = await fetch(`${this.serverUrl}/api/config/list`, { headers: this.getHeaders() });
      if (!res.ok) throw new Error('获取配置列表失败');
      const data = await res.json();
      if (!data.success) throw new Error(data.message ?? '接口返回失败');
      if (!this._configState) return;
      this._configState.list = data.configs ?? [];
      this.renderConfigList();
    } catch (e) {
      if (list) list.innerHTML = `<div class="empty-state"><p>加载失败: ${e.message}</p></div>`;
    }
  }

  renderConfigList() {
    if (!this._configState) return;
    const list = document.getElementById('configList');
    if (!list) return;

    if (!this._configState.list.length) {
      list.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; margin: 0 auto 12px; opacity: 0.3;">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <p>暂无配置</p>
        </div>
      `;
        return;
      }
      
    const keyword = this._configState.filter;
    const filtered = this._configState.list.filter(cfg => {
      if (!keyword) return true;
      const text = `${cfg.name} ${cfg.displayName ?? ''} ${cfg.description ?? ''}`.toLowerCase();
      return text.includes(keyword);
    });

    if (!filtered.length) {
      list.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; margin: 0 auto 12px; opacity: 0.3;">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <p>没有符合条件的配置</p>
          <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">尝试调整搜索关键词</p>
        </div>
      `;
      return;
    }

    list.innerHTML = filtered.map(cfg => {
      const title = this.escapeHtml(cfg.displayName || cfg.name);
      const desc = this.escapeHtml(cfg.description ?? cfg.filePath ?? '');
      return `
      <div class="config-item ${this._configState.selected?.name === cfg.name ? 'active' : ''}" data-name="${this.escapeHtml(cfg.name)}">
        <div class="config-item-meta">
          <div class="config-name">${title}</div>
          <p class="config-desc">${desc}</p>
          </div>
        ${cfg.name === 'system' ? '<span class="config-tag">多文件</span>' : ''}
          </div>
    `;
    }).join('');
  }

  selectConfig(name, child = null) {
    if (!this._configState) return;
    
    // 若选择与当前相同的配置和子项，避免重复渲染导致的抖动
    if (this._configState.selected?.name === name && (child || null) === this._configState.selectedChild) {
      return;
    }

    const config = this._configState.list.find(cfg => cfg.name === name);
    if (!config) return;

    this._configState.selected = config;
    this._configState.selectedChild = child || null;
    this._configState.schema = [];
    this._configState.values = {};
    this._configState.original = {};
    this._configState.rawObject = {};
    this._configState.dirty = {};
    this._configState.mode = 'form';
    this._configState.jsonText = '';
    this._configState.jsonDirty = false;

    if (config.name === 'system' && !child) {
      this.renderSystemConfigChooser(config);
      return;
    }

    this.loadSelectedConfigDetail();
  }

  renderSystemConfigChooser(config) {
    const main = document.getElementById('configMain');
    if (!main) return;

    const entries = Object.entries(config.configs ?? {});
    if (!entries.length) {
      main.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; margin: 0 auto 12px; opacity: 0.3;">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <p>SystemConfig 未定义子配置</p>
        </div>
      `;
      return;
    }

    main.innerHTML = `
      <div class="config-main-header">
        <div>
          <h2>${this.escapeHtml(config.displayName || config.name)}</h2>
          <p>${this.escapeHtml(config.description ?? '')}</p>
          </div>
        </div>
      <div class="config-grid">
        ${entries.map(([key, meta]) => `
          <div class="config-subcard" data-child="${this.escapeHtml(key)}">
            <div>
              <div class="config-subcard-title">${this.escapeHtml(meta.displayName || key)}</div>
              <p class="config-subcard-desc">${this.escapeHtml(meta.description ?? '')}</p>
          </div>
            <span class="config-tag">${this.escapeHtml(`system/${key}`)}</span>
          </div>
        `).join('')}
      </div>
    `;
    
    main.querySelectorAll('.config-subcard').forEach(card => {
      card.addEventListener('click', () => this.selectConfig('system', card.dataset.child));
    });
  }

  async loadSelectedConfigDetail() {
    if (!this._configState?.selected) return;
    const { name } = this._configState.selected;
    const child = this._configState.selectedChild;
    const query = child ? `?path=${encodeURIComponent(child)}` : '';

    try {
      this._configState.loading = true;
      const [flatStructRes, flatDataRes, structure] = await Promise.all([
        fetch(`${this.serverUrl}/api/config/${name}/flat-structure${query}`, { headers: this.getHeaders() }),
        fetch(`${this.serverUrl}/api/config/${name}/flat${query}`, { headers: this.getHeaders() }),
        this.fetchStructureSchema(name)
      ]);

      if (!flatStructRes.ok) throw new Error('获取结构失败');
      if (!flatDataRes.ok) throw new Error('获取数据失败');

      const flatStruct = await flatStructRes.json();
      const flatData = await flatDataRes.json();
      if (!flatStruct.success) throw new Error(flatStruct.message ?? '结构接口异常');
      if (!flatData.success) throw new Error(flatData.message ?? '数据接口异常');

      const schemaList = (flatStruct.flat ?? []).filter(field => field.path);
      const values = flatData.flat ?? {};

      const activeSchema = this.extractActiveSchema(structure, name, child) ?? { fields: {} };
      this._configState.activeSchema = activeSchema;
      this._configState.structureMeta = activeSchema.meta ?? {};
      this._configState.arraySchemaMap = this.buildArraySchemaIndex(activeSchema);
      this._configState.dynamicCollectionsMeta = this.buildDynamicCollectionsMeta(activeSchema);
      this._configState.flatSchema = schemaList;

      const normalizedValues = this.normalizeIncomingFlatValues(schemaList, values);
      this._configState.values = normalizedValues;
      this._configState.rawObject = this.unflattenObject(normalizedValues);
      this._configState.original = this._cloneFlat(normalizedValues);
      this._configState.jsonText = JSON.stringify(this._configState.rawObject, null, 2);
      this._configState.dirty = {};
      this._configState.jsonDirty = false;

      this.renderConfigFormPanel();
    } catch (e) {
      const main = document.getElementById('configMain');
      if (main) main.innerHTML = `<div class="empty-state"><p>加载失败：${e.message}</p></div>`;
    } finally {
      if (this._configState) this._configState.loading = false;
    }
  }

  async fetchStructureSchema(name) {
    if (this._schemaCache[name]) {
      return this._schemaCache[name];
    }
    const res = await fetch(`${this.serverUrl}/api/config/${name}/structure`, { headers: this.getHeaders() });
    if (!res.ok) {
      throw new Error('获取结构描述失败');
    }
      const data = await res.json();
    if (!data.success) {
      throw new Error(data.message || '结构接口异常');
    }
    this._schemaCache[name] = data.structure;
    return data.structure;
  }

  extractActiveSchema(structure, name, child) {
    if (!structure) return null;
    if (name === 'system') {
      if (!child) return null;
      const target = structure.configs?.[child];
      return target?.schema ?? { fields: target?.fields ?? {} };
    }
    return structure.schema ?? { fields: structure.fields ?? {} };
  }

  buildArraySchemaIndex(schema, prefix = '', map = {}) {
    if (!schema || !schema.fields) return map;
    for (const [key, fieldSchema] of Object.entries(schema.fields)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (fieldSchema.type === 'array' && fieldSchema.itemType === 'object') {
        const subFields = fieldSchema.itemSchema?.fields ?? fieldSchema.fields ?? {};
        map[path] = subFields;
      }
      if ((fieldSchema.type === 'object' || fieldSchema.type === 'map') && fieldSchema.fields) {
        this.buildArraySchemaIndex(fieldSchema, path, map);
      }
    }
    return map;
  }

  buildDynamicCollectionsMeta(schema) {
    const collections = schema?.meta?.collections ?? [];
    return collections.map(item => {
      const template = this.getSchemaNodeByPath(item.valueTemplatePath, schema);
      return {
        ...item,
        valueFields: template?.fields ?? {}
      };
    });
  }

  normalizeIncomingFlatValues(flatSchema, values) {
    const normalized = { ...values };
    if (!Array.isArray(flatSchema)) return normalized;
    flatSchema.forEach(field => {
      if (!Object.hasOwn(normalized, field.path)) return;
      normalized[field.path] = this.normalizeFieldValue(
        normalized[field.path],
        field.meta ?? {},
        field.type
      );
    });
    return normalized;
  }

  getSchemaNodeByPath(path = '', schema = this._configState?.activeSchema) {
    if (!path) return schema;
    if (!schema?.fields) return null;
    const segments = path.split('.');
    let current = schema;
    for (const segment of segments) {
      if (!current?.fields?.[segment]) return null;
      current = current.fields[segment];
    }
    return current;
  }

  renderConfigFormPanel() {
    if (!this._configState?.selected) return;
    const main = document.getElementById('configMain');
    if (!main) return;

    const { selected, selectedChild, mode } = this._configState;
    const dirtyCount = Object.keys(this._configState.dirty).length;
    const saveDisabled = mode === 'form' ? dirtyCount === 0 : !this._configState.jsonDirty;

    const title = this.escapeHtml(selected.displayName ?? selected.name);
    const childLabel = selectedChild ? ` / ${this.escapeHtml(selectedChild)}` : '';
    const descText = this.escapeHtml(selectedChild && selected.configs ? selected.configs[selectedChild]?.description ?? '' : selected.description ?? '');

    main.innerHTML = `
      <div class="config-main-header">
        <div>
          <h2>${title}${childLabel}</h2>
          <p>${descText}</p>
        </div>
        <div class="config-main-actions">
          <button class="btn btn-secondary" id="configReloadBtn">重载</button>
          <div class="config-mode-toggle">
            <button class="${mode === 'form' ? 'active' : ''}" data-mode="form">表单</button>
            <button class="${mode === 'json' ? 'active' : ''}" data-mode="json">JSON</button>
          </div>
          <button class="btn btn-primary" id="configSaveBtn" ${saveDisabled ? 'disabled' : ''}>
            ${mode === 'form' ? (dirtyCount ? `保存（${dirtyCount}）` : '保存') : '保存（JSON）'}
          </button>
        </div>
      </div>
      ${selected.name === 'system' && selectedChild ? this.renderSystemPathBadge(selectedChild) : ''}
      <div class="config-panel" id="configFormWrapper" style="${mode === 'json' ? 'display:none' : ''}">
        ${this.renderConfigFieldGroups()}
      </div>
      <div class="config-panel" id="configJsonWrapper" style="${mode === 'json' ? '' : 'display:none'}">
        ${this.renderConfigJsonPanel()}
      </div>
      ${this.renderDynamicCollections()}
    `;

    // 配置页面事件绑定 - 使用事件委托避免重复绑定
    const configMain = document.getElementById('configMain');
    if (configMain && !configMain.dataset._bound) {
      configMain.dataset._bound = '1';
      configMain.addEventListener('click', (e) => {
        const reloadBtn = e.target.closest('#configReloadBtn');
        if (reloadBtn) {
          this.loadSelectedConfigDetail();
          return;
        }
        const saveBtn = e.target.closest('#configSaveBtn');
        if (saveBtn) {
          this.saveConfigChanges();
          return;
        }
        const modeBtn = e.target.closest('.config-mode-toggle button');
        if (modeBtn) {
          this.switchConfigMode(modeBtn.dataset.mode);
        }
      });
    }

    this.bindConfigFieldEvents();
    this.bindConfigJsonEvents();
    this.bindArrayObjectEvents();
    this.bindDynamicCollectionEvents();
  }

  renderSystemPathBadge(child) {
    return `
      <div class="config-path-alert">
        <span>系统子配置</span>
        <code>${this.escapeHtml(`system/${child}`)}</code>
      </div>
    `;
  }

  renderConfigFieldGroups() {
    if (!this._configState?.flatSchema?.length) {
      return `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; margin: 0 auto 12px; opacity: 0.3;">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10,9 9,9 8,9"/>
          </svg>
          <p>该配置暂无扁平结构</p>
          <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">可切换 JSON 模式编辑</p>
        </div>
      `;
    }

    // 构建字段树结构，支持多级分组
    const fieldTree = this.buildFieldTree(this._configState.flatSchema);
    
    // 渲染字段树
    return this.renderFieldTree(fieldTree);
  }

  /**
   * 构建字段树结构，支持多级分组
   * 优化：根据路径深度和字段类型智能分组
   */
  buildFieldTree(flatSchema) {
    const tree = {};
    const subFormFields = new Map(); // 记录所有 SubForm 类型的字段路径及其信息
    
    // 第一遍：识别所有 SubForm 类型的字段
    flatSchema.forEach(field => {
      const meta = field.meta ?? {};
      const component = (meta.component ?? '').toLowerCase();
      if (component === 'subform' || (field.type === 'object' && meta.component !== 'json')) {
        subFormFields.set(field.path, {
          label: meta.label ?? field.path.split('.').pop() ?? field.path,
          description: meta.description ?? '',
          group: meta.group ?? null
        });
      }
    });
    
    // 第二遍：构建字段树
    flatSchema.forEach(field => {
      const meta = field.meta ?? {};
      const path = field.path;
      
      // 过滤掉数组模板路径字段（如 proxy.domains[].domain），这些字段只应该在数组项中显示
      // 模板路径包含 []，表示这是数组项的字段模板，不应该作为独立字段显示
      if (path.includes('[]')) {
        return; // 跳过数组模板字段，避免重复显示
      }
      
      const parts = path.split('.');
      
      // 智能确定分组键：
      // 1. 优先使用 meta.group
      // 2. 如果是 SubForm 的子字段，使用父 SubForm 的 group
      // 3. 否则根据路径深度和第一部分确定
      let groupKey = meta.group;
      let parentSubFormPath = null;
      
      // 查找最近的父 SubForm
      for (const [subFormPath, subFormInfo] of subFormFields.entries()) {
        if (path.startsWith(subFormPath + '.')) {
          parentSubFormPath = subFormPath;
          // 如果子字段没有 group，使用父 SubForm 的 group
          if (!groupKey && subFormInfo.group) {
            groupKey = subFormInfo.group;
          }
          break;
        }
      }

      // 如果是某个 SubForm 的子字段，但父级没有自定义 group，
      // 则优先按父级的顶层字段分组（例如 proxy.healthCheck.* 都归到 proxy 这一组），
      // 避免再额外生成 "Proxy - HealthCheck" 这类重复的大组。
      if (parentSubFormPath && !groupKey) {
        const top = parentSubFormPath.split('.')[0];
        groupKey = top || parentSubFormPath;
      }
      
      // 如果还是没有 group，根据路径确定
      // 统一使用路径的第一部分作为分组，避免重复分组
      if (!groupKey) {
        groupKey = parts[0];
      }
      
      // 格式化分组键
      groupKey = this.formatGroupKey(groupKey);
      
      if (parentSubFormPath) {
        // 这是 SubForm 的子字段，需要嵌套显示
        if (!tree[groupKey]) {
          tree[groupKey] = { fields: [], subGroups: {} };
        }
        
        const subFormInfo = subFormFields.get(parentSubFormPath);
        
        // 创建子分组
        if (!tree[groupKey].subGroups[parentSubFormPath]) {
          tree[groupKey].subGroups[parentSubFormPath] = {
            label: subFormInfo.label,
            description: subFormInfo.description,
            path: parentSubFormPath,
            fields: []
          };
        }
        
        tree[groupKey].subGroups[parentSubFormPath].fields.push(field);
      } else if (subFormFields.has(path)) {
        // 这是 SubForm 字段本身
        const isArrayType = field.type === 'array' || field.type === 'array<object>' || (meta.component ?? '').toLowerCase() === 'arrayform';
        
        if (isArrayType) {
          // 数组类型字段应该显示（通过 renderArrayObjectControl），子字段通过数组项渲染
          if (!tree[groupKey]) {
            tree[groupKey] = { fields: [], subGroups: {} };
          }
          tree[groupKey].fields.push(field);
        } else {
          // 非数组类型的 SubForm：如果有子字段则不在顶级显示（会在 subGroups 中显示）
          // 检查是否有非模板路径的子字段（排除包含 [] 的模板路径）
          const hasChildren = flatSchema.some(f => {
            const childPath = f.path;
            return childPath.startsWith(path + '.') && !childPath.includes('[]');
          });
          if (!hasChildren) {
            // 没有子字段，作为普通字段显示
            if (!tree[groupKey]) {
              tree[groupKey] = { fields: [], subGroups: {} };
            }
            tree[groupKey].fields.push(field);
          }
          // 有子字段的 SubForm 在 subGroups 中显示，避免重复
        }
      } else {
        // 普通字段，直接添加到分组
        if (!tree[groupKey]) {
          tree[groupKey] = { fields: [], subGroups: {} };
        }
        tree[groupKey].fields.push(field);
      }
    });
    
    return tree;
  }

  /**
   * 格式化分组键，使其更友好
   */
  formatGroupKey(key) {
    if (!key) return '其他';
    
    // 如果包含点，说明是嵌套路径，只取第一部分作为分组
    // 避免生成 "Proxy - Domains" 这样的重复标题
    if (key.includes('.')) {
      const parts = key.split('.');
      return this.getFieldLabel(parts[0]);
    }
    
    return this.getFieldLabel(key);
  }

  /**
   * 获取字段的友好标签
   */
  getFieldLabel(key) {
    const labelMap = {
      'llm': 'LLM 大语言模型',
      'defaults': '默认参数',
      'profiles': '模型档位',
      'embedding': 'Embedding 向量检索',
      'drawing': '绘图模型',
      'tts': 'TTS 语音合成',
      'asr': 'ASR 语音识别',
      'device': '设备运行参数',
      'emotions': '表情映射',
      'global': '全局设置',
      'cache': '缓存设置'
    };
    
    return labelMap[key] || this.formatGroupLabel(key);
  }

  /**
   * 渲染字段树
   */
  renderFieldTree(tree) {
    return Object.entries(tree).map(([groupKey, group]) => {
      const groupLabel = this.formatGroupLabel(groupKey);
      const groupDesc = group.fields[0]?.meta?.groupDesc ?? '';
      const totalFields = group.fields.length + Object.values(group.subGroups).reduce((sum, sg) => sum + sg.fields.length, 0);
      
      // 渲染子分组（SubForm），子分组内的字段也需要按分组显示
      const subGroupsHtml = Object.entries(group.subGroups).map(([subPath, subGroup]) => {
        // 对子分组内的字段进行分组
        const subFieldGroups = this.groupFieldsByMeta(subGroup.fields);
        const hasMultipleGroups = subFieldGroups.size > 1;
        
        const subFieldsHtml = Array.from(subFieldGroups.entries()).map(([subGroupKey, subFields]) => {
          return `
            <div class="config-subgroup-section">
              ${hasMultipleGroups ? `
                <div class="config-subgroup-section-header">
                  <h5>${this.escapeHtml(this.formatGroupLabel(subGroupKey))}</h5>
                </div>
              ` : ''}
              <div class="config-field-grid">
                ${subFields.map(field => this.renderConfigField(field)).join('')}
              </div>
            </div>
          `;
        }).join('');
        
        return `
          <div class="config-subgroup" data-subform-path="${this.escapeHtml(subPath)}">
            <div class="config-subgroup-header">
              <h4>${this.escapeHtml(subGroup.label)}</h4>
              ${subGroup.description ? `<p class="config-subgroup-desc">${this.escapeHtml(subGroup.description)}</p>` : ''}
            </div>
            ${subFieldsHtml}
          </div>
        `;
      }).join('');
      
      // 渲染普通字段
      const fieldsHtml = group.fields.length > 0 ? `
        <div class="config-field-grid">
          ${group.fields.map(field => this.renderConfigField(field)).join('')}
        </div>
      ` : '';
      
      return `
      <div class="config-group">
        <div class="config-group-header">
          <div>
              <h3>${this.escapeHtml(groupLabel)}</h3>
              ${groupDesc ? `<p>${this.escapeHtml(groupDesc)}</p>` : ''}
          </div>
            <span class="config-group-count">${totalFields} 项</span>
        </div>
          ${fieldsHtml}
          ${subGroupsHtml}
        </div>
      `;
    }).join('');
  }

  /**
   * 根据 meta.group 对字段进行分组
   */
  groupFieldsByMeta(fields) {
    const groups = new Map();
    
    fields.forEach(field => {
      const meta = field.meta ?? {};
      const groupKey = meta.group || '默认';
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey).push(field);
    });
    
    return groups;
  }

  renderConfigField(field) {
    const meta = field.meta ?? {};
    const path = field.path;
    const value = this._configState.values[path];
    const dirty = this._configState.dirty[path];
    const inputId = `cfg-${path.replace(/[^a-zA-Z0-9]/g, '_')}`;

    const label = this.escapeHtml(meta.label || path);
    const description = meta.description ? `<p class="config-field-hint">${this.escapeHtml(meta.description)}</p>` : '';

    return `
      <div class="config-field ${dirty ? 'config-field-dirty' : ''}">
        <label for="${inputId}">
          ${label}
          ${meta.required ? '<span class="required">*</span>' : ''}
        </label>
        ${description}
        ${this.renderConfigControl(field, value, inputId)}
      </div>
    `;
  }

  renderConfigControl(field, value, inputId) {
    const meta = field.meta ?? {};
    const component = meta.component ?? field.component ?? this.mapTypeToComponent(field.type);
    const dataset = `data-field="${this.escapeHtml(field.path)}" data-component="${component ?? ''}" data-type="${field.type}"`;
    const disabled = meta.readonly ? 'disabled' : '';
    const placeholder = this.escapeHtml(meta.placeholder ?? '');

    const normalizeOptions = (options = []) => options.map(opt => {
      if (typeof opt === 'object') return opt;
      return { label: opt, value: opt };
    });

    const lowerComponent = (component ?? '').toLowerCase();
    const isArrayObject = field.type === 'array<object>' || (lowerComponent === 'arrayform' && meta.itemType === 'object');
    if (isArrayObject) {
      const arrayValue = Array.isArray(value) ? value : (this.getNestedValue(this._configState?.rawObject ?? {}, field.path) ?? []);
      return this.renderArrayObjectControl(field, arrayValue, meta);
    }

    switch (lowerComponent) {
      case 'switch':
        return `
          <label class="config-switch">
            <input type="checkbox" id="${inputId}" ${dataset} ${value ? 'checked' : ''} ${disabled}>
            <span class="config-switch-slider"></span>
          </label>
        `;
      case 'select': {
        const opts = normalizeOptions(meta.enum ?? meta.options ?? []);
        const current = value ?? '';
        return `
          <select class="form-input" id="${inputId}" ${dataset} ${disabled}>
            ${opts.map(opt => `<option value="${this.escapeHtml(opt.value)}" ${String(opt.value) === String(current) ? 'selected' : ''}>${this.escapeHtml(opt.label)}</option>`).join('')}
          </select>
        `;
      }
      case 'multiselect': {
        const opts = normalizeOptions(meta.enum ?? meta.options ?? []);
        const current = Array.isArray(value) ? value.map(v => String(v)) : [];
        return `
          <select class="form-input" id="${inputId}" multiple ${dataset} data-control="multiselect" ${disabled}>
            ${opts.map(opt => `<option value="${this.escapeHtml(opt.value)}" ${current.includes(String(opt.value)) ? 'selected' : ''}>${this.escapeHtml(opt.label)}</option>`).join('')}
          </select>
          <p class="config-field-hint">按住 Ctrl/Command 多选</p>
        `;
      }
      case 'tags': {
        const text = this.escapeHtml(Array.isArray(value) ? value.join('\n') : (value ?? ''));
        return `
          <textarea class="form-input" rows="3" id="${inputId}" ${dataset} data-control="tags" placeholder="每行一个值" ${disabled}>${text}</textarea>
          <p class="config-field-hint">将文本拆分为数组</p>
        `;
      }
      case 'textarea':
      case 'text-area':
        return `<textarea class="form-input" rows="3" id="${inputId}" ${dataset} placeholder="${placeholder}" ${disabled}>${this.escapeHtml(value ?? '')}</textarea>`;
      case 'inputnumber':
      case 'number':
        return `<input type="number" class="form-input" id="${inputId}" ${dataset} value="${this.escapeHtml(value ?? '')}" min="${meta.min ?? ''}" max="${meta.max ?? ''}" step="${meta.step ?? 'any'}" placeholder="${placeholder}" ${disabled}>`;
      case 'inputpassword':
        return `<input type="password" class="form-input" id="${inputId}" ${dataset} value="${this.escapeHtml(value ?? '')}" placeholder="${placeholder}" ${disabled}>`;
      case 'subform': {
        // SubForm 类型：如果没有子字段，使用 JSON 编辑器
        // 注意：有子字段的 SubForm 会在 renderFieldTree 中展开显示，不会调用此函数
        return `
          <textarea class="form-input" rows="4" id="${inputId}" ${dataset} data-control="json" placeholder="JSON 数据" ${disabled}>${value ? this.escapeHtml(JSON.stringify(value, null, 2)) : ''}</textarea>
          <p class="config-field-hint">以 JSON 形式编辑该字段</p>
        `;
      }
      case 'arrayform':
      case 'json':
        return `
          <textarea class="form-input" rows="4" id="${inputId}" ${dataset} data-control="json" placeholder="JSON 数据" ${disabled}>${value ? this.escapeHtml(JSON.stringify(value, null, 2)) : ''}</textarea>
          <p class="config-field-hint">以 JSON 形式编辑该字段</p>
        `;
      default:
        return `<input type="text" class="form-input" id="${inputId}" ${dataset} value="${this.escapeHtml(value ?? '')}" placeholder="${placeholder}" ${disabled}>`;
    }
  }

  renderConfigJsonPanel() {
    return `
      <div class="config-json-panel">
        <textarea id="configJsonTextarea" rows="20">${this.escapeHtml(this._configState?.jsonText ?? '')}</textarea>
        <div class="config-json-actions">
          <button class="btn btn-secondary" id="configJsonFormatBtn">格式化</button>
          <p class="config-field-hint">JSON 模式会覆盖整份配置，提交前请仔细校验。</p>
        </div>
      </div>
    `;
  }

  renderArrayObjectControl(field, items = [], meta = {}) {
    const subFields = this._configState.arraySchemaMap[field.path] ?? meta.itemSchema?.fields ?? meta.fields ?? {};
    const itemLabel = meta.itemLabel ?? '条目';
    const fullItems = Array.isArray(items) && items.length > 0 ? items : 
      (this.getNestedValue(this._configState?.rawObject ?? {}, field.path) ?? []);
    const body = fullItems.length
      ? fullItems.map((item, idx) => this.renderArrayObjectItem(field.path, subFields, item ?? {}, idx, itemLabel)).join('')
      : `<div class="config-field-hint">暂无${this.escapeHtml(itemLabel)}，点击下方按钮新增。</div>`;

    return `
      <div class="array-object" data-array-wrapper="${this.escapeHtml(field.path)}">
        ${body}
        <button type="button" class="btn btn-secondary array-object-add" data-action="array-add" data-field="${this.escapeHtml(field.path)}">
          新增${this.escapeHtml(itemLabel)}
        </button>
      </div>
    `;
  }

  renderArrayObjectItem(parentPath, subFields, item, index, itemLabel) {
    return `
      <div class="array-object-card" data-array-card="${this.escapeHtml(parentPath)}" data-index="${index}">
        <div class="array-object-card-header">
          <span>${this.escapeHtml(itemLabel)} #${index + 1}</span>
          <div class="array-object-actions">
            <button type="button" class="btn btn-sm btn-secondary array-object-remove" data-action="array-remove" data-field="${this.escapeHtml(parentPath)}" data-index="${index}">删除</button>
          </div>
        </div>
        <div class="array-object-card-body">
          ${this.renderArrayObjectFields(parentPath, subFields, item, index)}
        </div>
      </div>
    `;
  }

  renderArrayObjectFields(parentPath, fields, itemValue, index, basePath = '') {
    return Object.entries(fields ?? {}).map(([key, schema]) => {
      const relPath = basePath ? `${basePath}.${key}` : key;
      const templatePath = `${parentPath}[].${relPath}`;
      
      // 优先从rawObject获取完整数据，确保嵌套对象（如SSL证书）正确显示
      const fullPath = `${parentPath}.${index}.${relPath}`;
      const rawValue = this.getNestedValue(this._configState?.rawObject ?? {}, fullPath);
      const value = rawValue !== undefined ? rawValue : this.getNestedValue(itemValue, relPath);
      
      const component = (schema.component ?? '').toLowerCase();
      const isSubForm = component === 'subform';
      const isNestedObject = (schema.type === 'object' || schema.type === 'map') && schema.fields;
      
      // SubForm 类型或嵌套对象类型：展开显示子字段
      if ((isSubForm || isNestedObject) && schema.fields) {
        // 对于嵌套对象，也需要从rawObject获取完整数据
        const nestedRawValue = this.getNestedValue(this._configState?.rawObject ?? {}, fullPath);
        const nestedValue = nestedRawValue !== undefined ? nestedRawValue : (value ?? {});
        return `
          <div class="array-object-subgroup">
            <div class="array-object-subgroup-title">${this.escapeHtml(schema.label || key)}</div>
            ${schema.description ? `<p class="config-field-hint">${this.escapeHtml(schema.description)}</p>` : ''}
            ${this.renderArrayObjectFields(parentPath, schema.fields, nestedValue, index, relPath)}
          </div>
        `;
      }

      return `
        <div class="array-object-field">
          <label>${this.escapeHtml(schema.label || key)}</label>
          ${schema.description ? `<p class="config-field-hint">${this.escapeHtml(schema.description)}</p>` : ''}
          ${this.renderArrayObjectFieldControl(parentPath, relPath, templatePath, schema, value, index)}
        </div>
      `;
    }).join('');
  }

  renderArrayObjectFieldControl(parentPath, relPath, templatePath, schema, value, index) {
    const component = (schema.component ?? this.mapTypeToComponent(schema.type) ?? '').toLowerCase();
    const dataset = `data-array-parent="${this.escapeHtml(parentPath)}" data-array-index="${index}" data-object-path="${this.escapeHtml(relPath)}" data-template-path="${this.escapeHtml(templatePath)}" data-component="${component}" data-type="${schema.type}"`;

    const normalizeOptions = (options = []) => options.map(opt => (typeof opt === 'object' ? opt : { label: opt, value: opt }));

    switch (component) {
      case 'switch':
        return `
          <label class="config-switch">
            <input type="checkbox" ${dataset} ${value ? 'checked' : ''}>
            <span class="config-switch-slider"></span>
          </label>
        `;
      case 'select': {
        const opts = normalizeOptions(schema.enum ?? schema.options ?? []);
        const current = value ?? '';
        return `
          <select class="form-input" ${dataset}>
            ${opts.map(opt => `<option value="${this.escapeHtml(opt.value)}" ${String(opt.value) === String(current) ? 'selected' : ''}>${this.escapeHtml(opt.label)}</option>`).join('')}
          </select>
        `;
      }
      case 'multiselect': {
        const opts = normalizeOptions(schema.enum ?? schema.options ?? []);
        const current = Array.isArray(value) ? value.map(v => String(v)) : [];
        return `
          <select class="form-input" multiple ${dataset} data-control="multiselect">
            ${opts.map(opt => `<option value="${this.escapeHtml(opt.value)}" ${current.includes(String(opt.value)) ? 'selected' : ''}>${this.escapeHtml(opt.label)}</option>`).join('')}
          </select>
        `;
      }
      case 'tags': {
        const text = this.escapeHtml(Array.isArray(value) ? value.join('\n') : (value ?? ''));
        return `<textarea class="form-input" rows="3" ${dataset} data-control="tags" placeholder="每行一个值">${text}</textarea>`;
      }
      case 'textarea':
      case 'text-area':
        return `<textarea class="form-input" rows="3" ${dataset}>${this.escapeHtml(value ?? '')}</textarea>`;
      case 'inputnumber':
      case 'number':
        return `<input type="number" class="form-input" ${dataset} value="${this.escapeHtml(value ?? '')}" min="${schema.min ?? ''}" max="${schema.max ?? ''}" step="${schema.step ?? 'any'}">`;
      case 'inputpassword':
        return `<input type="password" class="form-input" ${dataset} value="${this.escapeHtml(value ?? '')}">`;
      case 'json':
        return `<textarea class="form-input" rows="4" ${dataset} data-control="json">${value ? this.escapeHtml(JSON.stringify(value, null, 2)) : ''}</textarea>`;
      default:
        if (schema.type === 'array' || schema.type === 'object') {
          return `<textarea class="form-input" rows="4" ${dataset} data-control="json">${value ? this.escapeHtml(JSON.stringify(value, null, 2)) : ''}</textarea>`;
        }
        return `<input type="text" class="form-input" ${dataset} value="${this.escapeHtml(value ?? '')}">`;
    }
  }

  renderDynamicCollections() {
    const collections = this._configState?.dynamicCollectionsMeta ?? [];
    if (!collections.length) return '';
    return `
      <div class="dynamic-collections">
        ${collections.map(col => this.renderDynamicCollectionBlock(col)).join('')}
      </div>
    `;
  }

  renderDynamicCollectionBlock(collection) {
    const entries = this.getDynamicCollectionEntries(collection);
    const cards = entries.length
      ? entries.map(entry => this.renderDynamicEntryCard(collection, entry)).join('')
      : '<div class="config-field-hint">暂无配置，点击上方按钮新增。</div>';

    return `
      <div class="config-group">
        <div class="config-group-header">
          <div>
            <h3>${this.escapeHtml(collection.label ?? collection.name)}</h3>
            <p>${this.escapeHtml(collection.description ?? '')}</p>
          </div>
          <button type="button" class="btn btn-secondary" data-action="collection-add" data-collection="${this.escapeHtml(collection.name)}">
            新增${this.escapeHtml(collection.keyLabel || '项')}
          </button>
        </div>
        <div class="dynamic-collection-list">
          ${cards}
        </div>
        <p class="config-field-hint">如需删除既有条目，可切换 JSON 模式手动移除。</p>
      </div>
    `;
  }

  renderDynamicEntryCard(collection, entry) {
    return `
      <div class="dynamic-entry-card" data-collection-card="${this.escapeHtml(collection.name)}" data-entry-key="${this.escapeHtml(entry.key)}">
        <div class="array-object-card-header">
          <span>${this.escapeHtml(collection.keyLabel || '键')}：${this.escapeHtml(entry.key)}</span>
        </div>
        <div class="array-object-card-body">
          ${this.renderDynamicFields(collection, collection.valueFields ?? {}, entry.value ?? {}, entry.key)}
        </div>
      </div>
    `;
  }

  getDynamicCollectionEntries(collection) {
    const source = this.getNestedValue(this._configState?.rawObject ?? {}, collection.basePath ?? '');
    const exclude = new Set(collection.excludeKeys ?? []);
    return Object.entries(source ?? {})
      .filter(([key]) => !exclude.has(key))
      .map(([key, value]) => ({ key, value }));
  }

  renderDynamicFields(collection, fields, value, entryKey, basePath = '') {
    return Object.entries(fields ?? {}).map(([key, schema]) => {
      const relPath = basePath ? `${basePath}.${key}` : key;
      const templatePathBase = collection.valueTemplatePath ?? '';
      const templatePath = this.normalizeTemplatePath(templatePathBase ? `${templatePathBase}.${relPath}` : relPath);
      const fieldValue = this.getNestedValue(value, relPath);

      if ((schema.type === 'object' || schema.type === 'map') && schema.fields) {
        return `
          <div class="array-object-subgroup">
            <div class="array-object-subgroup-title">${this.escapeHtml(schema.label || key)}</div>
            ${this.renderDynamicFields(collection, schema.fields, fieldValue ?? {}, entryKey, relPath)}
          </div>
        `;
      }

      const dataset = `data-collection="${this.escapeHtml(collection.name)}" data-entry-key="${this.escapeHtml(entryKey)}" data-object-path="${this.escapeHtml(relPath)}" data-template-path="${this.escapeHtml(templatePath)}" data-component="${(schema.component ?? '').toLowerCase()}" data-type="${schema.type}"`;
      return `
        <div class="array-object-field">
          <label>${this.escapeHtml(schema.label || key)}</label>
          ${schema.description ? `<p class="config-field-hint">${this.escapeHtml(schema.description)}</p>` : ''}
          ${this.renderDynamicFieldControl(dataset, schema, fieldValue)}
        </div>
      `;
    }).join('');
  }

  renderDynamicFieldControl(dataset, schema, value) {
    const component = (schema.component ?? this.mapTypeToComponent(schema.type) ?? '').toLowerCase();
    const normalizeOptions = (options = []) => options.map(opt => (typeof opt === 'object' ? opt : { label: opt, value: opt }));

    switch (component) {
      case 'switch':
        return `
          <label class="config-switch">
            <input type="checkbox" ${dataset} ${value ? 'checked' : ''}>
            <span class="config-switch-slider"></span>
          </label>
        `;
      case 'select': {
        const opts = normalizeOptions(schema.enum ?? schema.options ?? []);
        const current = value ?? '';
        return `
          <select class="form-input" ${dataset}>
            ${opts.map(opt => `<option value="${this.escapeHtml(opt.value)}" ${String(opt.value) === String(current) ? 'selected' : ''}>${this.escapeHtml(opt.label)}</option>`).join('')}
          </select>
        `;
      }
      case 'multiselect': {
        const opts = normalizeOptions(schema.enum ?? schema.options ?? []);
        const current = Array.isArray(value) ? value.map(v => String(v)) : [];
        return `
          <select class="form-input" multiple ${dataset} data-control="multiselect">
            ${opts.map(opt => `<option value="${this.escapeHtml(opt.value)}" ${current.includes(String(opt.value)) ? 'selected' : ''}>${this.escapeHtml(opt.label)}</option>`).join('')}
          </select>
        `;
      }
      case 'tags': {
        const text = this.escapeHtml(Array.isArray(value) ? value.join('\n') : (value ?? ''));
        return `<textarea class="form-input" rows="3" ${dataset} data-control="tags">${text}</textarea>`;
      }
      case 'textarea':
      case 'text-area':
        return `<textarea class="form-input" rows="3" ${dataset}>${this.escapeHtml(value ?? '')}</textarea>`;
      case 'inputnumber':
      case 'number':
        return `<input type="number" class="form-input" ${dataset} value="${this.escapeHtml(value ?? '')}" min="${schema.min ?? ''}" max="${schema.max ?? ''}" step="${schema.step ?? 'any'}">`;
      case 'inputpassword':
        return `<input type="password" class="form-input" ${dataset} value="${this.escapeHtml(value ?? '')}">`;
      case 'json':
        return `<textarea class="form-input" rows="4" ${dataset} data-control="json">${value ? this.escapeHtml(JSON.stringify(value, null, 2)) : ''}</textarea>`;
      default:
        if (schema.type === 'array' || schema.type === 'object') {
          return `<textarea class="form-input" rows="4" ${dataset} data-control="json">${value ? this.escapeHtml(JSON.stringify(value, null, 2)) : ''}</textarea>`;
        }
        return `<input type="text" class="form-input" ${dataset} value="${this.escapeHtml(value ?? '')}">`;
    }
  }

  bindConfigFieldEvents() {
    if (this._configState?.mode !== 'form') return;
    const wrapper = document.getElementById('configFormWrapper');
    if (!wrapper) return;
    wrapper.querySelectorAll('[data-field]').forEach(el => {
      // 对于checkbox使用change事件，其他使用input事件（input事件会在每次输入时触发，change只在失去焦点时触发）
      const evt = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(evt, () => this.handleConfigFieldChange(el));
    });
  }

  bindConfigJsonEvents() {
    if (this._configState?.mode !== 'json') return;
    const textarea = document.getElementById('configJsonTextarea');
    if (textarea) {
      textarea.addEventListener('input', () => {
        if (!this._configState) return;
        this._configState.jsonDirty = true;
        this._configState.pendingJson = textarea.value;
        this.updateConfigSaveButton();
      });
    }
    document.getElementById('configJsonFormatBtn')?.addEventListener('click', () => this.formatConfigJson());
  }

  formatConfigJson() {
    const textarea = document.getElementById('configJsonTextarea');
    if (!textarea) return;
    try {
      const parsed = JSON.parse(textarea.value || '{}');
      const formatted = JSON.stringify(parsed, null, 2);
      textarea.value = formatted;
      if (this._configState) {
        this._configState.pendingJson = formatted;
        this._configState.jsonDirty = true;
        this.updateConfigSaveButton();
      }
      this.showToast('JSON 已格式化', 'success');
    } catch (e) {
      this.showToast('JSON 格式错误: ' + e.message, 'error');
    }
  }

  bindArrayObjectEvents() {
    if (this._configState?.mode !== 'form') return;
    const wrapper = document.getElementById('configFormWrapper');
    if (!wrapper) return;

    wrapper.querySelectorAll('[data-array-parent]').forEach(el => {
      const evt = el.type === 'checkbox' ? 'change' : (el.tagName === 'SELECT' ? 'change' : 'input');
      el.addEventListener(evt, () => this.handleArrayObjectFieldChange(el));
    });

    wrapper.querySelectorAll('[data-action="array-add"]').forEach(btn => {
      btn.addEventListener('click', () => this.addArrayObjectItem(btn.dataset.field));
    });

    wrapper.querySelectorAll('[data-action="array-remove"]').forEach(btn => {
      btn.addEventListener('click', () => this.removeArrayObjectItem(btn.dataset.field, parseInt(btn.dataset.index, 10)));
    });
  }

  handleArrayObjectFieldChange(target) {
    if (!this._configState) return;
    const parentPath = target.dataset.arrayParent;
    const index = parseInt(target.dataset.arrayIndex, 10);
    const objectPath = target.dataset.objectPath;
    const templatePath = this.normalizeTemplatePath(target.dataset.templatePath ?? '');
    const fieldDef = this.getFlatFieldDefinition(templatePath) ?? {};
    const meta = fieldDef.meta ?? {};
    const type = fieldDef.type ?? target.dataset.type ?? '';
    const component = (target.dataset.component ?? '').toLowerCase();

    let value;
    if (component === 'switch') {
      value = !!target.checked;
    } else if (target.dataset.control === 'tags') {
      value = target.value.split(/\n+/).map(v => v.trim()).filter(Boolean);
    } else if (target.dataset.control === 'multiselect') {
      value = Array.from(target.selectedOptions).map(opt => this.castValue(opt.value, meta.itemType || 'string'));
    } else if (target.dataset.control === 'json') {
      try {
        value = target.value ? JSON.parse(target.value) : null;
      } catch (e) {
        this.showToast('JSON 解析失败: ' + e.message, 'error');
        return;
      }
    } else if (component === 'inputnumber' || type === 'number') {
      value = target.value === '' ? null : Number(target.value);
    } else {
      value = target.value;
    }

    value = this.normalizeFieldValue(value, meta, type);
    this.updateArrayObjectValue(parentPath, index, objectPath, value);
  }

  // 获取配置数组的辅助函数，减少重复代码
  _getConfigArray(path) {
    if (!this._configState) return [];
    const rawArray = this.getNestedValue(this._configState.rawObject ?? {}, path);
    if (Array.isArray(rawArray)) return this._cloneValue(rawArray);
    const valueArray = this._configState.values[path];
    return Array.isArray(valueArray) ? this._cloneValue(valueArray) : [];
  }

  addArrayObjectItem(path) {
    if (!this._configState) return;
    const subFields = this._configState.arraySchemaMap[path] ?? {};
    const template = this.buildDefaultsFromFields(subFields);
    const list = this._getConfigArray(path);
    list.push(template);
    this.setConfigFieldValue(path, list);
    this.renderConfigFormPanel();
  }

  removeArrayObjectItem(path, index) {
    if (!this._configState) return;
    const list = this._getConfigArray(path);
    list.splice(index, 1);
    this.setConfigFieldValue(path, list);
    this.renderConfigFormPanel();
  }

  updateArrayObjectValue(path, index, objectPath, value) {
    if (!this._configState) return;
    const currentArray = this._getConfigArray(path);
    
    if (!currentArray[index] || typeof currentArray[index] !== 'object') {
      currentArray[index] = {};
    }
    
    const currentItem = this._cloneValue(currentArray[index]);
    const updated = this.setNestedValue(currentItem, objectPath, value);
    currentArray[index] = updated;
    
    this.setConfigFieldValue(path, this._cloneValue(currentArray));
    this.updateConfigSaveButton();
  }

  bindDynamicCollectionEvents() {
    if (this._configState?.mode !== 'form') return;
    const wrapper = document.getElementById('configMain');
    if (!wrapper) return;

    wrapper.querySelectorAll('[data-action="collection-add"]').forEach(btn => {
      btn.addEventListener('click', () => this.addDynamicCollectionEntry(btn.dataset.collection));
    });

    wrapper.querySelectorAll('[data-collection]').forEach(el => {
      const evt = el.type === 'checkbox' ? 'change' : (el.tagName === 'SELECT' ? 'change' : 'input');
      el.addEventListener(evt, () => this.handleDynamicFieldChange(el));
    });
  }

  async showPromptDialog(message) {
    return new Promise(resolve => {
      const id = 'xrkPromptDialog';
      let modal = document.getElementById(id);
      if (!modal) {
        modal = document.createElement('div');
        modal.id = id;
        modal.className = 'xrk-prompt-modal';
        modal.innerHTML = `
          <div class="xrk-prompt-backdrop"></div>
          <div class="xrk-prompt-dialog">
            <div class="xrk-prompt-message"></div>
            <input class="xrk-prompt-input" type="text" />
            <div class="xrk-prompt-actions">
              <button type="button" class="xrk-prompt-cancel">取消</button>
              <button type="button" class="xrk-prompt-ok">确定</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
      }

      const backdrop = modal.querySelector('.xrk-prompt-backdrop');
      const msgEl = modal.querySelector('.xrk-prompt-message');
      const input = modal.querySelector('.xrk-prompt-input');
      const okBtn = modal.querySelector('.xrk-prompt-ok');
      const cancelBtn = modal.querySelector('.xrk-prompt-cancel');

      const cleanup = (value) => {
        modal.style.display = 'none';
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onCancel);
        input.removeEventListener('keydown', onKeydown);
        resolve(value);
      };

      const onOk = () => cleanup(input.value);
      const onCancel = () => cleanup(null);
      const onKeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOk();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      };

      msgEl.textContent = message ?? '';
      input.value = '';
      modal.style.display = 'flex';
      input.focus();

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      backdrop.addEventListener('click', onCancel);
      input.addEventListener('keydown', onKeydown);
    });
  }

  async addDynamicCollectionEntry(collectionName) {
    if (!this._configState) return;
    const collection = this._configState.dynamicCollectionsMeta.find(col => col.name === collectionName);
    if (!collection) return;

    const key = (await this.showPromptDialog(collection.keyPlaceholder || '请输入键'))?.trim();
    if (!key) return;
    const existing = this.getNestedValue(this._configState.rawObject ?? {}, collection.basePath ?? '');
    if (existing && Object.hasOwn(existing, key)) {
      this.showToast('该键已存在', 'warning');
      return;
    }
    const defaults = this.buildDefaultsFromFields(collection.valueFields);
    const prefix = this.combinePath(collection.basePath ?? '', key);
    Object.entries(defaults).forEach(([fieldKey, fieldValue]) => {
      const fullPath = this.combinePath(prefix, fieldKey);
      this.setConfigFieldValue(fullPath, fieldValue);
    });
    this.renderConfigFormPanel();
  }

  handleDynamicFieldChange(target) {
    if (!this._configState) return;
    const collectionName = target.dataset.collection;
    const key = target.dataset.entryKey;
    const objectPath = target.dataset.objectPath;
    const templatePath = this.normalizeTemplatePath(target.dataset.templatePath || '');
    const collection = this._configState.dynamicCollectionsMeta.find(col => col.name === collectionName);
    if (!collection) return;

    const fieldDef = this.getFlatFieldDefinition(templatePath) || {};
    const meta = fieldDef.meta || {};
    const type = fieldDef.type || target.dataset.type || '';
    const component = (target.dataset.component || '').toLowerCase();

    let value;
    if (component === 'switch') {
      value = !!target.checked;
    } else if (target.dataset.control === 'tags') {
      value = target.value.split(/\n+/).map(v => v.trim()).filter(Boolean);
    } else if (target.dataset.control === 'multiselect') {
      value = Array.from(target.selectedOptions).map(opt => this.castValue(opt.value, meta.itemType || 'string'));
    } else if (target.dataset.control === 'json') {
      try {
        value = target.value ? JSON.parse(target.value) : null;
      } catch (e) {
        this.showToast('JSON 解析失败: ' + e.message, 'error');
        return;
      }
    } else if (component === 'inputnumber' || type === 'number') {
      value = target.value === '' ? null : Number(target.value);
      } else {
      value = target.value;
    }

    value = this.normalizeFieldValue(value, meta, type);
    const prefix = this.combinePath(collection.basePath ?? '', key);
    const fullPath = this.combinePath(prefix, objectPath);
    this.setConfigFieldValue(fullPath, value);
  }

  handleConfigFieldChange(target) {
    if (!this._configState) return;
    const path = target.dataset.field;
    const component = (target.dataset.component || '').toLowerCase();
    const fieldDef = this.getFlatFieldDefinition(path);
    const meta = fieldDef?.meta ?? {};
    const type = fieldDef?.type ?? target.dataset.type ?? '';

    let value;
    if (component === 'switch') {
      value = !!target.checked;
    } else if (target.dataset.control === 'tags') {
      value = target.value.split(/\n+/).map(v => v.trim()).filter(Boolean);
    } else if (target.dataset.control === 'multiselect') {
      value = Array.from(target.selectedOptions).map(opt => this.castValue(opt.value, meta.itemType || 'string'));
    } else if (target.dataset.control === 'json') {
      try {
        value = target.value ? JSON.parse(target.value) : null;
      } catch (e) {
        this.showToast('JSON 解析失败: ' + e.message, 'error');
        return;
      }
    } else if (component === 'inputnumber' || type === 'number') {
      value = target.value === '' ? null : Number(target.value);
    } else {
      value = target.value;
    }

    value = this.normalizeFieldValue(value, meta, type);
    this.setConfigFieldValue(path, value);
    this.updateConfigSaveButton();
  }

  setConfigFieldValue(path, value) {
    if (!this._configState) return;
    this._configState.values[path] = value;
    this._configState.rawObject = this.unflattenObject(this._configState.values);
    this._configState.jsonText = JSON.stringify(this._configState.rawObject, null, 2);
    this.updateDirtyState(path, value);
    this.refreshConfigFieldUI(path);
  }

  refreshConfigFieldUI(path) {
    const fieldEl = document.querySelector(`[data-field="${this.escapeSelector(path)}"]`);
    if (!fieldEl || !this._configState) return;
    const wrapper = fieldEl.closest('.config-field');
    if (!wrapper) return;
    if (this._configState.dirty[path]) wrapper.classList.add('config-field-dirty');
    else wrapper.classList.remove('config-field-dirty');
  }

  updateDirtyState(path, value) {
    if (!this._configState) return;
    const origin = this._cloneValue(this._configState.original[path]);
    const valueClone = this._cloneValue(value);
    const isSame = this.isSameValue(origin, valueClone);
    if (isSame) {
      delete this._configState.dirty[path];
    } else {
      this._configState.dirty[path] = true;
    }
  }

  updateConfigSaveButton() {
    const btn = document.getElementById('configSaveBtn');
    if (!btn || !this._configState) return;
    const dirtyCount = Object.keys(this._configState.dirty).length;
    const isDisabled = this._configState.mode === 'form' ? dirtyCount === 0 : !this._configState.jsonDirty;
    btn.disabled = isDisabled;
    btn.textContent = this._configState.mode === 'form' 
      ? (dirtyCount ? `保存（${dirtyCount}）` : '保存')
      : '保存（JSON）';
  }

  switchConfigMode(mode) {
    if (!this._configState || this._configState.mode === mode) return;
    this._configState.mode = mode;
    if (mode === 'json') {
      this._configState.pendingJson = this._configState.jsonText;
      this._configState.jsonDirty = false;
    }
    this.renderConfigFormPanel();
  }

  async saveConfigChanges() {
    if (!this._configState) return;
    if (this._configState.mode === 'json') {
      await this.saveConfigJson();
    } else {
      await this.saveConfigForm();
    }
  }

  async saveConfigForm() {
    if (!this._configState) return;
    const dirtyKeys = Object.keys(this._configState.dirty);
    if (!dirtyKeys.length) return;

    const flat = {};
    dirtyKeys.forEach(key => {
      flat[key] = this._configState.values[key];
    });

    try {
      await this.postBatchSet(flat);
      dirtyKeys.forEach(key => {
        this._configState.original[key] = this._cloneValue(this._configState.values[key]);
      });
      this._configState.dirty = {};
      this.showToast('配置已保存', 'success');
      this.loadSelectedConfigDetail();
    } catch (e) {
      this.showToast('保存失败: ' + e.message, 'error');
    }
  }

  async saveConfigJson() {
    if (!this._configState) return;
    const textarea = document.getElementById('configJsonTextarea');
    if (!textarea) return;
    try {
      const parsed = JSON.parse(textarea.value || '{}');
      const flat = this.flattenObject(parsed);
      await this.postBatchSet(flat);
      this.showToast('配置已保存', 'success');
      this._configState.mode = 'form';
      this.loadSelectedConfigDetail();
    } catch (e) {
      this.showToast('保存失败: ' + e.message, 'error');
    }
  }

  async postBatchSet(flat) {
    if (!this._configState?.selected) throw new Error('未选择配置');
    if (!Object.keys(flat ?? {}).length) throw new Error('未检测到改动');
    const { name } = this._configState.selected;
    const body = { flat, backup: true, validate: true };
    if (this._configState.selectedChild) body.path = this._configState.selectedChild;
    const res = await fetch(`${this.serverUrl}/api/config/${name}/batch-set`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body)
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.message || '批量写入失败');
    }
  }

  mapTypeToComponent(type) {
    switch ((type ?? '').toLowerCase()) {
      case 'boolean': return 'Switch';
      case 'number': return 'InputNumber';
      default: return 'Input';
    }
  }

  formatGroupLabel(label) {
    if (!label || label === '基础') return '基础设置';
    return label.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }

  normalizeFieldValue(value, meta, typeHint) {
    const type = (meta.type ?? typeHint ?? '').toLowerCase();
    if (type === 'number') return value === null || value === '' ? null : Number(value);
    if (type === 'boolean') {
      if (typeof value === 'string') {
        const normalized = value.toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
      }
      return !!value;
    }
    if (type === 'array<object>' || (type === 'array' && meta.itemType === 'object')) return Array.isArray(value) ? value : [];
    if (type === 'array' && Array.isArray(value)) return value;
    if (type === 'array' && typeof value === 'string') return value ? value.split(',').map(v => v.trim()).filter(Boolean) : [];
    return value;
  }

  castValue(value, type) {
    switch ((type ?? '').toLowerCase()) {
      case 'number': return Number(value);
      case 'boolean': return value === 'true' || value === true;
      default: return value;
    }
  }

  getFlatFieldDefinition(path) {
    if (!this._configState?.flatSchema) return null;
    const exact = this._configState.flatSchema.find(field => field.path === path);
    if (exact) return exact;
    const normalized = this.normalizeTemplatePath(path);
    return this._configState.flatSchema.find(field => this.normalizeTemplatePath(field.path) === normalized);
  }


  normalizeTemplatePath(path = '') {
    return path.replace(/\[\d+\]/g, '[]');
  }

  buildDefaultsFromFields(fields = {}) {
    const result = {};
    Object.entries(fields).forEach(([key, schema]) => {
      if (schema.type === 'object' && schema.fields) {
        result[key] = this.buildDefaultsFromFields(schema.fields);
      } else if (schema.type === 'array') {
        if (schema.itemType === 'object') {
          result[key] = [];
        } else {
          result[key] = Array.isArray(schema.default) ? [...schema.default] : [];
        }
      } else if (Object.hasOwn(schema, 'default')) {
        result[key] = this._cloneValue(schema.default);
      } else {
        result[key] = schema.type === 'number' ? 0 : schema.type === 'boolean' ? false : '';
      }
    });
    return result;
  }

  getNestedValue(obj = {}, path = '') {
    if (!path) return obj;
    return path.split('.').reduce((current, key) => (current ? current[key] : undefined), obj);
  }

  setNestedValue(source = {}, path = '', value) {
    if (!path) return this._cloneValue(value);
    const clone = Array.isArray(source) ? [...source] : { ...source };
    const keys = path.split('.');
    let cursor = clone;
    keys.forEach((key, idx) => {
      if (idx === keys.length - 1) {
        cursor[key] = this._cloneValue(value);
      } else {
        if (!cursor[key] || typeof cursor[key] !== 'object') {
          cursor[key] = {};
        }
        cursor = cursor[key];
      }
    });
    return clone;
  }

  combinePath(base, tail) {
    if (!base) return tail;
    if (!tail) return base;
    return `${base}.${tail}`;
  }

  flattenObject(obj, prefix = '', out = {}) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      Object.entries(obj).forEach(([key, val]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          this.flattenObject(val, path, out);
        } else {
          out[path] = val;
        }
      });
      return out;
    }
    if (prefix) out[prefix] = obj;
    return out;
  }

  unflattenObject(flat = {}) {
    const result = {};
    Object.entries(flat).forEach(([path, value]) => {
      const keys = path.split('.');
      let cursor = result;
      keys.forEach((key, idx) => {
        if (idx === keys.length - 1) {
          cursor[key] = this._cloneValue(value);
        } else {
          if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
          cursor = cursor[key];
        }
      });
    });
    return result;
  }

  isSameValue(a, b) {
    // 处理 null 和 undefined
    if (a === null || a === undefined || b === null || b === undefined) {
      return a === b;
    }
    // 处理对象和数组
    if (typeof a === 'object' || typeof b === 'object') {
      // 如果一个是数组另一个不是，直接返回 false
      if (Array.isArray(a) !== Array.isArray(b)) {
        return false;
      }
      try {
      return JSON.stringify(a) === JSON.stringify(b);
      } catch (e) {
        // JSON.stringify 失败时（如循环引用），使用严格相等
        console.warn('isSameValue JSON.stringify 失败:', e);
        return a === b;
      }
    }
    return a === b;
  }

  _cloneFlat(data) {
    const clone = {};
    Object.entries(data ?? {}).forEach(([k, v]) => {
      clone[k] = this._cloneValue(v);
    });
    return clone;
  }

  _cloneValue(value) {
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      return JSON.parse(JSON.stringify(value));
    }
    return value;
  }

  escapeSelector(value = '') {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return value.replace(/"/g, '\\"');
  }

  escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ========== API 调试 ==========
  renderAPI() {
    const content = document.getElementById('content');
    if (!content) return;
    
    content.innerHTML = `
      <div class="api-container">
        <div class="api-header-section" id="apiWelcome">
          <h1 class="api-header-title">API 调试中心</h1>
          <p class="api-header-subtitle">在左侧侧边栏选择 API 开始测试</p>
        </div>
        <div id="apiTestSection" style="display:none"></div>
      </div>
    `;
  }

  renderAPIGroups() {
    const container = document.getElementById('apiGroups');
    if (!container || !this.apiConfig) return;
    
    container.innerHTML = this.apiConfig.apiGroups.map(group => `
      <div class="api-group">
        <div class="api-group-title">${group.title}</div>
        ${group.apis.map(api => `
          <div class="api-item" data-id="${api.id}">
            <span class="method-tag method-${api.method.toLowerCase()}">${api.method}</span>
            <span>${api.title}</span>
          </div>
        `).join('')}
      </div>
    `).join('');
    
    // 事件委托：避免为每个 API 条目重复绑定监听器
    container.onclick = (e) => {
      const item = e.target?.closest?.('.api-item');
      if (!item || !container.contains(item)) return;
        container.querySelectorAll('.api-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        this.selectAPI(item.dataset.id);
    };
  }

  selectAPI(apiId) {
    const api = this.findAPIById(apiId);
    if (!api) {
      this.showToast('API 不存在', 'error');
      return;
    }
    
    this.currentAPI = { method: api.method, path: api.path, apiId };
    this._lastJsonPreview = null;
    
    // 在移动端，选择API后关闭侧边栏
    if (window.innerWidth <= 768) {
      this.closeSidebar();
    }
    
    const welcome = document.getElementById('apiWelcome');
    const section = document.getElementById('apiTestSection');
    
    if (!welcome || !section) {
      console.error('API页面元素不存在');
      return;
    }
    
    welcome.style.display = 'none';
    section.style.display = 'block';
    
    const pathParams = (api.path.match(/:(\w+)/g) ?? []).map(p => p.slice(1));
    
    let paramsHTML = '';
    
    // 路径参数
    if (pathParams.length && api.pathParams) {
      paramsHTML += `<div class="api-form-section">
        <h3 class="api-form-section-title">路径参数</h3>
        ${pathParams.map(p => {
          const cfg = api.pathParams[p] ?? {};
          return `<div class="form-group">
            <label class="form-label">${this.escapeHtml(cfg.label || p)} <span style="color:var(--danger)">*</span></label>
            <input type="text" class="form-input" id="path_${this.escapeHtml(p)}" placeholder="${this.escapeHtml(cfg.placeholder ?? '')}" data-request-field="1">
          </div>`;
        }).join('')}
      </div>`;
    }
    
    // 查询参数
    if (api.queryParams?.length) {
      paramsHTML += `<div class="api-form-section">
        <h3 class="api-form-section-title">查询参数</h3>
        ${api.queryParams.map(p => this.renderParamInput(p)).join('')}
      </div>`;
    }
    
    // 请求体参数
    if (api.method !== 'GET' && api.bodyParams?.length) {
      paramsHTML += `<div class="api-form-section">
        <h3 class="api-form-section-title">请求体</h3>
        ${api.bodyParams.map(p => this.renderParamInput(p)).join('')}
      </div>`;
    }
    
    section.innerHTML = `
      <div class="card" style="margin-bottom:24px">
        <div class="card-header">
          <span class="card-title">${api.title}</span>
          <span class="method-tag method-${api.method.toLowerCase()}">${api.method}</span>
        </div>
        <div class="api-endpoint-box">
          <span>${api.path}</span>
        </div>
        <p style="margin-top:12px;color:var(--text-secondary)">${api.description || ''}</p>
      </div>
      
      <div class="api-form-grid">
        <div>
          ${paramsHTML}
          ${apiId === 'file-upload' ? this.renderFileUpload() : ''}
          <div style="display:flex;gap:12px;margin-top:20px">
            <button class="btn btn-primary" id="executeBtn" type="button">执行请求</button>
            <button class="btn btn-secondary" id="fillExampleBtn" type="button">填充示例</button>
          </div>
        </div>
        <div>
          <div class="json-editor-container">
            <div class="json-editor-header">
              <span class="json-editor-title">请求预览</span>
              <div class="json-editor-actions">
                <button class="btn btn-sm btn-secondary" id="formatJsonBtn" type="button">格式化</button>
                <button class="btn btn-sm btn-secondary" id="copyJsonBtn" type="button">复制</button>
              </div>
            </div>
            <div class="json-editor-wrapper">
              <textarea id="jsonEditor">{}</textarea>
            </div>
          </div>
        </div>
      </div>
      
      <div id="responseSection"></div>
    `;
    
    // 事件链收敛：一个 click 入口 + 输入事件委托，避免重复绑定和 setTimeout
    section.onclick = (e) => {
      const t = e.target;
      if (!t) return;
      if (t.id === 'executeBtn') return this.executeRequest();
      if (t.id === 'fillExampleBtn') return this.fillExample();
      if (t.id === 'formatJsonBtn') return this.formatJSON();
      if (t.id === 'copyJsonBtn') return this.copyJSON();
    };

    section.oninput = (e) => {
      const t = e.target;
      if (t?.matches?.('[data-request-field="1"]')) this.updateJSONPreview();
    };
    section.onchange = (e) => {
      const t = e.target;
      if (t?.matches?.('[data-request-field="1"]')) this.updateJSONPreview();
    };
      
      // 文件上传设置
      if (apiId === 'file-upload') {
        this.setupFileUpload();
      }
    
    // 初始化JSON编辑器（只做“请求预览”，只读，避免误操作）
    this.initJSONEditor().then(() => this.updateJSONPreview());
  }

  renderParamInput(param) {
    const required = param.required ? '<span style="color:var(--danger)">*</span>' : '';
    let input = '';
    const placeholder = this.escapeHtml(param.placeholder || '');
    
    switch (param.type) {
      case 'select':
        input = `<select class="form-input" id="${param.name}" data-request-field="1">
          <option value="">请选择</option>
          ${param.options.map(o => {
            const selected = (param.defaultValue !== undefined && String(o.value) === String(param.defaultValue)) ? ' selected' : '';
            return `<option value="${this.escapeHtml(o.value)}"${selected}>${this.escapeHtml(o.label)}</option>`;
          }).join('')}
        </select>`;
        break;
      case 'textarea':
      case 'json':
        input = `<textarea class="form-input" id="${this.escapeHtml(param.name)}" placeholder="${placeholder}" data-request-field="1">${this.escapeHtml(param.defaultValue || '')}</textarea>`;
        break;
      default:
        input = `<input type="${this.escapeHtml(param.type || 'text')}" class="form-input" id="${this.escapeHtml(param.name)}" placeholder="${placeholder}" value="${this.escapeHtml(param.defaultValue || '')}" data-request-field="1">`;
    }
    
    return `<div class="form-group">
      <label class="form-label">${this.escapeHtml(param.label)} ${required}</label>
      ${param.hint ? `<p class="config-field-hint">${this.escapeHtml(param.hint)}</p>` : ''}
      ${input}
    </div>`;
  }

  renderFileUpload() {
    return `<div class="api-form-section">
      <h3 class="api-form-section-title">文件上传</h3>
      <div class="file-upload" id="fileUploadArea">
        <input type="file" id="fileInput" style="display:none" multiple>
        <svg class="file-upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="17,8 12,3 7,8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <p class="file-upload-text">点击或拖放文件到此处</p>
      </div>
      <div class="file-list" id="fileList"></div>
    </div>`;
  }

  setupFileUpload() {
    const area = document.getElementById('fileUploadArea');
    const input = document.getElementById('fileInput');
    
    if (!area || !input) return;
    
    area.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => this.handleFiles(e.target.files));
    
    this._bindDropArea(area, {
      onDragStateChange: (active) => {
        area.classList.toggle('is-dragover', Boolean(active));
      },
      onFiles: (files) => this.handleFiles(files)
    });
  }

  handleFiles(files) {
    this.selectedFiles = Array.from(files);
    const list = document.getElementById('fileList');
    if (!list) return;
    
    list.innerHTML = this.selectedFiles.map((f, i) => `
      <div class="file-item">
        <div class="file-item-info">
          <div class="file-item-name">${f.name}</div>
          <div class="file-item-size">${(f.size / 1024).toFixed(1)} KB</div>
        </div>
        <button class="file-item-remove" data-index="${i}">×</button>
      </div>
    `).join('');
    
    list.querySelectorAll('.file-item-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedFiles.splice(parseInt(btn.dataset.index), 1);
        this.handleFiles(this.selectedFiles);
      });
    });
  }

  findAPIById(id) {
    for (const group of this.apiConfig?.apiGroups || []) {
      const api = group.apis.find(a => a.id === id);
      if (api) return api;
    }
    return null;
  }

  updateJSONPreview() {
    if (!this.currentAPI) return;
    const data = this.buildRequestData();
    const next = JSON.stringify(data, null, 2);
    if (this._lastJsonPreview === next) return;
    this._lastJsonPreview = next;
    const textarea = document.getElementById('jsonEditor');
    if (textarea && !this.jsonEditor) {
      const top = textarea.scrollTop;
      textarea.value = next;
      textarea.scrollTop = top;
    } else if (this.jsonEditor) {
      const scroll = this.jsonEditor.getScrollInfo();
      this.jsonEditor.setValue(next);
      this.jsonEditor.scrollTo(null, scroll.top);
    }
  }

  buildRequestData() {
    const { method, path } = this.currentAPI;
    const api = this.findAPIById(this.currentAPI.apiId);
    const data = { method, url: path };
    
    // 路径参数
    (path.match(/:(\w+)/g) || []).forEach(p => {
      const name = p.slice(1);
      const val = document.getElementById(`path_${name}`)?.value;
      if (val) data.url = data.url.replace(p, val);
    });
    
    // 查询参数
    const query = {};
    api?.queryParams?.forEach(p => {
      const val = document.getElementById(p.name)?.value;
      if (!val) return;
      if (p.defaultValue !== undefined && String(val) === String(p.defaultValue)) return;
      query[p.name] = val;
    });
    if (Object.keys(query).length) data.query = query;
    
    // 请求体
    const body = {};
    api?.bodyParams?.forEach(p => {
      const el = document.getElementById(p.name);
      const rawVal = el?.value;
      if (!rawVal) return;
      if (p.defaultValue !== undefined && String(rawVal) === String(p.defaultValue)) return;
      let val = rawVal;
        if (p.type === 'json') {
          try {
            val = JSON.parse(val);
          } catch {
            // 解析失败时保持原值
          }
        }
        body[p.name] = val;
    });
    if (Object.keys(body).length) data.body = body;
    
    if (this.selectedFiles.length) {
      data.files = this.selectedFiles.map(f => ({ name: f.name, size: f.size }));
    }
    
    return data;
  }

  async initJSONEditor() {
    await this.loadCodeMirror();
    const textarea = document.getElementById('jsonEditor');
    if (!textarea || !window.CodeMirror) return;
    
    const theme = this.theme === 'dark' ? 'monokai' : 'default';
    this.jsonEditor = CodeMirror.fromTextArea(textarea, {
      mode: 'application/json',
      theme,
      lineNumbers: true,
      lineWrapping: true,
      matchBrackets: true,
      readOnly: true
    });
  }

  async loadCodeMirror() {
    if (window.CodeMirror) return;
    
    const loadCSS = (href) => new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      link.onerror = reject;
      document.head.appendChild(link);
    });
    
    const loadJS = (src) => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    
    const base = 'https://cdn.jsdelivr.net/npm/codemirror@5.65.2';
    try {
      await loadCSS(`${base}/lib/codemirror.min.css`);
      await loadCSS(`${base}/theme/monokai.min.css`);
      await loadJS(`${base}/lib/codemirror.min.js`);
      await loadJS(`${base}/mode/javascript/javascript.min.js`);
    } catch (e) {
      console.warn('Failed to load CodeMirror:', e);
    }
  }

  formatJSON() {
    try {
      const jsonEditor = document.getElementById('jsonEditor');
      const val = this.jsonEditor?.getValue() || jsonEditor?.value || '{}';
      const formatted = JSON.stringify(JSON.parse(val), null, 2);
      if (this.jsonEditor) {
        this.jsonEditor.setValue(formatted);
      } else if (jsonEditor) {
        jsonEditor.value = formatted;
      }
      this.showToast('已格式化', 'success');
    } catch (e) {
      this.showToast('JSON 格式错误: ' + e.message, 'error');
    }
  }

  copyJSON() {
    const jsonEditor = document.getElementById('jsonEditor');
    const val = this.jsonEditor?.getValue() || jsonEditor?.value || '';
    if (!val) {
      this.showToast('没有可复制的内容', 'warning');
      return;
    }
    
    this.copyToClipboard(val, '已复制', '复制失败');
  }

  fillExample() {
    if (!this.currentAPI || !this.apiConfig?.examples) return;
    const example = this.apiConfig.examples[this.currentAPI.apiId];
    if (!example) {
      this.showToast('暂无示例数据', 'info');
      return;
    }
    
    Object.entries(example).forEach(([key, val]) => {
      const el = document.getElementById(key);
      if (el) el.value = typeof val === 'object' ? JSON.stringify(val, null, 2) : val;
    });
    
    this.updateJSONPreview();
    this.showToast('已填充示例', 'success');
  }

  async executeRequest() {
    if (!this.currentAPI) {
      this.showToast('请先选择 API', 'warning');
      return;
    }
    
    const btn = document.getElementById('executeBtn');
    if (!btn) {
      this.showToast('执行按钮不存在', 'error');
      return;
    }
    
    const requestData = this.buildRequestData();
    
    // 文件上传
    if (this.currentAPI.apiId === 'file-upload' && this.selectedFiles.length) {
      return this.executeFileUpload();
    }
    
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner"></span> 执行中...';
    btn.disabled = true;
    
    const startTime = Date.now();
    let url = this.serverUrl + (requestData.url || this.currentAPI.path);
    
    // 处理路径参数
    if (requestData.url) {
      url = this.serverUrl + requestData.url;
    }
    
    if (requestData.query && Object.keys(requestData.query).length > 0) {
      url += '?' + new URLSearchParams(requestData.query).toString();
    }
    
    try {
      const options = {
        method: requestData.method || this.currentAPI.method || 'GET',
        headers: this.getHeaders()
      };
      
      if (requestData.body && Object.keys(requestData.body).length > 0) {
        options.body = JSON.stringify(requestData.body);
      }
      
      const res = await fetch(url, options);
      const time = Date.now() - startTime;
      const text = await res.text();
      let data;
      try { 
        data = JSON.parse(text); 
      } catch { 
        data = text; 
      }
      
      // 保存请求信息用于显示
      const requestInfo = {
        method: options.method || 'GET',
        url: url,
        headers: options.headers || {},
        body: requestData.body || null
      };
      
      this.renderResponse(res.status, data, time, requestInfo);
      this.showToast(res.ok ? '请求成功' : `请求失败: ${res.status}`, res.ok ? 'success' : 'error');
    } catch (e) {
      const requestInfo = {
        method: requestData.method || this.currentAPI.method || 'GET',
        url: url,
        headers: this.getHeaders(),
        body: requestData.body || null
      };
      this.renderResponse(0, { error: e.message }, Date.now() - startTime, requestInfo);
      this.showToast('请求失败: ' + e.message, 'error');
    } finally {
      if (btn) {
      btn.innerHTML = originalText;
      btn.disabled = false;
      }
    }
  }

  async executeFileUpload() {
    if (!this.selectedFiles || this.selectedFiles.length === 0) {
      this.showToast('请先选择文件', 'warning');
      return;
    }
    
    const formData = new FormData();
    this.selectedFiles.forEach(f => formData.append('file', f));
    
    const btn = document.getElementById('executeBtn');
    if (!btn) {
      this.showToast('执行按钮不存在', 'error');
      return;
    }
    
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner"></span> 上传中...';
    btn.disabled = true;
    
    const startTime = Date.now();
    
    try {
      const res = await fetch(`${this.serverUrl}/api/file/upload`, {
        method: 'POST',
        headers: { 'X-API-Key': localStorage.getItem('apiKey') || '' },
        body: formData
      });
      
      const time = Date.now() - startTime;
      let data;
      try {
        data = await res.json();
      } catch {
        data = { error: '响应解析失败' };
      }
      
      const requestInfo = {
        method: 'POST',
        url: `${this.serverUrl}/api/file/upload`,
        headers: { 'X-API-Key': localStorage.getItem('apiKey') || '' },
        body: null // FormData 不显示
      };
      
      this.renderResponse(res.status, data, time, requestInfo);
      
      if (res.ok) {
        this.showToast('上传成功', 'success');
        this.selectedFiles = [];
        const fileList = document.getElementById('fileList');
        if (fileList) fileList.innerHTML = '';
      } else {
        this.showToast('上传失败: ' + (data.message || res.statusText), 'error');
      }
    } catch (e) {
      const requestInfo = {
        method: 'POST',
        url: `${this.serverUrl}/api/file/upload`,
        headers: { 'X-API-Key': localStorage.getItem('apiKey') || '' },
        body: null
      };
      this.renderResponse(0, { error: e.message }, Date.now() - startTime, requestInfo);
      this.showToast('上传失败: ' + e.message, 'error');
    } finally {
      if (btn) {
        btn.innerHTML = originalText;
      btn.disabled = false;
      }
    }
  }

  renderResponse(status, data, time, requestInfo = {}) {
    const section = document.getElementById('responseSection');
    const isSuccess = status >= 200 && status < 300;
    const prettyJson = JSON.stringify(data, null, 2);
    
    // 格式化请求头显示
    const headers = requestInfo.headers || {};
    const headersHtml = Object.entries(headers).map(([key, value]) => 
      `<div class="request-header-item"><span class="request-header-key">${this.escapeHtml(key)}</span>: <span class="request-header-value">${this.escapeHtml(String(value))}</span></div>`
    ).join('');
    
    section.innerHTML = `
      <div style="margin-top:32px">
        <!-- 请求头一览 -->
        <div class="request-info-section">
          <div class="request-info-header" id="requestInfoToggle">
            <h3 class="request-info-title">
              <span class="request-info-icon">▼</span>
              请求信息
            </h3>
            <div class="request-info-meta">
              <span class="request-method-badge">${requestInfo.method || 'GET'}</span>
              <span class="request-url-text" title="${this.escapeHtml(requestInfo.url || '')}">${this.escapeHtml((requestInfo.url || '').substring(0, 60))}${(requestInfo.url || '').length > 60 ? '...' : ''}</span>
            </div>
          </div>
          <div class="request-info-content" id="requestInfoContent" style="display:none">
            <div class="request-info-item">
              <div class="request-info-label">请求方法</div>
              <div class="request-info-value">${requestInfo.method || 'GET'}</div>
            </div>
            <div class="request-info-item">
              <div class="request-info-label">请求URL</div>
              <div class="request-info-value request-url-full">${this.escapeHtml(requestInfo.url || '')}</div>
            </div>
            ${headersHtml ? `
            <div class="request-info-item">
              <div class="request-info-label">请求头</div>
              <div class="request-info-value request-headers">${headersHtml}</div>
            </div>
            ` : ''}
            ${requestInfo.body ? `
            <div class="request-info-item">
              <div class="request-info-label">请求体</div>
              <div class="request-info-value request-body"><pre>${this.syntaxHighlight(JSON.stringify(requestInfo.body, null, 2))}</pre></div>
            </div>
            ` : ''}
          </div>
        </div>
        
        <!-- 响应结果 -->
        <div class="response-section">
          <div class="response-header">
            <h3 class="response-title">响应结果</h3>
            <div class="response-meta">
              <span class="badge ${isSuccess ? 'badge-success' : 'badge-danger'}">${status || 'Error'}</span>
              <span style="color:var(--text-muted)">${time}ms</span>
              <button id="responseCopyBtn" class="btn btn-secondary btn-sm" type="button">复制结果</button>
            </div>
          </div>
          <div class="response-content">
            <pre>${this.syntaxHighlight(prettyJson)}</pre>
          </div>
        </div>
      </div>
    `;
    
    // 请求信息折叠/展开 - 使用事件委托避免重复绑定
    const requestInfoSection = document.getElementById('requestInfoSection');
    if (requestInfoSection && !requestInfoSection.dataset._bound) {
      requestInfoSection.dataset._bound = '1';
      requestInfoSection.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('#requestInfoToggle');
        if (toggleBtn) {
          const content = document.getElementById('requestInfoContent');
          if (content) {
            const isHidden = content.style.display === 'none';
            content.style.display = isHidden ? 'block' : 'none';
            const icon = toggleBtn.querySelector('.request-info-icon');
            if (icon) icon.textContent = isHidden ? '▲' : '▼';
          }
        }
        
        const copyBtn = e.target.closest('#responseCopyBtn');
        if (copyBtn) {
          this.copyToClipboard(prettyJson, '响应结果已复制到剪贴板', '复制失败，请检查浏览器权限');
        }
      });
    }
    
    section.scrollIntoView({ behavior: 'smooth' });
  }
  
  copyToClipboard(text, successMsg = '已复制到剪贴板', errorMsg = '复制失败') {
      navigator.clipboard.writeText(text)
        .then(() => this.showToast(successMsg, 'success'))
      .catch(() => this.showToast(errorMsg, 'error'));
  }

  syntaxHighlight(json) {
    return json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'json-key' : 'json-string';
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return `<span class="${cls}">${match}</span>`;
      });
  }

  // ========== WebSocket & 语音 ==========
  getWebUserId() {
    if (!this._webUserId) {
      this._webUserId = `webclient_${Date.now()}`;
      localStorage.setItem('webUserId', this._webUserId);
    }
    return this._webUserId;
  }

  // 清理 WebSocket 相关定时器
  _clearWsTimers() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._offlineCheckTimer) {
      clearInterval(this._offlineCheckTimer);
      this._offlineCheckTimer = null;
    }
  }

  async ensureDeviceWs() {
    const state = this._deviceWs?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    
    // 防止重复连接：如果正在连接中，直接返回
    if (this._wsConnecting) return;
    this._wsConnecting = true;
    
    // 清理旧的连接和定时器
    try {
      this._deviceWs?.close();
    } catch {}
    this._deviceWs = null;
    this._clearWsTimers();
    
    const apiKey = localStorage.getItem('apiKey') || '';
    // 支持 ws 和 wss 协议
    const protocol = this.serverUrl.startsWith('https') ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${this.serverUrl.replace(/^https?:\/\//, '')}/device${apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''}`;
    const deviceId = this.getWebUserId();
    
    try {
      this._deviceWs = new WebSocket(wsUrl);
      
      this._deviceWs.onopen = () => {
        this._wsConnecting = false;
        this._deviceWs.device_id = deviceId;
        
        // 注册设备
        this._deviceWs.send(JSON.stringify({
          type: 'register',
          device_id: deviceId,
          device_type: 'web',
          device_name: 'Web客户端',
          capabilities: ['display', 'microphone'],
          user_id: this.getWebUserId()
        }));
        
        const now = Date.now();
        this._lastHeartbeatAt = now;
        this._lastWsMessageAt = now;

        // 主动心跳：每 30 秒向后端发送一次心跳
        this._heartbeatTimer = setInterval(() => {
          if (this._deviceWs?.readyState === WebSocket.OPEN) {
            try {
              this._deviceWs.send(JSON.stringify({
                type: 'heartbeat',
                timestamp: Date.now()
              }));
              this._lastHeartbeatAt = Date.now();
            } catch (e) {
              console.warn('[WebSocket] 心跳发送失败:', e);
            }
          }
        }, 30000);

        // 前端兜底离线检测：31 分钟内无活跃则强制重连
        const OFFLINE_TIMEOUT = 31 * 60 * 1000;
        this._offlineCheckTimer = setInterval(() => {
          const lastActive = Math.max(this._lastHeartbeatAt || 0, this._lastWsMessageAt || 0);
          if (lastActive && Date.now() - lastActive > OFFLINE_TIMEOUT) {
            console.warn('[WebSocket] 检测到长时间无响应，强制重连');
            this._deviceWs?.close();
            this._deviceWs = null;
            this.ensureDeviceWs();
          }
        }, 60000);
        
        // 更新连接状态
        const status = $('#connectionStatus');
        if (status) {
          status.classList.add('online');
          const statusText = status.querySelector('.status-text');
          if (statusText) statusText.textContent = '已连接';
        }
      };
      
      this._deviceWs.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          this._lastWsMessageAt = Date.now();
          
          this.handleWsMessage(data);
        } catch (e) {
          console.warn('[WebSocket] 消息解析失败:', e);
        }
      };
      
      this._deviceWs.onclose = (event) => {
        this._wsConnecting = false;
        this._clearWsTimers();
        this._deviceWs = null;
        
        // 非正常关闭时，延迟重连
        if (event.code !== 1000) {
          const delay = event.code === 1006 ? 3000 : 5000; // 异常关闭时3秒重连，正常关闭时5秒
          setTimeout(() => {
            if (!this._deviceWs) {
              this.ensureDeviceWs();
            }
          }, delay);
        }
      };
      
      this._deviceWs.onerror = (e) => {
        this._wsConnecting = false;
        console.warn('[WebSocket] 连接错误:', e);
      };
    } catch (e) {
      this._wsConnecting = false;
      console.warn('[WebSocket] 连接失败:', e);
    }
  }


  sendDeviceMessage(text, meta = {}) {
    const payloadText = (text || '').trim();
    if (!payloadText) return;

    // 确保WebSocket连接
    this.ensureDeviceWs();
    const ws = this._deviceWs;
    
    // 如果连接未就绪，尝试等待一下
    if (ws?.readyState !== WebSocket.OPEN) {
      if (ws?.readyState === WebSocket.CONNECTING) {
        // 正在连接中，等待连接完成
        const checkConnection = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            clearInterval(checkConnection);
            this.sendDeviceMessage(text, meta);
          } else if (ws?.readyState === WebSocket.CLOSED) {
            clearInterval(checkConnection);
            this.showToast('设备通道连接失败', 'error');
          }
        }, 500);
        
        // 5秒后超时
        setTimeout(() => {
          clearInterval(checkConnection);
          if (ws?.readyState !== WebSocket.OPEN) {
            this.showToast('设备通道连接超时', 'warning');
          }
        }, 5000);
        return;
      } else {
        this.showToast('设备通道未连接，正在重连...', 'warning');
      return;
      }
    }

    const deviceId = ws.device_id || this.getWebUserId();
    const userId = this.getWebUserId();
    
    const msg = {
      type: 'message',
      device_id: deviceId,
      device_type: 'web',
      channel: 'web-chat',
      user_id: userId,
      text: payloadText,
      isMaster: true,
      // 可选：OneBot-like segments，用于携带图片/视频/音频等多模态输入
      // 若不传，则后端会使用 text 自动构造 [{type:'text',text}]
      message: Array.isArray(meta.message) ? meta.message : undefined,
      meta: {
        persona: this.getCurrentPersona(),
        workflow: this._chatSettings.workflow || 'device',
        source: meta.source || 'manual',
        ...meta.meta
      }
    };

    try {
      ws.send(JSON.stringify(msg));
      this._chatStreamState = { running: true, source: meta.source || 'manual' };
      this.updateChatStatus('AI 处理中...');
      this.setChatInteractionState(true);

      this.clearChatPendingTimer();
      
      // 快速超时：2.5秒内如果没有响应，认为没有流被触发，快速退出
      this._chatQuickTimeout = setTimeout(() => {
        if (this._chatStreamState.running) {
          this.clearChatStreamState();
          // 不显示提示，静默退出
        }
      }, 2500);
      
      // 长超时：60秒作为兜底
      this._chatPendingTimer = setTimeout(() => {
        if (this._chatStreamState.running) {
          this.clearChatStreamState();
          this.showToast('AI 暂无响应，请稍后再试', 'warning');
        }
      }, 60000);
    } catch (e) {
      this.showToast('发送失败: ' + e.message, 'error');
      this.clearChatStreamState();
    }
  }

  handleWsMessage(data) {
    // TTS音频消息不去重，因为每个音频块都是唯一的，必须全部处理
    const isTTSAudio = data.type === 'command' && data.command?.command === 'play_tts_audio';
    
    if (!isTTSAudio) {
      // 非TTS消息去重：使用event_id或timestamp+type作为唯一标识
      const messageId = data.event_id || `${data.type}_${data.timestamp || Date.now()}_${JSON.stringify(data).slice(0, 50)}`;
      if (this._processedMessageIds.has(messageId)) {
        return; // 已处理过，跳过
      }
      this._processedMessageIds.add(messageId);
      
      // 限制去重集合大小，避免内存泄漏
      if (this._processedMessageIds.size > 1000) {
        const firstId = this._processedMessageIds.values().next().value;
        this._processedMessageIds.delete(firstId);
      }
    }
    
    switch (data.type) {
      case 'heartbeat_request':
        if (this._deviceWs?.readyState === WebSocket.OPEN) {
          this._deviceWs.send(JSON.stringify({
            type: 'heartbeat_response',
            timestamp: Date.now()
          }));
        }
        break;
      case 'heartbeat':
        this._lastWsMessageAt = Date.now();
        break;
      case 'asr_interim':
        {
          const text = data.text || '';
          console.log(`[ASR前端] 中间结果: "${text}" session_id=${data.session_id || ''}`);
          if (this._chatMode === 'voice') {
            this.updateVoiceStatus(`识别中: ${text}`);
          } else {
            this.renderASRStreaming(text, false);
          }
        }
        break;
      case 'asr_final': {
        const finalText = (data.text || '').trim();
        console.log(`[ASR前端] 最终结果: "${finalText}" session_id=${data.session_id || ''}`);
        if (this._chatMode === 'voice') {
          if (finalText && !this._chatStreamState.running) {
            this.updateVoiceStatus('AI 思考中...');
            this.sendVoiceMessage(finalText).catch(e => {
              this.showToast(`语音处理失败: ${e.message}`, 'error');
            });
          }
        } else {
          this.renderASRStreaming(finalText, true);
        }
        break;
      }
      case 'reply': {
        // 处理 segments：device.js 已标准化格式
        const segments = Array.isArray(data.segments) ? data.segments : [];
        if (segments.length === 0 && data.text) {
          segments.push({ type: 'text', text: data.text });
        }
        
        this.clearChatStreamState();
        
        // 有 title/description 时显示为聊天记录，否则按顺序渲染 segments
        if (data.title || data.description) {
          const messages = segments
            .filter(seg => typeof seg === 'string' || seg.type === 'text' || seg.type === 'raw')
            .map(seg => typeof seg === 'string' ? seg : (seg.text || seg.data?.text || ''))
            .filter(text => text.trim());
          
          if (messages.length > 0) {
            this.appendChatRecord(messages, data.title || '', data.description || '', true);
          }
          
          // 媒体文件单独显示（图片/视频/音频）
          segments.filter(s => ['image', 'video', 'record'].includes(s.type) && s.url).forEach(seg => {
            if (seg.type === 'image') {
              this.appendImageMessage(seg.url, true);
            } else {
              this.appendSegments([seg], true);
            }
          });
        } else {
          this.appendSegments(segments, true, 'assistant');
        }
        break;
      }
      case 'forward': {
        // 处理转发消息（聊天记录）
        this.clearChatStreamState();
        
        if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
          // 提取消息内容：支持node格式和普通格式
          const messages = data.messages.map((msg) => {
            // node格式：从content数组中提取文本
            if (msg.type === 'node' && msg.data) {
              if (msg.data.content && Array.isArray(msg.data.content)) {
                const texts = msg.data.content
                  .filter(c => c && c.type === 'text' && c.data && c.data.text)
                  .map(c => c.data.text)
                  .filter(text => text && text.trim());
                if (texts.length > 0) {
                  return texts.join('\n');
                }
                const firstContent = msg.data.content[0];
                if (firstContent && firstContent.data && firstContent.data.text) {
                  return firstContent.data.text;
                }
              }
              // 降级处理
              if (typeof msg.data.content === 'string') {
                return msg.data.content;
              }
              if (msg.data.message) {
                return typeof msg.data.message === 'string' ? msg.data.message : String(msg.data.message);
              }
              return '';
            }
            // 普通格式：直接提取文本
            if (typeof msg === 'string') {
              return msg;
            }
            if (msg.message) {
              return typeof msg.message === 'string' ? msg.message : String(msg.message);
            }
            if (msg.content) {
              return typeof msg.content === 'string' ? msg.content : String(msg.content);
            }
            return String(msg);
          }).filter(text => text && text.trim());
          
          if (messages.length > 0) {
            this.appendChatRecord(messages, data.title || '', data.description || '', true);
          }
        }
        break;
      }
      case 'status':
        if (data.text) {
          this.appendChat('system', data.text, { persist: true, withCopyBtn: false });
        }
        // 状态消息不中断聊天流程
        break;
      case 'error':
        if (data.message) {
          this.showToast(data.message, 'error');
          // 错误时也显示在聊天中
          this.appendChat('system', `错误: ${data.message}`, { persist: true, withCopyBtn: false });
        }
        this.clearChatStreamState();
        break;
      case 'register_response':
        // 设备注册响应
        if (data.device) {
          this._deviceWs.device_id = data.device.device_id;
        }
        break;
      case 'heartbeat_response':
        // 心跳响应，更新活跃时间
        this._lastWsMessageAt = Date.now();
        break;
      case 'typing':
        // 显示正在输入状态
        if (data.typing) {
          this.updateChatStatus('AI 正在输入...');
        } else {
          this.updateChatStatus();
        }
        break;
      case 'command':
        if (data.command?.command === 'play_tts_audio') {
          const hexData = data.command.parameters?.audio_data;
          
          // 检查数据有效性
          if (!hexData || typeof hexData !== 'string' || hexData.length === 0) {
            console.warn(`[TTS] 收到无效的音频数据`);
            return;
          }
          
          if (hexData.length % 2 !== 0) {
            console.warn(`[TTS] 收到奇数长度的hex数据: 长度=${hexData.length}`);
            return;
          }
          
          this._ttsStats.wsMessageCount++;
          this._playTTSAudio(hexData);
        } else if (data.command === 'display' && data.parameters?.text) {
          this.appendChat('assistant', data.parameters.text, { persist: true, withCopyBtn: true });
        } else if (data.command === 'display_emotion' && data.parameters?.emotion) {
          this.updateEmotionDisplay(data.parameters.emotion);
        }
        break;
    }
  }

  renderASRStreaming(text = '', done = false) {
    const finalText = (text || '').trim();
    // 文本模式：把识别内容同步到主输入框（支持 MD，交由 renderMarkdown + 发送逻辑渲染）
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      chatInput.value = finalText;
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 语音模式：同时把识别内容同步到 voiceInput，方便立刻回显再触发 TTS 播放
    const voiceInput = document.getElementById('voiceInput');
    if (voiceInput) {
      voiceInput.value = finalText || '';
      // 语音输入框主要做展示，不需要再触发额外的 input 事件
    }
  }

  async toggleMic() {
    if (this._micStarting || this._micStopping) return;
    
    if (this._micActive) {
      await this.stopMic();
    } else {
      await this.startMic();
    }
  }

  async startMic() {
    if (this._micActive || this._micStarting) return;
    
    this._micStarting = true;
    try {
      // 如果已有会话，先停止
      if (this._asrSessionId || this._micActive) {
        await this.stopMic();
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      await this.ensureDeviceWs();
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
      });
      
      this._micStream = stream;
      this._audioCtx = new AudioContext({ sampleRate: 16000 });
      
      const source = this._audioCtx.createMediaStreamSource(stream);
      const processor = this._audioCtx.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
      processor.connect(this._audioCtx.destination);
      this._audioProcessor = processor;
      
      const sessionId = `sess_${Date.now()}`;
      this._asrSessionId = sessionId;
      this._asrChunkIndex = 0;
      // 初始化ASR统计
      this._asrStats = {
        totalChunks: 0,
        totalBytes: 0,
        totalSamples: 0,
        sessionStartTime: Date.now(),
        lastChunkTime: null
      };
      this._micActive = true;
      this._audioBuffer = [];
      this._preAudioBuffer = []; // 预缓冲：在ASR准备好之前收集的音频
      
      document.getElementById('micBtn')?.classList.add('recording');
      
      // 先启动音频处理，开始收集音频（预缓冲）
      processor.onaudioprocess = (e) => {
        if (!this._micActive) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // 使用预缓冲机制：同时存入预缓冲和正常缓冲，确保不丢失最开始的话
        this._preAudioBuffer.push(pcm16);
        // 限制预缓冲大小，避免内存问题（最多保存约3秒的音频，约30个块）
        if (this._preAudioBuffer.length > 30) {
          this._preAudioBuffer.shift(); // 移除最旧的
        }
        
        // 同时存入正常缓冲（ASR准备好后使用）
        this._audioBuffer.push(pcm16);
      };
      
      // 发送会话启动请求
      this._deviceWs?.send(JSON.stringify({
        type: 'asr_session_start',
        device_id: 'webclient',
        session_id: sessionId,
        sample_rate: 16000,
        bits: 16,
        channels: 1
      }));
      
      // 优化：立即发送音频，不等待ASR确认（后端会缓存）
      // 使用预缓冲机制确保不丢失最开始的话
      const sendBufferedAudio = () => {
        if (!this._micActive) return;
        
        // 合并预缓冲和当前缓冲（确保不丢失最开始的话）
        const allBuffers = [...this._preAudioBuffer, ...this._audioBuffer];
        if (allBuffers.length === 0) return;
        
        // 清空预缓冲（已合并）
        this._preAudioBuffer = [];
        
        const combined = new Int16Array(allBuffers.reduce((sum, buf) => sum + buf.length, 0));
        let offset = 0;
        for (const buf of allBuffers) {
          combined.set(buf, offset);
          offset += buf.length;
        }
        
        const hex = Array.from(new Uint8Array(combined.buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        const samples = combined.length;
        const bytes = samples * 2;
        const sr = 16000;
        const duration = samples / sr;
        const now = performance.now();
        const last = this._asrStats.lastChunkTime;
        const interval = last ? (now - last) : 0;
        this._asrStats.lastChunkTime = now;
        this._asrStats.totalChunks += 1;
        this._asrStats.totalBytes += bytes;
        this._asrStats.totalSamples += samples;

        this._deviceWs?.send(JSON.stringify({
          type: 'asr_audio_chunk',
          device_id: 'webclient',
          session_id: sessionId,
          chunk_index: this._asrChunkIndex++,
          vad_state: 'active',
          data: hex
        }));
        
        console.log(
          `[ASR前端] 发送音频块 #${this._asrChunkIndex}: 字节=${bytes}, 样本=${samples}, 时长=${duration.toFixed(3)}s,` +
          ` 发送间隔=${interval.toFixed(2)}ms, 累计块数=${this._asrStats.totalChunks}, 累计字节=${this._asrStats.totalBytes}`
        );
        
        this._audioBuffer = [];
      };
      
      // 优化：立即开始发送音频（不等待ASR确认），使用预缓冲确保不丢失最开始的话
      // 第一次立即发送预缓冲，然后使用更短的间隔（80ms，从150ms优化）
      const startSending = () => {
        if (!this._micActive) return;
        this._asrReady = true; // 标记ASR已准备好
        sendBufferedAudio(); // 立即发送预缓冲的音频（包含最开始的话）
        
        if (!this._audioBufferTimer) {
          this._audioBufferTimer = setInterval(sendBufferedAudio, 80);
        }
      };
      
      // 立即开始发送（不等待），确保不丢失最开始的话
      startSending();
    } catch (e) {
      this.showToast('麦克风启动失败: ' + e.message, 'error');
      this._micActive = false;
      this._asrSessionId = null;
      if (this._micStream) {
        this._micStream.getTracks().forEach(t => t.stop());
        this._micStream = null;
      }
      if (this._audioCtx) {
        await this._audioCtx.close().catch(() => {});
        this._audioCtx = null;
      }
    } finally {
      this._micStarting = false;
    }
  }

  async stopMic() {
    if (this._micStopping) return;
    if (!this._micActive && !this._asrSessionId) return;
    
    this._micStopping = true;
    try {
        if (this._audioBufferTimer) {
        clearInterval(this._audioBufferTimer);
        this._audioBufferTimer = null;
      }
      
      // 发送剩余的音频（包括预缓冲）
      const allBuffers = [...this._preAudioBuffer, ...this._audioBuffer];
      if (allBuffers.length > 0 && this._deviceWs && this._asrSessionId) {
        const combined = new Int16Array(allBuffers.reduce((sum, buf) => sum + buf.length, 0));
        let offset = 0;
        for (const buf of allBuffers) {
          combined.set(buf, offset);
          offset += buf.length;
        }
        const hex = Array.from(new Uint8Array(combined.buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        const samples = combined.length;
        const bytes = samples * 2;
        const sr = 16000;
        const duration = samples / sr;
        const now = performance.now();
        const last = this._asrStats.lastChunkTime;
        const interval = last ? (now - last) : 0;
        this._asrStats.lastChunkTime = now;
        this._asrStats.totalChunks += 1;
        this._asrStats.totalBytes += bytes;
        this._asrStats.totalSamples += samples;

        this._deviceWs.send(JSON.stringify({
          type: 'asr_audio_chunk',
          device_id: 'webclient',
          session_id: this._asrSessionId,
          chunk_index: this._asrChunkIndex++,
          vad_state: 'ending',
          data: hex
        }));
        
        console.log(
          `[ASR前端] 发送结束块 #${this._asrChunkIndex}: 字节=${bytes}, 样本=${samples}, 时长=${duration.toFixed(3)}s,` +
          ` 发送间隔=${interval.toFixed(2)}ms, 累计块数=${this._asrStats.totalChunks}, 累计字节=${this._asrStats.totalBytes}`
        );
      }

      this._audioProcessor?.disconnect();
      this._micStream?.getTracks().forEach(t => t.stop());
      await this._audioCtx?.close().catch(() => {});
      
      if (this._asrSessionId && this._deviceWs) {
        const totalDuration = this._asrStats.totalSamples / 16000;
        console.log(
          `[ASR前端] 会话结束: session_id=${this._asrSessionId}, 总块数=${this._asrStats.totalChunks},` +
          ` 总字节=${this._asrStats.totalBytes}, 估算时长=${totalDuration.toFixed(3)}s`
        );
        this._deviceWs.send(JSON.stringify({
          type: 'asr_session_stop',
          device_id: 'webclient',
          session_id: this._asrSessionId,
          duration: Number.isFinite(totalDuration) ? Number(totalDuration.toFixed(3)) : undefined
        }));
      }
    } finally {
      this._micActive = false;
      document.getElementById('micBtn')?.classList.remove('recording');
      this._audioCtx = null;
      this._micStream = null;
      this._audioProcessor = null;
      this._asrSessionId = null;
      this._audioBuffer = [];
      this._preAudioBuffer = [];
      this._micStopping = false;
    }
  }

  // ========== Toast ==========
  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    
    const icons = { success: '✓', error: '✗', warning: '⚠', info: 'ℹ' };
    
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
    
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('hide');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// 初始化应用
new App();