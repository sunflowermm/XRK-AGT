/**
 * 首页「插件信息」「工作流状态」词云式展示（悬停/聚焦显示详情）
 * 由系统概览路由 renderHome → _applyHomeData / _loadHomeDataAndUpdate 驱动
 */

import { escapeHtml } from '../utils.js';
import { setUpdating, clearUpdating } from '../dom.js';

function hashStr(s) {
  let h = 0;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function sizeClass(seed) {
  const sizes = ['tag-cloud-chip--sm', 'tag-cloud-chip--md', 'tag-cloud-chip--lg'];
  return sizes[hashStr(seed) % 3];
}

function toneClass(seed) {
  const tones = [
    'tag-cloud-chip--tone-primary',
    'tag-cloud-chip--tone-success',
    'tag-cloud-chip--tone-warning',
    'tag-cloud-chip--tone-info'
  ];
  return tones[hashStr(seed) % 4];
}

function safeDomId(prefix, seed, index) {
  const base = String(seed ?? 'x')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40);
  return `${prefix}-${index}-${base || 'n'}`;
}

function formatLoadTime(ms) {
  const n = Number(ms) || 0;
  return n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(2)}s`;
}

/** 靠近视口顶部的芯片改为向下弹出详情，减少裁切 */
function applyTagCloudPopoverFlip(root) {
  if (!root) return;
  requestAnimationFrame(() => {
    root.querySelectorAll('.tag-cloud-chip').forEach(chip => {
      const r = chip.getBoundingClientRect();
      chip.classList.toggle('popover-flip', r.top < 96);
    });
  });
}

/** 交互时再根据实时布局更新一次，避免首次渲染后布局变化导致的裁切 */
function bindTagCloudPopoverFlip(root) {
  if (!root) return;
  const chips = Array.from(root.querySelectorAll('.tag-cloud-chip'));
  const updateOne = (chip) => {
    const r = chip.getBoundingClientRect();
    chip.classList.toggle('popover-flip', r.top < 96);
  };
  for (const chip of chips) {
    chip.addEventListener('mouseenter', () => updateOne(chip));
    chip.addEventListener('focusin', () => updateOne(chip));
    chip.addEventListener('touchstart', () => updateOne(chip), { passive: true });
  }
}

/**
 * 渲染插件摘要词云（依赖 /api/plugins/summary）
 */
export async function loadPluginsInfoPanel(app) {
  const box = document.getElementById('pluginsInfo');
  if (!box) return;

  setUpdating(box);

  try {
    const res = await fetch(`${app.serverUrl}/api/plugins/summary`, {
      headers: app.getHeaders(),
      signal: AbortSignal.timeout(5000)
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.message ?? data.error ?? '获取插件信息失败');
    }

    const summary = data.summary ?? {};
    const plugins = Array.isArray(data.plugins) ? data.plugins : [];
    const totalPlugins = summary.totalPlugins ?? plugins.length;
    const pluginsWithRules = summary.withRules ?? 0;
    const pluginsWithTasks = summary.withTasks ?? summary.taskCount ?? 0;
    const loadTime = summary.totalLoadTime ?? 0;

    const metaHtml = `
      <div class="home-cloud-meta" aria-label="插件汇总">
        <span class="home-cloud-meta__item"><strong class="home-cloud-meta__num home-cloud-meta__num--primary">${totalPlugins}</strong><span class="home-cloud-meta__lbl">总插件</span></span>
        <span class="home-cloud-meta__sep" aria-hidden="true">·</span>
        <span class="home-cloud-meta__item"><strong class="home-cloud-meta__num home-cloud-meta__num--success">${pluginsWithRules}</strong><span class="home-cloud-meta__lbl">有规则</span></span>
        <span class="home-cloud-meta__sep" aria-hidden="true">·</span>
        <span class="home-cloud-meta__item"><strong class="home-cloud-meta__num home-cloud-meta__num--warning">${pluginsWithTasks}</strong><span class="home-cloud-meta__lbl">定时</span></span>
        <span class="home-cloud-meta__sep" aria-hidden="true">·</span>
        <span class="home-cloud-meta__item"><strong class="home-cloud-meta__num home-cloud-meta__num--info">${escapeHtml(formatLoadTime(loadTime))}</strong><span class="home-cloud-meta__lbl">加载</span></span>
      </div>
    `;

    if (!plugins.length) {
      box.innerHTML = `${metaHtml}<div class="home-cloud-empty">暂无插件条目</div>`;
      return;
    }

    const chips = plugins
      .map((p, i) => {
        const key = p.key ?? p.name ?? `p${i}`;
        const label = p.name ?? p.key ?? 'plugin';
        const tipId = safeDomId('plg-tip', key, i);
        const dsc = (p.dsc ?? '暂无描述').trim();
        const rules = Number(p.rule) || 0;
        const hasTask = p.task > 0;
        const pri = p.priority ?? '—';
        return `
          <div class="tag-cloud-chip ${sizeClass(key)} ${toneClass(key)}" style="--stagger:${i}">
            <button type="button" class="tag-cloud-chip__btn" aria-describedby="${tipId}">
              <span class="tag-cloud-chip__label">${escapeHtml(label)}</span>
            </button>
            <div class="tag-cloud-chip__popover" id="${tipId}" role="tooltip">
              <div class="tag-cloud-chip__popover-title">${escapeHtml(label)}</div>
              <div class="tag-cloud-chip__popover-key mono">${escapeHtml(String(key))}</div>
              <p class="tag-cloud-chip__popover-desc">${escapeHtml(dsc)}</p>
              <ul class="tag-cloud-chip__popover-facts">
                <li><span>优先级</span><em>${escapeHtml(String(pri))}</em></li>
                <li><span>规则条数</span><em>${rules}</em></li>
                <li><span>定时任务</span><em>${hasTask ? '是' : '否'}</em></li>
              </ul>
            </div>
          </div>
        `;
      })
      .join('');

    box.innerHTML = `${metaHtml}<div class="tag-cloud" role="list">${chips}</div>`;
    applyTagCloudPopoverFlip(box);
    bindTagCloudPopoverFlip(box);
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      box.innerHTML = '<div class="home-cloud-empty">加载超时</div>';
    } else {
      console.warn('[插件信息] 加载失败:', e);
      box.innerHTML = `<div class="home-cloud-empty">加载失败：${escapeHtml(e.message || '未知错误')}</div>`;
    }
  } finally {
    setTimeout(() => clearUpdating(box), 50);
  }
}

/**
 * 渲染工作流词云（数据来自系统状态快照 workflows + panels.workflows）
 */
export function renderWorkflowInfoPanel(app, workflows = {}, panels = {}) {
  const box = document.getElementById('workflowInfo');
  if (!box) return;

  setUpdating(box);

  const panelWf = panels.workflows ?? {};
  const stats = panelWf.stats ?? workflows.stats ?? {};
  const total = stats.total ?? panelWf.total ?? workflows.total ?? 0;
  /** 完整列表在 snapshot.workflows.items；panels 内为截断列表，优先用前者 */
  const items = Array.isArray(workflows.items) && workflows.items.length
    ? workflows.items
    : (panelWf.items ?? []);

  if (!total && !items.length) {
    box.innerHTML = '<div class="home-cloud-empty">暂无工作流数据</div>';
    clearUpdating(box);
    return;
  }

  const enabled = stats.enabled ?? panelWf.enabled ?? workflows.enabled ?? 0;
  const totalCount = total;

  const metaHtml = `
    <div class="home-cloud-meta" aria-label="工作流汇总">
      <span class="home-cloud-meta__item"><strong class="home-cloud-meta__num home-cloud-meta__num--primary">${enabled}/${totalCount}</strong><span class="home-cloud-meta__lbl">启用 / 总数</span></span>
    </div>
  `;

  if (!items.length) {
    box.innerHTML = `${metaHtml}<div class="home-cloud-empty">暂无工作流条目</div>`;
    clearUpdating(box);
    return;
  }

  const chips = items
    .map((item, i) => {
      const name = item.name ?? 'workflow';
      const desc = (item.description ?? '').trim() || '暂无描述';
      const priority = item.priority ?? '—';
      const on = item.enabled !== false;
      const tipId = safeDomId('wf-tip', name, i);
      const seed = `${name}-${i}`;
      const offCls = on ? '' : ' tag-cloud-chip--disabled';
      return `
        <div class="tag-cloud-chip ${sizeClass(seed)} ${toneClass(seed)}${offCls}" style="--stagger:${i}">
          <button type="button" class="tag-cloud-chip__btn" aria-describedby="${tipId}">
            <span class="tag-cloud-chip__label">${escapeHtml(name)}</span>
            ${on ? '' : '<span class="tag-cloud-chip__badge" aria-hidden="true">停</span>'}
          </button>
          <div class="tag-cloud-chip__popover" id="${tipId}" role="tooltip">
            <div class="tag-cloud-chip__popover-title">${escapeHtml(name)}</div>
            <p class="tag-cloud-chip__popover-desc">${escapeHtml(desc)}</p>
            <ul class="tag-cloud-chip__popover-facts">
              <li><span>优先级</span><em>${escapeHtml(String(priority))}</em></li>
              <li><span>状态</span><em>${on ? '已启用' : '未启用'}</em></li>
            </ul>
          </div>
        </div>
      `;
    })
    .join('');

  box.innerHTML = `${metaHtml}<div class="tag-cloud" role="list">${chips}</div>`;
  applyTagCloudPopoverFlip(box);
  bindTagCloudPopoverFlip(box);
  clearUpdating(box);
}
