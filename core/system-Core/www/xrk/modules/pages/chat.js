export async function renderChatPage(app) {
  const content = document.getElementById('content');
  const isAIMode = app._isAIMode();
  const isVoiceMode = app._isVoiceMode();
  const aiSettingsPlaceholder = isAIMode
    ? `<div class="ai-settings-panel" id="aiSettingsPlaceholder">
          <div style="padding:16px;color:var(--text-muted);font-size:13px;">AI 设置加载中...</div>
        </div>`
    : '';
  content.innerHTML = `
      <div class="chat-container ${isVoiceMode ? 'voice-mode' : ''}">
        <div class="chat-sidebar">
          <div class="chat-mode-selector">
            <button class="chat-mode-btn ${app._isEventMode() ? 'active' : ''}" data-mode="event">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
              <span>Event</span>
            </button>
            <button class="chat-mode-btn ${app._isVoiceMode() ? 'active' : ''}" data-mode="voice">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              <span>Voice</span>
            </button>
            <button class="chat-mode-btn ${app._isAIMode() ? 'active' : ''}" data-mode="ai">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              <span>AI</span>
            </button>
          </div>
          ${aiSettingsPlaceholder}
        </div>
        <div class="chat-main">
        ${isVoiceMode ? `
            <div class="voice-chat-center">
            <div class="voice-emotion-display" id="voiceEmotionIcon">${app._emotionIconSVG('happy')}</div>
            <div class="voice-wave" id="voiceWave">
              ${Array(6).fill('<div class="voice-wave-bar"></div>').join('')}
            </div>
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
            <span class="emotion-display" id="emotionIcon">${app._emotionIconSVG('happy')}</span>
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
          ${!isAIMode && !isVoiceMode ? `<div class="event-quote-strip" id="eventQuoteStrip" style="display:none;"><span class="event-quote-label">引用：</span><span class="event-quote-text"></span><button type="button" class="event-quote-cancel" aria-label="取消引用">×</button></div>` : ''}
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
          ${!isAIMode ? `<button class="poke-btn" id="pokeBtn" type="button" title="戳一戳">${app._pokeHandIconSVG()}</button>` : ''}
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

  if (isAIMode) {
    try {
      const aiSettings = await app._renderAISettings();
      const placeholder = document.getElementById('aiSettingsPlaceholder');
      placeholder.outerHTML = aiSettings;
    } catch {}
  }

  if (isVoiceMode) {
    await app.loadLlmOptions();
  }
  if (!isVoiceMode) {
    app.initChatControls();
  }
  app.restoreChatHistory();
  if (isVoiceMode || !isAIMode) {
    app.ensureDeviceWs();
  }
  app._bindChatEvents();
}

