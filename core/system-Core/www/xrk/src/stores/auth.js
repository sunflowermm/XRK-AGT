import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { abortTimeout, unwrapSuccess } from '@/utils/http';

const KEY = 'apiKey';
const AUTH_MODE_PATH = '/api/system/auth-mode';

export const useAuthStore = defineStore('auth', () => {
  const apiKey = ref(localStorage.getItem(KEY) || '');
  const dark = ref(document.documentElement.classList.contains('dark'));
  /** @type {import('vue').Ref<'unknown'|'ok'|'unauthorized'>} */
  const serverAuth = ref('unknown');
  /** @type {import('vue').Ref<'unknown'|'enforced'|'bypass'>} */
  const authMode = ref('unknown');

  let modeInflight = null;
  /** 每次 setApiKey 递增；页面 watch 后强制重拉 */
  const keyEpoch = ref(0);

  const hasKey = computed(() => Boolean(apiKey.value?.trim()));

  const authBadge = computed(() => {
    if (authMode.value === 'bypass') {
      return {
        type: 'error',
        text: '鉴权关闭',
        title: '服务端未启用或未加载 API Key，/api 可匿名访问（公网危险）',
      };
    }
    if (serverAuth.value === 'unauthorized') {
      return {
        type: 'error',
        text: '鉴权失败',
        title: '接口返回 401，请填写正确的 API Key',
      };
    }
    if (hasKey.value && serverAuth.value === 'ok' && authMode.value === 'enforced') {
      return {
        type: 'success',
        text: '已鉴权',
        title: '服务端要求 API Key，且当前 Key 已通过业务请求校验',
      };
    }
    if (hasKey.value) {
      return {
        type: 'warning',
        text: '已填 Key',
        title:
          authMode.value === 'unknown'
            ? '已保存 Key，正在读取服务端鉴权模式…'
            : '已保存 Key，等待业务接口确认',
      };
    }
    if (authMode.value === 'enforced') {
      return {
        type: 'warning',
        text: '须填 Key',
        title: '服务端要求 API Key（见 config/server_config/api_key.json）',
      };
    }
    return {
      type: 'warning',
      text: '未填 Key',
      title: '尚未填写 API Key，也尚未确认服务端鉴权模式',
    };
  });

  function setApiKey(value) {
    apiKey.value = String(value || '');
    serverAuth.value = 'unknown';
    authMode.value = 'unknown';
    keyEpoch.value += 1;
    if (apiKey.value) localStorage.setItem(KEY, apiKey.value);
    else localStorage.removeItem(KEY);
    void refreshAuthMode({ force: true });
  }

  function noteAuthorized() {
    serverAuth.value = 'ok';
  }

  function noteUnauthorized() {
    serverAuth.value = 'unauthorized';
    authMode.value = 'enforced';
  }

  /**
   * 读公开 GET /api/system/auth-mode（免 Key）。
   * @param {{ force?: boolean }} [opts]
   */
  async function refreshAuthMode(opts = {}) {
    if (!opts.force && authMode.value !== 'unknown') return authMode.value;
    if (!opts.force && modeInflight) return modeInflight;

    modeInflight = (async () => {
      try {
        const res = await fetch(`${window.location.origin}${AUTH_MODE_PATH}`, {
          method: 'GET',
          cache: 'no-store',
          signal: abortTimeout(8000),
        });
        if (!res.ok) return authMode.value;
        const json = await res.json().catch(() => null);
        if (!json) return authMode.value;
        const body = json.success === true ? unwrapSuccess(json) : json;
        authMode.value = body?.requiresKey === true ? 'enforced' : 'bypass';
      } catch {
        /* 网络失败不改状态 */
      } finally {
        modeInflight = null;
      }
      return authMode.value;
    })();

    return modeInflight;
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
    keyEpoch,
    dark,
    hasKey,
    serverAuth,
    authMode,
    authBadge,
    setApiKey,
    noteAuthorized,
    noteUnauthorized,
    refreshAuthMode,
    toggleDark,
    initTheme,
  };
});
