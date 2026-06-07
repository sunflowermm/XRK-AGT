function bindConfigListEvents(app, listContainer) {
  const selectFromEvent = (e) => {
    const item = e.target.closest('.config-item');
    if (!item || !app._configState) return;
    const name = item.dataset.name;
    if (name) app.selectConfig(name);
  };

  listContainer.addEventListener('click', selectFromEvent);
  listContainer.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.config-item');
    if (!item || !app._configState) return;
    if (!item.dataset.name) return;
    e.preventDefault();
    selectFromEvent(e);
  });
  let scrollPersistRaf = 0;
  listContainer.addEventListener('scroll', () => {
    if (scrollPersistRaf) return;
    scrollPersistRaf = requestAnimationFrame(() => {
      scrollPersistRaf = 0;
      app.persistConfigListScroll?.(listContainer.scrollTop);
    });
  }, { passive: true });
}

export function renderConfigPage(app) {
  const content = document.getElementById('content');
  if (!content) return;

  if (!app._configState) {
    app._configState = {
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
      loading: false,
      listScrollTop: app.readStoredConfigListScroll?.() ?? null,
      mainScrollTop: null
    };
    try {
      const lastName = localStorage.getItem('lastConfigName') || '';
      const lastChild = localStorage.getItem('lastConfigChild') || '';
      if (lastName) {
        app._configState.pendingSelect = { name: lastName, child: lastChild || null };
      }
    } catch {}
  } else if (app._configState.listScrollTop == null) {
    app._configState.listScrollTop = app.readStoredConfigListScroll?.() ?? null;
  }

  const hasSelection = Boolean(app._configState?.selected);
  const mainInitial = hasSelection
    ? `<div class="empty-state"><div class="loading-spinner" style="margin:0 auto"></div><p style="margin-top:12px">加载配置中...</p></div>`
    : app.renderConfigPlaceholder();

  content.innerHTML = `
      <div class="config-page${app.isConfigDense?.() ? ' config-page-dense' : ''}">
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
            <input type="search" id="configSearchInput" placeholder="搜索配置 / 描述" autocomplete="off">
        </div>
        <div class="config-list" id="configList">
          <div class="empty-state">
            <div class="loading-spinner" style="margin:0 auto"></div>
              <p style="margin-top:12px">加载配置中...</p>
          </div>
        </div>
        </aside>
        <section class="config-main" id="configMain">
          ${mainInitial}
        </section>
      </div>
    `;

  const searchInput = document.getElementById('configSearchInput');
  if (searchInput) {
    if (app._configState?.filter) {
      searchInput.value = app._configState.filter;
    }
    searchInput.addEventListener('input', (e) => {
      if (!app._configState) return;
      app._configState.filter = e.target.value.trim().toLowerCase();
      app.renderConfigList();
    });
  }

  const listContainer = document.getElementById('configList');
  if (listContainer) {
    bindConfigListEvents(app, listContainer);
  }

  const contentScroller = document.querySelector('.content');
  if (contentScroller) {
    let mainScrollRaf = 0;
    contentScroller.addEventListener('scroll', () => {
      if (mainScrollRaf) return;
      mainScrollRaf = requestAnimationFrame(() => {
        mainScrollRaf = 0;
        if (app._configState) app._configState.mainScrollTop = contentScroller.scrollTop;
      });
    }, { passive: true });
  }

  app.loadConfigList();
}
