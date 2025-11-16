/**
 * XRK-AGT葵子 API控制中心
 * 主应用程序 - 优化版
 */

class APIControlCenter {
    constructor() {
        this.serverUrl = window.location.origin;
        this.currentAPI = null;
        this.selectedFiles = [];
        this.apiConfig = null;
        this.jsonEditor = null;
        this.isUpdatingFromForm = false;
        this.isUpdatingFromEditor = false;
        this.floatingBtnDragging = false;
        this.floatingBtnOffset = { x: 0, y: 0 };
        this.touchStartTime = 0;
        this.touchStartPos = { x: 0, y: 0 };
        this.dragThreshold = 10;
        this.clickThreshold = 200;
        this.autoSaveTimer = null;
        this._charts = {};
        this._metricsHistory = { netRx: Array(30).fill(0), netTx: Array(30).fill(0) };
        this._prevNet = { rxBytes: 0, txBytes: 0 };
        this._prevNetTs = 0;
        this._chartInitAttempts = 0;
        this._chartRetryTimer = null;
        this._lastStatusData = null;
        this._wsReconnectAttempt = 0;
        this._wsHeartbeatTimer = null;
        this._ttsQueue = [];
        this._ttsPlaying = false;
        this._lastAsrFinal = '';
        this._chatHistory = this._loadChatHistory();
        this.init();
    }

    updateEmotionDisplay(emotion) {
        const map = {
            happy: '😀',
            sad: '😢',
            angry: '😠',
            surprise: '😮',
            love: '❤️',
            cool: '😎',
            sleep: '😴',
            think: '🤔',
            wink: '😉',
            laugh: '😂'
        };
        const zh2en = {
            '开心': 'happy',
            '伤心': 'sad',
            '生气': 'angry',
            '惊讶': 'surprise',
            '爱': 'love',
            '酷': 'cool',
            '睡觉': 'sleep',
            '思考': 'think',
            '眨眼': 'wink',
            '大笑': 'laugh'
        };
        let code = String(emotion || '').toLowerCase();
        if (!map[code]) {
            code = zh2en[emotion] || 'happy';
        }
        const icon = map[code] || '😀';
        const el = document.getElementById('emotionIcon');
        if (el) el.textContent = icon;
    }

