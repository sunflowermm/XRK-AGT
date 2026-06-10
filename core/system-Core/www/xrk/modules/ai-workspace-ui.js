import { formatBytes, escapeHtml } from './utils.js';

/** 与后端 normalizePresetId 对齐（前端单点） */
export function normalizeWorkspaceId(id) {
  const raw = String(id || 'default').trim() || 'default';
  return raw === 'desktop' ? 'default' : raw;
}

const TOOL_LABELS = {
  read: '读取',
  write: '写入',
  grep: '搜索',
  list_files: '列目录',
  run: '命令',
  web_fetch: '抓取',
  web_search: '搜索',
  delete_file: '删除',
  modify_file: '修改'
};

function toolLabel(name) {
  const short = String(name || '').split('.').pop();
  return TOOL_LABELS[short] || short || '?';
}

function fileIcon(type) {
  return type === 'dir'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
}

function renderBreadcrumb(dir) {
  const parts = String(dir || '').split('/').filter(Boolean);
  let html = '<button type="button" class="ai-ws-crumb" data-dir="">根目录</button>';
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    const d = acc;
    html += `<span class="ai-ws-crumb-sep">/</span><button type="button" class="ai-ws-crumb" data-dir="${escapeHtml(d)}">${escapeHtml(part)}</button>`;
  }
  return html;
}

export function renderWorkspaceFilesHtml(files = []) {
  if (!files.length) {
    return '<div class="ai-workspace-files-empty">此目录暂无文件</div>';
  }
  return files.map((f) => {
    const meta = f.type === 'dir' ? '文件夹' : formatBytes(f.size || 0);
    const action = f.type === 'file'
      ? `<button type="button" class="ai-ws-dl link-btn" data-path="${escapeHtml(f.path)}" title="下载">↓</button>`
      : '';
    return `
      <div class="ai-workspace-file-item" data-path="${escapeHtml(f.path)}" data-type="${f.type}">
        <span class="ai-workspace-file-icon">${fileIcon(f.type)}</span>
        <span class="ai-workspace-file-name" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span>
        <span class="ai-workspace-file-meta">${escapeHtml(meta)}</span>
        ${action}
      </div>
    `;
  }).join('');
}

export function renderAuditHtml(entries = []) {
  if (!entries.length) {
    return '<div class="audit-empty">暂无审计记录</div>';
  }
  return entries.map((e, i) => {
    const ok = e.ok !== false;
    const t = new Date(e.ts || 0).toLocaleString();
    const detail = ok ? '' : (e.detail || '失败');
    return `<article class="audit-card${ok ? '' : ' fail'}" style="animation-delay:${Math.min(i, 12) * 30}ms">
      <header class="audit-card-head">
        <span class="audit-tool">${escapeHtml(toolLabel(e.tool))}</span>
        <span class="audit-badge ${ok ? 'ok' : 'fail'}">${ok ? '成功' : '失败'}</span>
      </header>
      <time class="audit-time">${escapeHtml(t)}</time>
      ${detail ? `<p class="audit-detail">${escapeHtml(detail)}</p>` : ''}
    </article>`;
  }).join('');
}

export async function fetchWorkspacePresets(app) {
  const res = await fetch(`${app.serverUrl}/api/ai/workspaces`, { headers: app.getHeaders() });
  if (!res.ok) throw new Error(`加载工作区失败 (${res.status})`);
  const json = await res.json();
  return {
    workspaces: json.workspaces || [],
    defaultId: json.defaultId || 'default'
  };
}

