// API 调试模块：从 app.js 中提取的逻辑，统一通过 app 实例传入

export function renderAPI(app) {
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

  // 如果之前已选择过某个 API，刷新后自动恢复
  try {
    const lastApiId = localStorage.getItem('lastApiId');
    if (lastApiId) {
      // 进入 API 页：恢复上次选择不强制关闭侧边栏
      selectAPI(app, lastApiId, { closeSidebar: false });
    }
  } catch {}
}

export function renderAPIGroups(app) {
  const container = document.getElementById('apiGroups');
  if (!container || !app.apiConfig) return;

  const customGroupHtml = `
    <div class="api-group">
      <div class="api-group-title">自定义</div>
      <div class="api-item" data-id="custom">
        <span class="method-tag method-post">CUSTOM</span>
        <span>自定义请求</span>
      </div>
    </div>
  `;

  container.innerHTML =
    customGroupHtml +
    app.apiConfig.apiGroups
      .map(
        (group) => `
        <div class="api-group">
          <div class="api-group-title">${group.title}</div>
          ${group.apis
            .map(
              (api) => `
            <div class="api-item" data-id="${api.id}">
              <span class="method-tag method-${api.method.toLowerCase()}">${api.method}</span>
              <span>${api.title}</span>
            </div>`
            )
            .join('')}
        </div>`
      )
      .join('');

  // 事件委托：避免为每个 API 条目重复绑定监听器
  container.onclick = (e) => {
    const item = e.target?.closest?.('.api-item');
    if (!item || !container.contains(item)) return;
    container.querySelectorAll('.api-item').forEach((i) => i.classList.remove('active'));
    item.classList.add('active');
    // 移动端：用户点了具体 API 条目后关闭侧边栏
    selectAPI(app, item.dataset.id, { closeSidebar: true });
  };
}

