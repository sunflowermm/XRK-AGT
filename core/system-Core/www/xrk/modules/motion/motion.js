/**
 * 轻量 UI 辅助：移动端侧栏/遮罩同步，无 GSAP 依赖。
 */

const MOBILE_MQ = '(max-width: 768px)';
let onResizeSync = null;

function isMobileViewport() {
  return window.matchMedia?.(MOBILE_MQ)?.matches ?? false;
}

export function initMotion() {
  syncSidebarForViewport();
  onResizeSync = () => syncSidebarForViewport();
  window.addEventListener('resize', onResizeSync, { passive: true });
}

export function disposeMotion() {
  if (onResizeSync) {
    window.removeEventListener('resize', onResizeSync);
    onResizeSync = null;
  }
}

export function syncSidebarForViewport() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  if (!sidebar) return;

  if (!isMobileViewport()) {
    sidebar.classList.remove('open');
    document.body.classList.remove('sidebar-open');
    overlay?.classList.remove('show');
    document.getElementById('menuBtn')?.setAttribute('aria-expanded', 'false');
    return;
  }

  if (!sidebar.classList.contains('open')) {
    overlay?.classList.remove('show');
  }
}

export function setSidebarOpen(open) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  if (!sidebar) return;

  if (!isMobileViewport()) {
    syncSidebarForViewport();
    return;
  }

  sidebar.classList.toggle('open', open);
  document.body.classList.toggle('sidebar-open', open);
  overlay?.classList.toggle('show', open);
  document.getElementById('menuBtn')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}
