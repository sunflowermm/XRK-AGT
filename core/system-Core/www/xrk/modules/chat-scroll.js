let _persistTimer = null;

function storageKey(mode) {
  return `chatScroll_${mode || 'event'}`;
}

export function readStoredChatScroll(mode) {
  try {
    const raw = localStorage.getItem(storageKey(mode));
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function clearStoredChatScroll(mode) {
  try {
    localStorage.removeItem(storageKey(mode));
  } catch {}
}

export function persistChatScroll(mode, top, { flush = false } = {}) {
  const n = Number(top);
  if (!Number.isFinite(n) || n < 0) return;

  const write = () => {
    try {
      localStorage.setItem(storageKey(mode), String(Math.round(n)));
    } catch {}
  };

  if (flush) {
    if (_persistTimer) {
      clearTimeout(_persistTimer);
      _persistTimer = null;
    }
    write();
    return;
  }

  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    write();
  }, 320);
}

/** 恢复滚动；savedTop 为 null 时滚到底（首访无记录） */
export function applyChatScroll(box, savedTop) {
  if (!box) return;

  const run = () => {
    if (typeof savedTop === 'number') {
      const max = Math.max(0, box.scrollHeight - box.clientHeight);
      box.scrollTop = Math.min(savedTop, max);
    } else {
      box.scrollTop = box.scrollHeight;
    }
  };

  box.style.scrollBehavior = 'auto';
  run();
  requestAnimationFrame(() => {
    run();
    box.style.removeProperty('scroll-behavior');
  });
}