export function selectAPI(app, apiId, options = {}) {
  const closeSidebar = Boolean(options?.closeSidebar);

  // 自定义 API：不依赖 api-config.json
  if (apiId === 'custom') {
    return selectCustomAPI(app, { closeSidebar });
  }

  const api = findAPIById(app, apiId);
  if (!api) {
    app.showToast('API 不存在', 'error');
    return;
  }

  app.currentAPI = { method: api.method, path: api.path, apiId };
  // 记住最近选中的 API，刷新后恢复
  try {
    localStorage.setItem('lastApiId', apiId);
  } catch {}
  app._lastJsonPreview = null;
  // 切换 API 时强制清空旧 CodeMirror 引用，避免 setValue 写入已被 innerHTML 替换的旧 textarea
  app.jsonEditor = null;

  const welcome = document.getElementById('apiWelcome');
  const section = document.getElementById('apiTestSection');

  if (!welcome || !section) {
    console.error('API页面元素不存在');
    return;
  }

  welcome.style.display = 'none';
  section.style.display = 'block';

  // 侧边栏关闭（移动端 + 用户点击具体 API）
  if (closeSidebar) {
    const mql = window.matchMedia?.('(max-width: 768px)');
    const isMobile = mql ? mql.matches : window.innerWidth <= 768;
    if (isMobile && typeof app.closeSidebar === 'function') {
      app.closeSidebar();
    }
  }

  const pathParams = (api.path.match(/:(\w+)/g) ?? []).map((p) => p.slice(1));

  let paramsHTML = '';

  // 路径参数
  if (pathParams.length && api.pathParams) {
    paramsHTML += `<div class="api-form-section">
        <h3 class="api-form-section-title">路径参数</h3>
        ${pathParams
          .map((p) => {
            const cfg = api.pathParams[p] ?? {};
            return `<div class="form-group">
            <label class="form-label">${app.escapeHtml(cfg.label || p)} <span style="color:var(--danger)">*</span></label>
            <input type="text" class="form-input" id="path_${app.escapeHtml(
              p
            )}" placeholder="${app.escapeHtml(cfg.placeholder ?? '')}" data-request-field="1">
          </div>`;
          })
          .join('')}
      </div>`;
  }

  // 查询参数
  if (api.queryParams?.length) {
    paramsHTML += `<div class="api-form-section">
        <h3 class="api-form-section-title">查询参数</h3>
        ${api.queryParams.map((p) => renderParamInput(app, p)).join('')}
      </div>`;
  }

  // 请求体参数
  if (api.method !== 'GET' && api.bodyParams?.length) {
    paramsHTML += `<div class="api-form-section">
        <h3 class="api-form-section-title">请求体</h3>
        ${api.bodyParams.map((p) => renderParamInput(app, p)).join('')}
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
          ${apiId === 'file-upload' ? renderFileUpload() : ''}
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
    if (t.id === 'executeBtn') return executeRequest(app);
    if (t.id === 'fillExampleBtn') return fillExample(app);
    if (t.id === 'formatJsonBtn') return formatJSONPreview(app);
    if (t.id === 'copyJsonBtn') return copyJSON(app);
  };

  const onRequestFieldChanged = (e) => {
    const t = e.target;
    if (t?.matches?.('[data-request-field="1"]')) updateJSONPreview(app);
  };
  section.oninput = onRequestFieldChanged;
  section.onchange = onRequestFieldChanged;

  // 文件上传设置
  if (apiId === 'file-upload') {
    setupFileUpload(app);
  }

  // 初始化JSON编辑器（只做“请求预览”，只读，避免误操作）
  // 先立即渲染一次 preview，CodeMirror 初始化期间也能看到请求内容
  updateJSONPreview(app);
  initJSONEditor(app).then(() => updateJSONPreview(app));
}

function selectCustomAPI(app, { closeSidebar }) {
  const welcome = document.getElementById('apiWelcome');
  const section = document.getElementById('apiTestSection');

  if (!welcome || !section) {
    console.error('API页面元素不存在');
    return;
  }

  // 默认值（保存由页面交互触发）
  const method = String(localStorage.getItem('customApiMethod') || 'GET').toUpperCase();
  const customUrl = localStorage.getItem('customApiUrl') || '/api/system/status';
  const customBody = localStorage.getItem('customApiBody') || '{}';

  app.currentAPI = { method, path: customUrl, apiId: 'custom' };
  app._lastJsonPreview = null;
  app.jsonEditor = null;
  try {
    localStorage.setItem('lastApiId', 'custom');
  } catch {}

  welcome.style.display = 'none';
  section.style.display = 'block';

  if (closeSidebar) {
    const mql = window.matchMedia?.('(max-width: 768px)');
    const isMobile = mql ? mql.matches : window.innerWidth <= 768;
    if (isMobile && typeof app.closeSidebar === 'function') {
      app.closeSidebar();
    }
  }

  const methodOptions = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  const methodOptionsHtml = methodOptions
    .map((m) => `<option value="${m}"${m === method ? ' selected' : ''}>${m}</option>`)
    .join('');

  section.innerHTML = `
    <div class="card" style="margin-bottom:24px">
      <div class="card-header">
        <span class="card-title">自定义请求</span>
        <span class="method-tag method-post">${method}</span>
      </div>
      <div class="api-endpoint-box">
        <span>${app.escapeHtml(customUrl || '')}</span>
      </div>
      <p style="margin-top:12px;color:var(--text-secondary)">
        URL 支持相对路径（如 <span class="mono">/api/system/status</span>）或以 http(s) 开头的绝对地址
      </p>
    </div>

    <div class="api-form-grid">
      <div>
        <div class="api-form-section">
          <h3 class="api-form-section-title">请求</h3>

          <div class="form-group">
            <label class="form-label">方法</label>
            <select class="form-input" id="customMethod" data-request-field="1">
              ${methodOptionsHtml}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">URL</label>
            <input type="text" class="form-input" id="customUrl" data-request-field="1" value="${app.escapeHtml(customUrl)}" placeholder="/api/system/status">
          </div>

          <div class="form-group">
            <label class="form-label">Body (JSON)</label>
            <textarea class="form-input" id="customBody" data-request-field="1" placeholder="{}">${app.escapeHtml(customBody)}</textarea>
            <p class="config-field-hint">仅当方法非 GET 时会加入请求体；JSON 格式错误将导致请求失败</p>
          </div>
        </div>

        <div style="display:flex;gap:12px;margin-top:20px">
          <button class="btn btn-primary" id="executeBtn" type="button">执行请求</button>
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

  // 事件链收敛：一个 click 入口 + 输入事件委托
  section.onclick = (e) => {
    const t = e.target;
    if (!t) return;
    if (t.id === 'executeBtn') return executeRequest(app);
    if (t.id === 'formatJsonBtn') return formatJSONPreview(app);
    if (t.id === 'copyJsonBtn') return copyJSON(app);
  };

  const onRequestFieldChanged = (e) => {
    const t = e.target;
    if (t?.matches?.('[data-request-field="1"]')) updateJSONPreview(app);
  };
  section.oninput = onRequestFieldChanged;
  section.onchange = onRequestFieldChanged;

  const customMethodEl = document.getElementById('customMethod');
  const customUrlEl = document.getElementById('customUrl');
  const customBodyEl = document.getElementById('customBody');

  // 保存自定义输入，提升开发者体验（防止刷新丢失）
  if (customMethodEl) {
    customMethodEl.addEventListener('change', () => {
      try {
        localStorage.setItem('customApiMethod', customMethodEl.value);
      } catch {}
    });
  }
  let customSaveTimer = null;
  const persistWithDebounce = (key, el, delay = 400) => {
    if (!el) return;
    el.addEventListener('input', () => {
      clearTimeout(customSaveTimer);
      customSaveTimer = setTimeout(() => {
        try {
          localStorage.setItem(key, el.value);
        } catch {}
      }, delay);
    });
  };
  persistWithDebounce('customApiUrl', customUrlEl);
  persistWithDebounce('customApiBody', customBodyEl);

  // 初始化 JSON 预览
  updateJSONPreview(app);
  initJSONEditor(app).then(() => updateJSONPreview(app));
}

