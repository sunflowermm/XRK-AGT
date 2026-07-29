import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

const KEY = 'apiKey';

export const useAuthStore = defineStore('auth', () => {
  const apiKey = ref(localStorage.getItem(KEY) || '');
  const dark = ref(document.documentElement.classList.contains('dark'));
  /** @type {import('vue').Ref<'unknown'|'ok'|'unauthorized'>} */
  const serverAuth = ref('unknown');

  const hasKey = computed(() => Boolean(apiKey.value?.trim()));

  const isLocalHost = computed(() => {
    const h = String(window.location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '::1' || /^127\./.test(h);
  });

  const authBadge = computed(() => {
    if (serverAuth.value === 'unauthorized') {
      return {
        type: 'error',
        text: '鉴权失败',
        title: '接口返回 401，请填写正确的 API Key（公网访问必须带 Key）',
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
      if (!isLocalHost.value) {
        return {
          type: 'error',
          text: '须填 Key',
          title: '公网访问必须填写 API Key；若接口仍通，服务端鉴权可能未生效，请升级并重启 AGT',
        };
      }
      return {
        type: 'success',
        text: '已连通',
        title: '本机打开且接口可用，通常不用填 Key',
      };
    }
    return {
      type: 'warning',
      text: isLocalHost.value ? '未填 Key' : '须填 Key',
      title: isLocalHost.value
        ? '还没填 API Key，也还没确认接口是否放行'
        : '公网访问请填写 API Key（见服务端 api_key.json）',
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
