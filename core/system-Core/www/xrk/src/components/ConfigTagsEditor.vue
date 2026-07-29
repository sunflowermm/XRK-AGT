<script setup>
/**
 * 字符串数组：与 NInput 同高的芯片条，回车添加
 */
import { computed, nextTick, ref } from 'vue';
import { NTag } from 'naive-ui';

const props = defineProps({
  modelValue: { type: [Array, String], default: () => [] },
  placeholder: { type: String, default: '输入后回车添加' },
});

const emit = defineEmits(['update:modelValue']);
const draft = ref('');
const inputEl = ref(null);

const tags = computed(() => {
  if (Array.isArray(props.modelValue)) {
    return props.modelValue.map((x) => String(x ?? '').trim()).filter(Boolean);
  }
  return String(props.modelValue || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
});

function commit(next) {
  emit('update:modelValue', next);
}

function addDraft() {
  const t = draft.value.trim();
  if (!t) return;
  if (tags.value.includes(t)) {
    draft.value = '';
    return;
  }
  commit([...tags.value, t]);
  draft.value = '';
}

function removeAt(i) {
  commit(tags.value.filter((_, idx) => idx !== i));
}

function onKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    addDraft();
    return;
  }
  if (e.key === 'Backspace' && !draft.value && tags.value.length) {
    e.preventDefault();
    removeAt(tags.value.length - 1);
  }
}

async function focusInput() {
  await nextTick();
  inputEl.value?.focus();
}
</script>

<template>
  <div
    class="tags-bar"
    role="group"
    :aria-label="placeholder"
    @click="focusInput"
  >
    <NTag
      v-for="(t, i) in tags"
      :key="`${t}-${i}`"
      size="small"
      closable
      class="tags-chip"
      @close="removeAt(i)"
    >
      {{ t }}
    </NTag>
    <input
      ref="inputEl"
      v-model="draft"
      class="tags-input"
      type="text"
      :placeholder="tags.length ? '' : placeholder"
      @keydown="onKeydown"
      @blur="addDraft"
    />
  </div>
</template>

<style scoped>
.tags-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-height: 28px;
  max-height: 72px;
  overflow-y: auto;
  padding: 2px 8px;
  box-sizing: border-box;
  border: 1.5px solid var(--ink);
  border-radius: 3px;
  background: var(--card);
  cursor: text;
}
.tags-bar:focus-within {
  border-color: var(--pink);
}
.tags-chip {
  border: 1.5px solid var(--ink) !important;
  font-weight: 700;
  max-width: 100%;
  height: 22px !important;
}
.tags-input {
  flex: 1 1 72px;
  min-width: 72px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: var(--font-sm);
  line-height: 22px;
}
.tags-input::placeholder {
  color: var(--muted);
  opacity: 0.85;
}
</style>
