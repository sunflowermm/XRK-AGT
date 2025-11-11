/**
 * XRK-Yunzai葵崽 API控制中心
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
        this.init();
    }

    async init() {
        this.reorganizeDOMStructure();
        await this.loadAPIConfig();
        this.initEventListeners();
        this.initFloatingButton();
        this.loadSettings();
        this.checkConnection();
        this.loadStats();
        this.renderSidebar();
        this.renderQuickActions();
        
        setInterval(() => this.loadStats(), 30000);
        
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.checkConnection();
                this.loadStats();
            }
        });
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

    initEventListeners() {
        // 主题切换
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleTheme();
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
        const homeButton = document.getElementById('homeButton');
        if (homeButton) {
            homeButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showHome();
            });
        }

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

        let touchedItem = null;

        container.addEventListener('touchstart', (e) => {
            const apiItem = e.target.closest('.api-item');
            if (apiItem) {
                touchedItem = apiItem;
                apiItem.classList.add('touch-active');
            }
        }, { passive: true });

        container.addEventListener('touchend', (e) => {
            if (touchedItem) {
                touchedItem.classList.remove('touch-active');
                const apiId = touchedItem.dataset.apiId;
                const api = this.findAPIById(apiId);
                if (api) {
                    e.preventDefault();
                    this.selectAPI(api.method, api.path, apiId);
                }
                touchedItem = null;
            }
        }, { passive: false });

        container.addEventListener('touchcancel', () => {
            if (touchedItem) {
                touchedItem.classList.remove('touch-active');
                touchedItem = null;
            }
        }, { passive: true });
    }

    renderQuickActions() {
        if (!this.apiConfig) return;

        const container = document.getElementById('quickActions');
        if (!container) return;

        container.innerHTML = this.apiConfig.quickActions.map(action => `
            <a href="#" class="quick-action" data-api-id="${action.apiId}">
                <div class="quick-action-icon">${action.icon}</div>
                <div class="quick-action-text">${action.text}</div>
            </a>
        `).join('');

        container.querySelectorAll('.quick-action').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const apiId = item.dataset.apiId;
                const api = this.findAPIById(apiId);
                if (api) {
                    this.selectAPI(api.method, api.path, apiId);
                }
            });
        });
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
                <h1 class="welcome-title">XRK-Yunzai葵崽 API控制中心</h1>
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
                        <span class="section-icon">🔗</span>
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
                        <span class="section-icon">❓</span>
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
                        <span class="section-icon">📝</span>
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
                    <span>🚀</span>
                    <span>执行请求</span>
                </button>
                <button class="btn btn-secondary" onclick="app.fillExample()">
                    <span>📋</span>
                    <span>填充示例</span>
                </button>
            </div>
            </div>

            <div class="preview-column">
                <div class="json-editor">
                    <div class="editor-header">
                        <h3 class="editor-title">
                            <span class="section-icon">✏️</span>
                            请求编辑器
                        </h3>
                        <div class="editor-controls">
                            <button class="editor-btn" onclick="app.formatJSON()">
                                <span>🎨</span>
                                <span>格式化</span>
                            </button>
                            <button class="editor-btn" onclick="app.validateJSON()">
                                <span>✅</span>
                                <span>验证</span>
                            </button>
                            <button class="editor-btn" onclick="app.copyJSON()">
                                <span>📋</span>
                                <span>复制</span>
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

    renderFileUpload() {
        return `
            <div class="params-section">
                <h3 class="section-title">
                    <span class="section-icon">📁</span>
                    文件上传
                </h3>
                <div class="file-upload">
                    <input type="file" id="fileInput" class="file-upload-input" multiple onchange="app.handleFileSelect(event)">
                    <label for="fileInput" class="file-upload-label" id="fileUploadLabel">
                        <div class="file-upload-icon">📁</div>
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
                    <span class="file-icon">📄</span>
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">${this.formatFileSize(file.size)}</span>
                </div>
                <button class="file-remove" onclick="app.removeFile(${index})">✕</button>
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

            let responseData;
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                responseData = await response.json();
            } else {
                responseData = await response.text();
            }

            this.renderResponse(response.status, responseData, responseTime);

            if (response.ok) {
                this.showToast('请求成功', 'success');
            } else {
                this.showToast(`请求失败: ${response.status}`, 'error');
            }
        } catch (error) {
            this.renderResponse(0, { error: error.message }, Date.now() - startTime);
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
            const responseData = await response.json();

            this.renderResponse(response.status, responseData, responseTime);

            if (response.ok) {
                this.showToast('文件上传成功', 'success');
                this.selectedFiles = [];
                this.renderFileList();
                document.getElementById('fileInput').value = '';
            } else {
                this.showToast(`上传失败: ${response.status}`, 'error');
            }
        } catch (error) {
            this.renderResponse(0, { error: error.message }, Date.now() - startTime);
            this.showToast('上传失败: ' + error.message, 'error');
        } finally {
            button.innerHTML = originalText;
            button.disabled = false;
        }
    }

    renderResponse(status, data, time) {
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
            </div>
        `;

        responseSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    renderBotsList(bots) {
        if (!bots || bots.length === 0) return '';

        return `
            <div class="data-visualization">
                <h3 class="section-title">
                    <span class="section-icon">🤖</span>
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
                    <span class="section-icon">📱</span>
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
                    <span class="section-icon">🧩</span>
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