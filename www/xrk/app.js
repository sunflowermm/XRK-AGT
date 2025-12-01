/**
 * XRK-AGT控制台
 * 重构版 - 企业级简洁设计
 */

class App {
  constructor() {
    this.serverUrl = window.location.origin;
    this.currentPage = 'home';
    this.currentAPI = null;
    this.apiConfig = null;
    this.selectedFiles = [];
    this.jsonEditor = null;
    this._charts = {};
    this._metricsHistory = { 
      netRx: Array(30).fill(0), 
      netTx: Array(30).fill(0),
      _initialized: false,
      _lastTimestamp: null,
      _lastUpdate: null
    };
    this._chatHistory = this._loadChatHistory();
    this._deviceWs = null;
    this._micActive = false;
    this._ttsQueue = [];
    this._ttsPlaying = false;
    this._configState = null;
    this._schemaCache = {};
    this._llmOptions = { profiles: [], defaultProfile: '' };
    this._chatSettings = {
      workflow: 'device',  // 默认使用 device 工作流
      persona: localStorage.getItem('chatPersona') || '',
      profile: localStorage.getItem('chatProfile') || ''
    };
    this._chatStreamState = { running: false, source: null };
    this._activeEventSource = null;
    this._asrBubble = null;
    this._asrSessionId = null;
    this._asrChunkIndex = 0;
    this._systemThemeWatcher = null;
    this.theme = 'light';
    
    this.init();
  }

