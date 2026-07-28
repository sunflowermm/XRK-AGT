<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter, RouterView } from 'vue-router';
import {
  NButton,
  NInput,
  NSpace,
  NTag,
  NTooltip,
} from 'naive-ui';
import { useAuthStore } from '@/stores/auth';
import XrkIcon from '@/components/XrkIcon.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const collapsed = ref(localStorage.getItem('xrk.sidebarCollapsed') === '1');
const keyDraft = ref(auth.apiKey);

watch(
  () => auth.apiKey,
  (v) => {
    if (v !== keyDraft.value) keyDraft.value = v;
  },
);

const nav = [
  { name: 'home', label: '概览', hint: 'Home', icon: 'home', accent: 'var(--yellow)' },
  { name: 'chat', label: '对话', hint: 'Chat', icon: 'chat', accent: 'var(--pink)' },
  { name: 'config', label: '配置', hint: 'Config', icon: 'config', accent: 'var(--cyan)' },
  { name: 'api', label: 'API', hint: 'Debug', icon: 'api', accent: 'var(--green)' },
];

const pageTitle = computed(() => route.meta.title || 'XRK');

function go(name) {
  router.push({ name });
}

function saveKey() {
  const next = String(keyDraft.value || '').trim();
  // 失焦时空串不落盘，避免误清已保存的 Key
  if (!next) {
    keyDraft.value = auth.apiKey;
    return;
  }
  auth.setApiKey(next);
}

function clearKey() {
  if (!auth.hasKey) {
    keyDraft.value = '';
    return;
  }
  if (!window.confirm('确认清除已保存的 API Key？')) {
    keyDraft.value = auth.apiKey;
    return;
  }
  keyDraft.value = '';
  auth.setApiKey('');
}

function onKeyEnter() {
  if (!String(keyDraft.value || '').trim()) clearKey();
  else saveKey();
}

