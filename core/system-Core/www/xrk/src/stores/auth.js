import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

const KEY = 'apiKey';

export const useAuthStore = defineStore('auth', () => {
  const apiKey = ref(localStorage.getItem(KEY) || '');
  const dark = ref(document.documentElement.classList.contains('dark'));
  /** @type {import('vue').Ref<'unknown'|'ok'|'unauthorized'>} */
  const serverAuth = ref('unknown');

  const hasKey = computed(() => Boolean(apiKey.value?.trim()));

  const authBadge = computed(() => {
    if (serverAuth.value === 'unauthorized') return { type: 'error', text: '鉴权失败' };
    if (hasKey.value) {
      return {
        type: serverAuth.value === 'ok' ? 'success' : 'warning',
        text: serverAuth.value === 'ok' ? '已鉴权' : '已填 Key',
      };
    }
    if (serverAuth.value === 'ok') return { type: 'info', text: '未要求 Key' };
    return { type: 'warning', text: '未填 Key' };
  });

  function setApiKey(value) {
    apiKey.value = String(value || '');
    serverAuth.value = 'unknown';
    if (apiKey.value) localStorage.setItem(KEY, apiKey.value);
    else localStorage.removeItem(KEY);
  }

  function noteAuthorized() {
    serverAuth.value = 'ok';
  }

  function noteUnauthorized() {
    serverAuth.value = 'unauthorized';
  }

  function applyTheme(isDark) {
    dark.value = isDark;
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('xrk-theme', isDark ? 'dark' : 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#14110f' : '#ffd24a');
  }

  function toggleDark() {
    applyTheme(!dark.value);
  }

  function initTheme() {
    applyTheme(localStorage.getItem('xrk-theme') === 'dark');
  }

  return {
    apiKey,
    dark,
    hasKey,
    serverAuth,
    authBadge,
    setApiKey,
    noteAuthorized,
    noteUnauthorized,
    toggleDark,
    initTheme,
  };
});
