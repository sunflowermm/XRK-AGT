/**
 * 自 OpenClaw 移植：web-fetch-visibility.ts（隐藏元素剥离 + 零宽字符）
 */
const HIDDEN_STYLE_PATTERNS = [
  ['display', /^\s*none\s*$/i],
  ['visibility', /^\s*hidden\s*$/i],
  ['opacity', /^\s*0\s*$/],
  ['font-size', /^\s*0(px|em|rem|pt|%)?\s*$/i],
  ['text-indent', /^\s*-\d{4,}px\s*$/],
  ['color', /^\s*transparent\s*$/i],
  ['color', /^\s*rgba\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)\s*$/i],
  ['color', /^\s*hsla\s*\(\s*[\d.]+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*0(?:\.0+)?\s*\)\s*$/i]
];

const HIDDEN_CLASS_NAMES = new Set([
  'sr-only',
  'visually-hidden',
  'd-none',
  'hidden',
  'invisible',
  'screen-reader-only',
  'offscreen'
]);

function hasHiddenClass(className) {
  const classes = className.toLowerCase().split(/\s+/);
  return classes.some((cls) => HIDDEN_CLASS_NAMES.has(cls));
}

function isStyleHidden(style) {
  for (const [prop, pattern] of HIDDEN_STYLE_PATTERNS) {
    const escapedProp = prop.replace(/-/g, '\\-');
    const match = style.match(new RegExp(`(?:^|;)\\s*${escapedProp}\\s*:\\s*([^;]+)`, 'i'));
    if (match && pattern.test(match[1])) return true;
  }

  const clipPath = style.match(/(?:^|;)\s*clip-path\s*:\s*([^;]+)/i);
  if (clipPath && !/^\s*none\s*$/i.test(clipPath[1])) {
    if (/inset\s*\(\s*(?:0*\.\d+|[1-9]\d*(?:\.\d+)?)%/i.test(clipPath[1])) return true;
  }

  const transform = style.match(/(?:^|;)\s*transform\s*:\s*([^;]+)/i);
  if (transform) {
    if (/scale\s*\(\s*0\s*\)/i.test(transform[1])) return true;
    if (/translateX\s*\(\s*-\d{4,}px\s*\)/i.test(transform[1])) return true;
    if (/translateY\s*\(\s*-\d{4,}px\s*\)/i.test(transform[1])) return true;
  }

  const width = style.match(/(?:^|;)\s*width\s*:\s*([^;]+)/i);
  const height = style.match(/(?:^|;)\s*height\s*:\s*([^;]+)/i);
  const overflow = style.match(/(?:^|;)\s*overflow\s*:\s*([^;]+)/i);
  if (
    width &&
    /^\s*0(px)?\s*$/i.test(width[1]) &&
    height &&
    /^\s*0(px)?\s*$/i.test(height[1]) &&
    overflow &&
    /^\s*hidden\s*$/i.test(overflow[1])
  ) {
    return true;
  }

  const left = style.match(/(?:^|;)\s*left\s*:\s*([^;]+)/i);
  const top = style.match(/(?:^|;)\s*top\s*:\s*([^;]+)/i);
  if (left && /^\s*-\d{4,}px\s*$/i.test(left[1])) return true;
  if (top && /^\s*-\d{4,}px\s*$/i.test(top[1])) return true;

  return false;
}

function shouldRemoveElement(element) {
  const tagName = element.tagName.toLowerCase();

  if (['meta', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed'].includes(tagName)) {
    return true;
  }

  if (tagName === 'input' && element.getAttribute('type')?.toLowerCase() === 'hidden') {
    return true;
  }

  if (element.getAttribute('aria-hidden') === 'true') return true;
  if (element.hasAttribute('hidden')) return true;

  const className = element.getAttribute('class') ?? '';
  if (hasHiddenClass(className)) return true;

  const style = element.getAttribute('style') ?? '';
  if (style && isStyleHidden(style)) return true;

  return false;
}

export async function sanitizeHtml(html) {
  let sanitized = html.replace(/<!--[\s\S]*?-->/g, '');

  let document;
  try {
    const { parseHTML } = await import('linkedom');
    ({ document } = parseHTML(sanitized));
  } catch {
    return sanitized;
  }

  const all = Array.from(document.querySelectorAll('*'));
  for (let i = all.length - 1; i >= 0; i--) {
    const el = all[i];
    if (shouldRemoveElement(el)) {
      el.parentNode?.removeChild(el);
    }
  }

  return document.toString();
}

const INVISIBLE_UNICODE_RE =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF\u{E0000}-\u{E007F}]/gu;

export function stripInvisibleUnicode(text) {
  return text.replace(INVISIBLE_UNICODE_RE, '');
}
