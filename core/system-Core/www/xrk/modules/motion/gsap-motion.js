/**
 * GSAP 动效层：页面切换、壳层入场、Dashboard/聊天/Toast。
 * 原则：单一 reveal 入口、结束时 clearProps、尊重 prefers-reduced-motion。
 */

let gsap = null;
let shellContext = null;
let pageBlockContext = null;
let mm = null;
let reducedMotion = false;
let onResizeSync = null;

const MOBILE_MQ = '(max-width: 768px)';
const EASE_OUT = 'power3.out';
const EASE_IN = 'power2.in';
const PAGE_BLOCK_SEL =
  '.dashboard-header, .stat-card, .chart-card, .info-grid .card, .dashboard > .card, ' +
  '.card, .config-page, .api-container, ' +
  '.chat-sidebar, .chat-main, .chat-mode-btn, .ai-settings-section';

function isMobileViewport() {
  return window.matchMedia?.(MOBILE_MQ)?.matches ?? false;
}

function getGsap() {
  return typeof window !== 'undefined' ? window.gsap : null;
}

function dur(fallback = 0.32) {
  return reducedMotion ? 0 : fallback;
}

export function isMotionReady() {
  return Boolean(gsap);
}

export function isReducedMotion() {
  return reducedMotion;
}

/** 统一入场：淡入 + 轻微上移，结束清内联样式 */
function reveal(targets, options = {}) {
  if (!gsap || reducedMotion) return;
  const list = gsap.utils.toArray(targets);
  if (!list.length) return;
  gsap.killTweensOf(list);
  gsap.fromTo(
    list,
    { y: options.y ?? 12, autoAlpha: 0 },
    {
      y: 0,
      autoAlpha: 1,
      duration: dur(options.duration ?? 0.32),
      stagger: options.stagger ?? 0.045,
      ease: options.ease ?? EASE_OUT,
      overwrite: 'auto',
      clearProps: 'transform,opacity,visibility'
    }
  );
}

function releaseMotionStyles(root, selector = PAGE_BLOCK_SEL) {
  if (!root) return;
  const targets = root.querySelectorAll(selector);
  if (!targets.length) return;
  if (gsap) {
    gsap.killTweensOf(targets);
    gsap.set(targets, { autoAlpha: 1, y: 0, clearProps: 'transform,opacity,visibility' });
  } else {
    targets.forEach((el) => {
      el.style.removeProperty('opacity');
      el.style.removeProperty('visibility');
      el.style.removeProperty('transform');
    });
  }
}

/** 桌面端强制侧栏可见；移动端默认收起 */
export function syncSidebarForViewport() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  if (!sidebar) return;

  if (!isMobileViewport()) {
    sidebar.classList.remove('open');
    document.body.classList.remove('sidebar-open');
    overlay?.classList.remove('show');
    if (gsap) {
      gsap.killTweensOf([sidebar, overlay].filter(Boolean));
      gsap.set(sidebar, { clearProps: 'transform,x,opacity,visibility' });
      if (overlay) gsap.set(overlay, { clearProps: 'opacity,visibility' });
    } else {
      sidebar.style.removeProperty('transform');
      sidebar.style.removeProperty('opacity');
      sidebar.style.removeProperty('visibility');
    }
    document.getElementById('menuBtn')?.setAttribute('aria-expanded', 'false');
    return;
  }

  if (!sidebar.classList.contains('open')) {
    if (gsap) gsap.set(sidebar, { x: '-100%' });
    else sidebar.style.transform = 'translateX(-100%)';
    overlay?.classList.remove('show');
  }
}

