<script setup>
import { computed, ref } from 'vue';
import {
  parseToolResultPayload,
  summarizeToolResultText,
  toolArgsText,
  toolName,
  toolResultPreview,
} from '@/chat/tools';

const props = defineProps({
  tools: { type: Array, default: () => [] },
});

const openMap = ref({});

function isOpen(i) {
  return Boolean(openMap.value[i]);
}
function toggle(i) {
  openMap.value = { ...openMap.value, [i]: !openMap.value[i] };
}

const items = computed(() =>
  (props.tools || []).map((tool) => {
    const name = toolName(tool);
    const args = toolArgsText(tool);
    const payload = parseToolResultPayload(tool.result ?? tool.content ?? '');
    const preview = toolResultPreview(name, payload ?? tool.result);
    const result = summarizeToolResultText(payload ?? tool.result ?? tool.content ?? '');
    return { name, args, preview, result };
  }),
);
</script>

<template>
  <div class="tool-blocks">
    <div v-for="(item, i) in items" :key="i" class="tool-block">
      <button
        type="button"
        class="tool-head"
        :aria-expanded="isOpen(i) ? 'true' : 'false'"
        @click="toggle(i)"
      >
        <span class="tool-ico">🔧</span>
        <span class="tool-title">{{ item.name }}</span>
        <span class="tool-toggle">{{ isOpen(i) ? '收起' : '展开' }}</span>
      </button>
      <div v-show="isOpen(i)" class="tool-body">
        <div class="tool-sec">
          <span class="lbl">参数</span>
          <pre>{{ item.args }}</pre>
        </div>
        <div v-if="item.preview?.type === 'image'" class="tool-sec">
          <img class="tool-shot" :src="item.preview.src" :alt="item.preview.alt" loading="lazy" />
        </div>
        <div class="tool-sec">
          <span class="lbl">结果</span>
          <pre>{{ item.result }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-blocks {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}
.tool-block {
  border: 1.5px solid var(--ink);
  border-radius: 6px;
  background: color-mix(in srgb, var(--cyan) 12%, var(--card));
  overflow: hidden;
}
.tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  padding: 6px 8px;
  cursor: pointer;
  text-align: left;
}
.tool-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-toggle {
  font-size: var(--font-xs);
  opacity: 0.7;
}
.tool-body {
  border-top: 1px dashed color-mix(in srgb, var(--ink) 35%, transparent);
  padding: 6px 8px 8px;
}
.tool-sec {
  margin-bottom: 6px;
}
.tool-sec:last-child {
  margin-bottom: 0;
}
.lbl {
  display: block;
  font-size: var(--font-xs);
  font-weight: 800;
  opacity: 0.55;
  margin-bottom: 2px;
}
pre {
  margin: 0;
  padding: 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ink) 6%, transparent);
  font-family: var(--mono);
  font-size: var(--font-xs);
  line-height: 1.35;
  overflow: auto;
  max-height: 220px;
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-shot {
  max-width: 100%;
  max-height: 200px;
  border-radius: 4px;
  border: 1px solid var(--ink);
}
</style>
