/**
 * 按路由按需加载 Chart.js / Mermaid，避免非相关页首屏拉取大体积脚本
 */

const pending = { chart: null, mermaid: null };

function loadScript(src) {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) {
    return existing.dataset.loaded === '1'
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          existing.addEventListener('load', () => resolve(), { once: true });
          existing.addEventListener('error', () => reject(new Error(`load failed: ${src}`)), { once: true });
        });
  }
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => {
      el.dataset.loaded = '1';
      resolve();
    };
    el.onerror = () => reject(new Error(`load failed: ${src}`));
    document.head.appendChild(el);
  });
}

export async function ensureChart() {
  if (window.Chart) return true;
  if (!pending.chart) pending.chart = loadScript('lib/chart.umd.min.js');
  await pending.chart;
  return !!window.Chart;
}

export async function ensureMermaid() {
  if (window.mermaid) return true;
  if (!pending.mermaid) pending.mermaid = loadScript('lib/mermaid.min.js');
  await pending.mermaid;
  return !!window.mermaid;
}

/** @param {'home'|'chat'|'config'|'api'|string} page */
export async function ensurePageLibs(page) {
  if (page === 'home') return ensureChart();
  if (page === 'chat') return ensureMermaid();
  return true;
}