export function initMotion() {
  gsap = getGsap();
  reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

  syncSidebarForViewport();
  onResizeSync = () => syncSidebarForViewport();
  window.addEventListener('resize', onResizeSync, { passive: true });

  if (!gsap) {
    console.warn('[motion] GSAP 未加载，动效已降级为 CSS');
    return false;
  }

  gsap.defaults({ duration: 0.32, ease: EASE_OUT });

  mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: reduce)', () => {
    reducedMotion = true;
    cancelPageMotion(document.getElementById('content'));
    syncSidebarForViewport();
    return () => {
      reducedMotion = false;
    };
  });

  shellContext = gsap.context(() => animateAppShell());
  document.documentElement.classList.add('motion-enabled');
  return true;
}

export function disposeMotion() {
  if (onResizeSync) {
    window.removeEventListener('resize', onResizeSync);
    onResizeSync = null;
  }
  pageBlockContext?.revert();
  pageBlockContext = null;
  shellContext?.revert();
  shellContext = null;
  mm?.revert();
  mm = null;
}

/** 页面重渲染前取消块级动效 */
export function cancelPageMotion(container) {
  pageBlockContext?.revert();
  pageBlockContext = null;
  if (!container) return;
  releaseMotionStyles(container);
  if (gsap) {
    gsap.killTweensOf(container);
    gsap.set(container, { clearProps: 'transform,opacity,visibility' });
  } else {
    container.style.removeProperty('opacity');
    container.style.removeProperty('visibility');
    container.style.removeProperty('transform');
  }
}

export function animateAppShell() {
  if (!gsap || reducedMotion) return;

  const shellTargets = '.brand-logo, .brand-name, .nav-item, .sidebar-footer, .header';
  const tl = gsap.timeline({
    defaults: { ease: EASE_OUT },
    onComplete: () => gsap.set(shellTargets, { clearProps: 'transform,opacity,visibility' })
  });
  tl.fromTo('.brand-logo', { scale: 0.88, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.42, ease: 'back.out(1.4)' })
    .fromTo('.brand-name', { x: -10, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.28 }, '-=0.28')
    .fromTo('.nav-item', { x: -12, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.28, stagger: 0.05 }, '-=0.18')
    .fromTo('.sidebar-footer', { y: 8, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.26 }, '-=0.1')
    .fromTo('.header', { y: -8, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.28 }, '-=0.24');
}

export function animateHeaderTitle(el) {
  if (!gsap || !el || reducedMotion) return;
  gsap.fromTo(
    el,
    { y: -6, autoAlpha: 0 },
    {
      y: 0,
      autoAlpha: 1,
      duration: dur(0.24),
      ease: EASE_OUT,
      overwrite: 'auto',
      clearProps: 'transform,opacity,visibility'
    }
  );
}

export function animatePageExit(contentEl) {
  if (!gsap || !contentEl || reducedMotion) return Promise.resolve();

  return new Promise((resolve) => {
    gsap.to(contentEl, {
      autoAlpha: 0,
      y: 6,
      duration: dur(0.18),
      ease: EASE_IN,
      overwrite: 'auto',
      onComplete: () => {
        gsap.set(contentEl, { clearProps: 'transform,opacity,visibility' });
        resolve();
      }
    });
  });
}

/** @deprecated 页面切换仅保留块级 stagger，避免整页 + 块级双重动画 */
export function animatePageEnter(contentEl, page) {
  animatePageBlocks(contentEl, page);
}

export function animatePageBlocks(container, page) {
  if (!container) return;

  pageBlockContext?.revert();
  pageBlockContext = null;

  if (!gsap || reducedMotion) {
    releaseMotionStyles(container);
    return;
  }

  pageBlockContext = gsap.context(() => {
    requestAnimationFrame(() => {
      switch (page) {
        case 'home':
          animateDashboard(container);
          break;
        case 'chat':
          animateChatLayout(container);
          break;
        default:
          animateGenericBlocks(container);
          break;
      }
    });
  }, container);
}

export function animateDashboard(root) {
  const scope = root.querySelector('.dashboard') || root;
  const targets = scope.querySelectorAll(
    '.dashboard-header, .stat-card, .chart-card, .info-grid .card, .dashboard > .card'
  );
  reveal(targets, { y: 14, duration: 0.34, stagger: 0.04 });
}

