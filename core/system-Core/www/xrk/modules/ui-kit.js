/**
 * UI 图标工具（避免在 UI 上直接使用 emoji：使用 SVG 更可控）
 */

export function pokeHandIconSVG() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M7 11l5-5 3 3-5 5"></path>
      <path d="M9 13l-4 4"></path>
      <path d="M16 3l5 5"></path>
      <path d="M2 22l6-6"></path>
    </svg>
  `;
}

export function paperclipIconSVG() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.19 9.19a1.5 1.5 0 1 1-2.12-2.12l8.13-8.13"></path>
    </svg>
  `;
}

export function wrenchIconSVG() {
  // 通用扳手：用于“工具卡片”标题，不依赖任何 emoji 作为 UI 图标
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:16px;height:16px">
      <path d="M22 19a2 2 0 0 1-2 2h-2l-6-6 3-3 6 6v2z"></path>
      <path d="M14 7l3-3 2 2-3 3-2-2z"></path>
      <path d="M2 22l6-6"></path>
    </svg>
  `;
}

export function filePreviewIconSVG(mimeType = '') {
  const type = String(mimeType ?? '').toLowerCase();

  if (type.startsWith('video/')) {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--info)">
        <rect x="3" y="6" width="14" height="12" rx="2"></rect>
        <path d="M7 10l6 3-6 3z" fill="currentColor" stroke="none"></path>
        <path d="M17 9l4-2v10l-4-2z" fill="currentColor" stroke="none" opacity="0.75"></path>
      </svg>
    `;
  }

  if (type.startsWith('audio/')) {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--primary)">
        <path d="M11 5l-5 2v10l5 2z"></path>
        <path d="M19 7a6 6 0 0 1 0 10"></path>
        <path d="M17 9a3.5 3.5 0 0 1 0 6"></path>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--primary)">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <path d="M14 2v6h6"></path>
      <path d="M8 13h8"></path>
      <path d="M8 17h6"></path>
    </svg>
  `;
}

export function toastIconSVG(type = 'info') {
  const t = String(type ?? '').toLowerCase();

  // 使用 stroke/currentColor，让 toast 的主题色由 CSS 控制
  if (t === 'success') {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 6L9 17l-5-5"></path>
      </svg>
    `;
  }

  if (t === 'error') {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 6L6 18"></path>
        <path d="M6 6l12 12"></path>
      </svg>
    `;
  }

  if (t === 'warning') {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <path d="M12 9v4"></path>
        <path d="M12 17h.01"></path>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 16v-4"></path>
      <path d="M12 8h.01"></path>
    </svg>
  `;
}

/**
 * 统一将“情绪 key”映射到 SVG 图标。
 * 说明：兼容旧版传入 emoji 字符串（如 '😊'、'🤔'）。
 */
export function normalizeEmotionKey(emotion) {
  const k = String(emotion ?? '').trim().toLowerCase();

  const emojiMap = {
    '😊': 'happy',
    '😢': 'sad',
    '😠': 'angry',
    '😮': 'surprise',
    '❤️': 'love',
    '😎': 'cool',
    '😴': 'sleep',
    '🤔': 'think',
    '💬': 'message',
  };

  return emojiMap[k] || (k || 'happy');
}

export function emotionIconSVG(emotion) {
  const key = normalizeEmotionKey(emotion);
  const colorMap = {
    happy: 'var(--info)',
    sad: 'var(--danger)',
    angry: 'var(--warning)',
    surprise: 'var(--info)',
    love: '#ec4899',
    cool: '#7c3aed',
    sleep: 'var(--text-muted)',
    think: 'var(--primary)',
    message: 'var(--primary)',
  };

  const color = colorMap[key] || 'var(--primary)';

  switch (key) {
    case 'happy':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:${color}">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
          <path d="M9 9h.01"></path>
          <path d="M15 9h.01"></path>
        </svg>
      `;
    case 'sad':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:${color}">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M8 15c1.5-1.5 6.5-1.5 8 0"></path>
          <path d="M9 9h.01"></path>
          <path d="M15 9h.01"></path>
        </svg>
      `;
    case 'angry':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:${color}">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M8.5 10.5l-2 2"></path>
          <path d="M15.5 10.5l2 2"></path>
          <path d="M8 16h8"></path>
        </svg>
      `;
    case 'surprise':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:${color}">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M10 9h.01"></path>
          <path d="M14 9h.01"></path>
          <path d="M10 15a2 2 0 0 0 4 0"></path>
        </svg>
      `;
    case 'love':
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" style="color:${color}">
          <path fill="currentColor" d="M12 21s-7-4.35-7-11a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 6.65-7 11-7 11z"></path>
        </svg>
      `;
    case 'cool':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:${color}">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M7 11c2-3 8-3 10 0"></path>
          <path d="M9 15l1-2 4 0 1 2"></path>
          <path d="M4 9l1 1"></path>
          <path d="M20 9l-1 1"></path>
        </svg>
      `;
    case 'sleep':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:${color}">
          <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"></path>
          <path d="M8 19h8"></path>
        </svg>
      `;
    case 'message':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:${color}">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          <path d="M8 10h8"></path>
          <path d="M8 14h5"></path>
        </svg>
      `;
    case 'think':
    default:
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:${color}">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="M21 21l-4.35-4.35"></path>
          <path d="M8.5 6.5l.5 1"></path>
          <path d="M13.2 5.7l-.2 1.1"></path>
        </svg>
      `;
  }
}