export function switchChatMode(app, mode, oldMode = null) {
  app.clearChatStreamState();
  const needFullRender = mode === 'voice' || oldMode === 'voice' || mode === 'event' || oldMode === 'event';
  if (needFullRender) {
    if (mode !== 'event') app._clearEventReplyState();
    return app.renderChat();
  }

  const box = document.getElementById('chatMessages');
  if (!box) return app.renderChat();

  const isAIMode = mode === 'ai';
  const sidebar = document.querySelector('.chat-sidebar');
  const headerTitle = document.querySelector('.chat-header-title span:last-child');
  const imageInput = document.getElementById('chatImageInput');
  document.querySelectorAll('.chat-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  if (headerTitle) headerTitle.textContent = isAIMode ? 'AI 对话' : 'Event 对话';
  if (imageInput) imageInput.setAttribute('accept', isAIMode ? 'image/*' : 'image/*,video/*,audio/*');

  const finish = () => {
    app.ensureDeviceWs();
    app._bindChatEvents();
    const cached = app._chatMessagesCache[mode];
    if (cached?.html) {
      box.style.overflow = 'hidden';
      box.innerHTML = cached.html;
      box.style.overflow = '';
      box.scrollTop = cached.scrollTop ?? box.scrollHeight;
      app._chatMessagesCache[mode] = { scrollTop: box.scrollTop, scrollHeight: box.scrollHeight, html: box.innerHTML };
      return;
    }
    app._renderHistoryIntoBox(box, app._getChatHistoryByMode(mode));
    box.scrollTop = box.scrollHeight;
    app._chatMessagesCache[mode] = { scrollTop: box.scrollTop, scrollHeight: box.scrollHeight, html: box.innerHTML };
  };

  if (isAIMode) {
    return app._renderAISettings().then(aiSettings => {
      if (sidebar && !sidebar.querySelector('.ai-settings-panel')) {
        const settingsDiv = document.createElement('div');
        settingsDiv.innerHTML = aiSettings;
        sidebar.appendChild(settingsDiv.firstElementChild);
      }
      app.initChatControls();
      finish();
    });
  }

  sidebar?.querySelector('.ai-settings-panel')?.remove();
  finish();
}

export function unbindChatEvents(app) {
  for (const [element, handlers] of app._chatEventHandlers.entries()) {
    if (element && handlers) {
      handlers.forEach(({ event, handler }) => {
        try {
          element.removeEventListener(event, handler);
        } catch {}
      });
    }
  }
  app._chatEventHandlers.clear();
}

export function bindChatEvents(app) {
  unbindChatEvents(app);
  const sendBtn = document.getElementById('chatSendBtn');
  const input = document.getElementById('chatInput');
  const voiceInput = document.getElementById('voiceInput');
  const micBtn = document.getElementById('micBtn');
  const clearBtn = document.getElementById('clearChatBtn');
  const imageUploadBtn = document.getElementById('imageUploadBtn');
  const imageInput = document.getElementById('chatImageInput');
  if (imageInput) {
    imageInput.setAttribute('accept', app._isAIMode() ? 'image/*' : 'image/*,video/*,audio/*');
  }
  const safeBind = (element, event, handler) => {
    if (!element) return;
    element.addEventListener(event, handler);
    if (!app._chatEventHandlers.has(element)) app._chatEventHandlers.set(element, []);
    app._chatEventHandlers.get(element).push({ event, handler });
  };
  const chatRootContainer = document.querySelector('.chat-container');
  const setKeyboardOpen = (open) => chatRootContainer?.classList.toggle('keyboard-open', open);
  const isAnyChatInputFocused = () => {
    const active = document.activeElement;
    return active === input || active === voiceInput;
  };
  const onChatInputFocusIn = () => setKeyboardOpen(true);
  const onChatInputFocusOut = () => setTimeout(() => { if (!isAnyChatInputFocused()) setKeyboardOpen(false); }, 0);

  const modeSelector = document.querySelector('.chat-mode-selector');
  if (modeSelector) {
    safeBind(modeSelector, 'click', async (e) => {
      const btn = e.target.closest('.chat-mode-btn');
      if (!btn) return;
      const mode = btn.dataset.mode;
      if (app._chatMode === mode) return;
      const oldMode = app._chatMode;
      const box = document.getElementById('chatMessages');
      if (box) app._chatMessagesCache[oldMode] = { scrollTop: box.scrollTop, scrollHeight: box.scrollHeight, html: box.innerHTML };
      app._chatMode = mode;
      localStorage.setItem('chatMode', mode);
      await app._switchChatMode(mode, oldMode);
    });
  }
  if (app._isAIMode()) {
    const providerSelect = document.getElementById('aiProviderSelect');
    const personaInput = document.getElementById('aiPersonaInput');
    if (providerSelect) safeBind(providerSelect, 'change', () => {
      app._chatSettings.provider = providerSelect.value;
      localStorage.setItem('chatProvider', providerSelect.value);
    });
    if (personaInput) safeBind(personaInput, 'input', () => {
      app._chatSettings.persona = personaInput.value;
      localStorage.setItem('chatPersona', personaInput.value);
    });
    const workflowContainer = document.querySelector('.ai-settings-checkboxes');
    if (workflowContainer) safeBind(workflowContainer, 'change', () => {
      const workflows = Array.from(document.querySelectorAll('input[id^="workflow_"]:checked')).map(c => c.value);
      app._chatSettings.workflows = workflows;
      localStorage.setItem('chatWorkflows', JSON.stringify(workflows));
    });
    const remoteMCPBtn = document.getElementById('remoteMCPConfigBtn');
    if (remoteMCPBtn) safeBind(remoteMCPBtn, 'click', () => {
      const pendingSelect = { name: 'system', child: 'aistream' };
      if (app._configState) app._configState.pendingSelect = pendingSelect;
      try {
        localStorage.setItem('lastConfigName', pendingSelect.name);
        localStorage.setItem('lastConfigChild', pendingSelect.child);
      } catch {}
      app.navigateTo('config');
    });
  }
  if (sendBtn) safeBind(sendBtn, 'click', () => app.sendChatMessage());
  if (input) {
    safeBind(input, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        app.sendChatMessage();
      }
    });
    safeBind(input, 'focusin', onChatInputFocusIn);
    safeBind(input, 'focusout', onChatInputFocusOut);
  }
  if (voiceInput) {
    safeBind(voiceInput, 'focusin', onChatInputFocusIn);
    safeBind(voiceInput, 'focusout', onChatInputFocusOut);
  }
  if (micBtn) safeBind(micBtn, 'click', () => app.toggleMic());
  if (clearBtn) safeBind(clearBtn, 'click', () => app.clearChat());
  if (app._isVoiceMode()) {
    const voiceClearBtn = document.getElementById('voiceClearBtn');
    if (voiceClearBtn) safeBind(voiceClearBtn, 'click', () => app.clearChat());
    const voiceSendBtn = document.getElementById('voiceSendBtn');
    const voiceTtsStopBtn = document.getElementById('voiceTtsStopBtn');
    if (voiceInput && voiceSendBtn) {
      safeBind(voiceSendBtn, 'click', () => {
        const text = voiceInput.value.trim();
        if (text) {
          app.sendVoiceMessage(text).catch(e => app.showToast(`发送失败: ${e.message}`, 'error'));
          voiceInput.value = '';
        }
      });
      safeBind(voiceInput, 'keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          voiceSendBtn.click();
        }
      });
    }
    if (voiceTtsStopBtn) safeBind(voiceTtsStopBtn, 'click', () => {
      app.stopTTS();
      app.clearChatStreamState();
      app.updateVoiceStatus('播报已停止');
    });
  }
  if (imageUploadBtn && imageInput) {
    safeBind(imageUploadBtn, 'click', () => imageInput.click());
    safeBind(imageInput, 'change', (e) => app.handleImageSelect(e.target.files));
  }
  const pokeBtn = document.getElementById('pokeBtn');
  if (pokeBtn) {
    safeBind(pokeBtn, 'click', () => {
      const qq = app.getWebUserId();
      app.appendSegments([{ type: 'poke', qq }], true, 'user');
      app.sendDeviceNotice('notify', 'poke', { user_id: qq });
      app.scrollToBottom();
    });
  }
  const quoteStrip = document.getElementById('eventQuoteStrip');
  const quoteCancel = quoteStrip?.querySelector('.event-quote-cancel');
  if (quoteCancel) safeBind(quoteCancel, 'click', () => app._clearEventReplyState());

  const chatContainer = document.querySelector('.chat-container');
  if (chatContainer && !chatContainer.dataset._dropBound) {
    chatContainer.dataset._dropBound = '1';
    app._bindDropArea(chatContainer, {
      onDragStateChange: (active) => chatContainer?.classList.toggle('is-dragover', Boolean(active)),
      onFiles: (files) => {
        if (!files || files.length === 0) return;
        const isAIMode = app._isAIMode();
        const filteredFiles = isAIMode ? files.filter(f => f?.type?.startsWith('image/')) : files;
        if (!filteredFiles.length) {
          app.showToast(isAIMode ? '只能上传图片文件' : '文件格式不支持', 'warning');
          return;
        }
        app.handleImageSelect(filteredFiles);
        app.showToast(`已添加 ${filteredFiles.length} ${isAIMode ? '张图片' : '个文件'}，点击发送即可上传`, 'success');
      }
    });
  }
}

