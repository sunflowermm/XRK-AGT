/** 各页需记住的滚动容器（相对页面根节点） */
const PAGE_SCROLL_TARGETS = {
  home: ['.dashboard'],
  chat: ['#chatMessages', '.ai-settings-content'],
  config: ['#configList', '#configMain'],
  api: ['.api-container']
};

function collectScroll(page, root) {
  const scroll = {};
  for (const sel of PAGE_SCROLL_TARGETS[page] || []) {
    const el = root.querySelector(sel);
    if (el) scroll[sel] = el.scrollTop;
  }
  return scroll;
}

function applyScroll(root, scroll) {
  for (const [sel, top] of Object.entries(scroll)) {
    const el = root.querySelector(sel);
    if (!el || typeof top !== 'number') continue;
    el.scrollTop = top;
  }
}

/**
 * 页面 DOM 缓存：切走时保留整页 DOM + 滚动，回来时直接挂载，不重绘。
 */
export function createPageCache(app) {
  const holder = document.createElement('div');
  holder.id = 'xrkPageCache';
  holder.hidden = true;
  holder.setAttribute('aria-hidden', 'true');
  holder.style.contentVisibility = 'hidden';
  holder.style.contain = 'strict';
  document.body.appendChild(holder);

  const entries = new Map();

  return {
    has(page) {
      return entries.has(page);
    },

    save(page) {
      const content = document.getElementById('content');
      const root = content?.firstElementChild;
      if (!root || !page) return false;

      app._onPageHide?.(page);

      const scroll = collectScroll(page, root);
      content.removeChild(root);
      entries.set(page, { root, scroll });
      holder.appendChild(root);
      return true;
    },

    restore(page) {
      const content = document.getElementById('content');
      const entry = entries.get(page);
      if (!entry || !content) return false;

      content.appendChild(entry.root);
      applyScroll(entry.root, entry.scroll);
      app._onPageShow?.(page);
      return true;
    },

    invalidate(page) {
      const entry = entries.get(page);
      if (!entry) return;
      entry.root.remove();
      entries.delete(page);
    },

    invalidateAll() {
      for (const p of [...entries.keys()]) {
        this.invalidate(p);
      }
    }
  };
}