function toggleCollapse() {
  collapsed.value = !collapsed.value;
  try {
    localStorage.setItem('xrk.sidebarCollapsed', collapsed.value ? '1' : '0');
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <a href="#main" class="skip-link">跳到主内容</a>
  <!-- fixed：不依赖 Naive Provider 高度链，左右各自铺满视口 -->
  <div class="shell" :class="{ collapsed }">
    <aside class="sidebar brutal-card">
      <div class="brand">
        <span class="logo" aria-hidden="true">★</span>
        <div v-show="!collapsed" class="brand-text">
          <strong>XRK-AGT</strong>
        </div>
      </div>
      <nav class="nav ink-scroll" aria-label="主菜单">
        <button
          v-for="item in nav"
          :key="item.name"
          type="button"
          class="nav-link"
          :class="{ active: route.name === item.name }"
          :style="{ '--accent': item.accent }"
          :title="collapsed ? item.label : undefined"
          :aria-label="item.label"
          @click="go(item.name)"
        >
          <span class="nav-ico" aria-hidden="true">
            <XrkIcon :name="item.icon" :size="13" />
          </span>
          <span v-show="!collapsed" class="label">{{ item.label }}</span>
          <span v-show="!collapsed" class="hint">{{ item.hint }}</span>
        </button>
      </nav>
      <button type="button" class="collapse-btn" :aria-label="collapsed ? '展开侧栏' : '收起侧栏'" @click="toggleCollapse">
        <XrkIcon :name="collapsed ? 'expand' : 'collapse'" :size="14" />
        <span v-show="!collapsed">收起</span>
      </button>
    </aside>

    <div class="main-col">
      <header class="topbar brutal-card">
        <h1>{{ pageTitle }}</h1>
        <NSpace size="small" align="center" :wrap="false">
          <NInput
            v-model:value="keyDraft"
            size="small"
            type="password"
            show-password-on="click"
            placeholder="X-API-Key"
            style="width: 148px"
            title="回车保存；清空后回车可清除已存 Key"
            @keyup.enter="onKeyEnter"
            @blur="saveKey"
          />
          <NTooltip>
            <template #trigger>
              <NButton size="small" secondary class="icon-btn" :aria-label="auth.dark ? '切换浅色' : '切换深色'" @click="auth.toggleDark()">
                <XrkIcon :name="auth.dark ? 'sun' : 'moon'" :size="15" />
              </NButton>
            </template>
            {{ auth.dark ? '切换浅色' : '切换深色' }}
          </NTooltip>
          <NTag size="small" :type="auth.hasKey ? 'success' : 'error'" :bordered="true">
            <span class="key-tag">
              <XrkIcon name="key" :size="12" />
              {{ auth.hasKey ? '已鉴权' : '缺 Key' }}
            </span>
          </NTag>
        </NSpace>
      </header>

      <main id="main" class="content ink-scroll">
        <RouterView v-slot="{ Component }">
          <KeepAlive :include="['HomeView', 'ChatView', 'ConfigView', 'ApiDebugView']" :max="4">
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  position: fixed;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: stretch;
  gap: var(--gap);
  padding: var(--gap);
  box-sizing: border-box;
  overflow: hidden;
}

.sidebar {
  flex: 0 0 var(--sidebar-w);
  width: var(--sidebar-w);
  min-width: 0;
  min-height: 0;
  /* 与右侧同高：吃满 shell 交叉轴，不跟内容收缩 */
  align-self: stretch;
  display: flex;
  flex-direction: column;
  padding: 6px;
  overflow: hidden;
}
.shell.collapsed .sidebar {
  flex-basis: 48px;
  width: 48px;
}

.brand {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 8px;
  border-bottom: 2px solid var(--ink);
  margin-bottom: 6px;
}
.logo {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  background: var(--yellow);
  border: 2px solid var(--ink);
  border-radius: 6px;
  font-size: 12px;
  box-shadow: var(--shadow);
  flex-shrink: 0;
}
.brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.brand-text strong {
  font-size: 13px;
  letter-spacing: 0.02em;
  line-height: 1.2;
}

.nav {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow-x: hidden;
  overflow-y: auto;
}
.nav-link {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 22px 1fr auto;
  align-items: center;
  gap: 6px;
  border: 1.5px solid transparent;
  background: transparent;
  color: var(--ink);
  text-align: left;
  padding: 7px 6px;
  border-radius: 6px;
  font: inherit;
  font-size: var(--font-ui);
}
.shell.collapsed .nav-link {
  grid-template-columns: 1fr;
  justify-items: center;
  padding: 8px 4px;
}
.nav-ico {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1.5px solid var(--ink);
  border-radius: 6px;
  background: var(--card);
  color: var(--ink);
}
.nav-link.active {
  background: color-mix(in srgb, var(--accent) 55%, var(--card));
  border-color: var(--ink);
  box-shadow: var(--shadow);
  font-weight: 700;
}
.nav-link.active .nav-ico {
  background: var(--accent);
}
.nav-link:hover:not(.active) {
  background: color-mix(in srgb, var(--accent) 28%, transparent);
}
.hint {
  font-size: var(--font-xs);
  opacity: 0.55;
  font-family: var(--mono);
}
.collapse-btn {
  flex-shrink: 0;
  margin-top: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1.5px solid var(--ink);
  background: var(--paper-2);
  border-radius: 6px;
  padding: 6px;
  font: inherit;
  font-size: var(--font-sm);
  font-weight: 700;
  box-shadow: var(--shadow);
}
.key-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.icon-btn {
  min-width: 32px;
  padding: 0 8px;
}

.main-col {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  overflow: hidden;
}
.topbar {
  flex-shrink: 0;
  height: var(--topbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  gap: 8px;
}
.topbar h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.01em;
}
.content {
  flex: 1 1 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* block：子页面可用 height:100% 铺满；超高内容由本层滚轮滚动 */
  display: block;
  position: relative;
}
.content > :deep(*) {
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
}

@media (max-width: 800px) {
  .shell {
    flex-direction: column;
    padding:
      max(var(--gap), env(safe-area-inset-top))
      max(var(--gap), env(safe-area-inset-right))
      max(var(--gap), env(safe-area-inset-bottom))
      max(var(--gap), env(safe-area-inset-left));
  }
  .sidebar,
  .shell.collapsed .sidebar {
    flex: 0 0 auto;
    width: 100%;
    flex-direction: row;
    align-items: center;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 4px;
    padding: 4px;
  }
  .brand {
    border-bottom: none;
    margin-bottom: 0;
    padding: 2px 8px 2px 2px;
    border-right: 2px solid var(--ink);
    margin-right: 2px;
  }
  .nav {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 4px;
    flex: 1;
  }
  .nav-link {
    grid-template-columns: auto auto;
    padding: 6px 8px;
    white-space: nowrap;
  }
  .nav-link .hint {
    display: none;
  }
  .shell.collapsed .nav-link {
    grid-template-columns: auto;
  }
  .collapse-btn {
    display: none;
  }
  .topbar {
    padding: 0 8px;
    gap: 6px;
  }
  .topbar h1 {
    font-size: 13px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .topbar :deep(.n-input) {
    width: 112px !important;
  }
}
@media (max-width: 480px) {
  .brand-text strong {
    font-size: 11px;
  }
  .nav-link .label {
    font-size: var(--font-xs);
  }
  .topbar :deep(.n-space) {
    gap: 4px !important;
  }
}
</style>