export function renderParamInput(app, param) {
  const required = param.required ? '<span style="color:var(--danger)">*</span>' : '';
  let input = '';
  const placeholder = app.escapeHtml(param.placeholder || '');

  switch (param.type) {
    case 'select':
      input = `<select class="form-input" id="${param.name}" data-request-field="1">
          <option value="">请选择</option>
          ${param.options
            .map((o) => {
              const selected =
                param.defaultValue !== undefined && String(o.value) === String(param.defaultValue)
                  ? ' selected'
                  : '';
              return `<option value="${app.escapeHtml(o.value)}"${selected}>${app.escapeHtml(o.label)}</option>`;
            })
            .join('')}
        </select>`;
      break;
    case 'textarea':
    case 'json':
      input = `<textarea class="form-input" id="${app.escapeHtml(
        param.name
      )}" placeholder="${placeholder}" data-request-field="1">${app.escapeHtml(
        param.defaultValue || ''
      )}</textarea>`;
      break;
    default:
      input = `<input type="${app.escapeHtml(param.type || 'text')}" class="form-input" id="${app.escapeHtml(
        param.name
      )}" placeholder="${placeholder}" value="${app.escapeHtml(
        param.defaultValue || ''
      )}" data-request-field="1">`;
  }

  return `<div class="form-group">
      <label class="form-label">${app.escapeHtml(param.label)} ${required}</label>
      ${param.hint ? `<p class="config-field-hint">${app.escapeHtml(param.hint)}</p>` : ''}
      ${input}
    </div>`;
}

export function renderFileUpload() {
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

export function setupFileUpload(app) {
  const area = document.getElementById('fileUploadArea');
  const input = document.getElementById('fileInput');

  if (!area || !input) return;

  area.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => handleFiles(app, e.target.files));

  app._bindDropArea(area, {
    onDragStateChange: (active) => {
      area.classList.toggle('is-dragover', Boolean(active));
    },
    onFiles: (files) => handleFiles(app, files)
  });
}

export function handleFiles(app, files) {
  app.selectedFiles = Array.from(files);
  const list = document.getElementById('fileList');
  if (!list) return;

  list.innerHTML = app.selectedFiles
    .map(
      (f, i) => `
      <div class="file-item">
        <div class="file-item-info">
          <div class="file-item-name">${f.name}</div>
          <div class="file-item-size">${(f.size / 1024).toFixed(1)} KB</div>
        </div>
        <button class="file-item-remove" data-index="${i}">×</button>
      </div>`
    )
    .join('');

  list.querySelectorAll('.file-item-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      app.selectedFiles.splice(parseInt(btn.dataset.index, 10), 1);
      handleFiles(app, app.selectedFiles);
    });
  });
}