    async init() {
        this.reorganizeDOMStructure();
        this.renderStatusSkeleton();
        await this.loadAPIConfig();
        this.initEventListeners();
        this.initFloatingButton();
        this.loadSettings();
        this.checkConnection();
        this.currentPage = 'home'; // 默认首页
        this.loadSystemStatus();
        this.renderSidebar();
        this.renderQuickActions();
        this.ensureDeviceWs();
        this._initParticles();
        this._installRouter();
        
        // 预加载CodeMirror编辑器，避免进入API测试界面时延迟
        this._loadCodeMirror().catch(err => {
            console.warn('CodeMirror预加载失败:', err);
        });
        
        // 每分钟更新一次系统状态
        setInterval(() => {
            if (this.currentPage === 'home') {
                this.loadSystemStatus();
            }
        }, 60000);
        
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.checkConnection();
                if (this.currentPage === 'home') {
                    this.loadSystemStatus();
                }
                this.ensureDeviceWs();
                this._applyRoute();
            }
        });
    }

    renderStatusSkeleton() {
        const grid = document.getElementById('systemStatusGrid');
        if (!grid) return;
        grid.innerHTML = `
            <div class="status-card-large"><div class="status-card-header"><h3>CPU</h3></div><div class="status-card-content"><div id="cpuSummary" class="status-summary">--% / 100%</div><canvas id="cpuPie" height="140"></canvas></div></div>
            <div class="status-card-large"><div class="status-card-header"><h3>内存</h3></div><div class="status-card-content"><div id="memSummary" class="status-summary">-- / --</div><canvas id="memPie" height="140"></canvas></div></div>
            <div class="status-card-large"><div class="status-card-header"><h3>交换分区</h3></div><div class="status-card-content"><div id="swapSummary" class="status-summary">-- / --</div><canvas id="swapPie" height="140"></canvas></div></div>
            <div class="status-card-large"><div class="status-card-header"><h3>磁盘使用</h3></div><div class="status-card-content"><div id="diskPlaceholder" class="status-summary">--</div><canvas id="diskBar" height="180"></canvas></div></div>
            <div class="status-card-large"><div class="status-card-header"><h3>网络上下行 (KB/s)</h3></div><div class="status-card-content"><div id="netSummary" class="status-summary">--</div><canvas id="netLine" height="160"></canvas></div></div>
            <div class="status-card-large"><div class="status-card-header"><h3>进程 Top5</h3></div><div class="status-card-content"><table class="kv-table small"><tbody id="procTop"></tbody></table></div></div>
        `;
    }

    _destroyCharts() {
        try {
            if (!this._charts) return;
            Object.keys(this._charts).forEach(k => {
                const c = this._charts[k];
                if (c && typeof c.destroy === 'function') {
                    try { c.destroy(); } catch {}
                }
                this._charts[k] = null;
            });
        } catch {}
        this._charts = {};
    }

    reorganizeDOMStructure() {
        const overlay = document.getElementById('overlay');
        const floatingBtn = document.getElementById('floatingBtn');
        const toastContainer = document.getElementById('toastContainer');
        [overlay, floatingBtn, toastContainer].forEach(element => {
            if (element && element.parentNode !== document.body) {
                document.body.appendChild(element);
            }
        });
    }

    async loadAPIConfig() {
        try {
            const response = await fetch('api-config.json');
            this.apiConfig = await response.json();
        } catch (error) {
            console.error('Failed to load API configuration:', error);
            this.showToast('加载API配置失败', 'error');
        }
    }

    _buildChatContext(limitChars = 800, limitMsgs = 8) {
        try {
            const msgs = (this._chatHistory || []).slice(-limitMsgs);
            const compact = msgs.map(m => `${m.role === 'user' ? 'U' : 'A'}:${(m.text || '').replace(/\s+/g,' ').trim()}`)
                                .join(' | ')
                                .slice(-limitChars);
            return compact;
        } catch { return ''; }
    }

    initEventListeners() {
        // 主题切换
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleTheme();
                this._applyChartTheme();
            });
        }

        // API Key
        const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
        if (saveApiKeyBtn) {
            saveApiKeyBtn.addEventListener('click', () => this.saveApiKey());
        }

        const apiKeyInput = document.getElementById('apiKey');
        if (apiKeyInput) {
            apiKeyInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.saveApiKey();
                }
            });
        }

        // 导航
        // 导航事件已在 renderSidebar 中处理

        // 遮罩层
        const overlay = document.getElementById('overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.closeSidebar();
                }
            });
        }

        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        // 快捷键
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                document.getElementById('apiKey')?.focus();
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && this.currentAPI) {
                e.preventDefault();
                this.executeRequest();
            }

            if (e.key === 'Escape') {
                this.closeSidebar();
            }
        });

        // 自动保存
        document.addEventListener('input', (e) => {
            if (e.target.classList.contains('input-field')) {
                this.autoSaveInputs();
            }
        });

        window.addEventListener('resize', () => this.constrainFloatingButton());
    }

    initFloatingButton() {
        const floatingBtn = document.getElementById('floatingBtn');
        if (!floatingBtn) return;

        this.setFloatingButtonPosition();

        let isDragging = false;
        let currentX = 0;
        let currentY = 0;
        let initialX = 0;
        let initialY = 0;
        let startX = 0;
        let startY = 0;
        let isClick = false;

        const getEventCoords = (e) => {
            if (e.type.includes('touch')) {
                return {
                    x: e.touches[0] ? e.touches[0].clientX : e.changedTouches[0].clientX,
                    y: e.touches[0] ? e.touches[0].clientY : e.changedTouches[0].clientY
                };
            }
            return { x: e.clientX, y: e.clientY };
        };

        const dragStart = (e) => {
            const coords = getEventCoords(e);
            const rect = floatingBtn.getBoundingClientRect();

            startX = coords.x;
            startY = coords.y;
            initialX = rect.left;
            initialY = rect.top;

            this.touchStartTime = Date.now();
            this.touchStartPos = { x: coords.x, y: coords.y };

            isDragging = true;
            isClick = true;
            floatingBtn.classList.add('dragging');

            e.preventDefault();
            e.stopPropagation();
        };

        const dragMove = (e) => {
            if (!isDragging) return;

            e.preventDefault();
            const coords = getEventCoords(e);

            currentX = coords.x - startX;
            currentY = coords.y - startY;

            const distance = Math.sqrt(currentX * currentX + currentY * currentY);
            if (distance > this.dragThreshold) {
                isClick = false;
            }

            const newX = initialX + currentX;
            const newY = initialY + currentY;

            const maxX = window.innerWidth - floatingBtn.offsetWidth;
            const maxY = window.innerHeight - floatingBtn.offsetHeight;

            const finalX = Math.max(0, Math.min(newX, maxX));
            const finalY = Math.max(0, Math.min(newY, maxY));

            floatingBtn.style.left = `${finalX}px`;
            floatingBtn.style.top = `${finalY}px`;
            floatingBtn.style.right = 'auto';
            floatingBtn.style.bottom = 'auto';
            floatingBtn.style.transform = 'none';
        };

        const dragEnd = (e) => {
            if (!isDragging) return;

            isDragging = false;
            floatingBtn.classList.remove('dragging');

            const touchDuration = Date.now() - this.touchStartTime;

            if (isClick && touchDuration < this.clickThreshold) {
                setTimeout(() => {
                    this.toggleSidebar();
                }, 0);
            } else {
                this.saveFloatingButtonPosition();
                this.snapToEdge();
            }

            isClick = false;
            e.preventDefault();
            e.stopPropagation();
        };

        floatingBtn.addEventListener('touchstart', dragStart, { passive: false });
        document.addEventListener('touchmove', dragMove, { passive: false });
        document.addEventListener('touchend', dragEnd, { passive: false });

        floatingBtn.addEventListener('mousedown', dragStart);

        const handleMouseMove = (e) => {
            if (isDragging) {
                dragMove(e);
            }
        };

        const handleMouseUp = (e) => {
            if (isDragging) {
                dragEnd(e);
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        floatingBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    }

    setFloatingButtonPosition() {
        const floatingBtn = document.getElementById('floatingBtn');
        if (!floatingBtn) return;

        const savedPosition = localStorage.getItem('floatingBtnPosition');

        if (savedPosition) {
            try {
                const position = JSON.parse(savedPosition);
                floatingBtn.style.left = `${position.left}px`;
                floatingBtn.style.top = `${position.top}px`;
                floatingBtn.style.right = 'auto';
                floatingBtn.style.bottom = 'auto';
                floatingBtn.style.transform = 'none';
                this.constrainFloatingButton();
            } catch (e) {
                this.resetFloatingButtonPosition();
            }
        } else {
            this.resetFloatingButtonPosition();
        }
    }

    resetFloatingButtonPosition() {
        const floatingBtn = document.getElementById('floatingBtn');
        if (!floatingBtn) return;

        floatingBtn.style.left = '20px';
        floatingBtn.style.top = '50%';
        floatingBtn.style.transform = 'translateY(-50%)';
        floatingBtn.style.right = 'auto';
        floatingBtn.style.bottom = 'auto';
    }

    saveFloatingButtonPosition() {
        const floatingBtn = document.getElementById('floatingBtn');
        if (!floatingBtn) return;

        const rect = floatingBtn.getBoundingClientRect();
        localStorage.setItem('floatingBtnPosition', JSON.stringify({
            left: rect.left,
            top: rect.top
        }));
    }

    constrainFloatingButton() {
        const floatingBtn = document.getElementById('floatingBtn');
        if (!floatingBtn) return;

        const rect = floatingBtn.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width;
        const maxY = window.innerHeight - rect.height;

        let needsUpdate = false;
        let newLeft = rect.left;
        let newTop = rect.top;

        if (rect.left < 0) {
            newLeft = 0;
            needsUpdate = true;
        } else if (rect.left > maxX) {
            newLeft = maxX;
            needsUpdate = true;
        }

        if (rect.top < 0) {
            newTop = 0;
            needsUpdate = true;
        } else if (rect.top > maxY) {
            newTop = maxY;
            needsUpdate = true;
        }

        if (needsUpdate) {
            floatingBtn.style.left = `${newLeft}px`;
            floatingBtn.style.top = `${newTop}px`;
            floatingBtn.style.transform = 'none';
            this.saveFloatingButtonPosition();
        }
    }

    snapToEdge() {
        const floatingBtn = document.getElementById('floatingBtn');
        if (!floatingBtn) return;

        const rect = floatingBtn.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const screenWidth = window.innerWidth;
        const edgeThreshold = 100;

        if (centerX < edgeThreshold || centerX < screenWidth / 2) {
            floatingBtn.style.transition = 'left 0.3s ease';
            floatingBtn.style.left = '20px';
        } else if (screenWidth - centerX < edgeThreshold || centerX > screenWidth / 2) {
            floatingBtn.style.transition = 'left 0.3s ease';
            floatingBtn.style.left = `${screenWidth - rect.width - 20}px`;
        }

        setTimeout(() => {
            floatingBtn.style.transition = '';
            this.saveFloatingButtonPosition();
        }, 300);
    }

    loadSettings() {
        const savedKey = localStorage.getItem('apiKey');
        if (savedKey) {
            document.getElementById('apiKey').value = savedKey;
        }

        if (localStorage.getItem('theme') === 'light') {
            document.body.classList.add('light');
        }
    }

    toggleTheme() {
        document.body.classList.toggle('light');
        localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');

        if (this.jsonEditor) {
            const theme = document.body.classList.contains('light') ? 'default' : 'monokai';
            this.jsonEditor.setOption('theme', theme);
        }

        this.showToast(
            document.body.classList.contains('light') ? '已切换到亮色主题' : '已切换到暗色主题',
            'info'
        );
    }

    toggleSidebar() {
        if (this.sidebarToggling) return;
        this.sidebarToggling = true;

        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('overlay');

        if (sidebar.classList.contains('open')) {
            this.closeSidebar();
        } else {
            sidebar.classList.add('open');
            overlay.classList.add('show');
            document.body.classList.add('no-scroll');

            requestAnimationFrame(() => {
                sidebar.style.transform = 'translateX(0)';
            });
        }

        setTimeout(() => {
            this.sidebarToggling = false;
        }, 300);
    }

    closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('overlay');

        sidebar.classList.remove('open');
        overlay.classList.remove('show');
        document.body.classList.remove('no-scroll');

        setTimeout(() => {
            if (!sidebar.classList.contains('open')) {
                sidebar.style.transform = '';
            }
        }, 300);
    }

    saveApiKey() {
        const apiKey = document.getElementById('apiKey').value.trim();

        if (!apiKey) {
            this.showToast('请输入API Key', 'warning');
            return;
        }

        localStorage.setItem('apiKey', apiKey);
        this.showToast('API Key 已保存', 'success');
        this.checkConnection();
    }

    getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        const apiKey = localStorage.getItem('apiKey');
        if (apiKey) {
            headers['X-API-Key'] = apiKey;
        }
        return headers;
    }

    async checkConnection() {
        try {
            const response = await fetch(`${this.serverUrl}/api/health`, {
                headers: this.getHeaders()
            });

            const statusDot = document.getElementById('statusDot');
            const statusText = document.getElementById('statusText');

            if (response.ok) {
                statusDot.classList.add('online');
                statusText.textContent = '已连接';
            } else {
                statusDot.classList.remove('online');
                statusText.textContent = '未授权';
            }
        } catch (error) {
            document.getElementById('statusDot').classList.remove('online');
            document.getElementById('statusText').textContent = '连接失败';
        }
    }

    // 导航到指定页面
    navigateToPage(page) {
        this.currentPage = page;
        // 保存当前页面到localStorage
        localStorage.setItem('currentPage', page);
        
        const content = document.getElementById('content');
        const apiGroups = document.getElementById('apiGroups');
        
        switch(page) {
            case 'home':
                this.showHomePage();
                if (apiGroups) apiGroups.style.display = 'none';
                break;
            case 'chat':
                this.showChatPage();
                if (apiGroups) apiGroups.style.display = 'none';
                break;
            case 'config':
                this.showConfigPage();
                if (apiGroups) apiGroups.style.display = 'none';
                break;
            case 'api':
                this.showAPIPage();
                if (apiGroups) apiGroups.style.display = 'block';
                break;
        }
        
        // 更新URL hash
        window.location.hash = `#/${page}`;
        
        // 关闭侧边栏（移动端）
        this.closeSidebar();
    }

    showHomePage() {
        const content = document.getElementById('content');
        if (!content) return;
        this._destroyCharts();
        content.innerHTML = `
            <div class="welcome-screen" id="systemStatusPage">
                <div class="system-status-header">
                    <h1 class="welcome-title">系统状态监控</h1>
                    <p class="welcome-desc">实时监控系统运行状态</p>
                </div>
                <div class="system-status-grid" id="systemStatusGrid">
                    <!-- 系统状态卡片将在这里动态生成 -->
                </div>
            </div>
        `;
        this.renderStatusSkeleton();
        if (this._lastStatusData) {
            this.renderSystemStatus(this._lastStatusData);
        }
        this.loadSystemStatus();
    }

    showChatPage() {
        const content = document.getElementById('content');
        if (!content) return;
        content.innerHTML = `
            <div class="ai-chat-container">
                <div class="ai-chat-header">
                    <div class="ai-chat-title">葵宝聊天</div>
                    <div class="ai-chat-controls">
                        <button class="btn btn-secondary" id="micToggleBtn">
                            <span class="mic-icon"></span>
                            <span>开始语音</span>
                        </button>
                        <button class="btn btn-secondary ai-chat-clear" onclick="app.clearChat()">清空</button>
                    </div>
                </div>
                <div class="emotion-display" id="emotionDisplay">
                    <div class="emotion-icon" id="emotionIcon">😀</div>
                </div>
                <div class="ai-chat-body" id="chatMessages"></div>
                <div class="ai-chat-input-container">
                    <input type="text" id="chatInput" class="ai-chat-input" placeholder="输入消息..." 
                        onkeypress="if(event.key==='Enter') app.sendChatMessage()">
                    <button class="ai-chat-send" onclick="app.sendChatMessage()">发送</button>
                </div>
            </div>
        `;

        // 初始化聊天功能
        const input = document.getElementById('chatInput');
        const micBtn = document.getElementById('micToggleBtn');
        
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.sendChatMessage();
            });
        }
        
        if (micBtn) {
            micBtn.addEventListener('click', () => this.toggleMic());
        }

        // 恢复聊天记录
        this._restoreChatHistory();

        // 确保WebSocket连接
        this.ensureDeviceWs();
        this.updateEmotionDisplay('happy');
    }

    showConfigPage() {
        this.openConfigEditor();
    }

    showAPIPage() {
        const content = document.getElementById('content');
        if (!content) return;
        content.innerHTML = `
            <div class="welcome-screen">
                <div class="welcome-icon">🛠️</div>
                <h1 class="welcome-title">API 调试中心</h1>
                <p class="welcome-desc">在左侧选择一个 API 以开始调试，或参考下方说明。</p>
                <div class="stats-grid" style="max-width:900px;">
                    <div class="stat-card">
                        <div class="stat-icon">1️⃣</div>
                        <div class="stat-label">选择 API</div>
                        <div class="stat-value" style="font-size:24px;">从左侧列表</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">2️⃣</div>
                        <div class="stat-label">填写参数</div>
                        <div class="stat-value" style="font-size:24px;">自动生成表单</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">3️⃣</div>
                        <div class="stat-label">执行并查看</div>
                        <div class="stat-value" style="font-size:24px;">关键调试表 + JSON</div>
                    </div>
                </div>
                <div id="responseSection"></div>
            </div>
        `;
        // 初始引导，无需额外图表渲染，避免首屏阻塞
    }

    async loadSystemStatus() {
        try {
            const statusRes = await fetch(`${this.serverUrl}/api/system/status` , {
                headers: this.getHeaders()
            });
            if (statusRes.ok) {
                const data = await statusRes.json();
                if (data.success) {
                    this.renderSystemStatus(data);
                }
            }
        } catch (error) {
            console.error('Failed to load system status:', error);
        }
    }

    renderSystemStatus(data) {
        const grid = document.getElementById('systemStatusGrid');
        if (!grid) return;
        this._lastStatusData = data;

        const { system, bot, bots } = data;
        
        // 格式化字节
        const formatBytes = (bytes) => {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };

        // 格式化时间
        const formatUptime = (seconds) => {
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            if (days > 0) return `${days}天 ${hours}小时`;
            if (hours > 0) return `${hours}小时 ${minutes}分钟`;
            return `${minutes}分钟`;
        };

        // CPU 使用率
        const cpuPercent = (system.cpu && typeof system.cpu.percent === 'number') ? system.cpu.percent : null;
        const swapTotal = Number(system.swap?.total || 0);
        const swapUsed = Number(system.swap?.used || 0);
        const swapPercent = swapTotal > 0 ? +(swapUsed / swapTotal * 100).toFixed(2) : 0;
        const disks = Array.isArray(system.disks) ? system.disks : [];
        // 网络速率：仅使用后端缓存速率
        const rxSec = Number(system.netRates?.rxSec || 0);
        const txSec = Number(system.netRates?.txSec || 0);
        try {
            this._metricsHistory.netRx.push(rxSec / 1024);
            this._metricsHistory.netTx.push(txSec / 1024);
            const cap = 60;
            ['netRx','netTx'].forEach(k => { if (this._metricsHistory[k].length > cap) this._metricsHistory[k].shift(); });
        } catch {}

        // 顶部摘要：每次刷新都更新文字
        const cpuSum = document.getElementById('cpuSummary');
        if (cpuSum) cpuSum.textContent = (cpuPercent !== null ? (cpuPercent + '% / 100%') : '--% / 100%');
        const memSum = document.getElementById('memSummary');
        if (memSum) memSum.textContent = `${formatBytes(system.memory.used)} / ${formatBytes(system.memory.total)}`;
        const swapSum = document.getElementById('swapSummary');
        if (swapSum) swapSum.textContent = `${formatBytes(swapUsed)} / ${formatBytes(swapTotal)}${swapTotal === 0 ? ' (无交换分区)' : ''}`;

        const hasBuilt = !!document.getElementById('cpuPie');
        if (!hasBuilt) {
            this._destroyCharts();
            grid.innerHTML = `
                <div class="status-card-large">
                    <div class="status-card-header"><h3>CPU</h3></div>
                    <div class="status-card-content">
                        <div id="cpuSummary" class="status-summary">${cpuPercent !== null ? (cpuPercent + '% / 100%') : '--% / 100%'}</div>
                        <canvas id="cpuPie" height="140"></canvas>
                    </div>
                </div>
                <div class="status-card-large">
                    <div class="status-card-header"><h3>内存</h3></div>
                    <div class="status-card-content">
                        <div id="memSummary" class="status-summary">${formatBytes(system.memory.used)} / ${formatBytes(system.memory.total)}</div>
                        <canvas id="memPie" height="140"></canvas>
                    </div>
                </div>
                <div class="status-card-large">
                    <div class="status-card-header"><h3>交换分区</h3></div>
                    <div class="status-card-content">
                        <div id="swapSummary" class="status-summary">${formatBytes(swapUsed)} / ${formatBytes(swapTotal)}${swapTotal === 0 ? ' (无交换分区)' : ''}</div>
                        <canvas id="swapPie" height="140"></canvas>
                    </div>
                </div>
                <div class="status-card-large">
                    <div class="status-card-header"><h3>磁盘使用</h3></div>
                    <div class="status-card-content"><div id="diskPlaceholder" class="status-summary"></div><canvas id="diskBar" height="180"></canvas></div>
                </div>
                <div class="status-card-large">
                    <div class="status-card-header"><h3>网络上下行 (KB/s)</h3></div>
                    <div class="status-card-content"><div id="netSummary" class="status-summary">--</div><canvas id="netLine" height="160"></canvas></div>
                </div>
                <div class="status-card-large">
                    <div class="status-card-header"><h3>进程 Top5</h3></div>
                    <div class="status-card-content">
                        <table class="kv-table small"><tbody id="procTop"></tbody></table>
                    </div>
                </div>
            `;
        }

        // 初始化/更新图表
        requestAnimationFrame(() => {
            if (!window.Chart) {
                this._chartInitAttempts++;
                if (this._chartInitAttempts <= 30 && !this._chartRetryTimer) {
                    this._chartRetryTimer = setTimeout(() => {
                        this._chartRetryTimer = null;
                        if (this._lastStatusData) this.renderSystemStatus(this._lastStatusData);
                    }, 500);
                }
                return;
            }
            this._applyChartTheme();
            this._chartInitAttempts = 0;
            // CPU 饼图
            const cpuEl = document.getElementById('cpuPie');
            if (cpuEl) {
                const used = Math.max(0, Math.min(100, Number(cpuPercent || 0)));
                const free = 100 - used;
                if (!this._charts.cpuPie) {
                    this._charts.cpuPie = new Chart(cpuEl.getContext('2d'), {
                        type: 'doughnut',
                        data: { labels: ['使用','空闲'], datasets: [{ data: [used, free], backgroundColor: ['#f6a54c','rgba(255,255,255,0.25)'] }] },
                        options: { cutout: '60%', plugins: { legend: { display: true } } }
                    });
                } else {
                    this._charts.cpuPie.data.datasets[0].data = [used, free];
                    this._charts.cpuPie.update('active');
                }
            }

            // 内存饼图
            const memEl = document.getElementById('memPie');
            if (memEl) {
                const used = +(system.memory.used/1024/1024/1024).toFixed(2);
                const free = +((system.memory.total - system.memory.used)/1024/1024/1024).toFixed(2);
                if (!this._charts.memPie) {
                    this._charts.memPie = new Chart(memEl.getContext('2d'), {
                        type: 'doughnut',
                        data: { labels: ['已用(GB)','可用(GB)'], datasets: [{ data: [used, free], backgroundColor: ['#6aa9ff','rgba(255,255,255,0.25)'] }] },
                        options: { cutout: '60%', plugins: { legend: { display: true } } }
                    });
                } else {
                    this._charts.memPie.data.datasets[0].data = [used, free];
                    this._charts.memPie.update('active');
                }
            }

            // 交换分区饼图
            const swapEl = document.getElementById('swapPie');
            if (swapEl) {
                const hasSwap = swapTotal > 0;
                const used = hasSwap ? +(swapUsed/1024/1024/1024).toFixed(2) : 0;
                const free = hasSwap ? +(((swapTotal - swapUsed)/1024/1024/1024)).toFixed(2) : 1; // 占位，避免全0不渲染
                if (!this._charts.swapPie) {
                    this._charts.swapPie = new Chart(swapEl.getContext('2d'), {
                        type: 'doughnut',
                        data: { labels: ['已用(GB)','可用(GB)'], datasets: [{ data: [used, free], backgroundColor: ['#cd5c5c','rgba(255,255,255,0.25)'] }] },
                        options: { cutout: '60%', plugins: { legend: { display: true } } }
                    });
                } else {
                    this._charts.swapPie.data.datasets[0].data = [used, free];
                    this._charts.swapPie.update('active');
                }
            }

            // 磁盘条形图
            const diskEl = document.getElementById('diskBar');
            if (diskEl) {
                const hasDisks = Array.isArray(disks) && disks.length > 0;
                const labels = hasDisks ? disks.map(d => d.mount || d.fs) : ['-'];
                const used = hasDisks ? disks.map(d => +(d.used/1024/1024/1024).toFixed(2)) : [0];
                const free = hasDisks ? disks.map(d => +(((d.size - d.used)/1024/1024/1024)).toFixed(2)) : [0];
                if (!this._charts.diskBar) {
                    this._charts.diskBar = new Chart(diskEl.getContext('2d'), {
                        type: 'bar',
                        data: { labels, datasets: [
                            { label: '已用(GB)', data: used, backgroundColor: '#f4a460' },
                            { label: '可用(GB)', data: free, backgroundColor: 'rgba(255,255,255,0.25)' }
                        ] },
                        options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true } } }
                    });
                } else {
                    const c = this._charts.diskBar;
                    c.data.labels = labels;
                    c.data.datasets[0].data = used;
                    c.data.datasets[1].data = free;
                    c.update('active');
                }
                const ph = document.getElementById('diskPlaceholder');
                if (ph) {
                    ph.textContent = hasDisks ? `共 ${labels.length} 个分区: ${labels.join(', ')}` : '暂无磁盘数据';
                }
            }

            // 网络上下行折线图（KB/s）
            const netEl = document.getElementById('netLine');
            if (netEl) {
                const labels = this._metricsHistory.netRx.map(() => '');
                if (!this._charts.netLine) {
                    this._charts.netLine = new Chart(netEl.getContext('2d'), {
                        type: 'line',
                        data: { labels, datasets: [
                            { label: '下行RX (KB/s)', data: this._metricsHistory.netRx, borderColor: '#6aa9ff', backgroundColor: 'rgba(106,169,255,0.2)', fill: true, tension: 0.3, pointRadius: 0 },
                            { label: '上行TX (KB/s)', data: this._metricsHistory.netTx, borderColor: '#f6a54c', backgroundColor: 'rgba(246,165,76,0.2)', fill: true, tension: 0.3, pointRadius: 0 }
                        ] },
                        options: {
                            responsive: true,
                            animation: false,
                            interaction: { intersect: false, mode: 'index' },
                            plugins: { legend: { display: true }, decimation: { enabled: true, algorithm: 'min-max' } },
                            scales: { x: { display: false }, y: { beginAtZero: true } }
                        }
                    });
                } else {
                    const c = this._charts.netLine;
                    c.data.labels = labels;
                    c.data.datasets[0].data = this._metricsHistory.netRx;
                    c.data.datasets[1].data = this._metricsHistory.netTx;
                    c.update('active');
                }
                const sum = document.getElementById('netSummary');
                if (sum) {
                    const rx = (this._metricsHistory.netRx[this._metricsHistory.netRx.length - 1] || 0).toFixed(2);
                    const tx = (this._metricsHistory.netTx[this._metricsHistory.netTx.length - 1] || 0).toFixed(2);
                    sum.textContent = `当前: RX ${rx} KB/s | TX ${tx} KB/s`;
                }
            }

            // 进程Top5
            const procEl = document.getElementById('procTop');
            if (procEl && Array.isArray(data.processesTop5)) {
                if (data.processesTop5.length === 0) {
                    procEl.innerHTML = `<tr><th>暂无数据</th><td>正在收集进程信息...</td></tr>`;
                } else {
                    procEl.innerHTML = data.processesTop5.map((p,i) => `<tr><th>#${i+1} ${p.name} (pid:${p.pid})</th><td>CPU ${Number(p.cpu||0).toFixed(1)}% | MEM ${Number(p.mem||0).toFixed(1)}%</td></tr>`).join('');
                }
            }
        });
    }

    _applyChartTheme() {
        if (!window.Chart) return;
        try {
            const cs = getComputedStyle(document.body);
            const text = (cs.getPropertyValue('--text-primary') || '#fff').trim();
            const grid = (cs.getPropertyValue('--border') || 'rgba(255,255,255,0.2)').trim();
            const family = cs.fontFamily || 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
            const size = parseInt(cs.fontSize, 10) || 12;
            Chart.defaults.color = text;
            Chart.defaults.borderColor = grid;
            Chart.defaults.font = { family, size, weight: '500' };
            if (Chart.defaults.plugins?.legend?.labels) {
                Chart.defaults.plugins.legend.labels.color = text;
            }
            if (Chart.defaults.plugins?.tooltip) {
                Chart.defaults.plugins.tooltip.titleColor = text;
                Chart.defaults.plugins.tooltip.bodyColor = text;
            }
        } catch {}
    }

    async loadStats() {
        try {
            const statusRes = await fetch(`${this.serverUrl}/api/status`, {
                headers: this.getHeaders()
            });
            if (statusRes.ok) {
                const data = await statusRes.json();

                const onlineBots = data.bots?.filter(b => b.online).length || 0;
                this.updateStatValue('statBots', onlineBots);

                const uptime = Math.floor(data.bot?.uptime || 0);
                const days = Math.floor(uptime / 86400);
                const hours = Math.floor((uptime % 86400) / 3600);
                const minutes = Math.floor((uptime % 3600) / 60);

                let uptimeText = '';
                if (days > 0) uptimeText += `${days}d `;
                if (hours > 0) uptimeText += `${hours}h `;
                uptimeText += `${minutes}m`;

                this.updateStatValue('statUptime', uptimeText);
            }

            const devicesRes = await fetch(`${this.serverUrl}/api/devices`, {
                headers: this.getHeaders()
            });
            if (devicesRes.ok) {
                const data = await devicesRes.json();
                const onlineDevices = data.devices?.filter(d => d.online).length || 0;
                this.updateStatValue('statDevices', onlineDevices);
            }

            const pluginsRes = await fetch(`${this.serverUrl}/api/plugins`, {
                headers: this.getHeaders()
            });
            if (pluginsRes.ok) {
                const data = await pluginsRes.json();
                this.updateStatValue('statPlugins', data.plugins?.length || 0);
            }
        } catch (error) {
            console.error('加载统计失败:', error);
        }
    }

    updateStatValue(elementId, value) {
        const element = document.getElementById(elementId);
        if (element && element.textContent !== String(value)) {
            element.style.opacity = '0';
            element.style.transform = 'scale(0.8)';

            setTimeout(() => {
                element.textContent = value;
                element.style.opacity = '1';
                element.style.transform = 'scale(1)';
            }, 200);
        }
    }

    renderSidebar() {
        // 初始化导航项点击事件
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const page = item.dataset.page;
                this.navigateToPage(page);
                
                // 更新活动状态
                navItems.forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');
            });
        });

        // 渲染API列表（仅在API调试页面显示）
        if (!this.apiConfig) return;

        const container = document.getElementById('apiGroups');
        if (!container) return;

        container.innerHTML = this.apiConfig.apiGroups.map(group => `
            <div class="api-group">
                <div class="api-group-title">${group.title}</div>
                ${group.apis.map(api => `
                    <div class="api-item" data-api-id="${api.id}">
                        <span class="method-tag method-${api.method.toLowerCase()}">${api.method}</span>
                        <span>${api.title}</span>
                    </div>
                `).join('')}
            </div>
        `).join('');

        container.addEventListener('click', (e) => {
            const apiItem = e.target.closest('.api-item');
            if (apiItem) {
                const apiId = apiItem.dataset.apiId;
                const api = this.findAPIById(apiId);
                if (api) {
                    this.selectAPI(api.method, api.path, apiId);
                }
            }
        });

        // 修复手机端滑动误触问题
        let touchedItem = null;
        let touchStartY = 0;
        let touchStartX = 0;
        let touchMoved = false;

        container.addEventListener('touchstart', (e) => {
            const apiItem = e.target.closest('.api-item');
            if (apiItem) {
                touchedItem = apiItem;
                touchStartY = e.touches[0].clientY;
                touchStartX = e.touches[0].clientX;
                touchMoved = false;
                apiItem.classList.add('touch-active');
            }
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (touchedItem && e.touches[0]) {
                const deltaY = Math.abs(e.touches[0].clientY - touchStartY);
                const deltaX = Math.abs(e.touches[0].clientX - touchStartX);
                // 如果移动距离超过10px，认为是滑动而不是点击
                if (deltaY > 10 || deltaX > 10) {
                    touchMoved = true;
                    if (touchedItem) {
                        touchedItem.classList.remove('touch-active');
                    }
                }
            }
        }, { passive: true });

        container.addEventListener('touchend', (e) => {
            if (touchedItem && !touchMoved) {
                touchedItem.classList.remove('touch-active');
                const apiId = touchedItem.dataset.apiId;
                const api = this.findAPIById(apiId);
                if (api) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.selectAPI(api.method, api.path, apiId);
                }
            }
            touchedItem = null;
            touchMoved = false;
        }, { passive: false });

        container.addEventListener('touchcancel', () => {
            if (touchedItem) {
                touchedItem.classList.remove('touch-active');
                touchedItem = null;
            }
            touchMoved = false;
        }, { passive: true });
    }

    renderQuickActions() {
        if (!this.apiConfig) return;

        const container = document.getElementById('quickActions');
        if (!container) return;

        container.innerHTML = this.apiConfig.quickActions.map(action => `
            <a href="#" class="quick-action" data-api-id="${action.apiId || ''}" data-action="${action.action || ''}">
                <div class="quick-action-icon">${action.icon}</div>
                <div class="quick-action-text">${action.text}</div>
            </a>
        `).join('');

        container.querySelectorAll('.quick-action').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const apiId = item.dataset.apiId;
                const action = item.dataset.action;

                if (action === 'ai-chat') {
                    this.navigateToPage('chat');
                } else if (action === 'config-manager') {
                    this.navigateToPage('config');
                } else if (apiId) {
                    this.navigateToPage('api');
                    const api = this.findAPIById(apiId);
                    if (api) {
                        this.selectAPI(api.method, api.path, apiId);
                    }
                }
            });
        });
    }

    // ====================== AI Chat ======================
    openAIChat() {
        this.closeSidebar();
        this.currentAPI = null;
        const content = document.getElementById('content');
        content.innerHTML = `
            <div class="ai-chat-container">
                <div class="ai-chat-header">
                    <div class="ai-chat-title">AI 聊天</div>
                    <div class="ai-chat-controls">
                        <button class="btn btn-secondary" id="micToggleBtn">
                            <span>🎙️</span><span>开始语音</span>
                        </button>
                    </div>
                </div>
                <div class="ai-chat-body" id="chatMessages"></div>
                <div class="ai-chat-input">
                    <input id="chatInput" type="text" placeholder="输入消息后回车发送..." />
                    <button class="btn btn-primary" id="chatSendBtn"><span>发送</span></button>
                </div>
            </div>
        `;

        const input = document.getElementById('chatInput');
        const sendBtn = document.getElementById('chatSendBtn');
        const micBtn = document.getElementById('micToggleBtn');

        sendBtn.addEventListener('click', () => this.sendChatMessage());
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });
        micBtn.addEventListener('click', () => this.toggleMic());

        this.ensureDeviceWs();
    }

    appendChat(role, text, persist = true) {
        if (persist) this._persistChat(role, text);
        const box = document.getElementById('chatMessages');
        if (box) {
            const div = document.createElement('div');
            div.className = `chat-msg ${role}`;
            div.textContent = text;
            box.appendChild(div);
            box.scrollTop = box.scrollHeight;
        }
    }

    _loadChatHistory() {
        const stored = localStorage.getItem('chatHistory');
        if (!stored) return [];
        return JSON.parse(stored);
    }
    _saveChatHistory() {
        localStorage.setItem('chatHistory', JSON.stringify((this._chatHistory || []).slice(-200)));
    }
    _persistChat(role, text, ts = Date.now()) {
        if (!text) return;
        if (!Array.isArray(this._chatHistory)) this._chatHistory = [];
        this._chatHistory.push({ role, text, ts });
        this._saveChatHistory();
    }
    _restoreChatHistory() {
        const box = document.getElementById('chatMessages');
        if (!box) return;
        box.innerHTML = '';
        (this._chatHistory || []).forEach(m => {
            const div = document.createElement('div');
            div.className = `chat-msg ${m.role}`;
            div.textContent = m.text;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    }
    clearChat() {
        this._chatHistory = [];
        this._saveChatHistory();
        const box = document.getElementById('chatMessages');
        if (box) box.innerHTML = '';
    }

    async sendChatMessage() {
        const input = document.getElementById('chatInput');
        const text = (input.value || '').trim();
        if (!text) return;
        this.appendChat('user', text);
        input.value = '';

        try {
            await this.startAIStream(text);
        } catch (err) {
            this.showToast('发送失败: ' + err.message, 'error');
        }
    }

    async startAIStream(prompt) {
        // 通过 SSE 获取流式结果并渲染
        try {
            const ctx = this._buildChatContext(800, 8);
            const finalPrompt = ctx ? `【上下文】${ctx}\n【提问】${prompt}` : prompt;
            const url = `${this.serverUrl}/api/ai/stream?prompt=${encodeURIComponent(finalPrompt)}&persona=`;
            const es = new EventSource(url);
            let acc = '';
            const onMessage = (e) => {
                try {
                    const data = JSON.parse(e.data || '{}');
                    if (data.delta) {
                        acc += data.delta;
                        this.renderAssistantStreaming(acc);
                    }
                    if (data.done) {
                        es.close();
                        this.renderAssistantStreaming(acc, true);
                    }
                    if (data.error) {
                        es.close();
                        this.showToast('AI错误: ' + data.error, 'error');
                    }
                } catch {}
            };
            es.addEventListener('message', onMessage);
            es.addEventListener('error', () => {
                es.close();
            });
        } catch (e) {
            this.showToast('开启流式失败: ' + e.message, 'error');
        }
    }

    renderAssistantStreaming(text, done = false) {
        const box = document.getElementById('chatMessages');
        if (!box) return;
        let last = box.querySelector('.chat-msg.assistant.streaming');
        if (!last) {
            last = document.createElement('div');
            last.className = 'chat-msg assistant streaming';
            box.appendChild(last);
        }
        last.textContent = text;
        if (done) {
            last.classList.remove('streaming');
            if (text) this._persistChat('assistant', text);
        }
        box.scrollTop = box.scrollHeight;
    }

    renderASRStreaming(text, done = false) {
        const box = document.getElementById('chatMessages');
        if (!box) return;
        
        // 只保留一个识别中的消息
        let last = box.querySelector('.chat-msg.assistant.asr-streaming');
        
        if (!done && text) {
            // 更新或创建识别中的消息
            if (!last) {
            last = document.createElement('div');
            last.className = 'chat-msg assistant asr-streaming';
                last.style.opacity = '0';
                last.style.transform = 'translateY(10px)';
            box.appendChild(last);
                // 触发动画
                requestAnimationFrame(() => {
                    last.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    last.style.opacity = '1';
                    last.style.transform = 'translateY(0)';
                });
            }
            // 平滑更新文本
            if (last.textContent !== `识别中: ${text}`) {
                last.style.opacity = '0.7';
                requestAnimationFrame(() => {
                last.textContent = `识别中: ${text}`;
                    last.style.opacity = '1';
                });
            }
        } else if (done && last) {
            // 完成时淡出并移除
            last.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            last.style.opacity = '0';
            last.style.transform = 'translateY(-10px)';
            setTimeout(() => {
                if (last && last.parentNode) {
                last.remove();
            }
            }, 300);
        }
        
        box.scrollTop = box.scrollHeight;
    }

    // ============== Streaming ASR via /device WebSocket ==============
    async ensureDeviceWs() {
        if (this._deviceWs && (this._deviceWs.readyState === 0 || this._deviceWs.readyState === 1)) {
            return;
        }
        const apiKey = localStorage.getItem('apiKey') || '';
        // WebSocket 路径是 /device（根据 device.js 中的 ws.device 定义）
        const wsUrl = (this.serverUrl.replace(/^http/, 'ws') + `/device`) + (apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : '');
        try {
        this._deviceWs = new WebSocket(wsUrl);
        } catch (error) {
            console.warn('WebSocket connection failed, will retry later:', error);
            // 如果连接失败，不抛出错误，稍后重试
            this._scheduleWsReconnect();
            return;
        }
        this._deviceWs.addEventListener('open', () => {
            console.log('WebSocket connected to /device');
            this._wsReconnectAttempt = 0;
            this._startHeartbeat();
            // 注册为webclient设备
            try {
                this._deviceWs.send(JSON.stringify({
                    type: 'register',
                    device_id: 'webclient',
                    device_type: 'web',
                    device_name: 'Web客户端',
                    capabilities: ['display', 'microphone'],
                    metadata: {
                        ua: navigator.userAgent,
                        lang: navigator.language,
                        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
                    }
                }));
                // 主动上报一次心跳，帮助服务端尽快建立在线状态
                this._deviceWs.send(JSON.stringify({
                    type: 'heartbeat',
                    device_id: 'webclient',
                    status: { ui: 'ready' }
                }));
            } catch (error) {
                console.warn('Failed to send WebSocket message:', error);
            }
        });
        
        this._deviceWs.addEventListener('error', (error) => {
            console.warn('WebSocket error:', error);
            // 连接失败时不抛出错误，稍后会自动重试
        });
        
        this._deviceWs.addEventListener('close', () => {
            console.log('WebSocket closed, will retry on next use');
            this._deviceWs = null;
            this._stopHeartbeat();
            this._scheduleWsReconnect();
        });
        this._deviceWs.addEventListener('message', (evt) => {
            let data;
            try {
                data = JSON.parse(evt.data);
            } catch (e) {
                return; // 无效的JSON数据，忽略
            }
            if (data.type === 'heartbeat_request') {
                if (this._deviceWs && this._deviceWs.readyState === 1) {
                    this._deviceWs.send(JSON.stringify({
                        type: 'heartbeat',
                        device_id: 'webclient',
                        status: { ts: Date.now() }
                    }));
                }
                return;
            }
            if (data.type === 'heartbeat_response') {
                if (Array.isArray(data.commands) && data.commands.length > 0) {
                    this._handleDeviceCommands(data.commands);
                }
                return;
            }
            if (data.type === 'command') {
                const cmd = data.command ? [data.command] : [];
                if (cmd.length) this._handleDeviceCommands(cmd);
                return;
            }
            if (data.type === 'asr_interim' && data.text) {
                // 只显示最新的识别结果
                this.renderASRStreaming(data.text, false);
                return;
            }
            if (data.type === 'asr_final' && data.text) {
                // 结束识别：移除"识别中"，并把最终文本作为用户消息显示 + 持久化
                this.renderASRStreaming('', true);
                const finalText = data.text || '';
                if (finalText && finalText !== this._lastAsrFinal) {
                    this.appendChat('user', finalText, true);
                    this._lastAsrFinal = finalText;
                }
                return;
            }
            if (data.type === 'register_response' && data.success) {
                this.showToast('已连接设备: webclient', 'success');
                this.loadStats();
            }
        });
        // 移除重复的空监听器，避免冗余
    }

    _scheduleWsReconnect() {
        const attempt = Math.min(this._wsReconnectAttempt + 1, 8);
        this._wsReconnectAttempt = attempt;
        const backoff = Math.min(30000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 500);
        clearTimeout(this._wsReconnectTimer);
        this._wsReconnectTimer = setTimeout(() => this.ensureDeviceWs(), backoff);
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this._wsHeartbeatTimer = setInterval(() => {
            try {
                if (this._deviceWs && this._deviceWs.readyState === 1) {
                    this._deviceWs.send(JSON.stringify({ type: 'heartbeat', device_id: 'webclient', status: { ts: Date.now() } }));
                }
            } catch {}
        }, 15000);
    }

    _stopHeartbeat() {
        if (this._wsHeartbeatTimer) {
            clearInterval(this._wsHeartbeatTimer);
            this._wsHeartbeatTimer = null;
        }
    }

    async _waitWsReady(timeout = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (this._deviceWs && this._deviceWs.readyState === 1) return true;
            await new Promise(r => setTimeout(r, 100));
        }
        return false;
    }

    _initParticles() {
        const canvas = document.getElementById('bgParticles');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;
        const dpi = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        function resize() {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = Math.floor(width * dpi);
            canvas.height = Math.floor(height * dpi);
            ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
        }
        resize();
        window.addEventListener('resize', () => {
            resize();
        });
        // 优化粒子效果，使其更明显
        const count = Math.floor(Math.min(80, Math.max(40, (width + height) / 40)));
        const particles = new Array(count).fill(0).map(() => ({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            r: Math.random() * 2 + 1,
            a: Math.random() * Math.PI * 2
        }));
        const linksDist = 120;
        function step() {
            ctx.clearRect(0, 0, width, height);
            // 粉色梦幻系粒子颜色 - 更明显
            ctx.fillStyle = 'rgba(255, 103, 184, 0.8)';
            for (const p of particles) {
                p.x += p.vx;
                p.y += p.vy;
                p.a += 0.01;
                p.vx += Math.cos(p.a) * 0.0005;
                p.vy += Math.sin(p.a) * 0.0005;
                if (p.x < -10) p.x = width + 10; if (p.x > width + 10) p.x = -10;
                if (p.y < -10) p.y = height + 10; if (p.y > height + 10) p.y = -10;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();
            }
            // 粉色梦幻系连线 - 更明显
            ctx.strokeStyle = 'rgba(140, 114, 236, 0.7)';
            ctx.lineWidth = 1.5;
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const d = Math.hypot(dx, dy);
                    if (d < linksDist) {
                        ctx.globalAlpha = (1 - d / linksDist) * 0.5;
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.stroke();
                        ctx.globalAlpha = 1;
                    }
                }
            }
            requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    // 处理后端下发的设备命令（通过心跳响应）
    async _handleDeviceCommands(commands) {
        for (const cmd of commands) {
            const { id, command, parameters = {} } = cmd || {};
            let result = { ok: false };
            try {
                if (command === 'play_tts_audio' && parameters.audio_data) {
                    await this._playTtsPcmHex(parameters.audio_data);
                    result = { ok: true };
                } else if (command === 'display' && parameters.text) {
                    this.appendChat('assistant', parameters.text);
                    result = { ok: true };
                } else if (command === 'display_clear') {
                    const box = document.getElementById('chatMessages');
                    if (box) box.innerHTML = '';
                    result = { ok: true };
                } else if (command === 'display_emotion' && parameters.emotion) {
                    try { this.updateEmotionDisplay(parameters.emotion); } catch {}
                    this.showToast(`表情: ${parameters.emotion}`, 'info');
                    result = { ok: true };
                } else {
                    result = { ok: false, message: 'unsupported_command' };
                }
            } catch (e) {
                result = { ok: false, message: e?.message || 'error' };
            }
            try {
                this._deviceWs?.send(JSON.stringify({
                    type: 'command_result',
                    device_id: 'webclient',
                    command_id: id,
                    result
                }));
            } catch {}
        }
    }

    // 确保用于播放的 AudioContext 存在
    _ensurePlaybackCtx() {
        if (!this._playCtx) {
            try {
                this._playCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            } catch {}
        }
        return this._playCtx;
    }

    // 将后端hex编码的PCM16LE音频播放（16000Hz，单声道）
    async _playTtsPcmHex(hex) {
        const ctx = this._ensurePlaybackCtx();
        if (!ctx || !hex || typeof hex !== 'string' || hex.length === 0) return;
        try {
            const bytes = hex.match(/.{1,2}/g).map(b => parseInt(b, 16));
            const buf = new Uint8Array(bytes).buffer;
            const pcm16 = new Int16Array(buf);
            const float32 = new Float32Array(pcm16.length);
            for (let i = 0; i < pcm16.length; i++) {
                const s = pcm16[i] / 0x8000;
                float32[i] = Math.max(-1, Math.min(1, s));
            }
            const audioBuf = ctx.createBuffer(1, float32.length, 16000);
            audioBuf.getChannelData(0).set(float32);
            // 进入顺序播放队列
            this._ttsQueue.push(audioBuf);
            if (!this._ttsPlaying) this._dequeueTts();
        } catch (e) {
            console.warn('Failed to play TTS audio:', e);
        }
    }

    _dequeueTts() {
        const ctx = this._ensurePlaybackCtx();
        if (!ctx || this._ttsPlaying) return;
        const next = this._ttsQueue.shift();
        if (!next) { this._ttsPlaying = false; return; }
        this._ttsPlaying = true;
        const src = ctx.createBufferSource();
        src.buffer = next;
        src.connect(ctx.destination);
        src.addEventListener('ended', () => {
            this._ttsPlaying = false;
            // 继续下一段
            this._dequeueTts();
        });
        try { src.start(); } catch {}
    }

    // 简单哈希路由
    _installRouter() {
        window.addEventListener('hashchange', () => this._applyRoute());
        this._applyRoute();
    }
    _applyRoute() {
        const hash = (location.hash || '').replace(/^#\/?/, '');
        const page = hash.split('?')[0];
        
        if (!page || page === '') {
            const savedPage = localStorage.getItem('currentPage');
            if (savedPage && ['home', 'chat', 'api', 'config'].includes(savedPage)) {
                this.navigateToPage(savedPage);
                return;
            }
        }
        
        if (page === 'chat') { this.navigateToPage('chat'); return; }
        if (page === 'api') { this.navigateToPage('api'); return; }
        if (page === 'config') { this.navigateToPage('config'); return; }
        this.navigateToPage('home');
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
            
            // 检查HTTPS或localhost（某些浏览器要求）
            // 现代浏览器允许HTTP访问麦克风（需要用户授权）
            // 不再限制为localhost或HTTPS
            
            let stream = null;
            
            // 优先使用新版API
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ 
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                            sampleRate: 16000
                        } 
                    });
                } catch (err) {
                    console.warn('getUserMedia failed:', err);
                    // 如果失败，尝试不指定sampleRate
                    try {
                        stream = await navigator.mediaDevices.getUserMedia({ 
                            audio: {
                                echoCancellation: true,
                                noiseSuppression: true,
                                autoGainControl: true
                            } 
                        });
                    } catch (err2) {
                        console.warn('getUserMedia fallback failed:', err2);
                        throw err2;
                    }
                }
            } else {
                // 尝试旧版API（Edge等浏览器）
                const getUserMedia = navigator.getUserMedia || 
                                    navigator.webkitGetUserMedia || 
                                    navigator.mozGetUserMedia || 
                                    navigator.msGetUserMedia;
                if (getUserMedia) {
                    stream = await new Promise((resolve, reject) => {
                        getUserMedia.call(navigator, { audio: true }, resolve, reject);
                    });
                } else {
                    this.showToast('浏览器不支持麦克风访问，请使用现代浏览器（Chrome、Firefox、Edge等）', 'error');
                    return;
                }
            }
            
            if (!stream) {
                this.showToast('无法获取麦克风权限', 'error');
                return;
            }
            
            this._micStream = stream;
            
            // 创建音频上下文
            this._audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            const source = this._audioCtx.createMediaStreamSource(this._micStream);
            
            // 使用ScriptProcessorNode（兼容性更好）
            const processor = this._audioCtx.createScriptProcessor(4096, 1, 1);
            source.connect(processor);
            processor.connect(this._audioCtx.destination);
            this._audioProcessor = processor;

            const sessionId = `sess_${Date.now()}`;
            this._asrSessionId = sessionId;
            this._asrChunkIndex = 0;
            this._micActive = true;
            const micBtn = document.getElementById('micToggleBtn');
            if (micBtn) {
                micBtn.classList.add('recording');
                micBtn.innerHTML = '<span class="mic-icon"></span><span>停止语音</span>';
            }

            // 开始会话
            this._deviceWs?.send(JSON.stringify({
                type: 'asr_session_start',
                device_id: 'webclient',
                session_id: sessionId,
                session_number: 1,
                sample_rate: 16000,
                bits: 16,
                channels: 1
            }));

            processor.onaudioprocess = (e) => {
                if (!this._micActive) return;
                const input = e.inputBuffer.getChannelData(0);
                const pcm16 = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) {
                    let s = Math.max(-1, Math.min(1, input[i]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                const hex = Array.from(new Uint8Array(pcm16.buffer))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
                this._deviceWs?.send(JSON.stringify({
                    type: 'asr_audio_chunk',
                    device_id: 'webclient',
                    session_id: sessionId,
                    chunk_index: this._asrChunkIndex++,
                    vad_state: 'active',
                    data: hex
                }));
            };
        } catch (err) {
            this.showToast('启动麦克风失败: ' + err.message, 'error');
        }
    }

    async stopMic() {
        try {
            if (this._audioProcessor) {
                this._audioProcessor.disconnect();
                this._audioProcessor.onaudioprocess = null;
            }
            if (this._micStream) {
                this._micStream.getTracks().forEach(t => t.stop());
            }
            if (this._audioCtx) {
                await this._audioCtx.close().catch(() => {});
            }
            // 先发送 ending，等待服务端聚合最终结果后再发送 stop，避免过早结束导致超时或丢结果
            if (this._asrSessionId) {
                try {
                    this._deviceWs?.send(JSON.stringify({
                        type: 'asr_audio_chunk',
                        device_id: 'webclient',
                        session_id: this._asrSessionId,
                        chunk_index: this._asrChunkIndex++,
                        vad_state: 'ending',
                        data: ''
                    }));
                } catch {}
                // 等待一小段时间，让服务端处理最后的语音并返回最终文本
                await new Promise(r => setTimeout(r, 1200));
                try {
                    this._deviceWs?.send(JSON.stringify({
                        type: 'asr_session_stop',
                        device_id: 'webclient',
                        session_id: this._asrSessionId,
                        duration: 0,
                        session_number: 1
                    }));
                } catch {}
            }
        } finally {
            this._micActive = false;
            const micBtn = document.getElementById('micToggleBtn');
            if (micBtn) {
                micBtn.classList.remove('recording');
                micBtn.innerHTML = '<span class="mic-icon"></span><span>开始语音</span>';
            }
            this._audioCtx = null;
            this._micStream = null;
            this._audioProcessor = null;
            this._asrSessionId = null;
            this._asrChunkIndex = 0;
        }
    }

    findAPIById(apiId) {
        for (const group of this.apiConfig.apiGroups) {
            const api = group.apis.find(a => a.id === apiId);
            if (api) return api;
        }
        return null;
    }

    selectAPI(method, path, apiId) {
        this.closeSidebar();

        document.querySelectorAll('.api-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.apiId === apiId) {
                item.classList.add('active');
            }
        });

        // 特殊处理：配置管理器
        const api = this.findAPIById(apiId);
        if (api && api.special === 'config-editor') {
            this.openConfigEditor();
            return;
        }

        this.currentAPI = { method, path, apiId };
        this.renderAPIInterface(method, path, apiId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    showHome() {
        this.closeSidebar();
        this.currentAPI = null;
        document.querySelectorAll('.api-item').forEach(item => {
            item.classList.remove('active');
        });

        const content = document.getElementById('content');
        content.innerHTML = `
            <div class="welcome-screen">
                <div class="welcome-icon">🚀</div>
                <h1 class="welcome-title">XRK-AGT葵子 API控制中心</h1>
                <p class="welcome-desc">强大的机器人管理与开发平台</p>

                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon">🤖</div>
                        <div class="stat-value" id="statBots">-</div>
                        <div class="stat-label">在线机器人</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">📱</div>
                        <div class="stat-value" id="statDevices">-</div>
                        <div class="stat-label">连接设备</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">🧩</div>
                        <div class="stat-value" id="statPlugins">-</div>
                        <div class="stat-label">活跃插件</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">⏱️</div>
                        <div class="stat-value" id="statUptime">-</div>
                        <div class="stat-label">运行时间</div>
                    </div>
                </div>

                <div class="quick-actions" id="quickActions"></div>
            </div>
        `;

        this.renderQuickActions();
        this.loadStats();
    }

    renderAPIInterface(method, path, apiId) {
        const api = this.findAPIById(apiId);
        if (!api) return;

        const content = document.getElementById('content');
        const pathParams = (path.match(/:(\w+)/g) || []).map(p => p.slice(1));

        let html = `
            <div class="api-test-container">
                <div class="api-header">
                    <h1 class="api-title">${api.title}</h1>
                    <div class="api-endpoint">
                        <span class="method-tag method-${method.toLowerCase()}">${method}</span>
                        <span>${path}</span>
                    </div>
                    <p class="api-desc">${api.description}</p>
                </div>

                <div class="api-content-grid">
                    <div class="params-column">
        `;

        // 路径参数
        if (pathParams.length > 0 && api.pathParams) {
            html += `
                <div class="params-section">
                    <h3 class="section-title">
                        <span class="section-icon"></span>
                        路径参数
                    </h3>
                    <div class="param-grid">
            `;
            pathParams.forEach(param => {
                const paramConfig = api.pathParams[param] || {};
                html += `
                    <div class="param-item">
                        <label class="param-label">
                            ${paramConfig.label || param} <span class="required">*</span>
                            ${paramConfig.hint ? `<span class="param-hint">${paramConfig.hint}</span>` : ''}
                        </label>
                        <input type="text" class="input-field" id="path_${param}" 
                            placeholder="${paramConfig.placeholder || `请输入 ${param}`}" 
                            oninput="app.updateFromForm()">
                    </div>
                `;
            });
            html += `</div></div>`;
        }

        // 查询参数
        if (api.queryParams?.length > 0) {
            html += `
                <div class="params-section">
                    <h3 class="section-title">
                        <span class="section-icon"></span>
                        查询参数
                    </h3>
                    <div class="param-grid">
            `;
            api.queryParams.forEach(param => {
                html += this.renderParamField(param);
            });
            html += `</div></div>`;
        }

        // 请求体
        if (method !== 'GET' && api.bodyParams?.length > 0) {
            html += `
                <div class="params-section">
                    <h3 class="section-title">
                        <span class="section-icon"></span>
                        请求体参数
                    </h3>
                    <div class="param-grid">
            `;
            api.bodyParams.forEach(param => {
                html += this.renderParamField(param);
            });
            html += `</div></div>`;
        }

        // 文件上传
        if (apiId === 'file-upload') {
            html += this.renderFileUpload();
        }

        html += `
            <div class="button-group">
                <button class="btn btn-primary" onclick="app.executeRequest()">
                    <span class="btn-icon">执行请求</span>
                </button>
                <button class="btn btn-secondary" onclick="app.fillExample()">
                    <span class="btn-icon">填充示例</span>
                </button>
            </div>
            </div>

            <div class="preview-column">
                <div class="json-editor">
                    <div class="editor-header">
                        <h3 class="editor-title">
                            <span class="section-icon"></span>
                            请求编辑器
                        </h3>
                        <div class="editor-controls">
                            <button class="editor-btn" onclick="app.formatJSON()">
                                <span class="btn-icon">格式化</span>
                            </button>
                            <button class="editor-btn" onclick="app.validateJSON()">
                                <span class="check-icon"></span>
                                <span>验证</span>
                            </button>
                            <button class="editor-btn" onclick="app.copyJSON()">
                                <span class="btn-icon">复制</span>
                            </button>
                        </div>
                    </div>
                    <div class="json-editor-wrapper">
                        <textarea id="jsonEditor"></textarea>
                    </div>
                </div>
            </div>
        </div>

        <div id="responseSection"></div>
        </div>
        `;

        content.innerHTML = html;

        this.initJSONEditor();

        if (apiId === 'file-upload') {
            this.setupFileDragDrop();
        }

        this.restoreInputs();
        this.updateFromForm();
    }

    initJSONEditor() {
        const textarea = document.getElementById('jsonEditor');
        if (!textarea) return;

        const theme = document.body.classList.contains('light') ? 'default' : 'monokai';
        if (typeof window.CodeMirror === 'undefined') {
            this._loadCodeMirror().then(() => this.initJSONEditor());
            return;
        }

        this.jsonEditor = CodeMirror.fromTextArea(textarea, {
            mode: 'application/json',
            theme: theme,
            lineNumbers: true,
            lineWrapping: true,
            matchBrackets: true,
            autoCloseBrackets: true,
            foldGutter: true,
            gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
            extraKeys: {
                'Ctrl-Space': 'autocomplete',
                'Cmd-Space': 'autocomplete',
                'Ctrl-Enter': () => this.executeRequest(),
                'Cmd-Enter': () => this.executeRequest()
            }
        });

        this.jsonEditor.on('change', () => {
            if (!this.isUpdatingFromForm) {
                this.updateFromEditor();
            }
        });
    }

    _loadCodeMirror() {
        if (this._codeMirrorLoading) return this._codeMirrorLoading;
        // 使用多个CDN备用方案，提高加载成功率
        const cdnBases = [
            'https://cdn.jsdelivr.net/npm/codemirror@5.65.2',
            'https://cdn.bootcdn.net/ajax/libs/codemirror/5.65.2',
            'https://unpkg.com/codemirror@5.65.2'
        ];
        const cssList = [
            'codemirror.min.css',
            'theme/monokai.min.css',
            'addon/fold/foldgutter.min.css'
        ];
        const jsList = [
            'codemirror.min.js',
            'mode/javascript/javascript.min.js',
            'addon/edit/closebrackets.min.js',
            'addon/edit/matchbrackets.min.js',
            'addon/fold/foldcode.min.js',
            'addon/fold/foldgutter.min.js',
            'addon/fold/brace-fold.min.js'
        ];
        
        this._codeMirrorLoading = (async () => {
            // 加载CSS
            for (const css of cssList) {
                await this._loadCssWithFallback(cdnBases, css);
            }
            // 加载JS
            for (const js of jsList) {
                await this._loadScriptWithFallback(cdnBases, js);
            }
            return true;
        })();
        return this._codeMirrorLoading;
    }
    
    async _loadCssWithFallback(cdnBases, path) {
        for (const base of cdnBases) {
            try {
                await this._loadCss(`${base}/${path}`);
                return;
            } catch (err) {
                console.warn(`Failed to load CSS from ${base}/${path}, trying next CDN...`);
            }
        }
        throw new Error(`Failed to load CSS: ${path} from all CDNs`);
    }
    
    async _loadScriptWithFallback(cdnBases, path) {
        for (const base of cdnBases) {
            try {
                await this._loadScript(`${base}/${path}`);
                return;
            } catch (err) {
                console.warn(`Failed to load script from ${base}/${path}, trying next CDN...`);
            }
        }
        throw new Error(`Failed to load script: ${path} from all CDNs`);
    }

    _loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = () => resolve(true);
            s.onerror = () => reject(new Error('script load error'));
            document.head.appendChild(s);
        });
    }

    _loadCss(href) {
        return new Promise((resolve, reject) => {
            const l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = href;
            l.onload = () => resolve(true);
            l.onerror = () => reject(new Error('css load error'));
            document.head.appendChild(l);
        });
    }

    renderParamField(param) {
        let html = `
            <div class="param-item">
                <label class="param-label">
                    ${param.label}
                    ${param.required ? '<span class="required">*</span>' : ''}
                    ${param.hint ? `<span class="param-hint">${param.hint}</span>` : ''}
                </label>
        `;

        switch (param.type) {
            case 'select':
                html += `
                    <select class="input-field" id="${param.name}" onchange="app.updateFromForm()">
                        <option value="">请选择</option>
                        ${param.options.map(opt =>
                    `<option value="${opt.value}">${opt.label}</option>`
                ).join('')}
                    </select>
                `;
                break;
            case 'textarea':
            case 'json':
                html += `<textarea class="input-field" id="${param.name}" 
                    placeholder='${param.placeholder || ""}' 
                    oninput="app.updateFromForm()">${param.defaultValue || ''}</textarea>`;
                break;
            default:
                html += `<input type="${param.type || 'text'}" class="input-field" 
                    id="${param.name}" placeholder="${param.placeholder || ''}" 
                    value="${param.defaultValue || ''}"
                    oninput="app.updateFromForm()">`;
        }

        html += `</div>`;
        return html;
    }

    /**
     * 渲染 ArrayForm（对象数组）
     */
    renderArrayForm(fieldId, fieldName, fieldSchema, value) {
        const arr = Array.isArray(value) ? value : [];
        const subFields = fieldSchema.fields || {};
        const makeItem = (item = {}, index = 0) => {
            let inner = '';
            for (const [subName, subSchema] of Object.entries(subFields)) {
                const subVal = (item && Object.prototype.hasOwnProperty.call(item, subName)) ? item[subName] : (subSchema.default !== undefined ? subSchema.default : null);
                inner += `
                    <div class="config-form-subfield">
                        <label class="config-form-label">${subSchema.label || subName}</label>
                        ${this.renderFormField(`${fieldId}-${index}-${subName}`, `${subName}`, subSchema, subVal, subSchema.component || this.inferComponentType(subSchema.type, subSchema))}
                    </div>
                `;
            }
            return `
                <div class="config-form-arrayform-item" data-index="${index}">
                    ${inner}
                    <div class="config-form-arrayform-actions">
                        <button type="button" class="btn btn-sm btn-danger config-form-arrayform-remove" data-index="${index}">删除</button>
                    </div>
                </div>
            `;
        };

        let html = `<div class="config-form-arrayform" id="${fieldId}" data-field="${fieldName}">`;
        if (arr.length === 0) {
            html += makeItem({}, 0);
        } else {
            arr.forEach((item, i) => { html += makeItem(item || {}, i); });
        }
        html += `<button type="button" class="btn btn-sm btn-primary config-form-arrayform-add" data-field="${fieldName}">添加项</button>`;
        html += `</div>`;
        return html;
    }

    renderFileUpload() {
        return `
            <div class="params-section">
                <h3 class="section-title">
                    <span class="section-icon"></span>
                    文件上传
                </h3>
                <div class="file-upload">
                    <input type="file" id="fileInput" class="file-upload-input" multiple onchange="app.handleFileSelect(event)">
                    <label for="fileInput" class="file-upload-label" id="fileUploadLabel">
                        <div class="file-upload-icon"></div>
                        <div class="file-upload-text">点击选择文件或拖放到此处</div>
                    </label>
                    <div class="file-list" id="fileList" style="display: none;"></div>
                </div>
            </div>
        `;
    }

    setupFileDragDrop() {
        const fileUploadLabel = document.getElementById('fileUploadLabel');
        if (!fileUploadLabel) return;

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            fileUploadLabel.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            fileUploadLabel.addEventListener(eventName, () => {
                fileUploadLabel.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            fileUploadLabel.addEventListener(eventName, () => {
                fileUploadLabel.classList.remove('dragover');
            });
        });

        fileUploadLabel.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            this.handleFiles(files);
        });
    }

    handleFileSelect(event) {
        const files = event.target.files;
        this.handleFiles(files);
    }

    handleFiles(files) {
        this.selectedFiles = Array.from(files);
        this.renderFileList();
        this.updateFromForm();
    }

    renderFileList() {
        const fileList = document.getElementById('fileList');
        if (!fileList) return;

        if (this.selectedFiles.length === 0) {
            fileList.style.display = 'none';
            return;
        }

        fileList.style.display = 'block';
        fileList.innerHTML = this.selectedFiles.map((file, index) => `
            <div class="file-item">
                <div class="file-info">
                    <span class="file-icon"></span>
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">${this.formatFileSize(file.size)}</span>
                </div>
                <button class="file-remove" onclick="app.removeFile(${index})"><span class="remove-icon"></span></button>
            </div>
        `).join('');
    }

    removeFile(index) {
        this.selectedFiles.splice(index, 1);
        this.renderFileList();
        this.updateFromForm();
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    updateFromForm() {
        if (!this.currentAPI || this.isUpdatingFromEditor) return;

        this.isUpdatingFromForm = true;

        try {
            const jsonData = this.buildJSONFromForm();
            if (this.jsonEditor) {
                this.jsonEditor.setValue(JSON.stringify(jsonData, null, 2));
            }
        } catch (error) {
            console.error('Error updating from form:', error);
        } finally {
            this.isUpdatingFromForm = false;
        }
    }

    updateFromEditor() {
        if (!this.jsonEditor || this.isUpdatingFromForm) return;

        this.isUpdatingFromEditor = true;

        try {
            const jsonText = this.jsonEditor.getValue();
            const jsonData = JSON.parse(jsonText);
            this.updateFormFromJSON(jsonData);
        } catch (error) {
            // JSON解析错误时不更新表单
        } finally {
            this.isUpdatingFromEditor = false;
        }
    }

    buildJSONFromForm() {
        const { method, path } = this.currentAPI;
        const jsonData = { method, url: path };

        // 路径参数替换
        const pathParams = (path.match(/:(\w+)/g) || []);
        pathParams.forEach(param => {
            const paramName = param.slice(1);
            const value = document.getElementById(`path_${paramName}`)?.value;
            if (value) {
                jsonData.url = jsonData.url.replace(param, value);
            }
        });

        // 查询参数
        const queryParams = {};
        const api = this.findAPIById(this.currentAPI.apiId);
        if (api?.queryParams) {
            api.queryParams.forEach(param => {
                const value = document.getElementById(param.name)?.value;
                if (value) queryParams[param.name] = value;
            });
        }
        if (Object.keys(queryParams).length > 0) {
            jsonData.query = queryParams;
        }

        // 请求体
        if (method !== 'GET' && api?.bodyParams) {
            const body = {};
            api.bodyParams.forEach(param => {
                const element = document.getElementById(param.name);
                if (!element) return;

                let value = element.value;
                if (value) {
                    if (param.type === 'json') {
                        try {
                            value = JSON.parse(value);
                        } catch (e) {
                            // 保持原值
                        }
                    }
                    body[param.name] = value;
                }
            });
            if (Object.keys(body).length > 0) {
                jsonData.body = body;
            }
        }

        // 文件信息
        if (this.selectedFiles.length > 0) {
            jsonData.files = this.selectedFiles.map(f => ({
                name: f.name,
                size: f.size,
                type: f.type
            }));
        }

        return jsonData;
    }

    updateFormFromJSON(jsonData) {
        if (!jsonData || !this.currentAPI) return;

        const api = this.findAPIById(this.currentAPI.apiId);

        // 路径参数
        if (jsonData.url) {
            const originalPath = this.currentAPI.path;
            const pathParams = originalPath.match(/:(\w+)/g) || [];
            let workingUrl = jsonData.url;

            pathParams.forEach(param => {
                const paramName = param.slice(1);
                const paramPattern = new RegExp(`/([^/]+)`);
                const match = workingUrl.match(paramPattern);
                if (match) {
                    const input = document.getElementById(`path_${paramName}`);
                    if (input) input.value = match[1];
                }
            });
        }

        // 查询参数
        if (jsonData.query && api?.queryParams) {
            api.queryParams.forEach(param => {
                const value = jsonData.query[param.name];
                const input = document.getElementById(param.name);
                if (input && value !== undefined) {
                    input.value = value;
                }
            });
        }

        // 请求体参数
        if (jsonData.body && api?.bodyParams) {
            api.bodyParams.forEach(param => {
                const value = jsonData.body[param.name];
                const input = document.getElementById(param.name);
                if (input && value !== undefined) {
                    if (param.type === 'json' && typeof value === 'object') {
                        input.value = JSON.stringify(value, null, 2);
                    } else {
                        input.value = value;
                    }
                }
            });
        }
    }

    formatJSON() {
        if (!this.jsonEditor) return;

        try {
            const jsonText = this.jsonEditor.getValue();
            const jsonData = JSON.parse(jsonText);
            this.jsonEditor.setValue(JSON.stringify(jsonData, null, 2));
            this.showToast('JSON 已格式化', 'success');
        } catch (error) {
            this.showToast('JSON 格式错误: ' + error.message, 'error');
        }
    }

    validateJSON() {
        if (!this.jsonEditor) return;

        try {
            const jsonText = this.jsonEditor.getValue();
            JSON.parse(jsonText);
            this.showToast('JSON 格式正确', 'success');
        } catch (error) {
            this.showToast('JSON 格式错误: ' + error.message, 'error');
        }
    }

    copyJSON() {
        if (!this.jsonEditor) return;
        const jsonText = this.jsonEditor.getValue();
        this.copyToClipboard(jsonText);
    }

    fillExample() {
        if (!this.currentAPI) return;

        const example = this.apiConfig.examples[this.currentAPI.apiId];
        if (!example) {
            this.showToast('该API暂无示例数据', 'info');
            return;
        }

        Object.keys(example).forEach(key => {
            if (key.startsWith('path_')) {
                const pathParam = key.substring(5);
                const input = document.getElementById(`path_${pathParam}`);
                if (input) input.value = example[key];
            } else {
                const input = document.getElementById(key);
                if (input) {
                    if (typeof example[key] === 'object') {
                        input.value = JSON.stringify(example[key], null, 2);
                    } else {
                        input.value = example[key];
                    }
                }
            }
        });

        this.updateFromForm();
        this.showToast('已填充示例数据', 'success');
    }

    async executeRequest() {
        if (!this.currentAPI || !this.jsonEditor) return;

        let requestData;
        try {
            const jsonText = this.jsonEditor.getValue();
            requestData = JSON.parse(jsonText);
        } catch (error) {
            this.showToast('请求数据格式错误: ' + error.message, 'error');
            return;
        }

        const api = this.findAPIById(this.currentAPI.apiId);
        if (!api) return;

        // 验证必填字段
        const missingFields = [];
        if (api.bodyParams) {
            api.bodyParams.forEach(param => {
                if (param.required && !requestData.body?.[param.name]) {
                    missingFields.push(param.label);
                }
            });
        }

        if (missingFields.length > 0) {
            this.showToast(`请填写必填字段: ${missingFields.join(', ')}`, 'warning');
            return;
        }

        let url = this.serverUrl + (requestData.url || this.currentAPI.path);

        if (requestData.query) {
            const queryParams = new URLSearchParams(requestData.query);
            url += '?' + queryParams.toString();
        }

        // 文件上传
        if (this.currentAPI.apiId === 'file-upload') {
            if (this.selectedFiles.length === 0) {
                this.showToast('请选择要上传的文件', 'error');
                return;
            }

            const formData = new FormData();
            this.selectedFiles.forEach(file => {
                formData.append('file', file);
            });

            await this.executeFileUpload(url, formData);
            return;
        }

        const button = document.querySelector('.btn-primary');
        const originalText = button.innerHTML;
        button.innerHTML = '<span class="loading-spinner"></span><span>执行中...</span>';
        button.disabled = true;

        const startTime = Date.now();

        try {
            const options = {
                method: requestData.method || this.currentAPI.method,
                headers: this.getHeaders()
            };

            if (requestData.body) {
                options.body = JSON.stringify(requestData.body);
            }

            const response = await fetch(url, options);
            const responseTime = Date.now() - startTime;

            const contentType = response.headers.get('content-type') || '';
            const rawText = await response.clone().text();
            let responseData;
            try {
                responseData = contentType.includes('application/json') ? JSON.parse(rawText) : rawText;
            } catch {
                responseData = rawText;
            }
            const sizeBytes = new TextEncoder().encode(rawText).length;
            const headersObj = {};
            try { for (const [k, v] of response.headers.entries()) headersObj[k] = v; } catch {}

            this.renderResponse(response.status, responseData, responseTime, {
                url,
                method: options.method,
                headers: headersObj,
                sizeBytes,
                contentType
            });

            if (response.ok) {
                this.showToast('请求成功', 'success');
            } else {
                this.showToast(`请求失败: ${response.status}`, 'error');
            }
        } catch (error) {
            this.renderResponse(0, { error: error.message }, Date.now() - startTime, {
                url,
                method: (requestData.method || this.currentAPI.method) || '-',
                headers: {},
                sizeBytes: 0,
                contentType: '-'
            });
            this.showToast('请求失败: ' + error.message, 'error');
        } finally {
            button.innerHTML = originalText;
            button.disabled = false;
        }
    }

    async executeFileUpload(url, formData) {
        const button = document.querySelector('.btn-primary');
        const originalText = button.innerHTML;
        button.innerHTML = '<span class="loading-spinner"></span><span>上传中...</span>';
        button.disabled = true;

        const startTime = Date.now();

        try {
            const headers = { 'X-API-Key': localStorage.getItem('apiKey') || '' };

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: formData
            });

            const responseTime = Date.now() - startTime;
            const rawText = await response.clone().text();
            let responseData;
            try { responseData = JSON.parse(rawText); } catch { responseData = rawText; }
            const sizeBytes = new TextEncoder().encode(rawText).length;
            const headersObj = {};
            try { for (const [k, v] of response.headers.entries()) headersObj[k] = v; } catch {}

            this.renderResponse(response.status, responseData, responseTime, {
                url,
                method: 'POST',
                headers: headersObj,
                sizeBytes,
                contentType: response.headers.get('content-type') || ''
            });

            if (response.ok) {
                this.showToast('文件上传成功', 'success');
                this.selectedFiles = [];
                this.renderFileList();
                document.getElementById('fileInput').value = '';
            } else {
                this.showToast(`上传失败: ${response.status}`, 'error');
            }
        } catch (error) {
            this.renderResponse(0, { error: error.message }, Date.now() - startTime, {
                url,
                method: 'POST',
                headers: {},
                sizeBytes: 0,
                contentType: '-'
            });
            this.showToast('上传失败: ' + error.message, 'error');
        } finally {
            button.innerHTML = originalText;
            button.disabled = false;
        }
    }

    renderResponse(status, data, time, meta = {}) {
        const responseSection = document.getElementById('responseSection');
        if (!responseSection) return;

        const isSuccess = status >= 200 && status < 300;

        let visualizationHtml = '';

        if (isSuccess && data) {
            if (data.bots && Array.isArray(data.bots)) {
                visualizationHtml = this.renderBotsList(data.bots);
            } else if (data.devices && Array.isArray(data.devices)) {
                visualizationHtml = this.renderDevicesList(data.devices);
            } else if (data.plugins && Array.isArray(data.plugins)) {
                visualizationHtml = this.renderPluginsList(data.plugins);
            }
        }

        const formatBytes = (bytes) => {
            if (!bytes || bytes <= 0) return '-';
            const k = 1024; const sizes = ['B','KB','MB','GB'];
            const i = Math.floor(Math.log(bytes)/Math.log(k));
            return `${(bytes/Math.pow(k,i)).toFixed(2)} ${sizes[i]}`;
        };

        responseSection.innerHTML = `
            <div class="response-section">
                <div class="response-header">
                    <h2 class="response-title">响应结果</h2>
                    <div class="response-meta">
                        <span class="status-badge ${isSuccess ? 'status-success' : 'status-error'}">
                            <span>${isSuccess ? '✓' : '✗'}</span>
                            <span>${status}</span>
                        </span>
                        <span class="response-time">⏱️ ${time}ms</span>
                    </div>
                </div>
                
                <div class="kv-table-wrap">
                    <table class="kv-table">
                        <tbody>
                            <tr><th>方法</th><td>${meta.method || '-'}</td></tr>
                            <tr><th>URL</th><td class="break-all">${meta.url || '-'}</td></tr>
                            <tr><th>类型</th><td>${meta.contentType || '-'}</td></tr>
                            <tr><th>大小</th><td>${formatBytes(meta.sizeBytes)}</td></tr>
                            <tr><th>耗时</th><td>${time} ms</td></tr>
                        </tbody>
                    </table>
                </div>

                ${visualizationHtml}
                
                <div class="code-viewer">
                    <div class="code-header">
                        <span class="code-language">JSON Response</span>
                        <button class="copy-btn" onclick="app.copyResponse()">
                            <span>📋</span>
                            <span>复制</span>
                        </button>
                    </div>
                    <pre id="responseContent">${this.syntaxHighlight(JSON.stringify(data, null, 2))}</pre>
                </div>

                ${meta.headers && Object.keys(meta.headers).length ? `
                <details class="headers-details"><summary>响应头</summary>
                    <table class="kv-table small">
                        <tbody>
                            ${Object.entries(meta.headers).map(([k,v]) => `<tr><th>${k}</th><td class="break-all">${v}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </details>` : ''}
            </div>
        `;

        responseSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    renderBotsList(bots) {
        if (!bots || bots.length === 0) return '';

        return `
            <div class="data-visualization">
                <h3 class="section-title">
                    <span class="section-icon"></span>
                    机器人列表
                </h3>
                <div class="bot-grid">
                    ${bots.map(bot => `
                        <div class="bot-card">
                            <div class="bot-header">
                                <div class="bot-avatar">${bot.nickname ? bot.nickname.charAt(0) : '🤖'}</div>
                                <div class="bot-status ${bot.online ? 'online' : 'offline'}">
                                    <span class="status-dot ${bot.online ? 'online' : ''}"></span>
                                    <span>${bot.online ? '在线' : '离线'}</span>
                                </div>
                            </div>
                            <div class="bot-info">
                                <div class="bot-name">${bot.nickname || '未知'}</div>
                                <div class="bot-details">
                                    <div class="bot-detail">
                                        <span class="bot-detail-label">UIN</span>
                                        <span class="bot-detail-value">${bot.uin || '-'}</span>
                                    </div>
                                    <div class="bot-detail">
                                        <span class="bot-detail-label">适配器</span>
                                        <span class="bot-detail-value">${bot.adapter || '-'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    renderDevicesList(devices) {
        if (!devices || devices.length === 0) return '';

        return `
            <div class="data-visualization">
                <h3 class="section-title">
                    <span class="section-icon"></span>
                    设备列表
                </h3>
                <div class="bot-grid">
                    ${devices.map(device => `
                        <div class="bot-card">
                            <div class="bot-header">
                                <div class="bot-avatar">📱</div>
                                <div class="bot-status ${device.online ? 'online' : 'offline'}">
                                    <span class="status-dot ${device.online ? 'online' : ''}"></span>
                                    <span>${device.online ? '在线' : '离线'}</span>
                                </div>
                            </div>
                            <div class="bot-info">
                                <div class="bot-name">${device.device_name || device.device_id}</div>
                                <div class="bot-details">
                                    <div class="bot-detail">
                                        <span class="bot-detail-label">类型</span>
                                        <span class="bot-detail-value">${device.device_type || '-'}</span>
                                    </div>
                                    <div class="bot-detail">
                                        <span class="bot-detail-label">最后活跃</span>
                                        <span class="bot-detail-value">${device.last_heartbeat ? new Date(device.last_heartbeat).toLocaleTimeString() : '-'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    renderPluginsList(plugins) {
        if (!plugins || plugins.length === 0) return '';

        return `
            <div class="data-visualization">
                <h3 class="section-title">
                    <span class="section-icon"></span>
                    插件列表
                </h3>
                <div class="bot-grid">
                    ${plugins.map(plugin => `
                        <div class="bot-card">
                            <div class="bot-header">
                                <div class="bot-avatar">🧩</div>
                                <div class="bot-status online">
                                    <span class="status-dot online"></span>
                                    <span>已激活</span>
                                </div>
                            </div>
                            <div class="bot-info">
                                <div class="bot-name">${plugin.name || plugin.key}</div>
                                <div class="bot-details">
                                    <div class="bot-detail">
                                        <span class="bot-detail-label">标识</span>
                                        <span class="bot-detail-value">${plugin.key || '-'}</span>
                                    </div>
                                    <div class="bot-detail">
                                        <span class="bot-detail-label">优先级</span>
                                        <span class="bot-detail-value">${plugin.priority !== undefined ? plugin.priority : '-'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    syntaxHighlight(json) {
        json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
            let cls = 'json-number';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'json-key';
                } else {
                    cls = 'json-string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'json-boolean';
            } else if (/null/.test(match)) {
                cls = 'json-null';
            }
            return `<span class="${cls}">${match}</span>`;
        });
    }

    copyResponse() {
        const response = document.getElementById('responseContent').textContent;
        this.copyToClipboard(response);
    }

    copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                this.showToast('已复制到剪贴板', 'success');
            }).catch(() => {
                this.fallbackCopyToClipboard(text);
            });
        } else {
            this.fallbackCopyToClipboard(text);
        }
    }

    fallbackCopyToClipboard(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.top = '0';
        textarea.style.left = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                this.showToast('已复制到剪贴板', 'success');
            } else {
                this.showToast('复制失败，请手动复制', 'error');
            }
        } catch (err) {
            this.showToast('复制失败: ' + err.message, 'error');
        }
        document.body.removeChild(textarea);
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');

        const icons = {
            success: '✓',
            error: '✗',
            warning: '⚠️',
            info: 'ℹ️'
        };
        
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type]}</span>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
        });

        setTimeout(() => {
            toast.classList.add('hide');
            setTimeout(() => {
                if (container.contains(toast)) {
                    container.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }

    autoSaveInputs() {
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = setTimeout(() => {
            const inputs = document.querySelectorAll('.input-field');
            const values = {};
            inputs.forEach(input => {
                if (input.id && input.value) {
                    values[input.id] = input.value;
                }
            });
            localStorage.setItem('apiTestInputs', JSON.stringify(values));
        }, 1000);
    }

    restoreInputs() {
        const saved = localStorage.getItem('apiTestInputs');
        if (saved) {
            try {
                const values = JSON.parse(saved);
                Object.keys(values).forEach(id => {
                    const input = document.getElementById(id);
                    if (input) {
                        input.value = values[id];
                    }
                });
            } catch (e) {
                console.error('Failed to restore inputs:', e);
            }
        }
    }

    // ====================== Config Editor ======================
    async openConfigEditor() {
        this.closeSidebar();
        this.currentAPI = null;
        const content = document.getElementById('content');
        content.innerHTML = `
            <div class="config-editor-container">
                <div class="config-editor-header">
                    <div class="config-editor-title">配置管理</div>
                    <div class="config-editor-controls">
                        <button class="btn btn-secondary" id="refreshConfigListBtn">
                            <span>🔄</span><span>刷新</span>
                        </button>
                    </div>
                </div>
                <div class="config-editor-body">
                    <div class="config-list-panel" id="configListPanel">
                        <div class="config-list-loading">加载中...</div>
                    </div>
                    <div class="config-editor-panel" id="configEditorPanel" style="display: none;">
                        <div class="config-editor-toolbar">
                            <div class="config-editor-name" id="configEditorName"></div>
                            <div class="config-editor-actions">
                                <button class="btn btn-secondary" id="saveConfigBtn">
                                    <span class="btn-icon">保存</span>
                                </button>
                                <button class="btn btn-secondary" id="validateConfigBtn">
                                    <span class="btn-icon">验证</span>
                                </button>
                                <button class="btn btn-secondary" id="backConfigBtn">
                                    <span class="btn-icon">返回</span>
                                </button>
                            </div>
                        </div>
                        <div class="config-editor-content">
                            <textarea id="configEditorTextarea" class="config-editor-textarea"></textarea>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const refreshBtn = document.getElementById('refreshConfigListBtn');
        const saveBtn = document.getElementById('saveConfigBtn');
        const validateBtn = document.getElementById('validateConfigBtn');
        const backBtn = document.getElementById('backConfigBtn');

        refreshBtn.addEventListener('click', () => this.loadConfigList());
        saveBtn.addEventListener('click', () => this.saveConfig());
        validateBtn.addEventListener('click', () => this.validateConfig());
        backBtn.addEventListener('click', () => this.backToConfigList());

        await this.loadConfigList();
    }

    async loadConfigList() {
        const panel = document.getElementById('configListPanel');
        if (!panel) return;

        try {
            panel.innerHTML = '<div class="config-list-loading">加载中...</div>';
            const response = await fetch(`${this.serverUrl}/api/config/list`, {
                headers: this.getHeaders()
            });

            if (!response.ok) {
                throw new Error('获取配置列表失败');
            }

            const data = await response.json();
            if (!data.success || !data.configs) {
                throw new Error('配置列表格式错误');
            }

            if (data.configs.length === 0) {
                panel.innerHTML = '<div class="config-list-empty">暂无配置</div>';
                return;
            }

            // 处理配置列表：SystemConfig 需要特殊显示
            panel.innerHTML = data.configs.map(config => {
                const isSystem = config.name === 'system';
                const subConfigCount = isSystem && config.configs ? Object.keys(config.configs).length : 0;
                const badge = subConfigCount > 0 ? `<span class="config-badge">${subConfigCount} 个子配置</span>` : '';
                
                return `
                <div class="config-item" data-config-name="${config.name}">
                    <div class="config-item-icon">${isSystem ? '📦' : '⚙️'}</div>
                    <div class="config-item-info">
                        <div class="config-item-name">
                            ${config.displayName || config.name}
                            ${badge}
                        </div>
                        <div class="config-item-desc">${config.description || ''}</div>
                        <div class="config-item-path">${config.filePath || (isSystem ? '系统配置（包含多个子配置）' : '')}</div>
                    </div>
                    <div class="config-item-actions">
                        <button class="btn btn-sm btn-primary" data-action="edit" data-config-name="${config.name}">
                            <span class="btn-icon">编辑</span>
                        </button>
                    </div>
                </div>
            `;
            }).join('');

            // 使用事件委托，确保事件绑定可靠
            panel.querySelectorAll('[data-action="edit"]').forEach(btn => {
                // 先移除可能存在的旧事件监听器
                const newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);
                // 绑定新的事件监听器
                newBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const configName = newBtn.dataset.configName;
                    if (configName) {
                        this.editConfig(configName);
                    }
                });
            });
        } catch (error) {
            panel.innerHTML = `<div class="config-list-error">加载失败: ${error.message}</div>`;
            this.showToast('加载配置列表失败: ' + error.message, 'error');
        }
    }

    async editConfig(configName) {
        const listPanel = document.getElementById('configListPanel');
        const editorPanel = document.getElementById('configEditorPanel');
        const editorName = document.getElementById('configEditorName');
        const editorTextarea = document.getElementById('configEditorTextarea');

        if (!listPanel || !editorPanel || !editorName || !editorTextarea) return;

        try {
            listPanel.style.display = 'none';
            editorPanel.style.display = 'block';
            editorName.textContent = `编辑配置: ${configName}`;
            editorTextarea.value = '加载中...';
            editorTextarea.disabled = true;

            // 先获取配置结构，了解配置类型
            let configStructure = null;
            try {
                const structureRes = await fetch(`${this.serverUrl}/api/config/${configName}/structure`, {
                    headers: this.getHeaders()
                });
                if (structureRes.ok) {
                    const structureData = await structureRes.json();
                    if (structureData.success) {
                        configStructure = structureData.structure;
                    }
                }
            } catch (e) {
                console.warn('获取配置结构失败:', e);
            }

            const response = await fetch(`${this.serverUrl}/api/config/${configName}/read`, {
                headers: this.getHeaders()
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP ${response.status}: 读取配置失败`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.message || data.error || '读取配置失败');
            }

            // 处理配置数据：如果是 SystemConfig，需要特殊处理
            let configData = data.data;
            
            // SystemConfig 的特殊处理：它管理多个子配置文件
            if (configName === 'system') {
                // 检查返回的数据结构：如果是配置列表（有 configs 数组），显示子配置选择器
                if (configData && (configData.configs || (Array.isArray(configData) && configData.length > 0))) {
                    // 使用配置结构或返回的配置列表
                    const subConfigs = configData.configs || configData;
                    if (Array.isArray(subConfigs) && subConfigs.length > 0) {
                        // 构造结构对象用于显示
                        const structure = configStructure || {
                            name: 'system',
                            displayName: '系统配置',
                            description: 'XRK-AGT 系统配置管理',
                            configs: {}
                        };
                        // 如果结构中没有 configs，从返回的数据中构建
                        if (!structure.configs || Object.keys(structure.configs).length === 0) {
                            structure.configs = {};
                            subConfigs.forEach(sub => {
                                structure.configs[sub.name] = {
                                    name: sub.name,
                                    displayName: sub.displayName || sub.name,
                                    description: sub.description || '',
                                    filePath: sub.filePath || '',
                                    fileType: sub.fileType || 'yaml'
                                };
                            });
                        }
                        this.showSubConfigSelector(configName, structure, configData);
                        return;
                    }
                }
                // 如果返回的是配置结构对象（有 configs 对象）
                if (configData && configData.configs && typeof configData.configs === 'object' && !Array.isArray(configData.configs)) {
                    const structure = configStructure || {
                        name: configData.name || 'system',
                        displayName: configData.displayName || '系统配置',
                        description: configData.description || '',
                        configs: configData.configs
                    };
                    this.showSubConfigSelector(configName, structure, configData);
                    return;
                }
                // 如果没有子配置结构，可能是直接读取了某个子配置
                // 继续正常流程
            }

            // 检查是否有 schema，如果有则使用可视化表单，否则使用 JSON 编辑器
            const hasSchema = configStructure && configStructure.schema && configStructure.schema.fields;
            
            // 确保 configData 是对象
            if (!configData || typeof configData !== 'object') {
                configData = {};
            }
            
            if (hasSchema) {
                // 使用可视化表单编辑器
                this.renderConfigForm(configName, configData, configStructure.schema, editorPanel, editorTextarea);
            } else {
                // 使用 JSON 编辑器（向后兼容）
                let jsonString;
                try {
                    if (typeof configData === 'string') {
                        jsonString = JSON.stringify(JSON.parse(configData), null, 2);
                    } else {
                        jsonString = JSON.stringify(configData, null, 2);
                    }
                } catch (e) {
                    jsonString = typeof configData === 'string' ? configData : JSON.stringify(configData, null, 2);
                }

                editorTextarea.value = jsonString;
                editorTextarea.disabled = false;
                editorTextarea.dataset.configName = configName;

                // 初始化代码编辑器
                if (this.configEditor) {
                    this.configEditor.toTextArea();
                }
                if (typeof window.CodeMirror === 'undefined') {
                    await this._loadCodeMirror();
                }
                const theme = document.body.classList.contains('light') ? 'default' : 'monokai';
                this.configEditor = CodeMirror.fromTextArea(editorTextarea, {
                    mode: 'application/json',
                    theme: theme,
                    lineNumbers: true,
                    lineWrapping: true,
                    matchBrackets: true,
                    autoCloseBrackets: true,
                    foldGutter: true,
                    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter']
                });
            }
        } catch (error) {
            editorTextarea.value = `错误: ${error.message}`;
            editorTextarea.disabled = false;
            this.showToast('加载配置失败: ' + error.message, 'error');
        }
    }

    showSubConfigSelector(configName, structure, data) {
        const editorPanel = document.getElementById('configEditorPanel');
        if (!editorPanel) return;

        const subConfigs = Object.keys(structure.configs || {});
        if (subConfigs.length === 0) {
            this.showToast('该配置没有子配置', 'warning');
            this.backToConfigList();
            return;
        }

        editorPanel.innerHTML = `
            <div class="config-editor-toolbar">
                <div class="config-editor-name">选择子配置: ${configName}</div>
                <button class="btn btn-secondary" id="backConfigBtn">
                    <span class="btn-icon">返回</span>
                </button>
            </div>
            <div class="config-editor-content">
                <div class="sub-config-list-scroll">
                    <div class="sub-config-list">
                        ${subConfigs.map(subName => {
                            const subConfig = structure.configs[subName];
                            return `
                                <div class="sub-config-item" data-sub-name="${subName}">
                                    <div class="sub-config-icon"></div>
                                    <div class="sub-config-info">
                                        <div class="sub-config-name">${subConfig.displayName || subName}</div>
                                        <div class="sub-config-desc">${subConfig.description || ''}</div>
                                        <div class="sub-config-path">${subConfig.filePath || ''}</div>
                                    </div>
                                    <button class="btn btn-sm btn-primary" data-action="edit-sub" data-sub-name="${subName}">
                                        <span class="btn-icon">编辑</span>
                                    </button>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;

        const backBtn = document.getElementById('backConfigBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.backToConfigList());
        }
        
        editorPanel.querySelectorAll('[data-action="edit-sub"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const subName = btn.dataset.subName;
                this.editSubConfig(configName, subName);
            });
        });
    }

    async editSubConfig(parentName, subName) {
        // SystemConfig 的子配置需要通过 system 配置实例读取
        // 格式: system.bot, system.server 等
        const fullPath = `${parentName}.${subName}`;
        
        try {
            const response = await fetch(`${this.serverUrl}/api/config/${parentName}/read?path=${subName}`, {
                headers: this.getHeaders()
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP ${response.status}: 读取子配置失败`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.message || data.error || '读取子配置失败');
            }

            // 显示编辑界面
            const editorPanel = document.getElementById('configEditorPanel');
            editorPanel.innerHTML = `
                <div class="config-editor-toolbar">
                    <div class="config-editor-name">编辑配置: ${parentName}.${subName}</div>
                    <div class="config-editor-actions">
                        <button class="btn btn-secondary" id="saveConfigBtn">
                            <span class="btn-icon">保存</span>
                        </button>
                        <button class="btn btn-secondary" id="validateConfigBtn">
                            <span class="btn-icon">验证</span>
                        </button>
                        <button class="btn btn-secondary" id="backConfigBtn">
                            <span class="btn-icon">返回</span>
                        </button>
                    </div>
                </div>
                <div class="config-editor-content">
                    <textarea id="configEditorTextarea" class="config-editor-textarea"></textarea>
                </div>
            `;

            const editorTextarea = document.getElementById('configEditorTextarea');
            
            // 获取子配置的结构信息
            let subConfigStructure = null;
            try {
                const structureRes = await fetch(`${this.serverUrl}/api/config/${parentName}/structure`, {
                    headers: this.getHeaders()
                });
                if (structureRes.ok) {
                    const structureData = await structureRes.json();
                    if (structureData.success && structureData.structure && structureData.structure.configs) {
                        const subConfigMeta = structureData.structure.configs[subName];
                        if (subConfigMeta && subConfigMeta.schema) {
                            subConfigStructure = subConfigMeta.schema;
                        }
                    }
                }
            } catch (e) {
                console.warn('获取子配置结构失败:', e);
            }

            // 确保 data.data 是对象
            let subConfigData = data.data;
            if (!subConfigData || typeof subConfigData !== 'object') {
                subConfigData = {};
            }
            
            // 检查是否有 schema，如果有则使用可视化表单，否则使用 JSON 编辑器
            const hasSchema = subConfigStructure && subConfigStructure.fields;
            
            if (hasSchema) {
                // 使用可视化表单编辑器
                this.renderConfigForm(parentName, subConfigData, subConfigStructure, editorPanel, editorTextarea, subName);
            } else {
                // 使用 JSON 编辑器（向后兼容）
                let jsonString;
                try {
                    const jsonData = subConfigData || {};
                    if (typeof jsonData === 'string') {
                        jsonString = JSON.stringify(JSON.parse(jsonData), null, 2);
                    } else {
                        jsonString = JSON.stringify(jsonData, null, 2);
                    }
                } catch (e) {
                    jsonString = typeof subConfigData === 'string' ? subConfigData : JSON.stringify(subConfigData || {}, null, 2);
                }
                
                editorTextarea.value = jsonString;
                editorTextarea.disabled = false;
                editorTextarea.dataset.configName = parentName;
                editorTextarea.dataset.subName = subName;

                // 初始化编辑器
                if (this.configEditor) {
                    this.configEditor.toTextArea();
                }
                const theme = document.body.classList.contains('light') ? 'default' : 'monokai';
                this.configEditor = CodeMirror.fromTextArea(editorTextarea, {
                    mode: 'application/json',
                    theme: theme,
                    lineNumbers: true,
                    lineWrapping: true,
                    matchBrackets: true,
                    autoCloseBrackets: true,
                    foldGutter: true,
                    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter']
                });
            }

            document.getElementById('saveConfigBtn').addEventListener('click', () => this.saveSubConfig());
            document.getElementById('validateConfigBtn').addEventListener('click', () => this.validateSubConfig());
            document.getElementById('backConfigBtn').addEventListener('click', async () => {
                // 返回到子配置选择界面
                try {
                    const structureRes = await fetch(`${this.serverUrl}/api/config/${parentName}/structure`, {
                        headers: this.getHeaders()
                    });
                    if (structureRes.ok) {
                        const structureData = await structureRes.json();
                        if (structureData.success) {
                            const readRes = await fetch(`${this.serverUrl}/api/config/${parentName}/read`, {
                                headers: this.getHeaders()
                            });
                            if (readRes.ok) {
                                const readData = await readRes.json();
                                if (readData.success) {
                                    this.showSubConfigSelector(parentName, structureData.structure, readData.data);
                                }
                            }
                        }
                    }
                } catch (e) {
                    this.backToConfigList();
                }
            });
        } catch (error) {
            this.showToast('加载子配置失败: ' + error.message, 'error');
            // 出错时返回列表
            setTimeout(() => this.backToConfigList(), 2000);
        }
    }

    async saveSubConfig() {
        // 尝试多种方式获取 editorTextarea
        let editorTextarea = document.getElementById('configEditorTextarea');
        
        // 如果找不到，尝试从整个文档中查找
        if (!editorTextarea) {
            editorTextarea = document.querySelector('textarea#configEditorTextarea');
        }
        
        // 如果还是没有，尝试通过 data 属性查找
        if (!editorTextarea) {
            editorTextarea = document.querySelector('textarea[data-config-name][data-sub-name]');
        }
        
        if (!editorTextarea) {
            console.error('无法找到子配置编辑器，当前 DOM 状态:', {
                hasConfigEditorTextarea: !!document.getElementById('configEditorTextarea'),
                hasFormContainer: !!document.querySelector('.config-form-container'),
                hasEditorPanel: !!document.getElementById('configEditorPanel')
            });
            this.showToast('无法找到配置编辑器，请刷新页面重试', 'error');
            return;
        }

        const configName = editorTextarea.dataset.configName;
        const subName = editorTextarea.dataset.subName;
        
        if (!configName || !subName) {
            this.showToast('缺少配置信息', 'error');
            return;
        }

        let configData;

        // 检查是否使用表单
        const formContainer = document.querySelector('.config-form-container');
        if (formContainer && editorTextarea.dataset.hasForm === 'true') {
            configData = this.collectFormData(formContainer);
        } else {
            const jsonText = this.configEditor ? this.configEditor.getValue() : (editorTextarea.value || '{}');
            if (!jsonText || jsonText.trim() === '') {
                configData = {};
            } else {
                const parsed = this.parseJSON(jsonText);
                if (parsed.error) {
                    this.showToast('JSON 格式错误: ' + parsed.error, 'error');
                    return;
                }
                configData = parsed.data;
            }
        }
        
        // 确保 configData 是对象
        if (!configData || typeof configData !== 'object') {
            configData = {};
        }

        // SystemConfig 的子配置保存：使用 path 参数指定子配置名称
        const response = await fetch(`${this.serverUrl}/api/config/${configName}/write`, {
            method: 'POST',
            headers: {
                ...this.getHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                data: configData,
                path: subName,
                backup: true,
                validate: true
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            this.showToast('保存失败: ' + (errorData.message || errorData.error || `HTTP ${response.status}`), 'error');
            return;
        }

        const result = await response.json();
        if (!result.success) {
            this.showToast('保存失败: ' + (result.message || result.error || '未知错误'), 'error');
            return;
        }

        this.showToast('配置已保存', 'success');
    }

    async validateSubConfig() {
        const editorTextarea = document.getElementById('configEditorTextarea');
        if (!editorTextarea || !editorTextarea.dataset.configName || !editorTextarea.dataset.subName) return;

        const configName = editorTextarea.dataset.configName;
        const subName = editorTextarea.dataset.subName;
        let configData;

        // 检查是否使用表单
        const formContainer = document.querySelector('.config-form-container');
        if (formContainer && editorTextarea.dataset.hasForm === 'true') {
            configData = this.collectFormData(formContainer);
        } else {
            try {
                const jsonText = this.configEditor ? this.configEditor.getValue() : editorTextarea.value;
                configData = JSON.parse(jsonText);
            } catch (error) {
                this.showToast('JSON 格式错误: ' + error.message, 'error');
                return;
            }
        }

        try {
            const response = await fetch(`${this.serverUrl}/api/config/${configName}/validate`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ data: configData })
            });

            const result = await response.json();
            if (result.success && result.validation) {
                if (result.validation.valid) {
                    this.showToast('配置验证通过', 'success');
                } else {
                    this.showToast('配置验证失败: ' + result.validation.errors.join(', '), 'error');
                }
            } else {
                throw new Error(result.message || '验证失败');
            }
        } catch (error) {
            this.showToast('验证配置失败: ' + error.message, 'error');
        }
    }

    async saveConfig() {
        // 尝试多种方式获取 editorTextarea
        let editorTextarea = document.getElementById('configEditorTextarea');
        
        // 如果找不到，尝试从整个文档中查找
        if (!editorTextarea) {
            editorTextarea = document.querySelector('textarea#configEditorTextarea');
        }
        
        // 如果还是没有，尝试通过 data 属性查找
        if (!editorTextarea) {
            editorTextarea = document.querySelector('textarea[data-config-name]');
        }
        
        if (!editorTextarea) {
            console.error('无法找到配置编辑器，当前 DOM 状态:', {
                hasConfigEditorTextarea: !!document.getElementById('configEditorTextarea'),
                hasFormContainer: !!document.querySelector('.config-form-container'),
                hasEditorPanel: !!document.getElementById('configEditorPanel')
            });
            this.showToast('无法找到配置编辑器，请刷新页面重试', 'error');
            return;
        }

        const configName = editorTextarea.dataset.configName;
        if (!configName) {
            this.showToast('缺少配置名称', 'error');
            return;
        }
        
        // 检查是否是 system 配置的子配置（不应该通过 saveConfig 保存）
        if (configName === 'system' && editorTextarea.dataset.subName) {
            // 应该使用 saveSubConfig
            return await this.saveSubConfig();
        }
        
        let configData;

        // 检查是否使用表单
        const formContainer = document.querySelector('.config-form-container');
        if (formContainer && editorTextarea.dataset.hasForm === 'true') {
            configData = this.collectFormData(formContainer);
        } else {
            try {
                const jsonText = this.configEditor ? this.configEditor.getValue() : (editorTextarea.value || '{}');
                if (!jsonText || jsonText.trim() === '') {
                    configData = {};
                } else {
                    configData = JSON.parse(jsonText);
                }
            } catch (error) {
                this.showToast('JSON 格式错误: ' + error.message, 'error');
                return;
            }
        }
        
        // 确保 configData 是对象
        if (!configData || typeof configData !== 'object') {
            configData = {};
        }

        try {
            console.log('保存配置:', { configName, configData });
            const response = await fetch(`${this.serverUrl}/api/config/${configName}/write`, {
                method: 'POST',
                headers: {
                    ...this.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    data: configData,
                    backup: true,
                    validate: true
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('保存配置失败:', errorData);
                throw new Error(errorData.message || errorData.error || `HTTP ${response.status}: 保存失败`);
            }

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.message || result.error || '保存失败');
            }

            this.showToast('配置已保存', 'success');
        } catch (error) {
            this.showToast('保存配置失败: ' + error.message, 'error');
        }
    }

    async validateConfig() {
        const editorTextarea = document.getElementById('configEditorTextarea');
        if (!editorTextarea || !editorTextarea.dataset.configName) return;

        const configName = editorTextarea.dataset.configName;
        let configData;

        // 检查是否使用表单
        const formContainer = document.querySelector('.config-form-container');
        if (formContainer && editorTextarea.dataset.hasForm === 'true') {
            configData = this.collectFormData(formContainer);
        } else {
            try {
                const jsonText = this.configEditor ? this.configEditor.getValue() : editorTextarea.value;
                configData = JSON.parse(jsonText);
            } catch (error) {
                this.showToast('JSON 格式错误: ' + error.message, 'error');
                return;
            }
        }

        try {
            const response = await fetch(`${this.serverUrl}/api/config/${configName}/validate`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ data: configData })
            });

            const result = await response.json();
            if (result.success && result.validation) {
                if (result.validation.valid) {
                    this.showToast('配置验证通过', 'success');
                } else {
                    this.showToast('配置验证失败: ' + result.validation.errors.join(', '), 'error');
                }
            } else {
                throw new Error(result.message || '验证失败');
            }
        } catch (error) {
            this.showToast('验证配置失败: ' + error.message, 'error');
        }
    }

    backToConfigList() {
        const listPanel = document.getElementById('configListPanel');
        const editorPanel = document.getElementById('configEditorPanel');

        if (listPanel && editorPanel) {
            // 清理编辑器
            if (this.configEditor) {
                try {
                    this.configEditor.toTextArea();
                } catch (e) {
                    console.warn('清理编辑器失败:', e);
                }
                this.configEditor = null;
            }
            
            // 重置编辑器面板内容，避免嵌套问题
            // 但保留基本结构，以便后续重新使用
            editorPanel.innerHTML = `
                <div class="config-editor-toolbar">
                    <div class="config-editor-name" id="configEditorName"></div>
                    <div class="config-editor-actions">
                        <button class="btn btn-secondary" id="saveConfigBtn">
                            <span class="btn-icon">保存</span>
                        </button>
                        <button class="btn btn-secondary" id="validateConfigBtn">
                            <span class="btn-icon">验证</span>
                        </button>
                        <button class="btn btn-secondary" id="backConfigBtn">
                            <span class="btn-icon">返回</span>
                        </button>
                    </div>
                </div>
                <div class="config-editor-content">
                    <textarea id="configEditorTextarea" class="config-editor-textarea"></textarea>
                </div>
            `;
            
            // 重新绑定按钮事件，确保事件监听器正确
            const saveBtn = document.getElementById('saveConfigBtn');
            const validateBtn = document.getElementById('validateConfigBtn');
            const backBtn = document.getElementById('backConfigBtn');
            
            if (saveBtn) {
                // 移除旧的事件监听器（如果有）
                const newSaveBtn = saveBtn.cloneNode(true);
                saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
                newSaveBtn.addEventListener('click', () => this.saveConfig());
            }
            if (validateBtn) {
                const newValidateBtn = validateBtn.cloneNode(true);
                validateBtn.parentNode.replaceChild(newValidateBtn, validateBtn);
                newValidateBtn.addEventListener('click', () => this.validateConfig());
            }
            if (backBtn) {
                const newBackBtn = backBtn.cloneNode(true);
                backBtn.parentNode.replaceChild(newBackBtn, backBtn);
                newBackBtn.addEventListener('click', () => this.backToConfigList());
            }
            
            editorPanel.style.display = 'none';
            
            // 显示列表面板
            listPanel.style.display = 'block';
            
            // 重新加载配置列表，确保状态正确和事件绑定
            this.loadConfigList().catch(err => {
                console.error('重新加载配置列表失败:', err);
            });
        }
    }

    /**
     * 渲染可视化配置表单
     */
    renderConfigForm(configName, configData, schema, editorPanel, editorTextarea, subName = null) {
        // 确保 editorPanel 有正确的结构
        let contentDiv = editorPanel.querySelector('.config-editor-content');
        if (!contentDiv) {
            // 如果没有，创建结构
            editorPanel.innerHTML = `
                <div class="config-editor-toolbar">
                    <div class="config-editor-name">编辑配置: ${subName ? `${configName}.${subName}` : configName}</div>
                    <div class="config-editor-actions">
                        <button class="btn btn-secondary" id="saveConfigBtn">
                            <span class="btn-icon">保存</span>
                        </button>
                        <button class="btn btn-secondary" id="validateConfigBtn">
                            <span class="btn-icon">验证</span>
                        </button>
                        <button class="btn btn-secondary" id="backConfigBtn">
                            <span class="btn-icon">返回</span>
                        </button>
                    </div>
                </div>
                <div class="config-editor-content"></div>
            `;
            contentDiv = editorPanel.querySelector('.config-editor-content');
            
            // 绑定按钮事件
            const saveBtn = document.getElementById('saveConfigBtn');
            const validateBtn = document.getElementById('validateConfigBtn');
            const backBtn = document.getElementById('backConfigBtn');
            
            if (saveBtn) {
                saveBtn.addEventListener('click', () => {
                    if (subName) {
                        this.saveSubConfig();
                    } else {
                        this.saveConfig();
                    }
                });
            }
            if (validateBtn) {
                validateBtn.addEventListener('click', () => {
                    if (subName) {
                        this.validateSubConfig();
                    } else {
                        this.validateConfig();
                    }
                });
            }
            if (backBtn) {
                backBtn.addEventListener('click', () => {
                    this.backToConfigList();
                });
            }
        }
        
        const formContainer = document.createElement('div');
        formContainer.className = 'config-form-container';
        formContainer.innerHTML = this.generateFormHTML(configData, schema.fields || {}, schema.required || []);
        
        // 替换编辑器内容
        contentDiv.innerHTML = '';
        contentDiv.appendChild(formContainer);
        
        // 总是从 DOM 中查找或创建 editorTextarea，确保它存在
        let textareaElement = document.getElementById('configEditorTextarea');
        if (!textareaElement) {
            textareaElement = document.createElement('textarea');
            textareaElement.id = 'configEditorTextarea';
            textareaElement.className = 'config-editor-textarea';
            textareaElement.style.display = 'none';
            // 将 textarea 添加到 contentDiv，而不是 formContainer，避免被替换
            contentDiv.appendChild(textareaElement);
        }
        
        // 设置数据属性
        textareaElement.dataset.configName = configName;
        if (subName) {
            textareaElement.dataset.subName = subName;
        } else {
            // 确保没有 subName 时移除该属性
            delete textareaElement.dataset.subName;
        }
        textareaElement.dataset.hasForm = 'true';
        
        // 绑定表单事件
        this.bindFormEvents(formContainer, configName, subName);
    }

    /**
     * 生成表单 HTML
     * 确保所有 schema 中定义的字段都显示，即使数据中没有该字段
     */
    generateFormHTML(data, fields, required = []) {
        let html = '<div class="config-form-scroll">';
        
        // 确保 data 是对象
        if (!data || typeof data !== 'object') {
            data = {};
        }
        
        for (const [fieldName, fieldSchema] of Object.entries(fields)) {
            // 处理值：优先使用数据中的值（包括 null），否则使用默认值
            let value;
            if (data && Object.prototype.hasOwnProperty.call(data, fieldName)) {
                // 数据中有该字段（即使是 null 或 undefined）
                value = data[fieldName];
            } else {
                // 数据中没有该字段，使用默认值
                value = fieldSchema.default !== undefined ? fieldSchema.default : null;
            }
            
            const isRequired = required.includes(fieldName);
            const fieldId = `config-field-${fieldName}`;
            
            html += `<div class="config-form-field" data-field="${fieldName}">`;
            html += `<label for="${fieldId}" class="config-form-label">`;
            html += `${fieldSchema.label || fieldName}`;
            if (isRequired) {
                html += '<span class="config-form-required">*</span>';
            }
            html += `</label>`;
            
            if (fieldSchema.description) {
                html += `<div class="config-form-hint">${fieldSchema.description}</div>`;
            }
            
            // 根据组件类型渲染不同的输入控件
            const component = fieldSchema.component || this.inferComponentType(fieldSchema.type, fieldSchema);
            html += this.renderFormField(fieldId, fieldName, fieldSchema, value, component);
            
            html += `</div>`;
        }
        
        html += '</div>';
        return html;
    }

    /**
     * 推断组件类型
     */
    inferComponentType(type, fieldSchema = {}) {
        // 如果指定了 component，直接使用
        if (fieldSchema.component) {
            return fieldSchema.component;
        }
        
        // 如果是数组且有 itemType，可能是 Tags 组件
        if (type === 'array' && fieldSchema.itemType === 'string') {
            return 'Tags';
        }
        
        const typeMap = {
            'string': 'Input',
            'number': 'InputNumber',
            'boolean': 'Switch',
            'array': (fieldSchema.itemType === 'object' || fieldSchema.component === 'ArrayForm') ? 'ArrayForm' : 'Array',
            'object': 'SubForm'
        };
        return typeMap[type] || 'Input';
    }

    /**
     * 渲染表单字段
     */
    renderFormField(fieldId, fieldName, fieldSchema, value, component) {
        switch (component) {
            case 'Select':
                return this.renderSelect(fieldId, fieldName, fieldSchema, value);
            case 'MultiSelect':
                return this.renderMultiSelect(fieldId, fieldName, fieldSchema, value);
            case 'Input':
                return this.renderInput(fieldId, fieldName, fieldSchema, value);
            case 'InputPassword':
                return this.renderInputPassword(fieldId, fieldName, fieldSchema, value);
            case 'InputNumber':
                return this.renderInputNumber(fieldId, fieldName, fieldSchema, value);
            case 'Switch':
                return this.renderSwitch(fieldId, fieldName, fieldSchema, value);
            case 'SubForm':
                return this.renderSubForm(fieldId, fieldName, fieldSchema, value);
            case 'ArrayForm':
                return this.renderArrayForm(fieldId, fieldName, fieldSchema, value);
            case 'Array':
                return this.renderArray(fieldId, fieldName, fieldSchema, value);
            case 'Tags':
                return this.renderTags(fieldId, fieldName, fieldSchema, value);
            default:
                return this.renderInput(fieldId, fieldName, fieldSchema, value);
        }
    }

    /**
     * 渲染 Select 组件
     */
    renderSelect(fieldId, fieldName, fieldSchema, value) {
        const options = fieldSchema.enum || [];
        let html = `<select id="${fieldId}" class="config-form-select" data-field="${fieldName}">`;
        options.forEach(opt => {
            const selected = opt === value ? 'selected' : '';
            html += `<option value="${this.escapeHtml(String(opt))}" ${selected}>${this.escapeHtml(String(opt))}</option>`;
        });
        html += `</select>`;
        return html;
    }

    /**
     * 渲染 MultiSelect 组件（多选下拉框）
     */
    renderMultiSelect(fieldId, fieldName, fieldSchema, value) {
        const options = fieldSchema.enum || [];
        const selectedValues = Array.isArray(value) ? value : (value ? [value] : []);
        let html = `<div class="config-form-multiselect" id="${fieldId}" data-field="${fieldName}">`;
        html += `<div class="config-form-multiselect-selected">`;
        html += `<div class="config-form-multiselect-tags">`;
        selectedValues.forEach(val => {
            html += `<span class="config-form-multiselect-tag">${this.escapeHtml(String(val))}<button type="button" class="config-form-multiselect-tag-remove" data-value="${this.escapeHtml(String(val))}">×</button></span>`;
        });
        html += `</div>`;
        html += `<button type="button" class="config-form-multiselect-toggle">▼</button>`;
        html += `</div>`;
        html += `<div class="config-form-multiselect-dropdown" style="display: none;">`;
        options.forEach(opt => {
            const checked = selectedValues.includes(opt) ? 'checked' : '';
            html += `<label class="config-form-multiselect-option">`;
            html += `<input type="checkbox" value="${this.escapeHtml(String(opt))}" ${checked} />`;
            html += `<span>${this.escapeHtml(String(opt))}</span>`;
            html += `</label>`;
        });
        html += `</div>`;
        html += `</div>`;
        return html;
    }

    /**
     * 渲染 InputPassword 组件
     */
    renderInputPassword(fieldId, fieldName, fieldSchema, value) {
        const val = (value !== null && value !== undefined) ? String(value) : '';
        const placeholder = fieldSchema.placeholder || '请输入密码';
        return `<input type="password" id="${fieldId}" class="config-form-input config-form-password" data-field="${fieldName}" value="${this.escapeHtml(val)}" placeholder="${this.escapeHtml(placeholder)}" autocomplete="off" />`;
    }

    /**
     * 渲染 Input 组件
     */
    renderInput(fieldId, fieldName, fieldSchema, value) {
        // 允许 null 值，显示为空字符串
        // 如果值是 null 或 undefined，显示为空字符串，但保留字段
        const val = (value !== null && value !== undefined) ? String(value) : '';
        const placeholder = fieldSchema.placeholder || '';
        return `<input type="text" id="${fieldId}" class="config-form-input" data-field="${fieldName}" value="${this.escapeHtml(val)}" placeholder="${this.escapeHtml(placeholder)}" />`;
    }

    /**
     * 渲染 InputNumber 组件
     */
    renderInputNumber(fieldId, fieldName, fieldSchema, value) {
        // 如果值是 null 或 undefined，显示为空，允许用户输入或保持为空
        const val = (value !== null && value !== undefined && !isNaN(value)) ? Number(value) : '';
        const min = fieldSchema.min !== undefined ? `min="${fieldSchema.min}"` : '';
        const max = fieldSchema.max !== undefined ? `max="${fieldSchema.max}"` : '';
        const placeholder = fieldSchema.placeholder || (fieldSchema.default !== undefined ? String(fieldSchema.default) : '');
        return `<input type="number" id="${fieldId}" class="config-form-input config-form-number" data-field="${fieldName}" value="${val}" ${min} ${max} placeholder="${this.escapeHtml(placeholder)}" />`;
    }

    /**
     * 渲染 Switch 组件
     */
    renderSwitch(fieldId, fieldName, fieldSchema, value) {
        const checked = value === true ? 'checked' : '';
        return `
            <label class="config-form-switch">
                <input type="checkbox" id="${fieldId}" class="config-form-checkbox" data-field="${fieldName}" ${checked} />
                <span class="config-form-switch-slider"></span>
            </label>
        `;
    }

    /**
     * 渲染 SubForm 组件（嵌套对象）
     */
    renderSubForm(fieldId, fieldName, fieldSchema, value) {
        const subFields = fieldSchema.fields || {};
        // 如果 value 是 null 或不是对象，使用空对象，但保留字段结构
        const subData = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
        let html = `<div class="config-form-subform" id="${fieldId}" data-field="${fieldName}">`;
        for (const [subFieldName, subFieldSchema] of Object.entries(subFields)) {
            // 如果子数据中有该字段（即使是 null），使用它；否则使用默认值
            let subValue;
            if (subData && Object.prototype.hasOwnProperty.call(subData, subFieldName)) {
                subValue = subData[subFieldName]; // 保留 null
            } else {
                subValue = subFieldSchema.default !== undefined ? subFieldSchema.default : null;
            }
            const subFieldId = `${fieldId}-${subFieldName}`;
            html += `<div class="config-form-subfield">`;
            html += `<label for="${subFieldId}" class="config-form-label">${subFieldSchema.label || subFieldName}</label>`;
            if (subFieldSchema.description) {
                html += `<div class="config-form-hint">${subFieldSchema.description}</div>`;
            }
            html += this.renderFormField(subFieldId, `${fieldName}.${subFieldName}`, subFieldSchema, subValue, subFieldSchema.component || this.inferComponentType(subFieldSchema.type, subFieldSchema));
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    }

    /**
     * 渲染 Array 组件
     */
    renderArray(fieldId, fieldName, fieldSchema, value) {
        const arr = Array.isArray(value) ? value : [];
        let html = `<div class="config-form-array" id="${fieldId}" data-field="${fieldName}">`;
        arr.forEach((item, index) => {
            html += `<div class="config-form-array-item">`;
            html += `<input type="text" class="config-form-input" data-array-index="${index}" value="${this.escapeHtml(String(item))}" />`;
            html += `<button type="button" class="btn btn-sm btn-danger config-form-array-remove" data-index="${index}">删除</button>`;
            html += `</div>`;
        });
        html += `<button type="button" class="btn btn-sm btn-primary config-form-array-add" data-field="${fieldName}">添加项</button>`;
        html += `</div>`;
        return html;
    }

    /**
     * 渲染 Tags 组件（标签数组，用于字符串数组）
     */
    renderTags(fieldId, fieldName, fieldSchema, value) {
        // 确保 value 是数组，过滤掉 null 和 undefined
        const arr = Array.isArray(value) ? value.filter(item => item !== null && item !== undefined) : [];
        let html = `<div class="config-form-tags" id="${fieldId}" data-field="${fieldName}">`;
        html += `<div class="config-form-tags-list">`;
        arr.forEach((item, index) => {
            html += `<div class="config-form-tag-item" data-tag-index="${index}">`;
            html += `<span class="config-form-tag-text">${this.escapeHtml(String(item))}</span>`;
            html += `<button type="button" class="config-form-tag-remove" data-index="${index}">×</button>`;
            html += `</div>`;
        });
        html += `</div>`;
        html += `<div class="config-form-tags-input-wrapper">`;
        html += `<input type="text" class="config-form-tags-input" placeholder="输入后按回车添加" />`;
        html += `<button type="button" class="btn btn-sm btn-primary config-form-tags-add" data-field="${fieldName}">添加</button>`;
        html += `</div>`;
        html += `</div>`;
        return html;
    }

    /**
     * 绑定表单事件
     */
    bindFormEvents(formContainer, configName, subName) {
        // 数组操作（标量）
        formContainer.querySelectorAll('.config-form-array-add').forEach(btn => {
            btn.addEventListener('click', () => {
                const fieldName = btn.dataset.field;
                const arrayContainer = btn.closest('.config-form-array');
                const index = arrayContainer.querySelectorAll('.config-form-array-item').length;
                const itemDiv = document.createElement('div');
                itemDiv.className = 'config-form-array-item';
                itemDiv.innerHTML = `
                    <input type="text" class="config-form-input" data-array-index="${index}" value="" />
                    <button type="button" class="btn btn-sm btn-danger config-form-array-remove" data-index="${index}">删除</button>
                `;
                arrayContainer.insertBefore(itemDiv, btn);
                itemDiv.querySelector('.config-form-array-remove').addEventListener('click', function() {
                    itemDiv.remove();
                });
            });
        });

        formContainer.querySelectorAll('.config-form-array-remove').forEach(btn => {
            btn.addEventListener('click', function() {
                this.closest('.config-form-array-item').remove();
            });
        });

        // ArrayForm（对象数组）操作
        formContainer.querySelectorAll('.config-form-arrayform').forEach(arrayForm => {
            const addBtn = arrayForm.querySelector('.config-form-arrayform-add');
            if (addBtn) {
                addBtn.addEventListener('click', () => {
                    const index = arrayForm.querySelectorAll('.config-form-arrayform-item').length;
                    const fieldName = arrayForm.dataset.field;
                    // 生成空项
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = this.renderArrayForm(`${fieldName}-${index}`, fieldName, { fields: {} }, []);
                    // 只取一项结构：根据当前 arrayForm 的子字段渲染
                    const subFields = arrayForm.querySelector('.config-form-arrayform-item .config-form-subfield')
                        ? Array.from(arrayForm.querySelectorAll('.config-form-arrayform-item .config-form-subfield')).map(el => el.querySelector('[data-field]')?.dataset.field?.split('.')?.[0]).filter(Boolean)
                        : [];
                    const item = document.createElement('div');
                    item.className = 'config-form-arrayform-item';
                    item.dataset.index = String(index);
                    let inner = '';
                    // 基于第一项的结构克隆外观（简化：克隆第一个item的innerHTML）
                    const first = arrayForm.querySelector('.config-form-arrayform-item');
                    if (first) {
                        inner = first.innerHTML;
                    }
                    item.innerHTML = inner || `<div class="config-form-arrayform-actions"><button type="button" class="btn btn-sm btn-danger config-form-arrayform-remove" data-index="${index}">删除</button></div>`;
                    // 清空其中的值
                    item.querySelectorAll('[data-field]').forEach(el => {
                        if (el.type === 'checkbox') el.checked = false;
                        else el.value = '';
                    });
                    arrayForm.insertBefore(item, addBtn);
                    const rm = item.querySelector('.config-form-arrayform-remove');
                    if (rm) rm.addEventListener('click', () => item.remove());
                });
            }
            arrayForm.querySelectorAll('.config-form-arrayform-remove').forEach(btn => {
                btn.addEventListener('click', function() {
                    this.closest('.config-form-arrayform-item')?.remove();
                });
            });
        });

        // Tags 组件操作
        formContainer.querySelectorAll('.config-form-tags').forEach(tagsContainer => {
            const input = tagsContainer.querySelector('.config-form-tags-input');
            const addBtn = tagsContainer.querySelector('.config-form-tags-add');
            const tagsList = tagsContainer.querySelector('.config-form-tags-list');
            
            const addTag = () => {
                const value = input.value.trim();
                if (!value) return;
                
                const tagDiv = document.createElement('div');
                tagDiv.className = 'config-form-tag-item';
                const index = tagsList.children.length;
                tagDiv.dataset.tagIndex = index;
                tagDiv.innerHTML = `
                    <span class="config-form-tag-text">${this.escapeHtml(value)}</span>
                    <button type="button" class="config-form-tag-remove" data-index="${index}">×</button>
                `;
                tagsList.appendChild(tagDiv);
                input.value = '';
                
                tagDiv.querySelector('.config-form-tag-remove').addEventListener('click', function() {
                    tagDiv.remove();
                });
            };
            
            if (input) {
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag();
                    }
                });
            }
            
            if (addBtn) {
                addBtn.addEventListener('click', addTag);
            }
            
            // 绑定已有标签的删除按钮
            tagsList.querySelectorAll('.config-form-tag-remove').forEach(btn => {
                btn.addEventListener('click', function() {
                    this.closest('.config-form-tag-item').remove();
                });
            });
        });
    }

    /**
     * 更新 MultiSelect 组件的标签显示
     */
    updateMultiSelectTags(multiSelect, selectedValues) {
        const tagsContainer = multiSelect.querySelector('.config-form-multiselect-tags');
        if (!tagsContainer) return;
        
        tagsContainer.innerHTML = '';
        selectedValues.forEach(val => {
            const tag = document.createElement('span');
            tag.className = 'config-form-multiselect-tag';
            tag.innerHTML = `${this.escapeHtml(String(val))}<button type="button" class="config-form-multiselect-tag-remove" data-value="${this.escapeHtml(String(val))}">×</button>`;
            tagsContainer.appendChild(tag);
            
            tag.querySelector('.config-form-multiselect-tag-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                const value = tag.querySelector('.config-form-multiselect-tag-remove').dataset.value;
                const checkbox = multiSelect.querySelector(`input[value="${this.escapeHtml(value)}"]`);
                if (checkbox) checkbox.checked = false;
                const checkboxes = multiSelect.querySelectorAll('input[type="checkbox"]');
                const selected = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
                this.updateMultiSelectTags(multiSelect, selected);
            });
        });
    }

    /**
     * 从表单收集数据
     * 确保所有字段都被收集，即使值为 null 或空
     * 同时确保所有 schema 中定义的字段都在数据中（即使没有对应的表单元素）
     */
    collectFormData(formContainer) {
        const data = {};
        const collectedFields = new Set();
        const skipFields = new WeakSet();
        // 标记 ArrayForm 内部字段，防止在通用收集时被重复收集为顶层
        formContainer.querySelectorAll('.config-form-arrayform [data-field]').forEach(el => skipFields.add(el));
        
        // 收集所有表单字段
        const fields = formContainer.querySelectorAll('[data-field]');
        
        fields.forEach(field => {
            if (skipFields.has(field)) return;
            const fieldName = field.dataset.field;
            if (!fieldName) return;
            
            collectedFields.add(fieldName);
            const fieldPath = fieldName.split('.');
            
            if (fieldPath.length === 1) {
                // 简单字段
                if (field.type === 'checkbox') {
                    data[fieldName] = field.checked;
                } else if (field.type === 'number') {
                    // 数字字段：空字符串或无效值保持为 null（允许 null）
                    const numVal = field.value !== '' && field.value !== null && field.value !== undefined ? Number(field.value) : null;
                    data[fieldName] = (numVal !== null && !isNaN(numVal)) ? numVal : null;
                } else if (field.tagName === 'SELECT') {
                    // Select：空值保持为 null
                    data[fieldName] = field.value || null;
                } else if (field.closest('.config-form-multiselect')) {
                    // MultiSelect：收集所有选中的值
                    const multiSelect = field.closest('.config-form-multiselect');
                    const checkboxes = multiSelect.querySelectorAll('input[type="checkbox"]');
                    const selected = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
                    data[fieldName] = selected.length > 0 ? selected : [];
                } else {
                    // 字符串字段：保留空字符串（表示键存在但值为空）
                    data[fieldName] = field.value || '';
                }
            } else {
                // 嵌套字段
                let current = data;
                for (let i = 0; i < fieldPath.length - 1; i++) {
                    if (!current[fieldPath[i]]) {
                        current[fieldPath[i]] = {};
                    }
                    current = current[fieldPath[i]];
                }
                const lastKey = fieldPath[fieldPath.length - 1];
                if (field.type === 'checkbox') {
                    current[lastKey] = field.checked;
                } else if (field.type === 'number') {
                    const numVal = field.value !== '' && field.value !== null && field.value !== undefined ? Number(field.value) : null;
                    current[lastKey] = (numVal !== null && !isNaN(numVal)) ? numVal : null;
                } else if (field.tagName === 'SELECT') {
                    current[lastKey] = field.value || null;
                } else if (field.closest('.config-form-multiselect')) {
                    // MultiSelect：收集所有选中的值
                    const multiSelect = field.closest('.config-form-multiselect');
                    const checkboxes = multiSelect.querySelectorAll('input[type="checkbox"]');
                    const selected = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
                    current[lastKey] = selected.length > 0 ? selected : [];
                } else {
                    current[lastKey] = field.value || '';
                }
            }
        });
        
        // 处理数组字段：保留空数组
        formContainer.querySelectorAll('.config-form-array').forEach(arrayContainer => {
            const fieldName = arrayContainer.dataset.field;
            if (!fieldName) return;
            
            collectedFields.add(fieldName);
            const items = Array.from(arrayContainer.querySelectorAll('.config-form-array-item input'))
                .map(input => {
                    const val = input.value.trim();
                    if (val === '') return null;
                    // 尝试解析为数字
                    if (/^-?\d+\.?\d*$/.test(val)) {
                        return Number(val);
                    }
                    return val;
                })
                .filter(item => item !== null);
            
            // 即使数组为空，也保留键（空数组）
            data[fieldName] = items;
        });
        
        // 处理 ArrayForm（对象数组）字段
        formContainer.querySelectorAll('.config-form-arrayform').forEach(arrayForm => {
            const fieldName = arrayForm.dataset.field;
            if (!fieldName) return;
            collectedFields.add(fieldName);
            const items = [];
            arrayForm.querySelectorAll('.config-form-arrayform-item').forEach(itemEl => {
                const itemObj = {};
                const itemFields = itemEl.querySelectorAll('[data-field]');
                itemFields.forEach(f => {
                    const name = f.dataset.field;
                    if (!name) return;
                    const path = name.split('.');
                    let cur = itemObj;
                    for (let i = 0; i < path.length - 1; i++) {
                        const key = path[i];
                        if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};
                        cur = cur[key];
                    }
                    const last = path[path.length - 1];
                    if (f.type === 'checkbox') cur[last] = f.checked;
                    else if (f.type === 'number') {
                        const numVal = f.value !== '' && f.value !== null && f.value !== undefined ? Number(f.value) : null;
                        cur[last] = (numVal !== null && !isNaN(numVal)) ? numVal : null;
                    } else if (f.tagName === 'SELECT') cur[last] = f.value || null;
                    else cur[last] = f.value || '';
                });
                items.push(itemObj);
            });
            data[fieldName] = items;
        });
        
        // 处理 Tags 字段（字符串数组）
        formContainer.querySelectorAll('.config-form-tags').forEach(tagsContainer => {
            const fieldName = tagsContainer.dataset.field;
            if (!fieldName) return;
            
            collectedFields.add(fieldName);
            const items = Array.from(tagsContainer.querySelectorAll('.config-form-tag-text'))
                .map(span => span.textContent.trim())
                .filter(item => item !== '');
            
            // 即使数组为空，也保留键（空数组）
            data[fieldName] = items;
        });
        
        // 处理嵌套对象中的字段：确保所有子字段都被收集
        formContainer.querySelectorAll('.config-form-subform').forEach(subForm => {
            const fieldName = subForm.dataset.field;
            if (!fieldName) return;
            
            // 确保嵌套对象存在
            if (!data[fieldName] || typeof data[fieldName] !== 'object') {
                data[fieldName] = {};
            }
        });
        
        return data;
    }

    /**
     * HTML 转义
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 安全解析 JSON，避免 try-catch 嵌套
     */
    parseJSON(jsonText) {
        if (!jsonText || jsonText.trim() === '') {
            return { data: {}, error: null };
        }
        
        let data;
        let error = null;
        
        try {
            data = JSON.parse(jsonText);
        } catch (e) {
            error = e.message;
            data = null;
        }
        
        return { data, error };
    }
}

// 初始化应用
const app = new APIControlCenter();

// 防止数据丢失提示
window.addEventListener('beforeunload', (e) => {
    if (app.currentAPI && app.jsonEditor && app.jsonEditor.getValue() !== '{}') {
        e.preventDefault();
        e.returnValue = '';
    }
});
