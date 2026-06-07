/**
 * GSAP 动效层：页面切换、壳层入场、Dashboard/聊天/Toast。
 * 原则：短时长、power 缓动、无 back 弹跳；缓存页零动效；尊重 prefers-reduced-motion。
 */

let gsap = null;
let shellContext = null;
let pageBlockContext = null;
let mm = null;
let reducedMotion = false;
let onResizeSync = null;

const MOBILE_MQ = '(max-width: 768px)';
/** 控制台：短、稳、少位移；避免 back/elastic 弹跳 */
const EASE_OUT = 'power2.out';
const EASE_IN = 'power1.in';
const DUR = { fast: 0.14, normal: 0.2, slow: 0.26 };
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

function dur(fallback = DUR.normal) {
  return reducedMotion ? 0 : fallback;
}

export function isMotionReady() {
  return Boolean(gsap);
}

export function isReducedMotion() {
  return reducedMotion;
}

/** 统一入场：淡入 + 极轻微位移 */
function reveal(targets, options = {}) {
  if (!gsap || reducedMotion) return;
  const list = gsap.utils.toArray(targets);
  if (!list.length) return;
  gsap.killTweensOf(list);
  gsap.fromTo(
    list,
    { y: options.y ?? 6, autoAlpha: 0 },
    {
      y: 0,
      autoAlpha: 1,
      duration: dur(options.duration ?? DUR.normal),
      stagger: options.stagger ?? 0.024,
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

  gsap.defaults({ duration: DUR.normal, ease: EASE_OUT });

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
  tl.fromTo('.brand-logo', { scale: 0.96, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: dur(DUR.slow) })
    .fromTo('.brand-name', { autoAlpha: 0 }, { autoAlpha: 1, duration: dur(DUR.normal) }, '-=0.16')
    .fromTo('.nav-item', { autoAlpha: 0 }, { autoAlpha: 1, duration: dur(DUR.normal), stagger: 0.03 }, '-=0.12')
    .fromTo('.sidebar-footer', { autoAlpha: 0 }, { autoAlpha: 1, duration: dur(DUR.normal) }, '-=0.08')
    .fromTo('.header', { autoAlpha: 0 }, { autoAlpha: 1, duration: dur(DUR.normal) }, '-=0.12');
}

export function animateHeaderTitle(el) {
  if (!gsap || !el || reducedMotion) return;
  gsap.fromTo(
    el,
    { autoAlpha: 0 },
    {
      autoAlpha: 1,
      duration: dur(DUR.fast),
      ease: EASE_OUT,
      overwrite: 'auto',
      clearProps: 'opacity,visibility'
    }
  );
}

export function animatePageExit(contentEl) {
  if (!gsap || !contentEl || reducedMotion) return Promise.resolve();

  return new Promise((resolve) => {
    gsap.to(contentEl, {
      autoAlpha: 0,
      duration: dur(DUR.fast),
      ease: EASE_IN,
      overwrite: 'auto',
      onComplete: () => {
        gsap.set(contentEl, { clearProps: 'opacity,visibility' });
        resolve();
      }
    });
  });
}

export function animatePageBlocks(container, page, { intro = true, cached = false } = {}) {
  if (!container) return;

  pageBlockContext?.revert();
  pageBlockContext = null;

  if (cached) return;

  if (!intro || !gsap || reducedMotion) {
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
  const header = scope.querySelector('.dashboard-header');
  const blocks = scope.querySelectorAll('.stat-card, .chart-card, .info-grid .card, .dashboard > .card');
  if (header) reveal(header, { y: 4, duration: DUR.normal, stagger: 0 });
  if (blocks.length) reveal(blocks, { y: 6, duration: DUR.normal, stagger: 0.02 });
}

export function animateChatLayout(root) {
  const container = root.querySelector('.chat-container') || root;
  if (!container) return;
  reveal(container.querySelectorAll('.chat-sidebar, .chat-main'), { y: 5, duration: DUR.normal, stagger: 0.03 });
}

export function animateGenericBlocks(root) {
  const page = root.querySelector('.config-page, .api-container, .dashboard');
  if (page) {
    reveal(page, { y: 4, duration: DUR.normal, stagger: 0 });
    return;
  }
  reveal(root.querySelectorAll('.card, .dashboard-header'), { y: 5, duration: DUR.normal, stagger: 0.02 });
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
    gsap.fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: dur(DUR.normal), ease: EASE_OUT, overwrite: 'auto' });
  } else {
    gsap.to(overlay, {
      autoAlpha: 0,
      duration: dur(DUR.fast),
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
    gsap.fromTo(sidebar, { x: '-100%' }, { x: '0%', duration: dur(DUR.slow), ease: EASE_OUT, overwrite: 'auto' });
  } else {
    gsap.to(sidebar, { x: '-100%', duration: dur(DUR.normal), ease: EASE_IN, overwrite: 'auto' });
  }
  animateOverlay(open);
}

export function animateToastIn(toast) {
  if (!gsap || !toast || reducedMotion) return null;
  gsap.fromTo(
    toast,
    { x: 12, autoAlpha: 0 },
    {
      x: 0,
      autoAlpha: 1,
      duration: dur(DUR.normal),
      ease: EASE_OUT,
      overwrite: 'auto',
      clearProps: 'transform,opacity,visibility'
    }
  );
  return () =>
    new Promise((resolve) => {
      gsap.to(toast, {
        x: 8,
        autoAlpha: 0,
        duration: dur(DUR.fast),
        ease: EASE_IN,
        overwrite: 'auto',
        onComplete: resolve
      });
    });
}

export function animateChatMessage(el) {
  if (!gsap || !el || reducedMotion) return;
  el.classList.remove('message-enter');
  gsap.fromTo(
    el,
    { y: 4, autoAlpha: 0 },
    {
      y: 0,
      autoAlpha: 1,
      duration: dur(DUR.fast),
      ease: EASE_OUT,
      clearProps: 'transform,opacity,visibility',
      overwrite: 'auto'
    }
  );
}

export function animateChatMainCrossfade(el, onSwap) {
  if (!gsap || !el || reducedMotion) {
    onSwap?.();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    gsap.to(el, {
      autoAlpha: 0,
      duration: dur(DUR.fast),
      ease: EASE_IN,
      overwrite: 'auto',
      onComplete: () => {
        onSwap?.();
        gsap.fromTo(
          el,
          { autoAlpha: 0 },
          {
            autoAlpha: 1,
            duration: dur(DUR.normal),
            ease: EASE_OUT,
            clearProps: 'opacity,visibility',
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
  reveal(items, { y: 0, duration: DUR.fast, stagger: 0.02 });
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
        duration: dur(DUR.normal),
        ease: EASE_OUT,
        clearProps: 'height,opacity,visibility',
        overwrite: 'auto'
      }
    );
  } else {
    gsap.to(content, {
      height: 0,
      autoAlpha: 0,
      duration: dur(DUR.fast),
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
    { autoAlpha: 0.72 },
    { autoAlpha: 1, duration: dur(DUR.fast), ease: EASE_OUT, overwrite: 'auto', clearProps: 'opacity' }
  );
}

export function animateStreamStatus(el, active) {
  if (!gsap || !el || reducedMotion || !active) return;
  gsap.fromTo(
    el,
    { autoAlpha: 0.75 },
    { autoAlpha: 1, duration: dur(DUR.fast), ease: EASE_OUT, overwrite: 'auto' }
  );
}

export function animateAISettingsPanel(panel, expanded) {
  if (!gsap || !panel || reducedMotion || !isMobileViewport() || !expanded) return;
  const content = panel.querySelector('.ai-settings-content');
  if (content) reveal([content], { y: 0, duration: DUR.fast, stagger: 0 });
}

export function animateChatSendPulse(btn) {
  if (!gsap || !btn || reducedMotion) return;
  gsap.fromTo(
    btn,
    { scale: 1 },
    { scale: 0.94, duration: dur(0.06), yoyo: true, repeat: 1, ease: 'power1.inOut', overwrite: 'auto' }
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
    { autoAlpha: 0.5 },
    { autoAlpha: 1, duration: dur(DUR.normal), ease: EASE_OUT, overwrite: 'auto', clearProps: 'opacity' }
  );
}
