/** 配置页方法，挂载到 App.prototype（依赖 app.js 中的 config-manager 包装方法） */
import { formatKeyValueLines, parseKeyValueLines } from './utils.js';
import { showPromptDialog as showPromptDialogUI } from './ui/prompt-dialog.js';

function escapeConfigItemSelector(name) {
  const id = String(name ?? '');
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const configPageMethods = {
  setActiveConfigSidebarItem(name) {
    const list = document.getElementById('configList');
    if (!list || !name) return false;
    const item = list.querySelector(`.config-item[data-name="${escapeConfigItemSelector(name)}"]`);
    if (!item) return false;
    list.querySelectorAll('.config-item').forEach((el) => {
      el.classList.remove('active');
      el.setAttribute('aria-pressed', 'false');
    });
    item.classList.add('active');
    item.setAttribute('aria-pressed', 'true');
    try {
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch {}
    return true;
  },
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
  },

  async loadConfigList() {
    const list = document.getElementById('configList');
    if (!list) return;
    try {
      const res = await fetch(`${this.serverUrl}/api/config/list`, { headers: this.getHeaders() });
      if (res.status === 401) {
        if (this._configState) this._configState.list = [];
        list.innerHTML = `
          <div class="empty-state config-auth-failed">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; margin: 0 auto 12px; opacity: 0.5;">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <p><strong>未授权</strong></p>
            <p style="font-size: 13px; color: var(--text-muted); margin-top: 8px;">API 密钥无效或已过期，请在上方重新填写并保存。</p>
            <button type="button" class="btn btn-sm" id="configRetryApiKeyBtn" style="margin-top: 12px;">打开 API 密钥</button>
          </div>
        `;
        const retryBtn = document.getElementById('configRetryApiKeyBtn');
        if (retryBtn) retryBtn.addEventListener('click', () => {
          const box = document.getElementById('apiKeyBox');
          if (box) box.classList.add('show');
          const input = document.getElementById('apiKey');
          if (input) input.focus();
        });
        this.showToast('API 密钥无效或未填写，请重新填写后保存', 'warning');
        return;
      }
      if (!res.ok) throw new Error('获取配置列表失败');
      const data = await res.json();
      if (!data.success) throw new Error(data.message ?? '接口返回失败');
      if (!this._configState) return;
      this._configState.list = data.configs ?? [];
      this.renderConfigList();
  
      // 若存在待选中的配置（刷新后恢复）
      if (this._configState.pendingSelect) {
        const { name, child } = this._configState.pendingSelect;
        const target = this._configState.list.find(cfg => cfg.name === name);
        if (target) {
          this.selectConfig(name, child || null);
        }
        this._configState.pendingSelect = null;
      } else if (this.currentPage === 'config' && this._configState.selected) {
        // 从其它页面返回 config：pendingSelect 已清空，但 selected/selectedChild 仍保留，
        // 需要恢复渲染，否则 configMain 会停留在占位态/旧态，导致系统配置气泡不可交互。
        const selectedName = this._configState.selected.name;
        const selectedChild = this._configState.selectedChild;
        const latestSelected = this._configState.list.find(cfg => cfg.name === selectedName);
        if (latestSelected) {
          this._configState.selected = latestSelected;
          if (latestSelected.name === 'system' && !selectedChild) {
            this.renderSystemConfigChooser(latestSelected);
          } else {
            this.loadSelectedConfigDetail();
          }
        }
      }
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : '未知错误';
      if (list) list.innerHTML = `<div class="empty-state"><p>加载失败: ${this.escapeHtml(msg)}</p></div>`;
      this.showToast('配置列表加载失败', 'error');
    }
  },

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
      <div
        class="config-item ${this._configState.selected?.name === cfg.name ? 'active' : ''}"
        data-name="${this.escapeHtml(cfg.name)}"
        role="button"
        tabindex="0"
        aria-pressed="${this._configState.selected?.name === cfg.name ? 'true' : 'false'}"
      >
        <div class="config-item-meta">
          <div class="config-name">${title}</div>
          <p class="config-desc">${desc}</p>
          </div>
        ${cfg.name === 'system' ? '<span class="config-tag">多文件</span>' : ''}
          </div>
    `;
    }).join('');

    if (this._configState.selected?.name) {
      this.setActiveConfigSidebarItem(this._configState.selected.name);
    }
  },

  selectConfig(name, child = null) {
    if (!this._configState) return;
    
    // 若选择与当前相同的配置和子项，避免重复渲染导致的抖动
    if (this._configState.selected?.name === name && (child || null) === this._configState.selectedChild) {
      this.setActiveConfigSidebarItem(name);
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
  
    // 记住最近选中的配置，刷新后恢复
    try {
      localStorage.setItem('lastConfigName', name);
      localStorage.setItem('lastConfigChild', child || '');
    } catch {}
    this._configState.jsonText = '';
    this._configState.jsonDirty = false;

    this.setActiveConfigSidebarItem(name);

    if (config.name === 'system' && !child) {
      this.renderSystemConfigChooser(config);
      return;
    }
  
    this.loadSelectedConfigDetail();
  },

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
          <div
            class="config-subcard"
            data-child="${this.escapeHtml(key)}"
            role="button"
            tabindex="0"
            aria-label="选择系统子配置 system/${this.escapeHtml(key)}"
          >
            <div>
              <div class="config-subcard-title">${this.escapeHtml(meta.displayName || key)}</div>
              <p class="config-subcard-desc">${this.escapeHtml(meta.description ?? '')}</p>
          </div>
            <span class="config-tag">${this.escapeHtml(`system/${key}`)}</span>
          </div>
        `).join('')}
      </div>
    `;
    
    if (!main.dataset._systemChooserBound) {
      main.dataset._systemChooserBound = '1';
  
      main.addEventListener('click', (e) => {
        const card = e.target.closest('.config-subcard');
        if (!card || !this._configState) return;
        const child = card.dataset.child;
        if (child) this.selectConfig('system', child);
      });
  
      main.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.config-subcard');
        if (!card || !this._configState) return;
        const child = card.dataset.child;
        if (!child) return;
        e.preventDefault();
        this.selectConfig('system', child);
      });
    }
  },

  async loadSelectedConfigDetail() {
    if (!this._configState?.selected) return;
    const main = document.getElementById('configMain');
    const { name } = this._configState.selected;
    const child = this._configState.selectedChild;
    const query = child ? `?path=${encodeURIComponent(child)}` : '';
  
    try {
      this._configState.loading = true;
      if (main) {
        main.innerHTML = `
          <div class="config-loading">
            <div class="loading-spinner" style="margin:0 auto"></div>
            <p style="margin-top:12px; color: var(--text-muted);">加载配置中...</p>
          </div>
        `;
      }
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
      // flat 数据默认不包含“父对象字段本身”（例如 headers: {}），会导致 SubForm/JSON 控件初始为空。
      // 这里基于 schema 的 default 为 object/map 字段补齐缺失项，保证前端有可编辑的初始值。
      const filledValues = this.fillMissingObjectDefaults(schemaList, normalizedValues);
      this._configState.values = filledValues;
      this._configState.rawObject = this.unflattenObject(filledValues);
      this._configState.original = this._cloneFlat(filledValues);
      this._configState.jsonText = JSON.stringify(this._configState.rawObject, null, 2);
      this._configState.dirty = {};
      this._configState.jsonDirty = false;
  
      this.renderConfigFormPanel();
    } catch (e) {
      const mainEl = document.getElementById('configMain');
      if (mainEl) mainEl.innerHTML = `<div class="empty-state"><p>加载失败：${this.escapeHtml(e.message)}</p></div>`;
    } finally {
      if (this._configState) this._configState.loading = false;
    }
  },

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
  },

  extractActiveSchema(structure, name, child) {
    if (!structure) return null;
    if (name === 'system') {
      if (!child) return null;
      const target = structure.configs?.[child];
      return target?.schema ?? { fields: target?.fields ?? {} };
    }
    return structure.schema ?? { fields: structure.fields ?? {} };
  },

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
  },

  buildDynamicCollectionsMeta(schema) {
    const collections = schema?.meta?.collections ?? [];
    return collections.map(item => {
      if (item.valueFields && typeof item.valueFields === 'object') {
        return { ...item, valueFields: item.valueFields };
      }
      const template = this.getSchemaNodeByPath(item.valueTemplatePath, schema);
      return {
        ...item,
        valueFields: template?.fields ?? {}
      };
    });
  },

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
  },

  fillMissingObjectDefaults(flatSchema, values) {
    const filled = { ...(values ?? {}) };
    if (!Array.isArray(flatSchema)) return filled;
    flatSchema.forEach(field => {
      const path = field?.path;
      if (!path || Object.hasOwn(filled, path)) return;
      const meta = field.meta ?? {};
      const component = String(meta.component ?? field.component ?? '').toLowerCase();
      const type = String(meta.type ?? field.type ?? '').toLowerCase();
      const isObjectLike = type === 'object' || type === 'map';
      const isSubForm = component === 'subform';
      if (!isObjectLike && !isSubForm) return;
      if (Object.hasOwn(meta, 'default')) {
        filled[path] = this._cloneValue(meta.default);
      } else if (isObjectLike) {
        filled[path] = {};
      }
    });
    return filled;
  },

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
  },

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
        const subFormToggleBtn = e.target.closest('[data-action="subform-toggle"]');
        if (subFormToggleBtn) {
          this.toggleSubFormEditor(
            subFormToggleBtn.dataset.field,
            subFormToggleBtn.dataset.mode,
            subFormToggleBtn.dataset.subformId
          );
          return;
        }
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
  },

  renderSystemPathBadge(child) {
    return `
      <div class="config-path-alert">
        <span>系统子配置</span>
        <code>${this.escapeHtml(`system/${child}`)}</code>
      </div>
    `;
  },

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
  },

  buildFieldTree(flatSchema) {
    const tree = {};
    const subFormFields = new Map(); // 记录所有 SubForm 类型的字段路径及其信息
    const dynamicBasePaths = new Set(
      (this._configState?.dynamicCollectionsMeta ?? [])
        .map(c => String(c.basePath || '').trim())
        .filter(Boolean)
    );
    
    // 第一遍：识别所有 SubForm 类型的字段
    flatSchema.forEach(field => {
      const meta = field.meta ?? {};
      const component = String(meta.component ?? field.component ?? '').toLowerCase();
      // 只把明确声明为 SubForm 的 object/map 当作“父级容器”；
      // 避免把 Textarea 等普通 object 字段误判为 SubForm，导致字段被隐藏但又没有子分组渲染。
      const isSubForm = component === 'subform';
      const isObjectLike = field.type === 'object' || field.type === 'map';
      if (isSubForm && isObjectLike) {
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
  
      // 动态集合的 basePath 由 dynamic collection 专门渲染，避免与普通字段区重复展示
      if (dynamicBasePaths.has(path)) {
        return;
      }
      
      // 过滤掉数组模板路径字段（如 proxy.domains[].domain），这些字段只应该在数组项中显示
      // 模板路径包含 []，表示这是数组项的字段模板，不应该作为独立字段显示
      if (path.includes('[]')) {
        return; // 跳过数组模板字段，避免重复显示
      }
  
      // 防御性去重：如果某个 object/map 字段被声明为 SubForm 且确实存在子字段，
      // 则它应该只作为“子分组容器”展示，而不应作为一个可编辑控件重复渲染。
      //（否则会出现同名分组重复两次：一次为 SubForm 自由对象编辑器，一次为子字段表单）
      const component = String(meta.component ?? field.component ?? '').toLowerCase();
      const isObjectLike = field.type === 'object' || field.type === 'map';
      if (component === 'subform' && isObjectLike) {
        const hasChildren = flatSchema.some(f => {
          const childPath = f.path;
          return childPath.startsWith(path + '.') && !childPath.includes('[]');
        });
        if (hasChildren) {
          // 交给 subGroups 渲染
          return;
        }
      }
      
      const parts = path.split('.');
      
      // 智能确定分组键：
      // 1. 优先使用 meta.group
      // 2. 如果是 SubForm 的子字段，使用父 SubForm 的 group
      // 3. 否则根据路径深度和第一部分确定
      let groupKey = meta.group;
      let parentSubFormPath = null;
      
      // 查找最近的父 SubForm（最长前缀匹配），避免把 proxy.healthCheck.* 错归到 proxy.*
      let bestParent = null;
      let bestInfo = null;
      for (const [subFormPath, subFormInfo] of subFormFields.entries()) {
        if (!path.startsWith(subFormPath + '.')) continue;
        if (!bestParent || subFormPath.length > bestParent.length) {
          bestParent = subFormPath;
          bestInfo = subFormInfo;
        }
      }
      if (bestParent) {
        parentSubFormPath = bestParent;
        if (!groupKey && bestInfo?.group) groupKey = bestInfo.group;
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
          } else {
            // 有子字段：提前创建 subGroup 容器，保证一定会渲染（避免“父被隐藏但子分组没建出来”）
            if (!tree[groupKey]) {
              tree[groupKey] = { fields: [], subGroups: {} };
            }
            const subFormInfo = subFormFields.get(path);
            if (subFormInfo && !tree[groupKey].subGroups[path]) {
              tree[groupKey].subGroups[path] = {
                label: subFormInfo.label,
                description: subFormInfo.description,
                path,
                fields: []
              };
            }
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
  },

  formatGroupKey(key) {
    if (!key) return '其他';
    
    // 如果包含点，说明是嵌套路径，只取第一部分作为分组
    // 避免生成 "Proxy - Domains" 这样的重复标题
    if (key.includes('.')) {
      const parts = key.split('.');
      return this.getFieldLabel(parts[0]);
    }
    
    return this.getFieldLabel(key);
  },

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
  },

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
  },

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
  },

  renderConfigField(field) {
    const meta = field.meta ?? {};
    const path = field.path;
    const value = this._configState.values[path];
    const dirty = this._configState.dirty[path];
    const inputId = `cfg-${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
  
    const label = this.escapeHtml(meta.label || path);
    const description = meta.description ? `<p class="config-field-hint">${this.escapeHtml(meta.description)}</p>` : '';
    const example = Object.hasOwn(meta, 'example') ? this.renderExampleBlock(meta.example) : '';
  
    return `
      <div class="config-field ${dirty ? 'config-field-dirty' : ''}">
        <label for="${inputId}">
          ${label}
          ${meta.required ? '<span class="required">*</span>' : ''}
        </label>
        ${description}
        ${this.renderConfigControl(field, value, inputId)}
        ${example}
      </div>
    `;
  },

  renderExampleBlock(example) {
    try {
      const text = typeof example === 'string' ? example : JSON.stringify(example, null, 2);
      return `
        <div class="config-field-example"><strong>此为示例：</strong><pre>${this.escapeHtml(text ?? '')}</pre></div>
      `;
    } catch {
      return `
        <div class="config-field-example"><strong>此为示例：</strong><pre>${this.escapeHtml(String(example ?? ''))}</pre></div>
      `;
    }
  },

  _renderComponentByType(config) {
    const {
      component,
      inputId,
      dataset,
      value,
      meta,
      field,
      disabled,
      placeholder
    } = config;
  
    const normalizeOptions = (options = []) => options.map(opt => {
      if (typeof opt === 'object') return opt;
      return { label: opt, value: opt };
    });
  
    const lowerComponent = (component ?? '').toLowerCase();
  
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
        const current = (value !== undefined && value !== null && value !== '')
          ? value
          : (meta.default ?? (opts.length ? opts[0].value : ''));
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
        const tagsPlaceholder = placeholder || '每行一个值';
        return `
          <textarea class="form-input" rows="3" id="${inputId}" ${dataset} data-control="tags" placeholder="${tagsPlaceholder}" ${disabled}>${text}</textarea>
          <p class="config-field-hint">将文本拆分为数组</p>
        `;
      }
      case 'textarea':
      case 'text-area':
        return `<textarea class="form-input" rows="3" id="${inputId}" ${dataset} placeholder="${placeholder}" ${disabled}>${
          this.escapeHtml(
            value && typeof value === 'object'
              ? JSON.stringify(value, null, 2)
              : (value ?? '')
          )
        }</textarea>`;
      case 'inputnumber':
      case 'number':
        return `<input type="number" class="form-input" id="${inputId}" ${dataset} value="${this.escapeHtml(value ?? '')}" min="${meta.min ?? ''}" max="${meta.max ?? ''}" step="${meta.step ?? 'any'}" placeholder="${placeholder}" ${disabled}>`;
      case 'inputpassword': {
        const nofillName = `${inputId}-nofill`;
        return `<input type="password" class="form-input" id="${inputId}" name="${this.escapeHtml(nofillName)}" autocomplete="new-password" ${dataset} value="${this.escapeHtml(value ?? '')}" placeholder="${placeholder}" ${disabled}>`;
      }
      case 'url':
        return `<input type="url" class="form-input" id="${inputId}" ${dataset} value="${this.escapeHtml(value ?? '')}" placeholder="${placeholder}" ${disabled}>`;
      case 'email':
        return `<input type="email" class="form-input" id="${inputId}" ${dataset} value="${this.escapeHtml(value ?? '')}" placeholder="${placeholder}" ${disabled}>`;
      case 'slider':
      case 'range': {
        const min = meta.min ?? 0;
        const max = meta.max ?? 100;
        const step = meta.step ?? 1;
        const numVal = value !== undefined && value !== null && value !== '' ? Number(value) : (meta.default ?? min);
        const displayVal = numVal;
        return `
          <div class="config-slider-wrap">
            <input type="range" class="config-slider" id="${inputId}" ${dataset} min="${min}" max="${max}" step="${step}" value="${this.escapeHtml(String(displayVal))}" ${disabled}>
            <span class="config-slider-value" data-slider-value-for="${inputId}">${this.escapeHtml(String(displayVal))}</span>
          </div>
        `;
      }
      case 'radio': {
        const opts = normalizeOptions(meta.enum ?? meta.options ?? []);
        const current = value ?? meta.default ?? '';
        return `
          <div class="config-radio-group" role="radiogroup" aria-label="${this.escapeHtml(meta.label || field.path)}" id="${inputId}-group">
            ${opts.map((opt, i) => `
              <label class="config-radio-option">
                <input type="radio" name="${inputId}" ${dataset} value="${this.escapeHtml(opt.value)}" ${String(opt.value) === String(current) ? 'checked' : ''} ${i === 0 ? `id="${inputId}"` : ''} ${disabled}>
                <span class="config-radio-label">${this.escapeHtml(opt.label)}</span>
              </label>
            `).join('')}
          </div>
        `;
      }
      case 'input':
        return `<input type="text" class="form-input" id="${inputId}" ${dataset} value="${this.escapeHtml(value ?? '')}" placeholder="${placeholder}" ${disabled}>`;
      case 'subform': {
        const modeKey = `subform_mode:${this._configState?.selected?.name ?? 'config'}:${this._configState?.selectedChild ?? ''}:${field.path}`;
        const defaultValue = Object.hasOwn(meta, 'default') ? meta.default : {};
        return `
          ${this.renderFreeObjectSubFormEditor({
            dataset,
            value,
            defaultValue,
            modeKey,
            subformId: field.path,
            inputIdPrefix: inputId,
            disabled,
            fieldPath: field.path
          })}
          <p class="config-field-hint">键值模式更适合 Header/简单对象；复杂结构建议切换 JSON。</p>
        `;
      }
      case 'arrayform':
      case 'json':
        return `
          <textarea class="form-input" rows="4" id="${inputId}" ${dataset} data-control="json" placeholder="JSON 数据" ${disabled}>${value ? this.escapeHtml(JSON.stringify(value, null, 2)) : ''}</textarea>
          <p class="config-field-hint">以 JSON 形式编辑该字段</p>
        `;
      default:
        if (field.type === 'object' || field.type === 'map') {
          const modeKey = `subform_mode:${this._configState?.selected?.name ?? 'config'}:${this._configState?.selectedChild ?? ''}:${field.path}`;
          const defaultValue = Object.hasOwn(meta, 'default') ? meta.default : {};
          return `
          ${this.renderFreeObjectSubFormEditor({
            dataset,
            value,
            defaultValue,
            modeKey,
            subformId: field.path,
            inputIdPrefix: inputId,
            disabled,
            fieldPath: field.path
          })}
          <p class="config-field-hint">键值模式更适合简单键值对；复杂结构建议切换 JSON。</p>
        `;
        }
        const displayValue = (value != null && typeof value === 'object')
          ? ''
          : (value ?? '');
        return `<input type="text" class="form-input" id="${inputId}" ${dataset} value="${this.escapeHtml(displayValue)}" placeholder="${placeholder}" ${disabled}>`;
    }
  },

  renderFreeObjectSubFormEditor({ dataset, value, defaultValue, modeKey, subformId, inputIdPrefix, disabled, fieldPath }) {
    const mode = (localStorage.getItem(modeKey) || 'kv').toLowerCase(); // kv | json
    const obj = value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : this._cloneValue(defaultValue ?? {});
  
    const kvText = this.escapeHtml(this.formatKeyValueLines(obj));
    const jsonText = obj ? this.escapeHtml(JSON.stringify(obj, null, 2)) : '';
    const kvHidden = mode === 'json' ? 'hidden' : '';
    const jsonHidden = mode === 'kv' ? 'hidden' : '';
    const kvActive = mode === 'kv' ? 'active' : '';
    const jsonActive = mode === 'json' ? 'active' : '';
    const kvId = inputIdPrefix ? `id="${inputIdPrefix}-kv"` : '';
    const jsonId = inputIdPrefix ? `id="${inputIdPrefix}-json"` : '';
    const fieldAttr = fieldPath ? `data-field="${this.escapeHtml(fieldPath)}"` : '';
  
    return `
      <div class="subform-editor" data-subform-id="${this.escapeHtml(subformId)}" data-subform-mode-key="${this.escapeHtml(modeKey)}">
        <div class="subform-editor-tabs">
          <button type="button" class="subform-tab ${kvActive}" data-action="subform-toggle" ${fieldAttr} data-subform-id="${this.escapeHtml(subformId)}" data-mode="kv">键值</button>
          <button type="button" class="subform-tab ${jsonActive}" data-action="subform-toggle" ${fieldAttr} data-subform-id="${this.escapeHtml(subformId)}" data-mode="json">JSON</button>
        </div>
        <textarea class="form-input subform-kv" rows="4" ${kvId} ${dataset} data-control="kvlines" placeholder="每行一个：key=value（value 可写 JSON）" ${disabled ?? ''} ${kvHidden}>${kvText}</textarea>
        <textarea class="form-input subform-json" rows="4" ${jsonId} ${dataset} data-control="json" placeholder="JSON 数据" ${disabled ?? ''} ${jsonHidden}>${jsonText}</textarea>
      </div>
    `;
  },

  renderConfigControl(field, value, inputId) {
    const meta = field.meta ?? {};
    const component = meta.component ?? field.component ?? this.mapTypeToComponent(field.type);
    const dataset = `data-field="${this.escapeHtml(field.path)}" data-component="${component ?? ''}" data-type="${field.type}"`;
    const disabled = meta.readonly ? 'disabled' : '';
    const basePlaceholder = meta.placeholder ?? '';
    const hasSchemaDefault = Object.hasOwn(field, 'default') || Object.hasOwn(meta, 'default');
    const rawDefault = Object.hasOwn(meta, 'default') ? meta.default : field.default;
    // 对象/数组不做 String()，避免 placeholder 显示 [object Object]
    let defaultText = '';
    if (rawDefault !== undefined && rawDefault !== null) {
      if (typeof rawDefault === 'object' && !Array.isArray(rawDefault)) defaultText = '(对象)';
      else if (Array.isArray(rawDefault)) defaultText = '(数组)';
      else defaultText = String(rawDefault);
    }
    const isEmptyValue = value === undefined || value === null || value === '';
    // 当字段没有显式 placeholder 且当前值为空时，用 commonconfig 的 default 作为灰字提示
    const effectivePlaceholder = basePlaceholder
      || (isEmptyValue && hasSchemaDefault && defaultText ? `默认：${defaultText}` : '');
    const placeholder = this.escapeHtml(effectivePlaceholder);

    const lowerComponent = (component ?? '').toLowerCase();
    const isArrayObject = field.type === 'array<object>' || (lowerComponent === 'arrayform' && meta.itemType === 'object');
    if (isArrayObject) {
      const arrayValue = Array.isArray(value) ? value : (this.getNestedValue(this._configState?.rawObject ?? {}, field.path) ?? []);
      return this.renderArrayObjectControl(field, arrayValue, meta);
    }
  
    // 使用统一的组件渲染方法
    return this._renderComponentByType({
      component: lowerComponent,
      inputId,
      dataset,
      value,
      meta,
      field,
      disabled,
      placeholder
    });
  },

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
  },

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
  },

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
  },

  renderArrayObjectFields(parentPath, fields, itemValue, index, basePath = '') {
    return Object.entries(fields ?? {}).map(([key, schema]) => {
      const relPath = basePath ? `${basePath}.${key}` : key;
      const templatePath = `${parentPath}[].${relPath}`;
      
      // 优先从rawObject获取完整数据，确保嵌套对象（如SSL证书）正确显示
      const fullPath = `${parentPath}.${index}.${relPath}`;
      const rawValue = this.getNestedValue(this._configState?.rawObject ?? {}, fullPath);
      const value = rawValue !== undefined ? rawValue : this.getNestedValue(itemValue, relPath);
      
      const component = (schema.component ?? '').toLowerCase();
      const example = Object.hasOwn(schema, 'example') ? this.renderExampleBlock(schema.example) : '';
      const isSubForm = component === 'subform';
      const hasChildFields = schema.fields && Object.keys(schema.fields).length > 0;
      const isNestedObject = (schema.type === 'object' || schema.type === 'map') && hasChildFields;
      
      // SubForm / 嵌套对象 且 定义了子字段：展开显示子字段
      // 如果 SubForm 的 fields 为空（如 headers/extraBody 这种“自由对象”），不走这里，直接渲染为一个控件。
      if ((isSubForm || isNestedObject) && hasChildFields) {
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
          ${example}
        </div>
      `;
    }).join('');
  },

  renderArrayObjectFieldControl(parentPath, relPath, templatePath, schema, value, index) {
    const component = (schema.component ?? this.mapTypeToComponent(schema.type) ?? '').toLowerCase();
    const dataset = `data-array-parent="${this.escapeHtml(parentPath)}" data-array-index="${index}" data-object-path="${this.escapeHtml(relPath)}" data-template-path="${this.escapeHtml(templatePath)}" data-component="${component}" data-type="${schema.type}"`;
  
    // 特殊处理：SubForm 需要特定的 subformId
    if (component === 'subform' || ((schema.type === 'object' || schema.type === 'map') && !schema.fields)) {
      const subformId = `${parentPath}.${index}.${relPath}`;
      const modeKey = `subform_mode:${this._configState?.selected?.name ?? 'config'}:${this._configState?.selectedChild ?? ''}:${subformId}`;
      return this.renderFreeObjectSubFormEditor({
        dataset,
        value,
        defaultValue: {},
        modeKey,
        subformId,
        disabled: '',
        fieldPath: null
      });
    }
  
    // 使用统一的组件渲染方法
    const inputId = `arr-${parentPath}-${index}-${relPath}`.replace(/[^a-zA-Z0-9-_]/g, '_');
    return this._renderComponentByType({
      component,
      inputId,
      dataset,
      value,
      meta: schema,
      field: { path: relPath, type: schema.type },
      disabled: '',
      placeholder: ''
    });
  },

  renderDynamicCollections() {
    const collections = this._configState?.dynamicCollectionsMeta ?? [];
    if (!collections.length) return '';
    return `
      <div class="dynamic-collections">
        ${collections.map(col => this.renderDynamicCollectionBlock(col)).join('')}
      </div>
    `;
  },

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
  },

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
  },

  getDynamicCollectionEntries(collection) {
    const source = this.getNestedValue(this._configState?.rawObject ?? {}, collection.basePath ?? '');
    const exclude = new Set(collection.excludeKeys ?? []);
    return Object.entries(source ?? {})
      .filter(([key]) => !exclude.has(key))
      .map(([key, value]) => ({ key, value }));
  },

  renderDynamicFields(collection, fields, value, entryKey, basePath = '') {
    return Object.entries(fields ?? {}).map(([key, schema]) => {
      const relPath = basePath ? `${basePath}.${key}` : key;
      const templatePathBase = collection.valueTemplatePath ?? '';
      const templatePath = this.normalizeTemplatePath(templatePathBase ? `${templatePathBase}.${relPath}` : relPath);
      const fieldValue = this.getNestedValue(value, relPath);
  
      const component = (schema.component ?? '').toLowerCase();
      const isSubForm = component === 'subform';
      const hasChildFields = schema.fields && Object.keys(schema.fields).length > 0;
      if ((isSubForm || schema.type === 'object' || schema.type === 'map') && hasChildFields) {
        return `
          <div class="array-object-subgroup">
            <div class="array-object-subgroup-title">${this.escapeHtml(schema.label || key)}</div>
            ${this.renderDynamicFields(collection, schema.fields, fieldValue ?? {}, entryKey, relPath)}
          </div>
        `;
      }
  
      const dataset = `data-collection="${this.escapeHtml(collection.name)}" data-entry-key="${this.escapeHtml(entryKey)}" data-object-path="${this.escapeHtml(relPath)}" data-template-path="${this.escapeHtml(templatePath)}" data-component="${(schema.component ?? '').toLowerCase()}" data-type="${schema.type}"`;
      const subformId = `${collection.name}.${entryKey}.${relPath}`;
      const example = Object.hasOwn(schema, 'example') ? this.renderExampleBlock(schema.example) : '';
      return `
        <div class="array-object-field">
          <label>${this.escapeHtml(schema.label || key)}</label>
          ${schema.description ? `<p class="config-field-hint">${this.escapeHtml(schema.description)}</p>` : ''}
          ${this.renderDynamicFieldControl(dataset, schema, fieldValue, subformId)}
          ${example}
        </div>
      `;
    }).join('');
  },

  renderDynamicFieldControl(dataset, schema, value, subformId) {
    const component = (schema.component ?? this.mapTypeToComponent(schema.type) ?? '').toLowerCase();
  
    // 特殊处理：SubForm 需要特定的 modeKey
    if (component === 'subform' || ((schema.type === 'object' || schema.type === 'map') && !schema.fields)) {
      const modeKey = `subform_mode:${this._configState?.selected?.name ?? 'config'}:${this._configState?.selectedChild ?? ''}:${subformId}`;
      return this.renderFreeObjectSubFormEditor({
        dataset,
        value,
        defaultValue: {},
        modeKey,
        subformId,
        disabled: '',
        fieldPath: null
      });
    }
  
    // 使用统一的组件渲染方法
    const inputId = `dyn-${subformId}`.replace(/[^a-zA-Z0-9-_]/g, '_');
    return this._renderComponentByType({
      component,
      inputId,
      dataset,
      value,
      meta: schema,
      field: { path: subformId, type: schema.type },
      disabled: '',
      placeholder: ''
    });
  },

  bindConfigFieldEvents() {
    if (this._configState?.mode !== 'form') return;
    const wrapper = document.getElementById('configFormWrapper');
    if (!wrapper) return;
    wrapper.querySelectorAll('[data-field]').forEach(el => {
      // checkbox/radio 用 change，range 用 input（实时更新滑块数值），其余用 input
      const evt = (el.type === 'checkbox' || el.type === 'radio') ? 'change' : 'input';
      el.addEventListener(evt, () => this.handleConfigFieldChange(el));
    });
  },

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
  },

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
  },

  bindArrayObjectEvents() {
    if (this._configState?.mode !== 'form') return;
    const wrapper = document.getElementById('configFormWrapper');
    if (!wrapper) return;
  
    const nodes = wrapper.querySelectorAll('[data-array-parent]');
    nodes.forEach(el => {
      const evt = (el.type === 'checkbox' || el.type === 'radio') ? 'change' : (el.tagName === 'SELECT' ? 'change' : 'input');
      el.addEventListener(evt, () => this.handleArrayObjectFieldChange(el));
    });
  
    wrapper.querySelectorAll('[data-action="array-add"]').forEach(btn => {
      btn.addEventListener('click', () => this.addArrayObjectItem(btn.dataset.field));
    });
  
    wrapper.querySelectorAll('[data-action="array-remove"]').forEach(btn => {
      btn.addEventListener('click', () => this.removeArrayObjectItem(btn.dataset.field, parseInt(btn.dataset.index, 10)));
    });
  },

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
  
    const isRange = target.type === 'range' || component === 'slider' || component === 'range';
    if (isRange) {
      const card = target.closest('.array-object-card, .dynamic-entry-card');
      const span = card?.querySelector('.config-slider-value');
      if (span) span.textContent = target.value;
    }
  
    const parsed = this._parseConfigFieldValueFromTarget(target, {
      component,
      meta,
      type,
      radioRoot: target.closest('#configFormWrapper')
    });
    if (!parsed.ok) return;
    let value = parsed.value;
  
    value = this.normalizeFieldValue(value, meta, type);
    this.updateArrayObjectValue(parentPath, index, objectPath, value);
  },

  _getConfigArray(path) {
    if (!this._configState) return [];
    const rawArray = this.getNestedValue(this._configState.rawObject ?? {}, path);
    if (Array.isArray(rawArray)) return this._cloneValue(rawArray);
    const valueArray = this._configState.values[path];
    return Array.isArray(valueArray) ? this._cloneValue(valueArray) : [];
  },

  addArrayObjectItem(path) {
    if (!this._configState) return;
    const subFields = this._configState.arraySchemaMap[path] ?? {};
    const template = this.buildDefaultsFromFields(subFields);
    const list = this._getConfigArray(path);
    list.push(template);
    this.setConfigFieldValue(path, list);
    this.renderConfigFormPanel();
  },

  removeArrayObjectItem(path, index) {
    if (!this._configState) return;
    const list = this._getConfigArray(path);
    list.splice(index, 1);
    this.setConfigFieldValue(path, list);
    this.renderConfigFormPanel();
  },

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
  },

  bindDynamicCollectionEvents() {
    if (this._configState?.mode !== 'form') return;
    const wrapper = document.getElementById('configMain');
    if (!wrapper) return;
  
    wrapper.querySelectorAll('[data-action="collection-add"]').forEach(btn => {
      btn.addEventListener('click', () => this.addDynamicCollectionEntry(btn.dataset.collection));
    });
  
    const nodes = wrapper.querySelectorAll('[data-collection]');
    nodes.forEach(el => {
      const evt = el.type === 'checkbox' ? 'change' : (el.tagName === 'SELECT' ? 'change' : 'input');
      el.addEventListener(evt, () => this.handleDynamicFieldChange(el));
    });
  },

  async addDynamicCollectionEntry(collectionName) {
    if (!this._configState) return;
    const collection = this._configState.dynamicCollectionsMeta.find(col => col.name === collectionName);
    if (!collection) return;
  
    const key = (await showPromptDialogUI(collection.keyPlaceholder || '请输入键'))?.trim();
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
  },

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
    const parsed = this._parseConfigFieldValueFromTarget(target, {
      component,
      meta,
      type,
      radioRoot: target.closest('#configFormWrapper')
    });
    if (!parsed.ok) return;
    let value = parsed.value;
  
    value = this.normalizeFieldValue(value, meta, type);
    const prefix = this.combinePath(collection.basePath ?? '', key);
    const fullPath = this.combinePath(prefix, objectPath);
    this.setConfigFieldValue(fullPath, value);
  },

  _parseConfigFieldValueFromTarget(target, { component, meta, type, radioRoot } = {}) {
    // 只做“值解析/转换”，不处理 dirty/保存逻辑；需要时由调用方更新 UI 文本与 span
    let value;
  
    if (component === 'switch') {
      value = !!target.checked;
    } else if (target.type === 'radio') {
      const root = radioRoot ?? document;
      const checked = root?.querySelector ? root.querySelector(`input[name="${target.name}"]:checked`) : null;
      value = checked ? checked.value : target.value;
    } else if (target.type === 'range' || component === 'slider' || component === 'range') {
      value = target.value === '' ? null : Number(target.value);
    } else if (target.dataset.control === 'kvlines') {
      value = this.parseKeyValueLines(target.value || '');
    } else if (target.dataset.control === 'tags') {
      value = target.value.split(/\n+/).map(v => v.trim()).filter(Boolean);
    } else if (target.dataset.control === 'multiselect') {
      value = Array.from(target.selectedOptions).map(opt => this.castValue(opt.value, meta.itemType || 'string'));
    } else if (target.dataset.control === 'json') {
      try {
        value = target.value ? JSON.parse(target.value) : null;
      } catch (e) {
        this.showToast('JSON 解析失败: ' + e.message, 'error');
        return { ok: false, value: undefined };
      }
    } else if (component === 'inputnumber' || type === 'number') {
      value = target.value === '' ? null : Number(target.value);
    } else {
      value = target.value;
    }
  
    return { ok: true, value };
  },

  handleConfigFieldChange(target) {
    if (!this._configState) return;
    const path = target.dataset.field;
    const component = (target.dataset.component || '').toLowerCase();
    const fieldDef = this.getFlatFieldDefinition(path);
    const meta = fieldDef?.meta ?? {};
    const type = fieldDef?.type ?? target.dataset.type ?? '';
  
    const isRange = target.type === 'range' || component === 'slider' || component === 'range';
    if (isRange) {
      const wrap = target.closest('#configFormWrapper');
      const span = wrap && target.id ? wrap.querySelector(`[data-slider-value-for="${target.id}"]`) : null;
      if (span) span.textContent = target.value;
    }
  
    const parsed = this._parseConfigFieldValueFromTarget(target, {
      component,
      meta,
      type,
      radioRoot: document
    });
    if (!parsed.ok) return;
    let value = parsed.value;
  
    value = this.normalizeFieldValue(value, meta, type);
    this.setConfigFieldValue(path, value);
    this.updateConfigSaveButton();
  },

  toggleSubFormEditor(path, mode, subformId) {
    if (!mode) return;
    const selector = subformId
      ? `.subform-editor[data-subform-id="${this.escapeSelector(subformId)}"]`
      : `.subform-editor[data-subform-path="${this.escapeSelector(path)}"]`;
    const editor = document.querySelector(selector);
    if (!editor) return;
    const key = editor.dataset.subformModeKey;
    const kv = editor.querySelector('.subform-kv');
    const json = editor.querySelector('.subform-json');
    const tabs = editor.querySelectorAll('.subform-tab');
    const m = String(mode).toLowerCase();
  
    // 切换时保持当前内容为“真相源”，并做基础校验提示
    try {
      if (m === 'json' && kv && !kv.hidden && json) {
        const obj = this.parseKeyValueLines(kv.value || '');
        json.value = JSON.stringify(obj ?? {}, null, 2);
      }
      if (m === 'kv' && json && !json.hidden && kv) {
        let obj = {};
        try {
          obj = json.value ? JSON.parse(json.value) : {};
        } catch (e) {
          console.warn('[SubForm] JSON 解析失败，保持原文本:', e);
          // 解析失败时给出用户提示，并阻止切换，避免误丢数据
          this.showToast('JSON 格式有误，请先修正后再切换到键值模式', 'warning');
          return;
        }
        kv.value = this.formatKeyValueLines(obj ?? {});
      }
    } catch (e) {
      console.warn('[SubForm] 模式切换同步失败:', e);
    }
  
    if (kv) kv.hidden = m === 'json';
    if (json) json.hidden = m === 'kv';
    tabs.forEach(btn => btn.classList.toggle('active', (btn.dataset.mode || '').toLowerCase() === m));
    try {
      if (key) localStorage.setItem(key, m);
    } catch {}
  },

  formatKeyValueLines(obj = {}) {
    return formatKeyValueLines(obj);
  },

  parseKeyValueLines(text = '') {
    return parseKeyValueLines(text);
  },

  setConfigFieldValue(path, value) {
    if (!this._configState) return;
    this._configState.values[path] = value;
    this._configState.rawObject = this.unflattenObject(this._configState.values);
    this._configState.jsonText = JSON.stringify(this._configState.rawObject, null, 2);
    this.updateDirtyState(path, value);
    this.refreshConfigFieldUI(path);
  },

  refreshConfigFieldUI(path) {
    const fieldEl = document.querySelector(`[data-field="${this.escapeSelector(path)}"]`);
    if (!fieldEl || !this._configState) return;
    const wrapper = fieldEl.closest('.config-field');
    if (!wrapper) return;
    if (this._configState.dirty[path]) wrapper.classList.add('config-field-dirty');
    else wrapper.classList.remove('config-field-dirty');
  },

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
  },

  updateConfigSaveButton() {
    const btn = document.getElementById('configSaveBtn');
    if (!btn || !this._configState) return;
    const dirtyCount = Object.keys(this._configState.dirty).length;
    const isDisabled = this._configState.mode === 'form' ? dirtyCount === 0 : !this._configState.jsonDirty;
    btn.disabled = isDisabled;
    btn.textContent = this._configState.mode === 'form' 
      ? (dirtyCount ? `保存（${dirtyCount}）` : '保存')
      : '保存（JSON）';
  },

  switchConfigMode(mode) {
    if (!this._configState || this._configState.mode === mode) return;
    this._configState.mode = mode;
    if (mode === 'json') {
      this._configState.pendingJson = this._configState.jsonText;
      this._configState.jsonDirty = false;
    }
    this.renderConfigFormPanel();
  },

  async saveConfigChanges() {
    if (!this._configState) return;
    if (this._configState.mode === 'json') {
      await this.saveConfigJson();
    } else {
      await this.saveConfigForm();
    }
  },

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
      await this.loadSelectedConfigDetail();
    } catch (e) {
      this.showToast('保存失败: ' + e.message, 'error');
    }
  },

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
      await this.loadSelectedConfigDetail();
    } catch (e) {
      this.showToast('保存失败: ' + e.message, 'error');
    }
  },

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
};
