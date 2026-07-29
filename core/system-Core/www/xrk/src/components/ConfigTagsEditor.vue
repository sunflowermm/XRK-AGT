<script setup>
/**
 * 字符串数组：芯片列表 + 输入框旁「添加」按钮（手机可点，不必靠回车）
 */
import { computed, ref } from 'vue';
import { NButton, NInput, NTag } from 'naive-ui';
import XrkIcon from '@/components/XrkIcon.vue';

const props = defineProps({
  modelValue: { type: [Array, String], default: () => [] },
  placeholder: { type: String, default: '输入内容' },
});

const emit = defineEmits(['update:modelValue']);
const draft = ref('');

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
  if (!tags.value.includes(t)) commit([...tags.value, t]);
  draft.value = '';
}

function removeAt(i) {
  commit(tags.value.filter((_, idx) => idx !== i));
}

function onKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    addDraft();
  }
}
</script>

<template>
  <div class="tags-ed">
    <div v-if="tags.length" class="tags-list" role="list">
      <NTag
        v-for="(t, i) in tags"
        :key="`${t}-${i}`"
        size="small"
        closable
        class="tags-chip"
        role="listitem"
        @close="removeAt(i)"
      >
        {{ t }}
      </NTag>
    </div>
    <p v-else class="tags-empty">暂无项，在下方填写后点添加</p>

    <div class="tags-add">
      <NInput
        v-model:value="draft"
        size="small"
        class="tags-add-input"
        :placeholder="placeholder"
        clearable
        @keydown="onKeydown"
      />
      <NButton
        size="small"
        type="primary"
        class="tags-add-btn"
        :disabled="!draft.trim()"
        aria-label="添加"
        @click="addDraft"
      >
        <XrkIcon name="plus" :size="14" />
        <span>添加</span>
      </NButton>
    </div>
  </div>
</template>

<style scoped>
.tags-ed {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 88px;
  overflow-y: auto;
}
.tags-chip {
  border: 1.5px solid var(--ink) !important;
  font-weight: 700;
  max-width: 100%;
}
.tags-empty {
  margin: 0;
  font-size: var(--font-xs);
  color: var(--muted);
  line-height: 1.35;
}
.tags-add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
}
.tags-add-input {
  min-width: 0;
}
.tags-add-btn {
  display: inline-flex !important;
  align-items: center;
  gap: 4px;
  font-weight: 700 !important;
  white-space: nowrap !important;
  flex-shrink: 0;
  padding: 0 10px !important;
}
.tags-add-btn .n-button__content {
  display: inline-flex !important;
  align-items: center;
  gap: 4px;
}

@media (max-width: 480px) {
  .tags-add {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .tags-add-btn {
    min-height: 32px;
    min-width: 44px;
  }
}
</style>