export function animateChatLayout(root) {
  const container = root.querySelector('.chat-container') || root;
  if (!container) return;
  const targets = container.querySelectorAll('.chat-sidebar, .chat-main, .chat-mode-btn');
  reveal(targets, { y: 10, duration: 0.3, stagger: 0.05 });
  const aiSections = container.querySelectorAll('.ai-settings-section');
  if (aiSections.length) reveal(aiSections, { y: 8, duration: 0.26, stagger: 0.04 });
}

export function animateGenericBlocks(root) {
  reveal(root.querySelectorAll('.card, .config-page, .api-container, .dashboard-header'));
}

export function animateOverlay(show) {
  if (!isMobileViewport()) return;
  const overlay = document.getElementById('overlay');
  if (!overlay) return;

  if (!gsap || reducedMotion) {
    overlay.classList.toggle('show', show);
    return;
  }

  gsap.killTweensOf(overlay);
  if (show) {
    overlay.classList.add('show');
    gsap.fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: dur(0.22), ease: EASE_OUT, overwrite: 'auto' });
  } else {
    gsap.to(overlay, {
      autoAlpha: 0,
      duration: dur(0.18),
      ease: EASE_IN,
      overwrite: 'auto',
      onComplete: () => overlay.classList.remove('show')
    });
  }
}

export function setSidebarOpen(open) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  if (!isMobileViewport()) {
    syncSidebarForViewport();
    return;
  }

  sidebar.classList.toggle('open', open);
  document.body.classList.toggle('sidebar-open', open);
  document.getElementById('menuBtn')?.setAttribute('aria-expanded', open ? 'true' : 'false');

  if (!gsap || reducedMotion) {
    sidebar.style.transform = open ? 'translateX(0)' : 'translateX(-100%)';
    animateOverlay(open);
    return;
  }

  gsap.killTweensOf(sidebar);
  if (open) {
    gsap.fromTo(sidebar, { x: '-100%' }, { x: '0%', duration: dur(0.32), ease: EASE_OUT, overwrite: 'auto' });
  } else {
    gsap.to(sidebar, { x: '-100%', duration: dur(0.26), ease: EASE_IN, overwrite: 'auto' });
  }
  animateOverlay(open);
}

export function animateToastIn(toast) {
  if (!gsap || !toast || reducedMotion) return null;
  gsap.fromTo(
    toast,
    { x: 20, autoAlpha: 0, scale: 0.97 },
    {
      x: 0,
      autoAlpha: 1,
      scale: 1,
      duration: dur(0.3),
      ease: 'back.out(1.4)',
      overwrite: 'auto',
      clearProps: 'transform,opacity,visibility'
    }
  );
  return () =>
    new Promise((resolve) => {
      gsap.to(toast, {
        x: 16,
        autoAlpha: 0,
        scale: 0.97,
        duration: dur(0.18),
        ease: EASE_IN,
        overwrite: 'auto',
        onComplete: resolve
      });
    });
}

export function animateChatMessage(el) {
  if (!gsap || !el || reducedMotion) return;
  el.classList.remove('message-enter');
  const isUser = el.classList.contains('user');
  gsap.fromTo(
    el,
    { x: isUser ? 8 : -8, y: 8, autoAlpha: 0, scale: 0.98 },
    {
      x: 0,
      y: 0,
      autoAlpha: 1,
      scale: 1,
      duration: dur(isUser ? 0.24 : 0.28),
      ease: EASE_OUT,
      clearProps: 'transform,opacity,visibility',
      overwrite: 'auto'
    }
  );
}

export function animateChatHistoryRestore(box) {
  if (!gsap || !box || reducedMotion) return;
  const items = box.querySelectorAll('.chat-message, .voice-message');
  if (!items.length) return;
  items.forEach((el) => el.classList.remove('message-enter'));
  reveal(items, { y: 6, duration: 0.26, stagger: 0.035 });
}

