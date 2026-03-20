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
 * 创建元素
 * @param {string} tag - 标签名
 * @param {Object} attrs - 属性对象
 * @param {string|Element|Array} children - 子元素
 * @returns {Element} 创建的元素
 */
// 预留 createElement 占位（目前未在前端使用，如需封装统一创建逻辑可在此实现）
export function createElement(tag, attrs = {}, children = null) {
  const el = document.createElement(tag);
  if (attrs && typeof attrs === 'object') {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') {
        el.className = value;
      } else {
        el.setAttribute(key, value);
      }
    }
  }
  if (typeof children === 'string') {
    el.textContent = children;
  }
  return el;
}

/**
 * 添加事件监听器（支持事件委托）
 * @param {Element} element - 目标元素
 * @param {string} event - 事件名称
 * @param {string|Function} selectorOrHandler - 选择器或处理函数
 * @param {Function} handler - 处理函数（使用委托时）
 */
export function on(element, event, selectorOrHandler, handler) {
  if (typeof selectorOrHandler === 'function') {
    element.addEventListener(event, selectorOrHandler);
  } else if (handler) {
    element.addEventListener(event, (e) => {
      const target = e.target.closest(selectorOrHandler);
      if (target && element.contains(target)) {
        handler.call(target, e);
      }
    });
  }
}

export function off(element, event, handler) {
  element.removeEventListener(event, handler);
}

/**
 * 添加 CSS 类
 * @param {Element} element - 目标元素
 * @param {...string} classes - 类名
 */
export function addClass(element, ...classes) {
  element.classList.add(...classes);
}

export function removeClass(element, ...classes) {
  element.classList.remove(...classes);
}

export function toggleClass(element, className, force) {
  return element.classList.toggle(className, force);
}

export function hasClass(element, className) {
  return element.classList.contains(className);
}

/**
 * 设置元素属性
 * @param {Element} element - 目标元素
 * @param {string|Object} attrOrAttrs - 属性名或属性对象
 * @param {any} value - 属性值（当第二个参数是字符串时）
 */
export function setAttr(element, attrOrAttrs, value) {
  if (typeof attrOrAttrs === 'object') {
    for (const [key, val] of Object.entries(attrOrAttrs)) {
      element.setAttribute(key, val);
    }
  } else {
    element.setAttribute(attrOrAttrs, value);
  }
}

export function getAttr(element, attr) {
  return element.getAttribute(attr);
}

export function removeAttr(element, ...attrs) {
  attrs.forEach(attr => element.removeAttribute(attr));
}

/**
 * 显示元素
 * @param {Element} element - 目标元素
 * @param {string} display - display 值
 */
export function show(element, display = 'block') {
  element.style.display = display;
}

export function hide(element) {
  element.style.display = 'none';
}

export function toggle(element, display = 'block') {
  if (element.style.display === 'none' || !element.style.display) {
    show(element, display);
  } else {
    hide(element);
  }
}

/**
 * 滚动到元素
 * @param {Element} element - 目标元素
 * @param {Object} options - 滚动选项
 */
export function scrollTo(element, options = { behavior: 'smooth', block: 'start' }) {
  element.scrollIntoView(options);
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
 * 检查元素是否在视口中
 * @param {Element} element - 目标元素
 * @returns {boolean} 是否在视口中
 */
export function isInViewport(element) {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

/**
 * 获取元素的偏移位置
 * @param {Element} element - 目标元素
 * @returns {Object} {top, left}
 */
export function getOffset(element) {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top + window.pageYOffset,
    left: rect.left + window.pageXOffset
  };
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
 * - 使用 visualViewport（支持的浏览器更准确），否则回退到 innerHeight
 */
let _viewportHeightBound = false;
export function bindViewportHeightVar(varName = '--vh') {
  if (_viewportHeightBound) return;
  _viewportHeightBound = true;

  const apply = () => {
    const height =
      window.visualViewport?.height ??
      window.innerHeight ??
      document.documentElement.clientHeight;
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
