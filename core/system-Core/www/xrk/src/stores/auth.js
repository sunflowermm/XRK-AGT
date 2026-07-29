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
    if (serverAuth.value === 'unauthorized') {
      return {
        type: 'error',
        text: '鉴权失败',
        title: '接口返回 401，请核对控制台填写的 API Key',
      };
    }
    if (hasKey.value) {
      const ok = serverAuth.value === 'ok';
      return {
        type: ok ? 'success' : 'warning',
        text: ok ? '已鉴权' : '已填 Key',
        title: ok
          ? '已携带 API Key 且接口校验通过'
          : '本地已保存 Key，尚未确认服务端是否接受',
      };
    }
    if (serverAuth.value === 'ok') {
      return {
        type: 'info',
        text: '本机免填',
        title: '当前请求已成功。本机 127.0.0.1 默认免 Key；外网访问仍需填写',
      };
    }
    return {
      type: 'warning',
      text: '未填 Key',
      title: '尚未填写 API Key；外网或强制鉴权场景下接口可能 401',
    };
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