export function findAPIById(app, id) {
  for (const group of app.apiConfig?.apiGroups || []) {
    const api = group.apis.find((a) => a.id === id);
    if (api) return api;
  }
  return null;
}

export function updateJSONPreview(app) {
  if (!app.currentAPI) return;
  const data = buildRequestData(app);
  const next = JSON.stringify(data, null, 2);
  if (app._lastJsonPreview === next) return;
  app._lastJsonPreview = next;
  const textarea = document.getElementById('jsonEditor');
  // 同步 textarea 与 CodeMirror，避免初始化/切换期间出现“显示/复制源不一致”
  if (textarea) {
    const top = textarea.scrollTop;
    textarea.value = next;
    textarea.scrollTop = top;
  }
  if (app.jsonEditor) {
    const scroll = app.jsonEditor.getScrollInfo();
    app.jsonEditor.setValue(next);
    app.jsonEditor.scrollTo(null, scroll.top);
  }
}

export function buildRequestData(app) {
  // 自定义 API：从输入框读取请求信息
  if (app.currentAPI?.apiId === 'custom') {
    const methodEl = document.getElementById('customMethod');
    const urlEl = document.getElementById('customUrl');
    const bodyEl = document.getElementById('customBody');

    const method = String(methodEl?.value || app.currentAPI.method || 'GET').toUpperCase();
    const url = String(urlEl?.value || app.currentAPI.path || '');
    const rawBody = String(bodyEl?.value || '');

    const data = { method, url };

    if (method !== 'GET' && rawBody.trim()) {
      try {
        data.body = JSON.parse(rawBody);
      } catch {
        // Body JSON 非法时不加入 body，避免把字符串当作 JSON 发送
      }
    }

    return data;
  }

  const api = findAPIById(app, app.currentAPI.apiId) || {};
  // 避免 method/path 为 undefined 时 JSON.stringify 得到空对象 {}
  const method = app.currentAPI.method ?? api.method ?? 'GET';
  const path = app.currentAPI.path ?? api.path ?? '';
  const data = { method, url: path };

  // 路径参数
  (path.match(/:(\w+)/g) || []).forEach((p) => {
    const name = p.slice(1);
    const val = document.getElementById(`path_${name}`)?.value;
    if (val) data.url = data.url.replace(p, val);
  });

  // 查询参数
  const query = {};
  api?.queryParams?.forEach((p) => {
    const val = document.getElementById(p.name)?.value;
    if (!val) return;
    if (p.defaultValue !== undefined && String(val) === String(p.defaultValue)) return;
    query[p.name] = val;
  });
  if (Object.keys(query).length) data.query = query;

  // 请求体
  const body = {};
  api?.bodyParams?.forEach((p) => {
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

  if (app.selectedFiles.length) {
    data.files = app.selectedFiles.map((f) => ({ name: f.name, size: f.size }));
  }

  return data;
}

export async function initJSONEditor(app) {
  await loadCodeMirror();
  const textarea = document.getElementById('jsonEditor');
  if (!textarea || !window.CodeMirror) return;

  // 旧实例安全销毁（DOM 可能已被 innerHTML 替换）
  if (app.jsonEditor && typeof app.jsonEditor.toTextArea === 'function') {
    try {
      app.jsonEditor.toTextArea();
    } catch {}
  }

  const theme = app.theme === 'dark' ? 'monokai' : 'default';
  app.jsonEditor = window.CodeMirror.fromTextArea(textarea, {
    mode: 'application/json',
    theme,
    lineNumbers: true,
    lineWrapping: true,
    matchBrackets: true,
    readOnly: true
  });
}

export async function loadCodeMirror() {
  if (window.CodeMirror) return;

  const loadCSS = (href) =>
    new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      link.onerror = reject;
      document.head.appendChild(link);
    });

  const loadJS = (src) =>
    new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

  const base = 'lib/codemirror';
  try {
    await loadCSS(`${base}/lib/codemirror.min.css`);
    await loadCSS(`${base}/theme/monokai.min.css`);
    await loadJS(`${base}/lib/codemirror.min.js`);
    await loadJS(`${base}/mode/javascript/javascript.min.js`);
  } catch (e) {
    console.warn('Failed to load CodeMirror:', e);
  }
}

