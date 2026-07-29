import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { abortTimeout } from '@/utils/http';

const KEY = 'apiKey';

function isLocalHostname(hostname = window.location.hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127\./.test(h);
}

export const useAuthStore = defineStore('auth', () => {
  const apiKey = ref(localStorage.getItem(KEY) || '');
  const dark = ref(document.documentElement.classList.contains('dark'));
  /** @type {import('vue').Ref<'unknown'|'ok'|'unauthorized'>} */
  const serverAuth = ref('unknown');
  /**
   * 服务端是否真的在拦无 Key 请求（与「填了 Key 且业务接口 200」分开）。
   * @type {import('vue').Ref<'unknown'|'enforced'|'bypass'>}
   */
  const authEnforced = ref('unknown');

  let probeInflight = null;
  let probeAt = 0;

  const hasKey = computed(() => Boolean(apiKey.value?.trim()));
  const isLocalHost = computed(() => isLocalHostname());

  const authBadge = computed(() => {
    if (authEnforced.value === 'bypass') {
      return {
        type: 'error',
        text: '鉴权失效',
        title:
          '无 Key 也能访问 /api。公网等于裸奔：请部署含 isLoopbackAuthExempt 的修复并重启 AGT；填什么 Key 都不会被校验',
      };
    }
    if (serverAuth.value === 'unauthorized') {
      return {
        type: 'error',
        text: '鉴权失败',
        title: '接口返回 401，请填写正确的 API Key（公网访问必须带 Key）',
      };
    }
    if (hasKey.value) {
      const ok = serverAuth.value === 'ok' && authEnforced.value === 'enforced';
      if (ok) {
        return {
          type: 'success',
          text: '已鉴权',
          title: '无 Key 会被拒绝，且当前 Key 已通过校验',
        };
      }
      if (serverAuth.value === 'ok' && authEnforced.value === 'unknown') {
        return {
          type: 'warning',
          text: '已填 Key',
          title: '正在确认服务端是否真正校验 API Key…',
        };
      }
      return {
        type: 'warning',
        text: '已填 Key',
        title: '本地已保存 Key，尚未确认服务端是否接受（无 Key 请求须 401 才算鉴权生效）',
      };
    }
    if (serverAuth.value === 'ok') {
      if (!isLocalHost.value) {
        return {
          type: 'error',
          text: '须填 Key',
          title: '公网访问必须填写 API Key',
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
    authEnforced.value = 'unknown';
    probeAt = 0;
    if (apiKey.value) localStorage.setItem(KEY, apiKey.value);
    else localStorage.removeItem(KEY);
    void probeAuthEnforcement({ force: true });
  }

  function noteAuthorized() {
    serverAuth.value = 'ok';
    void probeAuthEnforcement();
  }

  function noteUnauthorized() {
    serverAuth.value = 'unauthorized';
    authEnforced.value = 'enforced';
  }

  /**
   * 故意不带 Key 打一枪：401 → 鉴权生效；200 → 旁路（公网致命）。
   * @param {{ force?: boolean }} [opts]
   */
  async function probeAuthEnforcement(opts = {}) {
    const now = Date.now();
    if (!opts.force && probeInflight) return probeInflight;
    if (!opts.force && now - probeAt < 15000 && authEnforced.value !== 'unknown') {
      return authEnforced.value;
    }

    probeInflight = (async () => {
      try {
        const res = await fetch(`${window.location.origin}/api/system/status`, {
          method: 'GET',
          // 故意不带 X-API-Key
          signal: abortTimeout(8000),
          cache: 'no-store',
        });
        if (res.status === 401) {
          authEnforced.value = 'enforced';
        } else if (res.ok) {
          authEnforced.value = 'bypass';
        }
      } catch {
        /* 网络失败不改状态 */
      } finally {
        probeAt = Date.now();
        probeInflight = null;
      }
      return authEnforced.value;
    })();

    return probeInflight;
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
    isLocalHost,
    serverAuth,
    authEnforced,
    authBadge,
    setApiKey,
    noteAuthorized,
    noteUnauthorized,
    probeAuthEnforcement,
    toggleDark,
    initTheme,
  };
});
