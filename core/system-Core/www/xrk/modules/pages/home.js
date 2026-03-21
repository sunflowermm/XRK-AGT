export function renderHomePage(app) {
  ['cpu', 'mem', 'net'].forEach(key => {
    if (app._charts[key]) {
      try {
        app._charts[key].destroy();
      } catch (e) {
        console.warn(`Failed to destroy chart ${key}:`, e);
      }
      app._charts[key] = null;
    }
  });

  const content = document.getElementById('content');
  if (!content) return;

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
            <div id="pluginsInfo" class="home-cloud-panel" role="region" aria-label="插件信息">加载中...</div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">工作流状态</span>
            </div>
            <div id="workflowInfo" class="home-cloud-panel" role="region" aria-label="工作流状态">加载中...</div>
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

  const cachedData = app._homeDataCache || app._latestSystem;
  if (cachedData) {
    Promise.resolve().then(() => {
      app._applyHomeData(cachedData, true);
    });
  }

  app._loadHomeDataAndUpdate();
}