export function formatJSONPreview(app) {
  try {
    const jsonEditor = document.getElementById('jsonEditor');
    const val = app.jsonEditor?.getValue() || jsonEditor?.value || '{}';
    const formatted = JSON.stringify(JSON.parse(val), null, 2);
    if (app.jsonEditor) {
      app.jsonEditor.setValue(formatted);
    } else if (jsonEditor) {
      jsonEditor.value = formatted;
    }
    app.showToast('已格式化', 'success');
  } catch (e) {
    app.showToast('JSON 格式错误: ' + e.message, 'error');
  }
}

export function copyJSON(app) {
  const jsonEditor = document.getElementById('jsonEditor');
  const val = app.jsonEditor?.getValue() || jsonEditor?.value || '';
  if (!val) {
    app.showToast('没有可复制的内容', 'warning');
    return;
  }

  app.copyToClipboard(val, '已复制', '复制失败');
}

export function fillExample(app) {
  if (!app.currentAPI || !app.apiConfig?.examples) return;
  const example = app.apiConfig.examples[app.currentAPI.apiId];
  if (!example) {
    app.showToast('暂无示例数据', 'info');
    return;
  }

  Object.entries(example).forEach(([key, val]) => {
    const el = document.getElementById(key);
    if (el)
      el.value =
        typeof val === 'object'
          ? JSON.stringify(val, null, 2)
          : val;
  });

  updateJSONPreview(app);
  app.showToast('已填充示例', 'success');
}