  async init() {
    await this.loadAPIConfig();
    this.bindEvents();
    this.loadSettings();
    await this.loadLlmOptions();
    this.checkConnection();
    this.handleRoute();
    this.ensureDeviceWs();
    
    window.addEventListener('hashchange', () => this.handleRoute());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.checkConnection();
        this.ensureDeviceWs();
      }
    });
    
    setInterval(() => {
      if (this.currentPage === 'home') this.loadSystemStatus();
    }, 60000);
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
        defaultProfile: data.defaultProfile || '',
        profiles: data.profiles || [],
        workflows: data.workflows || []
      };

      // 默认使用 device 工作流
        this._chatSettings.workflow = 'device';

      if (!this._chatSettings.profile && this._llmOptions.defaultProfile) {
        this._chatSettings.profile = this._llmOptions.defaultProfile;
      }
      localStorage.setItem('chatProfile', this._chatSettings.profile);

      this.refreshChatWorkflowOptions();
      this.refreshChatModelOptions();
    } catch (e) {
      console.warn('未能加载 LLM 档位信息:', e.message || e);
    }
  }

  bindEvents() {
    // 侧边栏
    document.getElementById('menuBtn')?.addEventListener('click', () => this.toggleSidebar());
    document.getElementById('sidebarClose')?.addEventListener('click', () => this.closeSidebar());
    document.getElementById('overlay')?.addEventListener('click', () => this.closeSidebar());
    
    // API列表返回按钮
    document.getElementById('apiListBackBtn')?.addEventListener('click', () => {
      // 返回到导航菜单，不关闭侧边栏
      const navMenu = document.getElementById('navMenu');
      const apiListContainer = document.getElementById('apiListContainer');
      if (navMenu && apiListContainer) {
        navMenu.style.display = 'flex';
        apiListContainer.style.display = 'none';
      }
    });
    
    // 主题切换
    document.getElementById('themeToggle')?.addEventListener('click', () => this.toggleTheme());
    
    // API Key
    document.getElementById('saveApiKeyBtn')?.addEventListener('click', () => this.saveApiKey());
    document.getElementById('apiKey')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.saveApiKey();
    });
    
    // 导航
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        if (page) this.navigateTo(page);
      });
    });
    
    // 快捷键
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && this.currentAPI) {
        e.preventDefault();
        this.executeRequest();
      }
    });
    
    // API Key 切换按钮
    document.getElementById('apiKeyToggleBtn')?.addEventListener('click', () => this.toggleApiKeyBox());
  }
  
  toggleApiKeyBox() {
    const apiKeyBox = document.getElementById('apiKeyBox');
    if (apiKeyBox) {
      apiKeyBox.classList.toggle('show');
    }
  }

  loadSettings() {
    const savedKey = localStorage.getItem('apiKey');
    if (savedKey) document.getElementById('apiKey').value = savedKey;
    
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
    try {
      if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch {}
    return 'light';
  }

  enableSystemThemeSync() {
    if (!window.matchMedia || this._systemThemeWatcher) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event) => {
      if (!localStorage.getItem('theme')) {
        this.applyTheme(event.matches ? 'dark' : 'light');
      }
    };
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
    } else {
      mql.addListener?.(handler);
    }
    this._systemThemeWatcher = { mql, handler };
  }

  disableSystemThemeSync() {
    if (!this._systemThemeWatcher) return;
    const { mql, handler } = this._systemThemeWatcher;
    mql.removeEventListener?.('change', handler);
    mql.removeListener?.(handler);
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
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    sidebar?.classList.toggle('open');
    overlay?.classList.toggle('show');
  }

  openSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    sidebar?.classList.add('open');
    overlay?.classList.add('show');
  }

  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
  }

  saveApiKey() {
    const key = document.getElementById('apiKey')?.value?.trim();
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
    try {
      const res = await fetch(`${this.serverUrl}/api/health`, { headers: this.getHeaders() });
      const status = document.getElementById('connectionStatus');
      if (res.ok) {
        status.classList.add('online');
        status.querySelector('.status-text').textContent = '已连接';
      } else {
        status.classList.remove('online');
        status.querySelector('.status-text').textContent = '未授权';
      }
    } catch {
      const status = document.getElementById('connectionStatus');
      status.classList.remove('online');
      status.querySelector('.status-text').textContent = '连接失败';
    }
  }

  handleRoute() {
    const hash = location.hash.replace(/^#\/?/, '') || 'home';
    const page = hash.split('?')[0];
    this.navigateTo(page);
  }

  navigateTo(page) {
    this.currentPage = page;
    
    // 更新导航状态
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });
    
    // 更新标题
    const titles = { home: '系统概览', chat: 'AI 对话', config: '配置管理', api: 'API 调试' };
    const headerTitle = document.getElementById('headerTitle');
    if (headerTitle) {
      headerTitle.textContent = titles[page] || page;
    }
    
    // 侧边栏内容切换：API调试页面显示API列表，其他页面显示导航
    const navMenu = document.getElementById('navMenu');
    const apiListContainer = document.getElementById('apiListContainer');
    
    if (page === 'api') {
      navMenu.style.display = 'none';
      apiListContainer.style.display = 'flex';
      this.renderAPIGroups();
      if (window.innerWidth <= 768) {
        this.openSidebar();
      }
    } else {
      navMenu.style.display = 'flex';
      apiListContainer.style.display = 'none';
      if (window.innerWidth <= 768) {
        this.closeSidebar();
      }
    }
    
    // 渲染页面
    switch (page) {
      case 'home': this.renderHome(); break;
      case 'chat': this.renderChat(); break;
      case 'config': this.renderConfig(); break;
      case 'api': this.renderAPI(); break;
      default: this.renderHome();
    }
    
    location.hash = `#/${page}`;
  }

  // ========== 首页 ==========
  async renderHome() {
    // 销毁旧的图表实例
    if (this._charts.cpu) {
      this._charts.cpu.destroy();
      this._charts.cpu = null;
    }
    if (this._charts.mem) {
      this._charts.mem.destroy();
      this._charts.mem = null;
    }
    if (this._charts.net) {
      this._charts.net.destroy();
      this._charts.net = null;
    }
    
    const content = document.getElementById('content');
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
    
    this.loadSystemStatus();
    this.loadPluginsInfo();
  }

  async loadSystemStatus() {
    try {
      const res = await fetch(`${this.serverUrl}/api/system/overview?withHistory=1`, { headers: this.getHeaders() });
      if (!res.ok) throw new Error('接口异常');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '获取失败');
      this._latestSystem = data;
      this.updateSystemStatus(data);
      // 确保数据正确传递
      this.renderBotsPanel(data.bots || []);
      this.renderWorkflowInfo(data.workflows || {}, data.panels || {});
      this.renderNetworkInfo(data.system?.network || {}, data.system?.netRates || {});
      // 更新工作流选项（如果LLM选项已加载）
      if (this._llmOptions?.workflows) {
        this.refreshChatWorkflowOptions();
      }
    } catch (e) {
      console.error('Failed to load system status:', e);
      this.renderBotsPanel();
      this.renderWorkflowInfo();
      this.renderNetworkInfo();
    }
  }
  
  async loadBotsInfo() {
    try {
      const res = await fetch(`${this.serverUrl}/api/status`, { headers: this.getHeaders() });
      if (!res.ok) throw new Error('接口异常');
      const data = await res.json();
      this.renderBotsPanel(data.bots || []);
    } catch {
      this.renderBotsPanel();
    }
  }
  
  renderBotsPanel(bots = []) {
      const botsInfo = document.getElementById('botsInfo');
      if (!botsInfo) return;
    if (!Array.isArray(bots) || !bots.length) {
      botsInfo.innerHTML = '<div style="color:var(--text-muted);padding:16px">暂无机器人</div>';
      return;
    }
      
        botsInfo.innerHTML = `
          <div style="display:grid;gap:0">
        ${bots.map((bot, index) => `
          <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;${index < bots.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}transition:background var(--transition);cursor:pointer" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
            <div style="width:40px;height:40px;border-radius:16px;background:var(--bg-muted);display:flex;align-items:center;justify-content:center;font-weight:600;color:var(--primary)">
              ${bot.nickname?.slice(0,2) || bot.uin?.slice(-2) || '??'}
            </div>
                <div style="flex:1;min-width:0;text-align:left">
              <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;font-size:14px;text-align:left">${this.escapeHtml(bot.nickname || bot.uin)}</div>
                  <div style="font-size:12px;color:var(--text-muted);line-height:1.4;text-align:left">
                    ${bot.adapter || '未知适配器'}${bot.device ? '' : ` · ${bot.stats?.friends || 0} 好友 · ${bot.stats?.groups || 0} 群组`}
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
  }
  
  renderWorkflowInfo(workflows = {}, panels = {}) {
    const box = document.getElementById('workflowInfo');
    if (!box) return;
    // 优先使用 panels.workflows，其次使用 workflows
    const workflowData = panels?.workflows || workflows;
    const stats = workflowData?.stats || {};
    const items = workflowData?.items || [];
    const total = stats?.total ?? workflowData?.total ?? 0;
    if (!total && !items.length) {
      box.innerHTML = '<div style="color:var(--text-muted);padding:16px">暂无工作流数据</div>';
      return;
    }
    
    const enabled = stats?.enabled ?? workflowData?.enabled ?? 0;
    const totalCount = total;
    const embeddingReady = stats?.embeddingReady ?? workflowData?.embeddingReady ?? 0;
    const provider = stats?.provider ?? workflowData?.provider ?? '默认';
    
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
              <div style="font-weight:600;color:var(--text-primary)">${this.escapeHtml(item.name || 'workflow')}</div>
              <div style="font-size:12px;color:var(--text-muted)">${this.escapeHtml(item.description || '')}</div>
            </li>
          `).join('')}
        </ul>
      ` : ''}
    `;
  }
  
  renderNetworkInfo(network = {}, rates = {}) {
    const box = document.getElementById('networkInfo');
    if (!box) return;
    // 确保 network 是对象
    const networkObj = network && typeof network === 'object' ? network : {};
    const entries = Object.entries(networkObj);
    if (!entries.length) {
      box.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">暂无网络信息</div>';
      return;
    }
    const rxSec = rates?.rxSec ?? rates?.rx ?? 0;
    const txSec = rates?.txSec ?? rates?.tx ?? 0;
    const rateText = `${Math.max(0, rxSec / 1024).toFixed(1)} KB/s ↓ · ${Math.max(0, txSec / 1024).toFixed(1)} KB/s ↑`;
    box.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;text-align:center;line-height:1.4">${rateText}</div>
      ${entries.map(([name, info]) => {
        const address = info?.address || '';
        const mac = info?.mac || '';
        return `
        <div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="font-weight:600;color:var(--text-primary);text-align:center">${this.escapeHtml(name)}</div>
          <div style="font-size:12px;color:var(--text-muted);text-align:center;line-height:1.4">IP: ${this.escapeHtml(address)}${mac ? ` · MAC: ${this.escapeHtml(mac)}` : ''}</div>
        </div>
      `;
      }).join('')}
    `;
  }
  
  async loadPluginsInfo() {
    try {
      const res = await fetch(`${this.serverUrl}/api/plugins/summary`, { headers: this.getHeaders() });
      const pluginsInfo = document.getElementById('pluginsInfo');
      if (!pluginsInfo) return;
      if (!res.ok) throw new Error('接口异常');
      const data = await res.json();
      if (!data.success) throw new Error(data.message || '获取失败');
      const summary = data.summary || {};
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
      const pluginsInfo = document.getElementById('pluginsInfo');
      if (pluginsInfo) pluginsInfo.innerHTML = `<div style="color:var(--danger)">加载失败：${e.message || ''}</div>`;
    }
  }

  updateSystemStatus(data) {
    const { system } = data;
    const panels = data.panels || {};
    const metrics = panels.metrics || {};
    
    const formatUptime = (s) => {
      if (!s || s === 0) return '0分钟';
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (d > 0) return `${d}天 ${h}小时`;
      if (h > 0) return `${h}小时 ${m}分钟`;
      return `${m}分钟`;
    };
    
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
      uptimeEl.textContent = formatUptime(system?.uptime || data.bot?.uptime);
    }
    
    // 更新网络历史：优先使用后端返回的实时数据
    const netRecent = system?.netRecent || [];
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
    
    // 更新进程表
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

  updateCharts(cpu, mem) {
    if (!window.Chart) return;
    
    const primary = getComputedStyle(document.body).getPropertyValue('--primary').trim() || '#0ea5e9';
    const success = getComputedStyle(document.body).getPropertyValue('--success').trim() || '#22c55e';
    const warning = getComputedStyle(document.body).getPropertyValue('--warning').trim() || '#f59e0b';
    const danger = getComputedStyle(document.body).getPropertyValue('--danger').trim() || '#ef4444';
    const textMuted = getComputedStyle(document.body).getPropertyValue('--text-muted').trim() || '#94a3b8';
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
        const cpuChart = new Chart(cpuCtx.getContext('2d'), {
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
        
        // 添加中心标签插件（仅应用于doughnut类型图表）
        const cpuLabelPlugin = {
          id: 'cpuLabel',
          afterDraw: (chart) => {
            // 只对doughnut类型图表应用，并且只对CPU图表应用
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
        Chart.register(cpuLabelPlugin);
        
        this._charts.cpu = cpuChart;
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
        const memChart = new Chart(memCtx.getContext('2d'), {
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
        
        // 添加中心标签插件（仅应用于doughnut类型图表）
        const memLabelPlugin = {
          id: 'memLabel',
          afterDraw: (chart) => {
            // 只对doughnut类型图表应用，并且只对内存图表应用
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
        Chart.register(memLabelPlugin);
        
        this._charts.mem = memChart;
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
      // 如果图表实例存在但canvas元素不匹配，销毁并重新创建
      if (this._charts.net && this._charts.net.canvas !== netCtx) {
        this._charts.net.destroy();
        this._charts.net = null;
      }
      
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
  renderChat() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="chat-container">
        <div class="chat-header">
          <div class="chat-header-title">
            <span class="emotion-display" id="emotionIcon">😊</span>
            <span>AI 对话</span>
          </div>
          <div class="chat-header-actions">
            <button class="btn btn-sm btn-secondary" id="clearChatBtn">清空</button>
          </div>
        </div>
        <div class="chat-settings">
          <div class="chat-setting">
            <label>模型
              <select id="chatModelSelect"></select>
            </label>
          </div>
          <div class="chat-setting">
            <label>人设
              <input type="text" id="chatPersonaInput" placeholder="自定义人设...">
            </label>
          </div>
          <button class="btn btn-sm btn-ghost" id="cancelStreamBtn" disabled>中断</button>
          <span class="chat-stream-status" id="chatStreamStatus">空闲</span>
        </div>
        <div class="chat-messages" id="chatMessages"></div>
        <div class="chat-input-area">
          <button class="mic-btn" id="micBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
              <path d="M19 10v2a7 7 0 01-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
          <input type="text" class="chat-input" id="chatInput" placeholder="输入消息...">
          <button class="chat-send-btn" id="chatSendBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22,2 15,22 11,13 2,9"/>
            </svg>
          </button>
        </div>
      </div>
    `;
    
    document.getElementById('chatSendBtn').addEventListener('click', () => this.sendChatMessage());
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChatMessage();
    });
    document.getElementById('micBtn').addEventListener('click', () => this.toggleMic());
    document.getElementById('clearChatBtn').addEventListener('click', () => this.clearChat());
    this.initChatControls();
    
    this.restoreChatHistory();
    this.ensureDeviceWs();
  }
  

  _loadChatHistory() {
    try {
      return JSON.parse(localStorage.getItem('chatHistory') || '[]');
    } catch { return []; }
  }

  _saveChatHistory() {
    localStorage.setItem('chatHistory', JSON.stringify(this._chatHistory.slice(-200)));
  }

  restoreChatHistory() {
    const box = document.getElementById('chatMessages');
    if (!box) return;
    box.innerHTML = '';
    this._chatHistory.forEach(m => {
      const div = document.createElement('div');
      div.className = `chat-message ${m.role}`;
      div.textContent = m.text;
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  }

  appendChat(role, text, persist = true) {
    if (persist) {
      this._chatHistory.push({ role, text, ts: Date.now() });
      this._saveChatHistory();
    }
    const box = document.getElementById('chatMessages');
    if (box) {
      const div = document.createElement('div');
      div.className = `chat-message ${role}`;
      div.textContent = text;
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
    }
  }

  clearChat() {
    this._chatHistory = [];
    this._saveChatHistory();
    const box = document.getElementById('chatMessages');
    if (box) box.innerHTML = '';
  }

  async sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input?.value?.trim();
    if (!text) return;
    
    input.value = '';
    
    try {
      await this.streamAIResponse(text, { appendUser: true, source: 'manual' });
    } catch (e) {
      this.showToast('发送失败: ' + e.message, 'error');
    }
  }

  initChatControls() {
    const modelSelect = document.getElementById('chatModelSelect');
    if (modelSelect) {
      this.populateModelSelect(modelSelect);
      const currentProfile = this.getCurrentProfile();
      if (currentProfile) {
        const optionExists = Array.from(modelSelect.options).some(opt => opt.value === currentProfile);
        modelSelect.value = optionExists ? currentProfile : (modelSelect.options[0]?.value || '');
      }
      modelSelect.addEventListener('change', () => {
        this._chatSettings.profile = modelSelect.value;
        localStorage.setItem('chatProfile', this._chatSettings.profile);
      });
    }
    
    const personaInput = document.getElementById('chatPersonaInput');
    if (personaInput) {
      personaInput.value = this._chatSettings.persona || '';
      personaInput.addEventListener('input', (e) => {
        this._chatSettings.persona = e.target.value;
        localStorage.setItem('chatPersona', this._chatSettings.persona);
      });
    }
    
    const cancelBtn = document.getElementById('cancelStreamBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.cancelAIStream());
    }
    
    this.updateChatStatus();
    this.setChatInteractionState(this._chatStreamState.running);
  }

  populateModelSelect(select) {
    const options = this.getModelOptions();
    select.innerHTML = options.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
  }

  refreshChatModelOptions() {
    const select = document.getElementById('chatModelSelect');
    if (!select) return;
    const previous = this.getCurrentProfile();
    this.populateModelSelect(select);
    const match = Array.from(select.options).some(opt => opt.value === previous);
    if (match) {
      select.value = previous;
    } else if (select.options.length) {
      select.selectedIndex = 0;
      this._chatSettings.profile = select.value;
      localStorage.setItem('chatProfile', this._chatSettings.profile);
    }
  }

  refreshChatWorkflowOptions() {
    // 刷新聊天工作流选项（如果存在工作流选择器）
    // 目前UI中可能没有工作流选择器，此方法保留以兼容现有调用
    const select = document.getElementById('chatWorkflowSelect');
    if (!select) return;
    const workflows = this._llmOptions?.workflows || [];
    const currentWorkflow = this._chatSettings.workflow || 'device';
    select.innerHTML = workflows.map(wf => 
      `<option value="${this.escapeHtml(wf.name || wf)}">${this.escapeHtml(wf.description || wf.name || wf)}</option>`
    ).join('');
    if (Array.from(select.options).some(opt => opt.value === currentWorkflow)) {
      select.value = currentWorkflow;
    } else if (select.options.length) {
      select.selectedIndex = 0;
      this._chatSettings.workflow = select.value;
    }
  }

  getModelOptions() {
    const configured = (this._llmOptions?.profiles || []).map(item => ({
      value: item.key,
      label: item.label ? `${item.label}${item.label === item.key ? '' : ` (${item.key})`}` : item.key
    })).filter(opt => opt.value);

    if (configured.length) {
      return configured;
    }

    return [
      { value: this._chatSettings.profile || 'balanced', label: '默认' }
    ];
  }
  
  getCurrentPersona() {
    return this._chatSettings.persona?.trim() || '';
  }

  getCurrentProfile() {
    return this._chatSettings.profile || this._llmOptions?.defaultProfile || '';
  }
  
  updateChatStatus(message) {
    const statusEl = document.getElementById('chatStreamStatus');
    const cancelBtn = document.getElementById('cancelStreamBtn');
    if (!statusEl) return;
    
    if (this._chatStreamState.running) {
      statusEl.textContent = message || `${this._chatStreamState.source === 'voice' ? '语音' : '文本'}生成中...`;
      statusEl.classList.add('active');
      if (cancelBtn) cancelBtn.disabled = false;
    } else {
      statusEl.textContent = '空闲';
      statusEl.classList.remove('active');
      if (cancelBtn) cancelBtn.disabled = true;
    }
  }
  
  setChatInteractionState(streaming) {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');
    if (input) input.disabled = streaming;
    if (sendBtn) sendBtn.disabled = streaming;
  }
  
  stopActiveStream() {
    if (this._activeEventSource) {
      try {
        this._activeEventSource.close();
      } catch {}
      this._activeEventSource = null;
    }
    this._chatStreamState = { running: false, source: null };
    this.updateChatStatus();
    this.setChatInteractionState(false);
  }
  
  cancelAIStream() {
    if (!this._chatStreamState.running) return;
    this.stopActiveStream();
    this.renderStreamingMessage('', true);
    this.showToast('已中断 AI 输出', 'info');
  }
  
  async streamAIResponse(prompt, options = {}) {
    const text = prompt?.trim();
    if (!text) return;
    
    const { appendUser = false, source = 'manual' } = options;
    if (appendUser) {
      this.appendChat('user', text);
    }
    
    // 默认使用 device 工作流
    const workflow = 'device';
    const persona = this.getCurrentPersona();
    const profile = this.getCurrentProfile();
    const recentHistory = this._chatHistory.slice(-8).map(m => ({ role: m.role, text: m.text }));
    const ctxSummary = recentHistory.map(m => `${m.role === 'user' ? 'U' : 'A'}:${m.text}`).join('|').slice(-800);
    const finalPrompt = ctxSummary ? `【上下文】${ctxSummary}\n【提问】${text}` : text;
    
    const params = new URLSearchParams({
      prompt: finalPrompt,
      workflow,
      persona
    });
    if (profile) {
      params.set('profile', profile);
    }
    if (recentHistory.length) {
      params.set('context', JSON.stringify(recentHistory));
    }
    
    this.stopActiveStream();
    this.renderStreamingMessage('', true);
    this._chatStreamState = { running: true, source };
    this.updateChatStatus('AI 生成中...');
    this.setChatInteractionState(true);
    
    const es = new EventSource(`${this.serverUrl}/api/ai/stream?${params.toString()}`);
    this._activeEventSource = es;
    let acc = '';
    
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data || '{}');
        if (data.delta) {
          acc += data.delta;
          this.renderStreamingMessage(acc);
          this.updateChatStatus(`AI 输出中 (${acc.length} 字)`);
        }
        if (data.done) {
          es.close();
          if (this._activeEventSource === es) this._activeEventSource = null;
          this.renderStreamingMessage(acc, true);
          this.stopActiveStream();
        }
        if (data.error) {
          es.close();
          if (this._activeEventSource === es) this._activeEventSource = null;
          this.stopActiveStream();
          this.showToast('AI错误: ' + data.error, 'error');
        }
      } catch {}
    };
    
    es.onerror = () => {
      es.close();
      if (this._activeEventSource === es) {
        this._activeEventSource = null;
      }
      this.stopActiveStream();
      this.showToast('AI流已中断', 'warning');
    };
  }

  renderStreamingMessage(text, done = false) {
    const box = document.getElementById('chatMessages');
    if (!box) return;
    
    let msg = box.querySelector('.chat-message.assistant.streaming');
    if (!msg && !done) {
      msg = document.createElement('div');
      msg.className = 'chat-message assistant streaming';
      box.appendChild(msg);
    }
    
    if (!msg) return;
    
    msg.textContent = text;
    
    if (done) {
      msg.classList.remove('streaming');
      if (text) {
        this._chatHistory.push({ role: 'assistant', text, ts: Date.now() });
        this._saveChatHistory();
      } else {
        msg.remove();
      }
      this.updateChatStatus();
    } else {
      this.updateChatStatus(`AI 输出中 (${text.length} 字)`);
    }
    
    box.scrollTop = box.scrollHeight;
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
    
    document.getElementById('configSearchInput')?.addEventListener('input', (e) => {
      if (!this._configState) return;
      this._configState.filter = e.target.value.trim().toLowerCase();
      this.renderConfigList();
    });

    this.loadConfigList();
  }

  renderConfigPlaceholder() {
    return `
      <div class="config-empty">
        <h2>选择左侧配置开始</h2>
        <p>支持表单 + JSON 双模式，所有提交均通过 ConfigBase schema 严格校验。</p>
      </div>
    `;
  }

  async loadConfigList() {
    const list = document.getElementById('configList');
    try {
      const res = await fetch(`${this.serverUrl}/api/config/list`, { headers: this.getHeaders() });
      if (!res.ok) throw new Error('获取配置列表失败');
      const data = await res.json();
      if (!data.success) throw new Error(data.message || '接口返回失败');
      if (!this._configState) return;
      this._configState.list = data.configs || [];
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
        list.innerHTML = '<div class="empty-state"><p>暂无配置</p></div>';
        return;
      }
      
    const keyword = this._configState.filter;
    const filtered = this._configState.list.filter(cfg => {
      if (!keyword) return true;
      const text = `${cfg.name} ${cfg.displayName || ''} ${cfg.description || ''}`.toLowerCase();
      return text.includes(keyword);
    });

    if (!filtered.length) {
      list.innerHTML = '<div class="empty-state"><p>没有符合条件的配置</p></div>';
      return;
    }

    list.innerHTML = filtered.map(cfg => {
      const title = this.escapeHtml(cfg.displayName || cfg.name);
      const desc = this.escapeHtml(cfg.description || cfg.filePath || '');
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
      
      list.querySelectorAll('.config-item').forEach(item => {
      item.addEventListener('click', () => this.selectConfig(item.dataset.name));
    });
  }

  selectConfig(name, child = null) {
    if (!this._configState) return;
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

    this.renderConfigMainSkeleton();

    if (config.name === 'system' && !child) {
      this.renderSystemConfigChooser(config);
      return;
    }

    this.loadSelectedConfigDetail();
  }

  renderConfigMainSkeleton() {
    const main = document.getElementById('configMain');
    if (!main) return;
    main.innerHTML = `
      <div class="empty-state">
        <div class="loading-spinner" style="margin:0 auto"></div>
        <p style="margin-top:12px">加载配置详情...</p>
          </div>
    `;
  }

  renderSystemConfigChooser(config) {
    const main = document.getElementById('configMain');
    if (!main) return;

    const entries = Object.entries(config.configs || {});
    if (!entries.length) {
      main.innerHTML = '<div class="empty-state"><p>SystemConfig 未定义子配置</p></div>';
      return;
    }

    main.innerHTML = `
      <div class="config-main-header">
        <div>
          <h2>${this.escapeHtml(config.displayName || config.name)}</h2>
          <p>${this.escapeHtml(config.description || '')}</p>
          </div>
        </div>
      <div class="config-grid">
        ${entries.map(([key, meta]) => `
          <div class="config-subcard" data-child="${this.escapeHtml(key)}">
            <div>
              <div class="config-subcard-title">${this.escapeHtml(meta.displayName || key)}</div>
              <p class="config-subcard-desc">${this.escapeHtml(meta.description || '')}</p>
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
      if (!flatStruct.success) throw new Error(flatStruct.message || '结构接口异常');
      if (!flatData.success) throw new Error(flatData.message || '数据接口异常');

      const schemaList = (flatStruct.flat || []).filter(field => field.path);
      const values = flatData.flat || {};

      const activeSchema = this.extractActiveSchema(structure, name, child) || { fields: {} };
      this._configState.activeSchema = activeSchema;
      this._configState.structureMeta = activeSchema.meta || {};
      this._configState.arraySchemaMap = this.buildArraySchemaIndex(activeSchema);
      this._configState.dynamicCollectionsMeta = this.buildDynamicCollectionsMeta(activeSchema);
      this._configState.flatSchema = schemaList;

      const normalizedValues = this.normalizeIncomingFlatValues(schemaList, values);
      this._configState.values = normalizedValues;
      this._configState.original = this._cloneFlat(normalizedValues);
      this._configState.rawObject = this.unflattenObject(normalizedValues);
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
      return target?.schema || { fields: target?.fields || {} };
    }
    return structure.schema || { fields: structure.fields || {} };
  }

  buildArraySchemaIndex(schema, prefix = '', map = {}) {
    if (!schema || !schema.fields) return map;
    for (const [key, fieldSchema] of Object.entries(schema.fields)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (fieldSchema.type === 'array' && fieldSchema.itemType === 'object') {
        const subFields = fieldSchema.itemSchema?.fields || fieldSchema.fields || {};
        map[path] = subFields;
      }
      if ((fieldSchema.type === 'object' || fieldSchema.type === 'map') && fieldSchema.fields) {
        this.buildArraySchemaIndex(fieldSchema, path, map);
      }
    }
    return map;
  }

  buildDynamicCollectionsMeta(schema) {
    const collections = schema?.meta?.collections || [];
    return collections.map(item => {
      const template = this.getSchemaNodeByPath(item.valueTemplatePath, schema);
      return {
        ...item,
        valueFields: template?.fields || {}
      };
    });
  }

  normalizeIncomingFlatValues(flatSchema, values) {
    const normalized = { ...values };
    if (!Array.isArray(flatSchema)) return normalized;
    flatSchema.forEach(field => {
      if (!Object.prototype.hasOwnProperty.call(normalized, field.path)) return;
      normalized[field.path] = this.normalizeFieldValue(
        normalized[field.path],
        field.meta || {},
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

    const title = this.escapeHtml(selected.displayName || selected.name);
    const childLabel = selectedChild ? ` / ${this.escapeHtml(selectedChild)}` : '';
    const descText = this.escapeHtml(selectedChild && selected.configs ? selected.configs[selectedChild]?.description || '' : selected.description || '');

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

    document.getElementById('configReloadBtn')?.addEventListener('click', () => this.loadSelectedConfigDetail());
    main.querySelectorAll('.config-mode-toggle button').forEach(btn => {
      btn.addEventListener('click', () => this.switchConfigMode(btn.dataset.mode));
    });
    document.getElementById('configSaveBtn')?.addEventListener('click', () => this.saveConfigChanges());

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
      return '<div class="empty-state"><p>该配置暂无扁平结构，可切换 JSON 模式编辑。</p></div>';
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
      const meta = field.meta || {};
      const component = (meta.component || '').toLowerCase();
      if (component === 'subform' || (field.type === 'object' && meta.component !== 'json')) {
        subFormFields.set(field.path, {
          label: meta.label || field.path.split('.').pop() || field.path,
          description: meta.description || '',
          group: meta.group || null
        });
      }
    });
    
    // 第二遍：构建字段树
    flatSchema.forEach(field => {
      const meta = field.meta || {};
      const path = field.path;
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
      
      // 如果还是没有 group，根据路径确定
      if (!groupKey) {
        if (parts.length === 1) {
          // 顶级字段，使用字段名作为分组
          groupKey = parts[0];
        } else if (parts.length === 2) {
          // 二级字段，使用第一部分作为分组
          groupKey = parts[0];
        } else {
          // 更深层的字段，使用前两部分作为分组
          groupKey = parts.slice(0, 2).join('.');
        }
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
        // 这是 SubForm 字段本身，如果有子字段则不在顶级显示
        const hasChildren = flatSchema.some(f => f.path.startsWith(path + '.'));
        if (!hasChildren) {
          // 没有子字段，作为普通字段显示
          if (!tree[groupKey]) {
            tree[groupKey] = { fields: [], subGroups: {} };
          }
          tree[groupKey].fields.push(field);
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
    
    // 如果包含点，说明是嵌套路径，取最后一部分
    if (key.includes('.')) {
      const parts = key.split('.');
      // 对于 llm.defaults 这样的路径，返回 "LLM 默认参数"
      if (parts.length === 2) {
        const [parent, child] = parts;
        const parentLabel = this.getFieldLabel(parent);
        const childLabel = this.getFieldLabel(child);
        return `${parentLabel} - ${childLabel}`;
      }
      return this.getFieldLabel(parts[parts.length - 1]);
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
      const groupDesc = group.fields[0]?.meta?.groupDesc || '';
      const totalFields = group.fields.length + Object.values(group.subGroups).reduce((sum, sg) => sum + sg.fields.length, 0);
      
      // 渲染子分组（SubForm），子分组内的字段也需要按分组显示
      const subGroupsHtml = Object.entries(group.subGroups).map(([subPath, subGroup]) => {
        // 对子分组内的字段进行分组
        const subFieldGroups = this.groupFieldsByMeta(subGroup.fields);
        
        const subFieldsHtml = Array.from(subFieldGroups.entries()).map(([subGroupKey, subFields]) => {
          const subGroupLabel = this.formatGroupLabel(subGroupKey);
          
          return `
            <div class="config-subgroup-section">
              ${subFieldGroups.size > 1 ? `
                <div class="config-subgroup-section-header">
                  <h5>${this.escapeHtml(subGroupLabel)}</h5>
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
      const meta = field.meta || {};
      const groupKey = meta.group || '默认';
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey).push(field);
    });
    
    return groups;
  }

  renderConfigField(field) {
    const meta = field.meta || {};
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
    const meta = field.meta || {};
    const component = meta.component || field.component || this.mapTypeToComponent(field.type);
    const dataset = `data-field="${this.escapeHtml(field.path)}" data-component="${component || ''}" data-type="${field.type}"`;
    const disabled = meta.readonly ? 'disabled' : '';
    const placeholder = this.escapeHtml(meta.placeholder || '');

    const normalizeOptions = (options = []) => options.map(opt => {
      if (typeof opt === 'object') return opt;
      return { label: opt, value: opt };
    });

    const lowerComponent = (component || '').toLowerCase();
    const isArrayObject = field.type === 'array<object>' || (lowerComponent === 'arrayform' && meta.itemType === 'object');
    if (isArrayObject) {
      return this.renderArrayObjectControl(field, Array.isArray(value) ? value : [], meta);
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
        const opts = normalizeOptions(meta.enum || meta.options || []);
        const current = value ?? '';
        return `
          <select class="form-input" id="${inputId}" ${dataset} ${disabled}>
            ${opts.map(opt => `<option value="${this.escapeHtml(opt.value)}" ${String(opt.value) === String(current) ? 'selected' : ''}>${this.escapeHtml(opt.label)}</option>`).join('')}
          </select>
        `;
      }
      case 'multiselect': {
        const opts = normalizeOptions(meta.enum || meta.options || []);
        const current = Array.isArray(value) ? value.map(v => String(v)) : [];
        return `
          <select class="form-input" id="${inputId}" multiple ${dataset} data-control="multiselect" ${disabled}>
            ${opts.map(opt => `<option value="${this.escapeHtml(opt.value)}" ${current.includes(String(opt.value)) ? 'selected' : ''}>${this.escapeHtml(opt.label)}</option>`).join('')}
          </select>
          <p class="config-field-hint">按住 Ctrl/Command 多选</p>
        `;
      }
      case 'tags': {
        const text = this.escapeHtml(Array.isArray(value) ? value.join('\n') : (value || ''));
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
        // SubForm 类型：检查是否有子字段，如果有则展开显示，否则显示 JSON 编辑器
        const subFields = this.getSubFormFields(field.path);
        if (subFields && subFields.length > 0) {
          // 有子字段，在 renderFieldTree 中已经展开显示，这里返回空
          // 但为了兼容，我们返回一个占位符提示
          return `<div class="config-subform-placeholder">
            <p class="config-field-hint">该配置项已展开显示在下方分组中</p>
          </div>`;
        }
        // 没有子字段，使用 JSON 编辑器
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
        <textarea id="configJsonTextarea" rows="20">${this.escapeHtml(this._configState?.jsonText || '')}</textarea>
        <div class="config-json-actions">
          <button class="btn btn-secondary" id="configJsonFormatBtn">格式化</button>
          <p class="config-field-hint">JSON 模式会覆盖整份配置，提交前请仔细校验。</p>
        </div>
      </div>
    `;
  }

  renderArrayObjectControl(field, items = [], meta = {}) {
    const subFields = this._configState.arraySchemaMap[field.path] || meta.itemSchema?.fields || meta.fields || {};
    const itemLabel = meta.itemLabel || '条目';
    const body = items.length
      ? items.map((item, idx) => this.renderArrayObjectItem(field.path, subFields, item || {}, idx, itemLabel)).join('')
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
    return Object.entries(fields || {}).map(([key, schema]) => {
      const relPath = basePath ? `${basePath}.${key}` : key;
      const templatePath = `${parentPath}[].${relPath}`;
      const value = this.getNestedValue(itemValue, relPath);
      if ((schema.type === 'object' || schema.type === 'map') && schema.fields) {
        return `
          <div class="array-object-subgroup">
            <div class="array-object-subgroup-title">${this.escapeHtml(schema.label || key)}</div>
            ${this.renderArrayObjectFields(parentPath, schema.fields, value || {}, index, relPath)}
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
    const component = (schema.component || this.mapTypeToComponent(schema.type) || '').toLowerCase();
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
        const opts = normalizeOptions(schema.enum || schema.options || []);
        const current = value ?? '';
        return `
          <select class="form-input" ${dataset}>
            ${opts.map(opt => `<option value="${this.escapeHtml(opt.value)}" ${String(opt.value) === String(current) ? 'selected' : ''}>${this.escapeHtml(opt.label)}</option>`).join('')}
          </select>
        `;
      }
      case 'multiselect': {
        const opts = normalizeOptions(schema.enum || schema.options || []);
        const current = Array.isArray(value) ? value.map(v => String(v)) : [];
        return `
          <select class="form-input" multiple ${dataset} data-control="multiselect">
            ${opts.map(opt => `<option value="${this.escapeHtml(opt.value)}" ${current.includes(String(opt.value)) ? 'selected' : ''}>${this.escapeHtml(opt.label)}</option>`).join('')}
          </select>
        `;
      }
      case 'tags': {
        const text = this.escapeHtml(Array.isArray(value) ? value.join('\n') : (value || ''));
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
    const collections = this._configState?.dynamicCollectionsMeta || [];
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
            <h3>${this.escapeHtml(collection.label || collection.name)}</h3>
            <p>${this.escapeHtml(collection.description || '')}</p>
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
          ${this.renderDynamicFields(collection, collection.valueFields || {}, entry.value || {}, entry.key)}
        </div>
      </div>
    `;
  }

  getDynamicCollectionEntries(collection) {
    const source = this.getValueFromObject(this._configState?.rawObject || {}, collection.basePath || '');
    const exclude = new Set(collection.excludeKeys || []);
    return Object.entries(source || {})
      .filter(([key]) => !exclude.has(key))
      .map(([key, value]) => ({ key, value }));
  }

  renderDynamicFields(collection, fields, value, entryKey, basePath = '') {
    return Object.entries(fields || {}).map(([key, schema]) => {
      const relPath = basePath ? `${basePath}.${key}` : key;
      const templatePathBase = collection.valueTemplatePath || '';
      const templatePath = this.normalizeTemplatePath(templatePathBase ? `${templatePathBase}.${relPath}` : relPath);
      const fieldValue = this.getNestedValue(value, relPath);

      if ((schema.type === 'object' || schema.type === 'map') && schema.fields) {
        return `
          <div class="array-object-subgroup">
            <div class="array-object-subgroup-title">${this.escapeHtml(schema.label || key)}</div>
            ${this.renderDynamicFields(collection, schema.fields, fieldValue || {}, entryKey, relPath)}
          </div>
        `;
      }

      const dataset = `data-collection="${this.escapeHtml(collection.name)}" data-entry-key="${this.escapeHtml(entryKey)}" data-object-path="${this.escapeHtml(relPath)}" data-template-path="${this.escapeHtml(templatePath)}" data-component="${(schema.component || '').toLowerCase()}" data-type="${schema.type}"`;
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
    const component = (schema.component || this.mapTypeToComponent(schema.type) || '').toLowerCase();
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
        const opts = normalizeOptions(schema.enum || schema.options || []);
        const current = value ?? '';
        return `
          <select class="form-input" ${dataset}>
            ${opts.map(opt => `<option value="${this.escapeHtml(opt.value)}" ${String(opt.value) === String(current) ? 'selected' : ''}>${this.escapeHtml(opt.label)}</option>`).join('')}
          </select>
        `;
      }
      case 'multiselect': {
        const opts = normalizeOptions(schema.enum || schema.options || []);
        const current = Array.isArray(value) ? value.map(v => String(v)) : [];
        return `
          <select class="form-input" multiple ${dataset} data-control="multiselect">
            ${opts.map(opt => `<option value="${this.escapeHtml(opt.value)}" ${current.includes(String(opt.value)) ? 'selected' : ''}>${this.escapeHtml(opt.label)}</option>`).join('')}
          </select>
        `;
      }
      case 'tags': {
        const text = this.escapeHtml(Array.isArray(value) ? value.join('\n') : (value || ''));
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
      const evt = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(evt, () => this.handleConfigFieldChange(el));
      if (evt !== 'change') {
        el.addEventListener('change', () => this.handleConfigFieldChange(el));
      }
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
    const templatePath = this.normalizeTemplatePath(target.dataset.templatePath || '');
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
    this.updateArrayObjectValue(parentPath, index, objectPath, value);
  }

  addArrayObjectItem(path) {
    if (!this._configState) return;
    const subFields = this._configState.arraySchemaMap[path] || {};
    const template = this.buildDefaultsFromFields(subFields);
    const list = Array.isArray(this._configState.values[path]) ? this._cloneValue(this._configState.values[path]) : [];
    list.push(template);
    this.setConfigFieldValue(path, list);
    this.renderConfigFormPanel();
  }

  removeArrayObjectItem(path, index) {
    if (!this._configState) return;
    const list = Array.isArray(this._configState.values[path]) ? this._cloneValue(this._configState.values[path]) : [];
    list.splice(index, 1);
    this.setConfigFieldValue(path, list);
    this.renderConfigFormPanel();
  }

  updateArrayObjectValue(path, index, objectPath, value) {
    if (!this._configState) return;
    const list = Array.isArray(this._configState.values[path]) ? this._cloneValue(this._configState.values[path]) : [];
    if (!list[index] || typeof list[index] !== 'object') {
      list[index] = {};
    }
    const updated = this.setNestedValue(list[index], objectPath, value);
    list[index] = updated;
    this.setConfigFieldValue(path, list);
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

  addDynamicCollectionEntry(collectionName) {
    if (!this._configState) return;
    const collection = this._configState.dynamicCollectionsMeta.find(col => col.name === collectionName);
    if (!collection) return;
    const key = (prompt(collection.keyPlaceholder || '请输入键') || '').trim();
    if (!key) return;
    const existing = this.getValueFromObject(this._configState.rawObject || {}, collection.basePath || '');
    if (existing && Object.prototype.hasOwnProperty.call(existing, key)) {
      this.showToast('该键已存在', 'warning');
      return;
    }
    const defaults = this.buildDefaultsFromFields(collection.valueFields);
    const prefix = this.combinePath(collection.basePath || '', key);
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
    const prefix = this.combinePath(collection.basePath || '', key);
    const fullPath = this.combinePath(prefix, objectPath);
    this.setConfigFieldValue(fullPath, value);
  }

  handleConfigFieldChange(target) {
    if (!this._configState) return;
    const path = target.dataset.field;
    const component = (target.dataset.component || '').toLowerCase();
    const fieldDef = this.getFlatFieldDefinition(path);
    const meta = fieldDef?.meta || {};
    const type = fieldDef?.type || target.dataset.type || '';

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
    this.updateDirtyState(path, value);
    this._configState.rawObject = this.unflattenObject(this._configState.values);
    this._configState.jsonText = JSON.stringify(this._configState.rawObject, null, 2);
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
    const origin = this._configState.original[path];
    if (this.isSameValue(origin, value)) delete this._configState.dirty[path];
    else this._configState.dirty[path] = true;
  }

  updateConfigSaveButton() {
    const btn = document.getElementById('configSaveBtn');
    if (!btn || !this._configState) return;
    const dirtyCount = Object.keys(this._configState.dirty).length;
    if (this._configState.mode === 'form') {
      btn.disabled = dirtyCount === 0;
      btn.textContent = dirtyCount ? `保存（${dirtyCount}）` : '保存';
    } else {
      btn.disabled = !this._configState.jsonDirty;
      btn.textContent = '保存（JSON）';
    }
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
    if (!Object.keys(flat || {}).length) throw new Error('未检测到改动');
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
    switch ((type || '').toLowerCase()) {
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
    const type = (meta.type || typeHint || '').toLowerCase();
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
    switch ((type || '').toLowerCase()) {
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

  /**
   * 获取 SubForm 的子字段
   */
  getSubFormFields(parentPath) {
    if (!this._configState?.flatSchema) return null;
    return this._configState.flatSchema.filter(field => {
      const fieldPath = field.path;
      // 检查是否是父路径的直接子字段
      if (!fieldPath.startsWith(parentPath + '.')) return false;
      const relativePath = fieldPath.substring(parentPath.length + 1);
      // 只返回直接子字段（不包含更深层的字段）
      return !relativePath.includes('.');
    });
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
      } else if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
        result[key] = this._cloneValue(schema.default);
      } else {
        result[key] = schema.type === 'number' ? 0 : schema.type === 'boolean' ? false : '';
      }
    });
    return result;
  }

  getValueFromObject(obj, path = '') {
    if (!path) return obj;
    return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
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
    if (typeof a === 'object' || typeof b === 'object') {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return a === b;
  }

  _cloneFlat(data) {
    const clone = {};
    Object.entries(data || {}).forEach(([k, v]) => {
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
    
    container.querySelectorAll('.api-item').forEach(item => {
      item.addEventListener('click', () => {
        container.querySelectorAll('.api-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        this.selectAPI(item.dataset.id);
      });
    });
  }

  selectAPI(apiId) {
    const api = this.findAPIById(apiId);
    if (!api) {
      this.showToast('API 不存在', 'error');
      return;
    }
    
    this.currentAPI = { method: api.method, path: api.path, apiId };
    
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
    
    const pathParams = (api.path.match(/:(\w+)/g) || []).map(p => p.slice(1));
    
    let paramsHTML = '';
    
    // 路径参数
    if (pathParams.length && api.pathParams) {
      paramsHTML += `<div class="api-form-section">
        <h3 class="api-form-section-title">路径参数</h3>
        ${pathParams.map(p => {
          const cfg = api.pathParams[p] || {};
          return `<div class="form-group">
            <label class="form-label">${cfg.label || p} <span style="color:var(--danger)">*</span></label>
            <input type="text" class="form-input" id="path_${p}" placeholder="${cfg.placeholder || ''}" data-param-type="path">
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
    
    // 等待DOM更新后绑定事件
    setTimeout(() => {
      const executeBtn = document.getElementById('executeBtn');
      const fillExampleBtn = document.getElementById('fillExampleBtn');
      const formatJsonBtn = document.getElementById('formatJsonBtn');
      const copyJsonBtn = document.getElementById('copyJsonBtn');
      
      if (executeBtn) {
        executeBtn.addEventListener('click', () => this.executeRequest());
      }
      
      if (fillExampleBtn) {
        fillExampleBtn.addEventListener('click', () => this.fillExample());
      }
      
      if (formatJsonBtn) {
        formatJsonBtn.addEventListener('click', () => this.formatJSON());
      }
      
      if (copyJsonBtn) {
        copyJsonBtn.addEventListener('click', () => this.copyJSON());
      }
      
      // 文件上传设置
      if (apiId === 'file-upload') {
        this.setupFileUpload();
      }
    
    // 监听输入变化
    section.querySelectorAll('input, textarea, select').forEach(el => {
      el.addEventListener('input', () => this.updateJSONPreview());
        el.addEventListener('change', () => this.updateJSONPreview());
    });
    
      // 初始化JSON编辑器
      this.initJSONEditor().then(() => {
    this.updateJSONPreview();
      });
    }, 0);
  }

  renderParamInput(param) {
    const required = param.required ? '<span style="color:var(--danger)">*</span>' : '';
    let input = '';
    
    switch (param.type) {
      case 'select':
        input = `<select class="form-input" id="${param.name}" data-param-type="body">
          <option value="">请选择</option>
          ${param.options.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
        </select>`;
        break;
      case 'textarea':
      case 'json':
        input = `<textarea class="form-input" id="${param.name}" placeholder="${param.placeholder || ''}" data-param-type="body">${param.defaultValue || ''}</textarea>`;
        break;
      default:
        input = `<input type="${param.type || 'text'}" class="form-input" id="${param.name}" placeholder="${param.placeholder || ''}" value="${param.defaultValue || ''}" data-param-type="body">`;
    }
    
    return `<div class="form-group">
      <label class="form-label">${param.label} ${required}</label>
      ${param.hint ? `<p class="config-field-hint">${param.hint}</p>` : ''}
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
    
    area?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', (e) => this.handleFiles(e.target.files));
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
      area?.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });
    
    area?.addEventListener('drop', (e) => this.handleFiles(e.dataTransfer.files));
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
    const textarea = document.getElementById('jsonEditor');
    if (textarea && !this.jsonEditor) {
      textarea.value = JSON.stringify(data, null, 2);
    } else if (this.jsonEditor) {
      this.jsonEditor.setValue(JSON.stringify(data, null, 2));
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
      if (val) query[p.name] = val;
    });
    if (Object.keys(query).length) data.query = query;
    
    // 请求体
    const body = {};
    api?.bodyParams?.forEach(p => {
      const el = document.getElementById(p.name);
      let val = el?.value;
      if (val) {
        if (p.type === 'json') {
          try { val = JSON.parse(val); } catch {}
        }
        body[p.name] = val;
      }
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
      matchBrackets: true
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
    
    if (navigator.clipboard) {
      navigator.clipboard.writeText(val).then(
        () => this.showToast('已复制', 'success'),
        () => this.showToast('复制失败', 'error')
      );
    } else {
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = val;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        this.showToast('已复制', 'success');
      } catch {
        this.showToast('复制失败', 'error');
      }
      document.body.removeChild(textarea);
    }
  }

  fillExample() {
    if (!this.currentAPI || !this.apiConfig?.examples) return;
    const example = this.apiConfig.examples[this.currentAPI.apiId];
    if (!example) {
      this.showToast('暂无示例数据', 'info');
      return;
    }
    
    Object.entries(example).forEach(([key, val]) => {
      const id = key.startsWith('path_') ? key : key;
      const el = document.getElementById(id);
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
    
    let requestData;
    try {
      const jsonEditor = document.getElementById('jsonEditor');
      const val = this.jsonEditor?.getValue() || jsonEditor?.value || '{}';
      requestData = JSON.parse(val);
    } catch (e) {
      this.showToast('请求数据格式错误: ' + e.message, 'error');
      return;
    }
    
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
      
      this.renderResponse(res.status, data, time);
      this.showToast(res.ok ? '请求成功' : `请求失败: ${res.status}`, res.ok ? 'success' : 'error');
    } catch (e) {
      this.renderResponse(0, { error: e.message }, Date.now() - startTime);
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
      
      this.renderResponse(res.status, data, time);
      
      if (res.ok) {
        this.showToast('上传成功', 'success');
        this.selectedFiles = [];
        const fileList = document.getElementById('fileList');
        if (fileList) fileList.innerHTML = '';
      } else {
        this.showToast('上传失败: ' + (data.message || res.statusText), 'error');
      }
    } catch (e) {
      this.renderResponse(0, { error: e.message }, Date.now() - startTime);
      this.showToast('上传失败: ' + e.message, 'error');
    } finally {
      if (btn) {
        btn.innerHTML = originalText;
      btn.disabled = false;
      }
    }
  }

  renderResponse(status, data, time) {
    const section = document.getElementById('responseSection');
    const isSuccess = status >= 200 && status < 300;
    
    section.innerHTML = `
      <div style="margin-top:32px">
        <div class="response-header">
          <h3 class="response-title">响应结果</h3>
          <div class="response-meta">
            <span class="badge ${isSuccess ? 'badge-success' : 'badge-danger'}">${status || 'Error'}</span>
            <span style="color:var(--text-muted)">${time}ms</span>
          </div>
        </div>
        <div class="response-content">
          <pre>${this.syntaxHighlight(JSON.stringify(data, null, 2))}</pre>
        </div>
      </div>
    `;
    
    section.scrollIntoView({ behavior: 'smooth' });
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
  async ensureDeviceWs() {
    const state = this._deviceWs?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    
    // 清理之前的心跳定时器
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    
    const apiKey = localStorage.getItem('apiKey') || '';
    const wsUrl = this.serverUrl.replace(/^http/, 'ws') + '/device' + (apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : '');
    
    try {
      this._deviceWs = new WebSocket(wsUrl);
      
      this._deviceWs.onopen = () => {
        this._deviceWs.send(JSON.stringify({
          type: 'register',
          device_id: 'webclient',
          device_type: 'web',
          device_name: 'Web客户端',
          capabilities: ['display', 'microphone']
        }));
        
        // 启动前端心跳检测（每30秒发送一次ping）
        this._heartbeatTimer = setInterval(() => {
          if (this._deviceWs && this._deviceWs.readyState === WebSocket.OPEN) {
            try {
              this._deviceWs.send(JSON.stringify({
                type: 'heartbeat',
                timestamp: Date.now()
              }));
            } catch (e) {
              console.warn('心跳发送失败:', e);
            }
          }
        }, 30000);
      };
      
      this._deviceWs.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          this.handleWsMessage(data);
        } catch {}
      };
      
      this._deviceWs.onclose = () => {
        if (this._heartbeatTimer) {
          clearInterval(this._heartbeatTimer);
          this._heartbeatTimer = null;
        }
        this._deviceWs = null;
        setTimeout(() => this.ensureDeviceWs(), 5000);
      };
      
      this._deviceWs.onerror = (e) => {
        console.warn('WebSocket错误:', e);
      };
    } catch (e) {
      console.warn('WebSocket连接失败:', e);
    }
  }

  handleWsMessage(data) {
    switch (data.type) {
      case 'heartbeat_request':
        // 响应心跳请求
        if (this._deviceWs && this._deviceWs.readyState === WebSocket.OPEN) {
          this._deviceWs.send(JSON.stringify({
            type: 'heartbeat_response',
            timestamp: Date.now()
          }));
        }
        break;
      case 'asr_interim':
        this.renderASRStreaming(data.text, false);
        break;
      case 'asr_final': {
        const finalText = data.text || '';
        this.renderASRStreaming(finalText, true);
        if (finalText) {
          this.streamAIResponse(finalText, { appendUser: false, source: 'voice' })
            .catch(err => this.showToast('语音触发失败: ' + err.message, 'error'));
        }
        break;
      }
      case 'command':
        if (data.command === 'display' && data.parameters?.text) {
          this.appendChat('assistant', data.parameters.text);
        }
        if (data.command === 'display_emotion' && data.parameters?.emotion) {
          this.updateEmotionDisplay(data.parameters.emotion);
        }
        break;
    }
  }

  renderASRStreaming(text = '', done = false) {
    const box = document.getElementById('chatMessages');
    if (!box) return;

    const finalText = (text || '').trim();
    let bubble = this._asrBubble;

    if (!bubble) {
      if (done) {
        if (finalText) this.appendChat('user', finalText);
        return;
      }
      bubble = document.createElement('div');
      bubble.className = 'chat-message user asr-streaming';
      bubble.innerHTML = `
        <span class="chat-stream-icon">🎙</span>
        <span class="chat-stream-text"></span>
      `;
      box.appendChild(bubble);
      this._asrBubble = bubble;
    }

    const textNode = bubble.querySelector('.chat-stream-text') || bubble;

    if (!done) {
      bubble.classList.add('streaming');
      textNode.textContent = finalText || '正在聆听...';
    } else {
      bubble.classList.remove('streaming', 'asr-streaming');
      if (!finalText) {
        bubble.remove();
      } else {
        textNode.textContent = finalText;
        this._chatHistory.push({ role: 'user', text: finalText, ts: Date.now(), source: 'voice' });
        this._saveChatHistory();
      }
      this._asrBubble = null;
    }

    box.scrollTop = box.scrollHeight;
  }

  async toggleMic() {
    if (this._micActive) {
      await this.stopMic();
    } else {
      await this.startMic();
    }
  }

  async startMic() {
    try {
      await this.ensureDeviceWs();
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
      });
      
      this._micStream = stream;
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      
      const source = this._audioCtx.createMediaStreamSource(stream);
      const processor = this._audioCtx.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
      processor.connect(this._audioCtx.destination);
      this._audioProcessor = processor;
      
      const sessionId = `sess_${Date.now()}`;
      this._asrSessionId = sessionId;
      this._asrChunkIndex = 0;
      this._micActive = true;
      
      document.getElementById('micBtn')?.classList.add('recording');
      
      this._deviceWs?.send(JSON.stringify({
        type: 'asr_session_start',
        device_id: 'webclient',
        session_id: sessionId,
        sample_rate: 16000,
        bits: 16,
        channels: 1
      }));
      
      processor.onaudioprocess = (e) => {
        if (!this._micActive) return;
        
        const input = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        const hex = Array.from(new Uint8Array(pcm16.buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        
        this._deviceWs?.send(JSON.stringify({
          type: 'asr_audio_chunk',
          device_id: 'webclient',
          session_id: sessionId,
          chunk_index: this._asrChunkIndex++,
          vad_state: 'active',
          data: hex
        }));
      };
    } catch (e) {
      this.showToast('麦克风启动失败: ' + e.message, 'error');
    }
  }

  async stopMic() {
    try {
      this._audioProcessor?.disconnect();
      this._micStream?.getTracks().forEach(t => t.stop());
      await this._audioCtx?.close().catch(() => {});
      
      if (this._asrSessionId && this._deviceWs) {
        this._deviceWs.send(JSON.stringify({
          type: 'asr_audio_chunk',
          device_id: 'webclient',
          session_id: this._asrSessionId,
          chunk_index: this._asrChunkIndex++,
          vad_state: 'ending',
          data: ''
        }));
        
        await new Promise(r => setTimeout(r, 1000));
        
        this._deviceWs.send(JSON.stringify({
          type: 'asr_session_stop',
          device_id: 'webclient',
          session_id: this._asrSessionId
        }));
      }
    } finally {
      this._micActive = false;
      document.getElementById('micBtn')?.classList.remove('recording');
      this._audioCtx = null;
      this._micStream = null;
      this._audioProcessor = null;
      this._asrSessionId = null;
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
const app = new App();