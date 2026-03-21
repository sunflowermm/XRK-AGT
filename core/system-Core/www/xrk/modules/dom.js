/**
 * DOM 操作辅助模块
 * 提供简化的 DOM 查询和操作函数
 */

/**
 * 查询单个元素
 * @param {string} selector - CSS 选择器
 * @param {Element|Document} context - 上下文元素
 * @returns {Element|null} 查询到的元素
 */
export function $(selector, context = document) {
  return context.querySelector(selector);
}

/**
 * 查询多个元素
 * @param {string} selector - CSS 选择器
 * @param {Element|Document} context - 上下文元素
 * @returns {NodeList} 查询到的元素列表
 */
export function $$(selector, context = document) {
  return context.querySelectorAll(selector);
}

/**
 * 添加 CSS 类
 * @param {Element} element - 目标元素
 * @param {...string} classes - 类名
 */
function addClass(element, ...classes) {
  element.classList.add(...classes);
}

/**
 * 滚动到底部
 * @param {Element} element - 目标元素
 * @param {boolean} smooth - 是否平滑滚动
 */
export function scrollToBottom(element, smooth = true) {
  if (smooth) {
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  } else {
    element.scrollTop = element.scrollHeight;
  }
}

/**
 * 初始化懒加载
 * @param {string} selector - 图片选择器
 * @param {Object} options - IntersectionObserver 选项
 */
export function initLazyLoad(selector = 'img[data-src]', options = { rootMargin: '50px' }) {
  const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
          addClass(img, 'loaded');
          observer.unobserve(img);
        }
      }
    });
  }, options);

  const images = $$(selector);
  images.forEach(img => imageObserver.observe(img));

  return imageObserver;
}

/**
 * 统一 UI 加载态（data-updating）切换
 * @param {Element|null|undefined} el
 */
export function setUpdating(el) {
  if (!el) return;
  el.setAttribute('data-updating', 'true');
}

export function clearUpdating(el) {
  if (!el) return;
  requestAnimationFrame(() => el.removeAttribute('data-updating'));
}

/**
 * 绑定移动端“真实可视高度”到 CSS 变量 `--vh`。
 * - 解决移动端软键盘/地址栏变化导致的 `100vh` 跳动问题
 * - 使用 visualViewport.height + offsetTop 计算实际可见高度；否则回退到 innerHeight
 */
let _viewportHeightBound = false;
export function bindViewportHeightVar(varName = '--vh') {
  if (_viewportHeightBound) return;
  _viewportHeightBound = true;

  const apply = () => {
    const viewport = window.visualViewport;
    const height = viewport
      ? Math.max(0, (viewport.height ?? 0) + (viewport.offsetTop ?? 0))
      : (window.innerHeight ?? document.documentElement.clientHeight);
    document.documentElement.style.setProperty(varName, `${height}px`);
  };

  // 先立即设置一次，减少首屏跳动
  try {
    apply();
  } catch {}

  // visualViewport resize 在软键盘弹出时更敏感
  try {
    window.visualViewport?.addEventListener?.('resize', apply);
  } catch {}

  window.addEventListener('resize', apply, { passive: true });
}