export async function executeRequest(app) {
  if (!app.currentAPI) {
    app.showToast('请先选择 API', 'warning');
    return;
  }

  const btn = document.getElementById('executeBtn');
  if (!btn) {
    app.showToast('执行按钮不存在', 'error');
    return;
  }

  const requestData = buildRequestData(app);

  // 文件上传
  if (app.currentAPI.apiId === 'file-upload' && app.selectedFiles.length) {
    return executeFileUpload(app);
  }

  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="loading-spinner"></span> 执行中...';
  btn.disabled = true;

  const startTime = Date.now();
  const rawUrl = String(requestData.url ?? app.currentAPI.path ?? '');
  let url = '';

  // 支持：相对路径 / 绝对 http(s) URL
  if (!rawUrl) {
    url = app.serverUrl;
  } else if (/^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('//')) {
    url = rawUrl;
  } else if (rawUrl.startsWith('/')) {
    url = app.serverUrl + rawUrl;
  } else {
    url = app.serverUrl + '/' + rawUrl;
  }

  if (requestData.query && Object.keys(requestData.query).length > 0) {
    const qs = new URLSearchParams(requestData.query).toString();
    if (qs) url += url.includes('?') ? '&' + qs : '?' + qs;
  }

  try {
    const options = {
      method: requestData.method || app.currentAPI.method || 'GET',
      headers: app.getHeaders()
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
      url,
      headers: options.headers || {},
      body: requestData.body || null
    };

    renderResponse(app, res.status, data, time, requestInfo);
    app.showToast(res.ok ? '请求成功' : `请求失败: ${res.status}`, res.ok ? 'success' : 'error');
  } catch (e) {
    const requestInfo = {
      method: requestData.method || app.currentAPI.method || 'GET',
      url,
      headers: app.getHeaders(),
      body: requestData.body || null
    };
    renderResponse(app, 0, { error: e.message }, Date.now() - startTime, requestInfo);
    app.showToast('请求失败: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }
}

export async function executeFileUpload(app) {
  if (!app.selectedFiles || app.selectedFiles.length === 0) {
    app.showToast('请先选择文件', 'warning');
    return;
  }

  const formData = new FormData();
  app.selectedFiles.forEach((f) => formData.append('file', f));

  const btn = document.getElementById('executeBtn');
  if (!btn) {
    app.showToast('执行按钮不存在', 'error');
    return;
  }

  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="loading-spinner"></span> 上传中...';
  btn.disabled = true;

  const startTime = Date.now();

  try {
    const res = await fetch(`${app.serverUrl}/api/file/upload`, {
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
      url: `${app.serverUrl}/api/file/upload`,
      headers: { 'X-API-Key': localStorage.getItem('apiKey') || '' },
      body: null // FormData 不显示
    };

    renderResponse(app, res.status, data, time, requestInfo);

    if (res.ok) {
      app.showToast('上传成功', 'success');
      app.selectedFiles = [];
      const fileList = document.getElementById('fileList');
      if (fileList) fileList.innerHTML = '';
    } else {
      app.showToast('上传失败: ' + (data.message || res.statusText), 'error');
    }
  } catch (e) {
    const requestInfo = {
      method: 'POST',
      url: `${app.serverUrl}/api/file/upload`,
      headers: { 'X-API-Key': localStorage.getItem('apiKey') || '' },
      body: null
    };
    renderResponse(app, 0, { error: e.message }, Date.now() - startTime, requestInfo);
    app.showToast('上传失败: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }
}

export function renderResponse(app, status, data, time, requestInfo = {}) {
  const section = document.getElementById('responseSection');
  const isSuccess = status >= 200 && status < 300;
  const prettyJson = JSON.stringify(data, null, 2);
  // 复制按钮只绑定一次，但回调需要复制“最新响应结果”，避免闭包引用陈旧数据
  if (section) section.dataset.latestPrettyJson = prettyJson;
  const mql = window.matchMedia?.('(max-width: 768px)');
  const isMobile = mql ? mql.matches : window.innerWidth <= 768;

  // 格式化请求头显示
  const headers = requestInfo.headers || {};
  const headersHtml = Object.entries(headers)
    .map(
      ([key, value]) =>
        `<div class="request-header-item"><span class="request-header-key">${app.escapeHtml(
          key
        )}</span>: <span class="request-header-value">${app.escapeHtml(String(value))}</span></div>`
    )
    .join('');

  section.innerHTML = `
      <div class="api-response-wrapper">
        <!-- 请求头一览 -->
        <div class="request-info-section" id="requestInfoSection">
          <div class="request-info-header" id="requestInfoToggle">
            <h3 class="request-info-title">
              <span class="request-info-icon">${isMobile ? '▲' : '▼'}</span>
              请求信息
            </h3>
            <div class="request-info-meta">
              <span class="request-method-badge">${requestInfo.method || 'GET'}</span>
              <span class="request-url-text" title="${app.escapeHtml(requestInfo.url || '')}">${app.escapeHtml(
                (requestInfo.url || '').substring(0, 60)
              )}${(requestInfo.url || '').length > 60 ? '...' : ''}</span>
            </div>
          </div>
          <div class="request-info-content" id="requestInfoContent" style="display:${isMobile ? 'block' : 'none'}">
            <div class="request-info-item">
              <div class="request-info-label">请求方法</div>
              <div class="request-info-value">${requestInfo.method || 'GET'}</div>
            </div>
            <div class="request-info-item">
              <div class="request-info-label">请求URL</div>
              <div class="request-info-value request-url-full">${app.escapeHtml(requestInfo.url || '')}</div>
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
              <div class="request-info-value request-body"><pre>${syntaxHighlight(
                JSON.stringify(requestInfo.body, null, 2)
              )}</pre></div>
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
            <pre>${syntaxHighlight(prettyJson)}</pre>
          </div>
        </div>
      </div>
    `;

  // 请求信息折叠/展开 & 复制响应结果 - 使用事件委托避免重复绑定
  if (section && !section.dataset._bound) {
    section.dataset._bound = '1';
    section.addEventListener('click', (e) => {
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
        const latest = section.dataset.latestPrettyJson || '';
        app.copyToClipboard(latest, '响应结果已复制到剪贴板', '复制失败，请检查浏览器权限');
      }
    });
  }

  try {
    if (!isMobile) {
      section.scrollIntoView({ behavior: 'smooth' });
    }
  } catch {}
}

export function syntaxHighlight(json) {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'json-key' : 'json-string';
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
}