export function applyMessageEnter(app, div, animate = true) {
  if (!div || app._isRestoringHistory) return;
  if (!animate) {
    div.classList.remove('message-enter');
    return;
  }
  div.addEventListener('animationend', () => {
    div.classList.remove('message-enter');
  }, { once: true });
}

export function appendChatMessage(app, role, text, options = {}) {
  const isVoiceMode = app._isVoiceMode();
  const { persist = true, mcpTools = null, messageId = null, source = null } = options;
  const msgId = messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  if (persist) {
    const history = app._getCurrentChatHistory();
    const historyItem = { role, text, ts: Date.now(), id: msgId };
    if (mcpTools) historyItem.mcpTools = mcpTools;
    if (source) historyItem.source = source;
    history.push(historyItem);
    app._saveChatHistory();
  }
  const box = document.getElementById('chatMessages');
  if (!box) return null;
  const div = document.createElement('div');
  div.className = `chat-message ${role}${isVoiceMode ? ' voice-message' : ''}${app._isRestoringHistory ? '' : ' message-enter'}`;
  div.dataset.messageId = msgId;
  div.dataset.role = role;
  const contentDiv = document.createElement('div');
  contentDiv.className = 'chat-content chat-markdown';
  contentDiv.innerHTML = app.renderMarkdown(text);
  div.appendChild(contentDiv);
  if (mcpTools && Array.isArray(mcpTools) && mcpTools.length > 0) app._addToolBlock(div, mcpTools);
  app._addMessageActions(div, role, text, msgId);
  box.appendChild(div);
  app._renderMermaidIn(div);
  if (!app._isRestoringHistory) app.scrollToBottom();
  app._applyMessageEnter(div, persist);
  return div;
}

