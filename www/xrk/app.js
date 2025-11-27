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
    this.configEditor = null;
    this._charts = {};
    this._metricsHistory = { netRx: Array(30).fill(0), netTx: Array(30).fill(0) };
    this._chatHistory = this._loadChatHistory();
    this._deviceWs = null;
    this._micActive = false;
    this._ttsQueue = [];
    this._ttsPlaying = false;
    
    this.init();
  }

  async init() {
    await this.loadAPIConfig();
    this.bindEvents();
    this.loadSettings();
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
    
    if (localStorage.getItem('theme') === 'dark') {
      document.body.classList.add('dark');
    }
  }

  toggleTheme() {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
    this.showToast(document.body.classList.contains('dark') ? '已切换到暗色主题' : '已切换到亮色主题', 'info');
  }

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
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
      // 在移动端自动打开侧边栏（仅在首次进入时）
      if (window.innerWidth <= 768 && !this._apiSidebarOpened) {
        this.toggleSidebar();
        this._apiSidebarOpened = true;
      }
    } else {
      navMenu.style.display = 'flex';
      apiListContainer.style.display = 'none';
      this.closeSidebar();
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
    this.loadBotsInfo();
    this.loadPluginsInfo();
  }

  async loadSystemStatus() {
    try {
      const res = await fetch(`${this.serverUrl}/api/system/status`, { headers: this.getHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) this.updateSystemStatus(data);
    } catch (e) {
      console.error('Failed to load system status:', e);
    }
  }
  
  async loadBotsInfo() {
    try {
      const res = await fetch(`${this.serverUrl}/api/status`, { headers: this.getHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const botsInfo = document.getElementById('botsInfo');
      if (!botsInfo) return;
      
      if (data.bots && Array.isArray(data.bots) && data.bots.length > 0) {
        botsInfo.innerHTML = `
          <div style="display:grid;gap:0">
            ${data.bots.map((bot, index) => `
              <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;${index < data.bots.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}transition:background var(--transition);cursor:pointer" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
                <div style="flex:1;min-width:0">
                  <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;font-size:14px">${bot.nickname || bot.uin}</div>
                  <div style="font-size:12px;color:var(--text-muted);line-height:1.4">
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
      } else {
        botsInfo.innerHTML = '<div style="color:var(--text-muted)">暂无机器人</div>';
      }
    } catch (e) {
      const botsInfo = document.getElementById('botsInfo');
      if (botsInfo) botsInfo.innerHTML = '<div style="color:var(--danger)">加载失败</div>';
    }
  }
  
  async loadPluginsInfo() {
    try {
      // 获取插件统计信息
      const statsRes = await fetch(`${this.serverUrl}/api/plugins/stats`, { headers: this.getHeaders() });
      const pluginsRes = await fetch(`${this.serverUrl}/api/plugins`, { headers: this.getHeaders() });
      
      const pluginsInfo = document.getElementById('pluginsInfo');
      if (!pluginsInfo) return;
      
      if (!statsRes.ok || !pluginsRes.ok) {
        pluginsInfo.innerHTML = '<div style="color:var(--text-muted)">加载中...</div>';
        return;
      }
      
      const statsData = await statsRes.json();
      const pluginsData = await pluginsRes.json();
      
      if (statsData.success && pluginsData.success) {
        const stats = statsData.stats || {};
        const plugins = pluginsData.plugins || [];
        const totalPlugins = stats.totalPlugins || plugins.length;
        const pluginsWithRules = plugins.filter(p => p.rule > 0).length;
        const pluginsWithTasks = stats.taskCount || 0;
        const loadTime = stats.totalLoadTime || 0;
        const formatLoadTime = (ms) => {
          if (ms < 1000) return `${ms}ms`;
          return `${(ms / 1000).toFixed(2)}s`;
        };
        
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
      } else {
        pluginsInfo.innerHTML = '<div style="color:var(--text-muted)">暂无插件</div>';
      }
    } catch (e) {
      const pluginsInfo = document.getElementById('pluginsInfo');
      if (pluginsInfo) pluginsInfo.innerHTML = '<div style="color:var(--danger)">加载失败</div>';
    }
  }

  updateSystemStatus(data) {
    const { system } = data;
    const formatBytes = (b) => {
      if (!b || b === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(b) / Math.log(k));
      return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
    };
    
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
    const cpuPercent = system?.cpu?.percent ?? 0;
    const cpuEl = document.getElementById('cpuValue');
    if (cpuEl) cpuEl.textContent = `${cpuPercent.toFixed(1)}%`;
    
    const memUsed = system?.memory?.used ?? 0;
    const memTotal = system?.memory?.total ?? 1;
    const memPercent = memTotal > 0 ? ((memUsed / memTotal) * 100).toFixed(1) : 0;
    const memEl = document.getElementById('memValue');
    if (memEl) memEl.textContent = `${memPercent}%`;
    
    const disks = system?.disks ?? [];
    const diskEl = document.getElementById('diskValue');
    if (diskEl) {
      if (disks.length > 0) {
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
    
    // 更新网络历史（只添加非零值或有效数据）
    const rxSec = Number(system?.netRates?.rxSec || 0) / 1024;
    const txSec = Number(system?.netRates?.txSec || 0) / 1024;
    // 过滤掉0.0或无效值
    if (rxSec > 0 || txSec > 0 || this._metricsHistory.netRx.length === 0) {
    this._metricsHistory.netRx.push(rxSec);
    this._metricsHistory.netTx.push(txSec);
    if (this._metricsHistory.netRx.length > 30) this._metricsHistory.netRx.shift();
    if (this._metricsHistory.netTx.length > 30) this._metricsHistory.netTx.shift();
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
        
        // 添加中心标签插件
        const cpuLabelPlugin = {
          id: 'cpuLabel',
          afterDraw: (chart) => {
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
        
        // 添加中心标签插件
        const memLabelPlugin = {
          id: 'memLabel',
          afterDraw: (chart) => {
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
                backgroundColor: `${primary}20`, 
                fill: true, 
                tension: 0.4, 
                pointRadius: 0,
                spanGaps: true
              },
              { 
                label: '上行', 
                data: this._metricsHistory.netTx, 
                borderColor: warning, 
                backgroundColor: `${warning}20`, 
                fill: true, 
                tension: 0.4, 
                pointRadius: 0,
                spanGaps: true
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: { legend: { position: 'bottom', labels: { color: textMuted, padding: 16 } } },
            scales: {
              x: { display: false },
              y: { 
                beginAtZero: true, 
                grid: { color: border }, 
                ticks: { 
                  display: false  // 完全隐藏Y轴刻度文字
                }
              }
            }
          }
        });
      } else {
        this._charts.net.data.labels = labels;
        this._charts.net.data.datasets[0].data = this._metricsHistory.netRx;
        this._charts.net.data.datasets[1].data = this._metricsHistory.netTx;
        this._charts.net.update('none');
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
    
    this.appendChat('user', text);
    input.value = '';
    
    try {
      await this.startAIStream(text);
    } catch (e) {
      this.showToast('发送失败: ' + e.message, 'error');
    }
  }

  async startAIStream(prompt) {
    const ctx = this._chatHistory.slice(-8).map(m => `${m.role === 'user' ? 'U' : 'A'}:${m.text}`).join('|').slice(-800);
    const finalPrompt = ctx ? `【上下文】${ctx}\n【提问】${prompt}` : prompt;
    const url = `${this.serverUrl}/api/ai/stream?prompt=${encodeURIComponent(finalPrompt)}&persona=`;
    
    const es = new EventSource(url);
    let acc = '';
    
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data || '{}');
        if (data.delta) {
          acc += data.delta;
          this.renderStreamingMessage(acc);
        }
        if (data.done) {
          es.close();
          this.renderStreamingMessage(acc, true);
        }
        if (data.error) {
          es.close();
          this.showToast('AI错误: ' + data.error, 'error');
        }
      } catch {}
    };
    
    es.onerror = () => es.close();
  }

  renderStreamingMessage(text, done = false) {
    const box = document.getElementById('chatMessages');
    if (!box) return;
    
    let msg = box.querySelector('.chat-message.assistant.streaming');
    if (!msg) {
      msg = document.createElement('div');
      msg.className = 'chat-message assistant streaming';
      box.appendChild(msg);
    }
    
    msg.textContent = text;
    
    if (done) {
      msg.classList.remove('streaming');
      if (text) {
        this._chatHistory.push({ role: 'assistant', text, ts: Date.now() });
        this._saveChatHistory();
      }
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
  async renderConfig() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="config-container">
        <div class="dashboard-header">
          <div>
            <h1 class="dashboard-title">配置管理</h1>
            <p class="dashboard-subtitle">管理系统配置文件</p>
          </div>
          <button class="btn btn-secondary" id="refreshConfigBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23,4 23,10 17,10"/>
              <polyline points="1,20 1,14 7,14"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            刷新
          </button>
        </div>
        <div class="config-list" id="configList">
          <div class="empty-state">
            <div class="loading-spinner" style="margin:0 auto"></div>
            <p style="margin-top:16px">加载中...</p>
          </div>
        </div>
      </div>
    `;
    
    document.getElementById('refreshConfigBtn').addEventListener('click', () => this.loadConfigList());
    this.loadConfigList();
  }

  async loadConfigList() {
    const list = document.getElementById('configList');
    try {
      const res = await fetch(`${this.serverUrl}/api/config/list`, { headers: this.getHeaders() });
      if (!res.ok) throw new Error('获取配置列表失败');
      const data = await res.json();
      
      if (!data.success || !data.configs?.length) {
        list.innerHTML = '<div class="empty-state"><p>暂无配置</p></div>';
        return;
      }
      
      list.innerHTML = data.configs.map(cfg => `
        <div class="config-item" data-name="${cfg.name}">
          <div class="config-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
            </svg>
          </div>
          <div class="config-info">
            <div class="config-name">${cfg.displayName || cfg.name}</div>
            <div class="config-desc">${cfg.description || cfg.filePath || ''}</div>
          </div>
          <svg class="config-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9,18 15,12 9,6"/>
          </svg>
        </div>
      `).join('');
      
      list.querySelectorAll('.config-item').forEach(item => {
        item.addEventListener('click', () => this.editConfig(item.dataset.name));
      });
    } catch (e) {
      list.innerHTML = `<div class="empty-state"><p>加载失败: ${e.message}</p></div>`;
    }
  }

  async editConfig(name) {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="config-editor">
        <div class="config-editor-header">
          <div class="config-editor-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
            </svg>
            编辑: ${name}
          </div>
          <div class="config-editor-actions">
            <button class="btn btn-secondary" id="backConfigBtn">返回</button>
            <button class="btn btn-secondary" id="validateConfigBtn">验证</button>
            <button class="btn btn-primary" id="saveConfigBtn">保存</button>
          </div>
        </div>
        <div class="json-editor-container">
          <div class="json-editor-header">
            <span class="json-editor-title">配置内容</span>
          </div>
          <div class="json-editor-wrapper">
            <textarea id="configTextarea" placeholder="加载中..."></textarea>
          </div>
        </div>
      </div>
    `;
    
    document.getElementById('backConfigBtn').addEventListener('click', () => this.renderConfig());
    document.getElementById('saveConfigBtn').addEventListener('click', () => this.saveConfig(name));
    document.getElementById('validateConfigBtn').addEventListener('click', () => this.validateConfig(name));
    
    try {
      const res = await fetch(`${this.serverUrl}/api/config/${name}/read`, { headers: this.getHeaders() });
      if (!res.ok) throw new Error('读取配置失败');
      const data = await res.json();
      
      const textarea = document.getElementById('configTextarea');
      textarea.value = JSON.stringify(data.data || {}, null, 2);
      textarea.dataset.configName = name;
      
      await this.initConfigEditor();
    } catch (e) {
      document.getElementById('configTextarea').value = `错误: ${e.message}`;
    }
  }

  async initConfigEditor() {
    await this.loadCodeMirror();
    const textarea = document.getElementById('configTextarea');
    if (!textarea || !window.CodeMirror) return;
    
    const theme = document.body.classList.contains('dark') ? 'monokai' : 'default';
    this.configEditor = CodeMirror.fromTextArea(textarea, {
      mode: 'application/json',
      theme,
      lineNumbers: true,
      lineWrapping: true,
      matchBrackets: true,
      autoCloseBrackets: true
    });
  }

  async saveConfig(name) {
    const value = this.configEditor?.getValue() || document.getElementById('configTextarea')?.value;
    try {
      const data = JSON.parse(value);
      const res = await fetch(`${this.serverUrl}/api/config/${name}/write`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ data, backup: true, validate: true })
      });
      const result = await res.json();
      if (result.success) {
        this.showToast('配置已保存', 'success');
      } else {
        throw new Error(result.message || '保存失败');
      }
    } catch (e) {
      this.showToast('保存失败: ' + e.message, 'error');
    }
  }

  async validateConfig(name) {
    const value = this.configEditor?.getValue() || document.getElementById('configTextarea')?.value;
    try {
      JSON.parse(value);
      this.showToast('JSON 格式正确', 'success');
    } catch (e) {
      this.showToast('JSON 格式错误: ' + e.message, 'error');
    }
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
    
    const theme = document.body.classList.contains('dark') ? 'monokai' : 'default';
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
    if (this._deviceWs?.readyState === WebSocket.OPEN) return;
    
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
      };
      
      this._deviceWs.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          this.handleWsMessage(data);
        } catch {}
      };
      
      this._deviceWs.onclose = () => {
        setTimeout(() => this.ensureDeviceWs(), 5000);
      };
    } catch (e) {
      console.warn('WebSocket连接失败:', e);
    }
  }

  handleWsMessage(data) {
    switch (data.type) {
      case 'asr_interim':
        this.renderASRStreaming(data.text, false);
        break;
      case 'asr_final':
        this.renderASRStreaming('', true);
        if (data.text) this.appendChat('user', data.text);
        break;
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

  renderASRStreaming(text, done) {
    const box = document.getElementById('chatMessages');
    if (!box) return;
    
    let msg = box.querySelector('.chat-message.asr-streaming');
    
    if (!done && text) {
      if (!msg) {
        msg = document.createElement('div');
        msg.className = 'chat-message assistant asr-streaming';
        box.appendChild(msg);
      }
      msg.textContent = `识别中: ${text}`;
    } else if (done && msg) {
      msg.remove();
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