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
        const aiChatButton = document.getElementById('aiChatButton');
        if (aiChatButton) {
            aiChatButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openAIChat();
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
                    this.openAIChat();
                } else if (apiId) {
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

    appendChat(role, text) {
        const box = document.getElementById('chatMessages');
        if (!box) return;
        const div = document.createElement('div');
        div.className = `chat-msg ${role}`;
        div.textContent = text;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
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
            const url = `${this.serverUrl}/api/ai/stream?prompt=${encodeURIComponent(prompt)}&persona=`;
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
            return;
        }
        this._deviceWs.addEventListener('open', () => {
            console.log('WebSocket connected to /device');
            // 注册为webclient设备
            try {
            this._deviceWs.send(JSON.stringify({
                type: 'register',
                device_id: 'webclient',
                device_type: 'web',
                device_name: 'Web客户端',
                capabilities: ['display', 'microphone']
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
        });
        this._deviceWs.addEventListener('message', (evt) => {
            try {
                const data = JSON.parse(evt.data);
                if (data?.type === 'heartbeat_request') {
                    try {
                        this._deviceWs?.send(JSON.stringify({
                            type: 'heartbeat',
                            device_id: 'webclient',
                            status: { ts: Date.now() }
                        }));
                    } catch {}
                    return;
                }
                if (data?.type === 'heartbeat_response') return;
                if (data?.type === 'asr_interim' && data.text) {
                    // 只显示最新的识别结果
                    this.renderASRStreaming(data.text, false);
                    return;
                }
                if (data?.type === 'asr_final' && data.text) {
                    // 先移除识别中的消息，然后显示最终结果
                    this.renderASRStreaming('', true);
                    // 延迟一点再显示最终结果，让过渡更自然
                    setTimeout(() => {
                    this.appendChat('assistant', `识别: ${data.text}`);
                    }, 350);
                    return;
                }
                if (data?.type === 'register_response' && data.success) {
                    this.showToast('已连接设备: webclient', 'success');
                }
            } catch {}
        });
        this._deviceWs.addEventListener('close', () => {});
        this._deviceWs.addEventListener('error', () => {});
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
            if (!navigator.mediaDevices?.getUserMedia) {
                this.showToast('浏览器不支持麦克风', 'error');
                return;
            }
            this._audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this._micStream = stream;
            const source = this._audioCtx.createMediaStreamSource(stream);
            const processor = this._audioCtx.createScriptProcessor(4096, 1, 1);
            source.connect(processor);
            processor.connect(this._audioCtx.destination);
            this._audioProcessor = processor;

            const sessionId = `sess_${Date.now()}`;
            this._asrSessionId = sessionId;
            this._asrChunkIndex = 0;
            this._micActive = true;
            document.getElementById('micToggleBtn').innerHTML = '<span>🛑</span><span>停止语音</span>';

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
            document.getElementById('micToggleBtn').innerHTML = '<span>🎙️</span><span>开始语音</span>';
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

            panel.querySelectorAll('[data-action="edit"]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const configName = btn.dataset.configName;
                    this.editConfig(configName);
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
            // SystemConfig 的子配置保存：使用 path 参数指定子配置名称
            console.log('保存子配置:', { configName, subName, configData });
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
                console.error('保存子配置失败:', errorData);
                throw new Error(errorData.message || errorData.error || `HTTP ${response.status}: 保存失败`);
            }

            const result = await response.json();
            if (!result.success) {
                console.error('保存子配置失败:', result);
                throw new Error(result.message || result.error || '保存失败');
            }

            console.log('子配置保存成功:', result);
            this.showToast('配置已保存', 'success');
        } catch (error) {
            console.error('保存子配置异常:', error);
            this.showToast('保存失败: ' + error.message, 'error');
        }
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
                console.error('保存配置失败:', result);
                throw new Error(result.message || result.error || '保存失败');
            }

            console.log('配置保存成功:', result);
            this.showToast('配置已保存', 'success');
        } catch (error) {
            console.error('保存配置异常:', error);
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
            listPanel.style.display = 'block';
            editorPanel.style.display = 'none';
            if (this.configEditor) {
                this.configEditor.toTextArea();
                this.configEditor = null;
            }
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
            'array': 'Array',
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
            case 'Input':
                return this.renderInput(fieldId, fieldName, fieldSchema, value);
            case 'InputNumber':
                return this.renderInputNumber(fieldId, fieldName, fieldSchema, value);
            case 'Switch':
                return this.renderSwitch(fieldId, fieldName, fieldSchema, value);
            case 'SubForm':
                return this.renderSubForm(fieldId, fieldName, fieldSchema, value);
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
        // 数组操作
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
     * 从表单收集数据
     * 确保所有字段都被收集，即使值为 null 或空
     * 同时确保所有 schema 中定义的字段都在数据中（即使没有对应的表单元素）
     */
    collectFormData(formContainer) {
        const data = {};
        const collectedFields = new Set();
        
        // 收集所有表单字段
        const fields = formContainer.querySelectorAll('[data-field]');
        
        fields.forEach(field => {
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