export function animateChatMainCrossfade(el, onSwap) {
  if (!gsap || !el || reducedMotion) {
    onSwap?.();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    gsap.to(el, {
      autoAlpha: 0,
      y: 6,
      duration: dur(0.14),
      ease: EASE_IN,
      overwrite: 'auto',
      onComplete: () => {
        onSwap?.();
        gsap.fromTo(
          el,
          { autoAlpha: 0, y: -4 },
          {
            autoAlpha: 1,
            y: 0,
            duration: dur(0.22),
            ease: EASE_OUT,
            clearProps: 'transform,opacity,visibility',
            onComplete: resolve
          }
        );
      }
    });
  });
}

export function animateImagePreviewItems(container) {
  if (!gsap || !container || reducedMotion) return;
  const items = container.querySelectorAll('.chat-image-preview-item');
  if (!items.length) return;
  reveal(items, { y: 0, duration: 0.24, stagger: 0.04 });
}

export function animateToolBlockToggle(content, expanded) {
  if (!gsap || !content || reducedMotion) return;
  gsap.killTweensOf(content);
  if (expanded) {
    content.hidden = false;
    gsap.fromTo(
      content,
      { height: 0, autoAlpha: 0 },
      {
        height: 'auto',
        autoAlpha: 1,
        duration: dur(0.24),
        ease: EASE_OUT,
        clearProps: 'height,opacity,visibility',
        overwrite: 'auto'
      }
    );
  } else {
    gsap.to(content, {
      height: 0,
      autoAlpha: 0,
      duration: dur(0.18),
      ease: EASE_IN,
      overwrite: 'auto',
      onComplete: () => {
        content.hidden = true;
        gsap.set(content, { clearProps: 'height,opacity,visibility' });
      }
    });
  }
}

export function animateChatModeSwitch(activeBtn) {
  if (!gsap || reducedMotion || !activeBtn) return;
  gsap.fromTo(
    activeBtn,
    { scale: 0.96 },
    { scale: 1, duration: dur(0.22), ease: 'back.out(1.6)', overwrite: 'auto', clearProps: 'transform' }
  );
}

export function animateStreamStatus(el, active) {
  if (!gsap || !el || reducedMotion || !active) return;
  gsap.fromTo(
    el,
    { scale: 0.92, autoAlpha: 0.7 },
    { scale: 1, autoAlpha: 1, duration: dur(0.22), ease: EASE_OUT, overwrite: 'auto' }
  );
}

export function animateAISettingsPanel(panel, expanded) {
  if (!gsap || !panel || reducedMotion || !isMobileViewport()) return;
  const content = panel.querySelector('.ai-settings-content');
  if (content && expanded) {
    reveal([content], { y: -4, duration: 0.22, stagger: 0 });
  }
}

export function animateChatSendPulse(btn) {
  if (!gsap || !btn || reducedMotion) return;
  gsap.fromTo(
    btn,
    { scale: 1 },
    { scale: 0.9, duration: dur(0.07), yoyo: true, repeat: 1, ease: 'power2.inOut', overwrite: 'auto' }
  );
}

export function animateVoiceWave(waveEl, active) {
  if (!gsap || !waveEl || reducedMotion) return;
  gsap.to(waveEl, {
    autoAlpha: active ? 1 : 0.4,
    duration: dur(0.2),
    ease: EASE_OUT,
    overwrite: 'auto'
  });
}

export function pulseOnlineStatus(dotEl) {
  if (!gsap || !dotEl || reducedMotion) return;
  gsap.fromTo(
    dotEl,
    { scale: 0.75 },
    { scale: 1, duration: dur(0.4), ease: 'back.out(2)', overwrite: 'auto', clearProps: 'transform' }
  );
}