async function apiGet(app, path) {
  const res = await fetch(`${app.serverUrl}${path}`, { headers: app.getHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `请求失败 (${res.status})`);
  return json;
}

export function ensureWorkspaceDialogs() {
  if (document.getElementById('ai-agents-dialog')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="ai-agents-dialog" class="ai-console-dialog">
      <form method="dialog" class="ai-console-dialog-inner">
        <header class="ai-console-dialog-head">
          <h3>AGENTS.md</h3>
          <p class="ai-console-dialog-sub">工作区根目录规则，保存后下次对话生效</p>
        </header>
        <textarea id="ai-agents-editor" rows="14" spellcheck="false" placeholder="# Agent 规则…"></textarea>
        <footer class="ai-console-dialog-foot">
          <button type="button" id="ai-agents-cancel" class="btn btn-secondary btn-sm">取消</button>
          <button type="submit" id="ai-agents-save" class="btn btn-primary btn-sm">保存</button>
        </footer>
      </form>
    </dialog>
    <dialog id="ai-audit-dialog" class="ai-console-dialog wide">
      <div class="ai-console-dialog-inner">
        <header class="ai-console-dialog-head">
          <h3>工具审计</h3>
          <p class="ai-console-dialog-sub">当前工作区 MCP 工具调用记录</p>
        </header>
        <div id="ai-audit-list" class="audit-list ink-scroll"></div>
        <footer class="ai-console-dialog-foot">
          <button type="button" id="ai-audit-close" class="btn btn-secondary btn-sm">关闭</button>
        </footer>
      </div>
    </dialog>
  `);
}

export function bindWorkspacePanel(app) {
  ensureWorkspaceDialogs();

  const select = document.getElementById('aiWorkspaceSelect');
  const refreshBtn = document.getElementById('aiWorkspaceRefreshBtn');
  const uploadBtn = document.getElementById('aiWorkspaceUploadBtn');
  const createBtn = document.getElementById('aiWorkspaceCreateBtn');
  const uploadInput = document.getElementById('aiWorkspaceUploadInput');
  const rulesBtn = document.getElementById('aiWorkspaceRulesBtn');
  const auditBtn = document.getElementById('aiWorkspaceAuditBtn');
  const listEl = document.getElementById('aiWorkspaceFilesList');
  const pathEl = document.getElementById('aiWorkspacePathHint');
  const crumbEl = document.getElementById('aiWorkspaceBreadcrumb');

  app._aiWorkspaceDir = app._aiWorkspaceDir || '';

  const currentWorkspace = () => normalizeWorkspaceId(app._chatSettings.workspace);

  const persist = (id) => {
    const next = normalizeWorkspaceId(id);
    app._chatSettings.workspace = next;
    app._aiWorkspaceDir = '';
    localStorage.setItem('chatWorkspace', next);
  };

  const refreshFiles = async () => {
    if (!listEl) return;
    const ws = currentWorkspace();
    const dir = app._aiWorkspaceDir || '';
    listEl.innerHTML = '<div class="ai-workspace-files-loading">加载中…</div>';
    if (crumbEl) crumbEl.innerHTML = renderBreadcrumb(dir);
    try {
      const q = new URLSearchParams({ workspace: ws, dir });
      const json = await apiGet(app, `/api/ai/workspace/files?${q}`);
      if (pathEl) pathEl.textContent = json.root || '';
      listEl.innerHTML = renderWorkspaceFilesHtml(json.files || []);
    } catch (err) {
      listEl.innerHTML = `<div class="ai-workspace-files-empty">${escapeHtml(err.message)}</div>`;
    }
  };

  listEl?.addEventListener('click', (e) => {
    const dl = e.target.closest('.ai-ws-dl');
    if (dl) {
      e.stopPropagation();
      const ws = currentWorkspace();
      const p = dl.dataset.path;
      const q = new URLSearchParams({ workspace: ws, path: p });
      fetch(`${app.serverUrl}/api/ai/workspace/files/download?${q}`, { headers: app.getHeaders() })
        .then(async (res) => {
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j.message || `下载失败 (${res.status})`);
          }
          return res.blob();
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = p.split('/').pop() || 'download';
          a.click();
          URL.revokeObjectURL(url);
        })
        .catch((err) => app.showToast(err.message, 'error'));
      return;
    }
    const row = e.target.closest('.ai-workspace-file-item[data-type="dir"]');
    if (!row) return;
    app._aiWorkspaceDir = row.dataset.path || '';
    refreshFiles();
  });

  crumbEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('.ai-ws-crumb');
    if (!btn) return;
    app._aiWorkspaceDir = btn.dataset.dir || '';
    refreshFiles();
  });

  select?.addEventListener('change', () => {
    persist(select.value);
    refreshFiles();
  });
  refreshBtn?.addEventListener('click', () => refreshFiles());

  uploadBtn?.addEventListener('click', () => uploadInput?.click());
  uploadInput?.addEventListener('change', async () => {
    const files = uploadInput.files;
    if (!files?.length) return;
    const ws = currentWorkspace();
    const dir = app._aiWorkspaceDir || '';
    const fd = new FormData();
    for (const f of files) fd.append('file', f);
    try {
      const q = new URLSearchParams({ workspace: ws, dir });
      const res = await fetch(`${app.serverUrl}/api/ai/workspace/files/upload?${q}`, {
        method: 'POST',
        headers: app.getAuthHeaders?.() || {},
        body: fd
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || '上传失败');
      app.showToast(`已上传 ${json.files?.length || files.length} 个文件`, 'success');
      await refreshFiles();
    } catch (err) {
      app.showToast(err.message, 'error');
    } finally {
      uploadInput.value = '';
    }
  });

  createBtn?.addEventListener('click', async () => {
    const name = window.prompt('新建工作区名称（字母/数字/中文/下划线）');
    if (!name?.trim()) return;
    try {
      const res = await fetch(`${app.serverUrl}/api/ai/workspaces`, {
        method: 'POST',
        headers: app.getHeaders(),
        body: JSON.stringify({ id: name.trim() })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || '创建失败');
      const wsData = await fetchWorkspacePresets(app);
      app._aiWorkspacePresets = wsData.workspaces;
      if (select) {
        select.innerHTML = wsData.workspaces.map((w) =>
          `<option value="${escapeHtml(w.id)}">${escapeHtml(w.label || w.id)}</option>`
        ).join('');
        select.value = json.id || name.trim();
      }
      persist(select?.value || name.trim());
      app.showToast('工作区已创建', 'success');
      await refreshFiles();
    } catch (err) {
      app.showToast(err.message, 'error');
    }
  });

  const agentsDialog = document.getElementById('ai-agents-dialog');
  const agentsEditor = document.getElementById('ai-agents-editor');
  document.getElementById('ai-agents-cancel')?.addEventListener('click', () => agentsDialog?.close());
  rulesBtn?.addEventListener('click', async () => {
    const ws = currentWorkspace();
    try {
      const json = await apiGet(app, `/api/ai/workspace/agents?workspace=${encodeURIComponent(ws)}`);
      if (agentsEditor) agentsEditor.value = json.content || '';
      agentsDialog?.showModal();
    } catch (err) {
      app.showToast(err.message, 'error');
    }
  });
  agentsDialog?.querySelector('form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ws = currentWorkspace();
    try {
      const res = await fetch(`${app.serverUrl}/api/ai/workspace/agents?workspace=${encodeURIComponent(ws)}`, {
        method: 'PUT',
        headers: app.getHeaders(),
        body: JSON.stringify({ content: agentsEditor?.value ?? '', workspace: ws })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || '保存失败');
      app.showToast('规则已保存', 'success');
      agentsDialog?.close();
    } catch (err) {
      app.showToast(err.message, 'error');
    }
  });

  const auditDialog = document.getElementById('ai-audit-dialog');
  const auditList = document.getElementById('ai-audit-list');
  document.getElementById('ai-audit-close')?.addEventListener('click', () => auditDialog?.close());
  auditBtn?.addEventListener('click', async () => {
    const ws = currentWorkspace();
    if (auditList) auditList.innerHTML = '<div class="audit-empty">加载中…</div>';
    auditDialog?.showModal();
    try {
      const json = await apiGet(app, `/api/ai/workspace/audit?workspace=${encodeURIComponent(ws)}&limit=50`);
      if (auditList) auditList.innerHTML = renderAuditHtml(json.entries || []);
    } catch (err) {
      if (auditList) auditList.innerHTML = `<div class="audit-empty">${escapeHtml(err.message)}</div>`;
    }
  });

  app._refreshAIWorkspaceFiles = refreshFiles;
  return refreshFiles;
}
