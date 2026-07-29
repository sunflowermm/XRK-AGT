<script setup>
/**
 * 字符串数组编辑：芯片 + 逐项添加（替代逗号分隔输入）
 */
import { computed } from 'vue';
import { NDynamicTags } from 'naive-ui';

const props = defineProps({
  modelValue: { type: [Array, String], default: () => [] },
  size: { type: String, default: 'small' },
  placeholder: { type: String, default: '输入后回车添加' },
});

const emit = defineEmits(['update:modelValue']);

const tags = computed({
  get() {
    if (Array.isArray(props.modelValue)) {
      return props.modelValue.map((x) => String(x ?? '').trim()).filter(Boolean);
    }
    return String(props.modelValue || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
  set(v) {
    emit('update:modelValue', Array.isArray(v) ? v : []);
  },
});
</script>

<template>
  <div class="tags-editor">
    <div class="tags-box">
      <NDynamicTags v-model:value="tags" :size="size" />
    </div>
    <p class="hint">{{ placeholder }}</p>
  </div>
</template>

<style scoped>
.tags-editor {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}
.tags-box {
  min-height: 36px;
  display: flex;
  align-items: flex-start;
  width: 100%;
  box-sizing: border-box;
}
.hint {
  margin: 0;
  min-height: 1.2em;
  font-size: var(--font-xs);
  color: var(--muted);
  line-height: 1.3;
}
.tags-editor :deep(.n-dynamic-tags) {
  gap: 6px;
  flex-wrap: wrap;
}
.tags-editor :deep(.n-tag) {
  border: 1.5px solid var(--ink);
  font-weight: 700;
  max-width: 100%;
}
.tags-editor :deep(.n-button) {
  border: 1.5px solid var(--ink);
  box-shadow: var(--shadow);
  font-weight: 700;
}
</style>
