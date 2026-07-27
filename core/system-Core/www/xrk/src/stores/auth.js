import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

const KEY = 'apiKey';

export const useAuthStore = defineStore('auth', () => {
  const apiKey = ref(localStorage.getItem(KEY) || '');
  const dark = ref(document.documentElement.classList.contains('dark'));

  const hasKey = computed(() => Boolean(apiKey.value?.trim()));

  function setApiKey(value) {
    apiKey.value = String(value || '');
    if (apiKey.value) localStorage.setItem(KEY, apiKey.value);
    else localStorage.removeItem(KEY);
  }

  function toggleDark() {
    dark.value = !dark.value;
    document.documentElement.classList.toggle('dark', dark.value);
    localStorage.setItem('xrk-theme', dark.value ? 'dark' : 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark.value ? '#14110f' : '#ffd24a');
  }

  function initTheme() {
    const saved = localStorage.getItem('xrk-theme');
    dark.value = saved === 'dark';
    document.documentElement.classList.toggle('dark', dark.value);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark.value ? '#14110f' : '#ffd24a');
  }

  return { apiKey, dark, hasKey, setApiKey, toggleDark, initTheme };
});
