<script setup>
import { computed, ref, watch } from 'vue';
import { NButton, NInput, NSpace } from 'naive-ui';
import {
  buildDefaultsFromFields,
  getNestedValue,
  isFieldFullSpan,
  resolveFieldControl,
  setNestedValue,
} from '@/config/flat';
import {
  getProviderEntrySummary,
  groupProviderSchemaFields,
  isLlmProvidersArray,
} from '@/config/llm-provider-ui';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { randomId } from '@/utils/http';
import ConfigFieldControl from '@/components/ConfigFieldControl.vue';
import XrkIcon from '@/components/XrkIcon.vue';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  path: { type: String, default: '' },
  label: { type: String, default: '条目' },
  itemFields: { type: Object, default: () => ({}) },
  dense: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue']);
const { confirm } = useConfirmDialog();

const items = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []));
const isProviders = computed(() => isLlmProvidersArray(props.path));
const hasSchema = computed(() => Object.keys(props.itemFields || {}).length > 0);
const rootEl = ref(null);
/** 与条目一一对应的稳定 key，避免增删改序时控件错位 */
const rowKeys = ref([]);

const sectionsForItem = computed(() => {
  if (!hasSchema.value) return [];
  if (isProviders.value) return groupProviderSchemaFields(props.itemFields);
  return [{ id: 'all', label: '', collapsible: false, entries: Object.entries(props.itemFields) }];
});

watch(
  () => items.value.length,
  (len) => {
    const next = rowKeys.value.slice(0, len);
    while (next.length < len) next.push(randomId());
    rowKeys.value = next;
  },
  { immediate: true },
);

function fieldControl(schema) {
  return resolveFieldControl(schema);
}

function asFieldMeta(key, schema) {
  return {
    path: key,
    type: schema?.type || 'string',
    component: String(schema?.component || '').toLowerCase(),
    layout: schema?.layout,
    span: schema?.span,
    fields: schema?.fields,
  };
}

function isFull(key, schema) {
  const ctrl = fieldControl(schema);
  return (
    isFieldFullSpan(asFieldMeta(key, schema)) ||
    ctrl === 'json' ||
    ctrl === 'kv' ||
    ctrl === 'textarea' ||
    ctrl === 'nested' ||
    ctrl === 'tags'
  );
}

function readItem(item, relPath) {
  return getNestedValue(item || {}, relPath);
}

function patchItem(index, relPath, value) {
  emit(
    'update:modelValue',
    items.value.map((it, i) => (i === index ? setNestedValue(it || {}, relPath, value) : it)),
  );
}

function patchItemJson(index, relPath, text) {
  try {
    const parsed = JSON.parse(text || '{}');
    if (!relPath) {
      emit(
        'update:modelValue',
        items.value.map((it, i) => (i === index ? parsed : it)),
      );
      return;
    }
    patchItem(index, relPath, parsed);
  } catch {
    /* keep typing */
  }
}

function jsonText(item, relPath) {
  try {
    const v = relPath ? readItem(item, relPath) : item;
    return JSON.stringify(v ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

function addItem() {
  rowKeys.value = [...rowKeys.value, randomId()];
  emit('update:modelValue', [
    ...items.value,
    hasSchema.value ? buildDefaultsFromFields(props.itemFields) : {},
  ]);
}

async function removeItem(i) {
  const title = summary(items.value[i], i);
  const ok = await confirm({
    title: `删除${props.label || '条目'}`,
    content: `确认删除「${title}」？未保存前可点重载撤销。`,
    positiveText: '删除',
    negativeText: '取消',
  });
  if (!ok) return;
  const next = [...items.value];
  next.splice(i, 1);
  const keys = [...rowKeys.value];
  keys.splice(i, 1);
  rowKeys.value = keys;
  emit('update:modelValue', next);
}

function moveItem(i, delta) {
  const next = [...items.value];
  const j = i + delta;
  if (j < 0 || j >= next.length) return;
  [next[i], next[j]] = [next[j], next[i]];
  const keys = [...rowKeys.value];
  [keys[i], keys[j]] = [keys[j], keys[i]];
  rowKeys.value = keys;
  emit('update:modelValue', next);
}

function summary(item, index) {
  if (isProviders.value) return getProviderEntrySummary(item) || `${props.label} #${index + 1}`;
  return `${props.label} #${index + 1}`;
}

function collapseAll() {
  rootEl.value?.querySelectorAll('details.card').forEach((el) => {
    el.open = false;
  });
}

function expandAll() {
  rootEl.value?.querySelectorAll('details.card').forEach((el) => {
    el.open = true;
  });
}
</script>

<template>
  <div ref="rootEl" class="array-form" :class="{ dense, providers: isProviders }">
    <div class="bar">
      <span class="count">{{ items.length }} 项</span>
      <NSpace size="small">
        <NButton v-if="items.length > 1" size="tiny" quaternary @click="collapseAll">全部折叠</NButton>
        <NButton v-if="items.length > 1" size="tiny" quaternary @click="expandAll">全部展开</NButton>
        <NButton size="small" type="primary" class="ico-btn" @click="addItem">
          <XrkIcon name="plus" :size="14" />
          <span>新增{{ label }}</span>
        </NButton>
      </NSpace>
    </div>

    <p v-if="!items.length" class="empty">暂无{{ label }}，点击下方按钮新增。</p>

    <details v-for="(item, i) in items" :key="rowKeys[i] || i" class="card" open>
      <summary class="card-head">
        <span class="card-title">{{ summary(item, i) }}</span>
        <NSpace size="small" class="card-acts" @click.stop>
          <NButton
            size="tiny"
            quaternary
            class="ico-only"
            :disabled="i === 0"
            title="上移"
            aria-label="上移"
            @click="moveItem(i, -1)"
          >
            <XrkIcon name="up" :size="14" />
          </NButton>
          <NButton
            size="tiny"
            quaternary
            class="ico-only"
            :disabled="i >= items.length - 1"
            title="下移"
            aria-label="下移"
            @click="moveItem(i, 1)"
          >
            <XrkIcon name="down" :size="14" />
          </NButton>
          <NButton
            size="tiny"
            tertiary
            type="error"
            class="ico-btn"
            title="删除此条"
            @click="removeItem(i)"
          >
            <XrkIcon name="trash" :size="13" />
            <span>删除</span>
          </NButton>
        </NSpace>
      </summary>

      <div class="card-body">
        <template v-if="hasSchema">
          <component
            :is="sec.collapsible ? 'details' : 'section'"
            v-for="sec in sectionsForItem"
            :key="sec.id"
            class="section"
            v-bind="sec.collapsible ? { open: true } : {}"
          >
            <summary v-if="sec.collapsible" class="section-head">{{ sec.label }}</summary>
            <header v-else-if="sec.label" class="section-head static">{{ sec.label }}</header>

            <div class="field-grid">
              <template v-for="[key, schema] in sec.entries" :key="key">
                <div v-if="fieldControl(schema) === 'nested'" class="field full nested">
                  <div class="nested-title">{{ schema.label || key }}</div>
                  <p v-if="schema.description" class="desc" :title="schema.description">
                    {{ schema.description }}
                  </p>
                  <div class="field-grid">
                    <div
                      v-for="[nk, ns] in Object.entries(schema.fields || {})"
                      :key="nk"
                      class="field"
                      :class="{
                        full: isFull(nk, ns),
                        switch: fieldControl(ns) === 'switch',
                      }"
                    >
                      <label :title="ns.description || nk">{{ ns.label || nk }}</label>
                      <ConfigFieldControl
                        :schema="ns"
                        :model-value="readItem(item, `${key}.${nk}`)"
                        @update:model-value="(v) => patchItem(i, `${key}.${nk}`, v)"
                      />
                    </div>
                  </div>
                </div>

                <div
                  v-else
                  class="field"
                  :class="{ full: isFull(key, schema), switch: fieldControl(schema) === 'switch' }"
                >
                  <label :title="schema.description || key">{{ schema.label || key }}</label>
                  <p v-if="schema.description" class="desc" :title="schema.description">
                    {{ schema.description }}
                  </p>
                  <ConfigFieldControl
                    :schema="schema"
                    :model-value="readItem(item, key)"
                    @update:model-value="(v) => patchItem(i, key, v)"
                  />
                </div>
              </template>
            </div>
          </component>
        </template>
        <NInput
          v-else
          :value="jsonText(item, '')"
          type="textarea"
          size="small"
          class="mono"
          :rows="6"
          @update:value="(v) => patchItemJson(i, '', v)"
        />
      </div>
    </details>
  </div>
</template>

<style scoped>
.array-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  container-type: inline-size;
  container-name: cfg-array;
}
.bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.count {
  font-size: var(--font-xs);
  font-weight: 700;
  color: var(--muted);
}
.empty {
  margin: 0;
  font-size: var(--font-sm);
  color: var(--muted);
}
.card {
  border: 1.5px solid var(--ink);
  border-radius: 8px;
  background: var(--card);
  box-shadow: var(--shadow);
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  list-style: none;
  font-weight: 800;
  font-size: var(--font-sm);
  background: color-mix(in srgb, var(--yellow) 22%, var(--card));
  border-bottom: 1.5px solid color-mix(in srgb, var(--ink) 25%, transparent);
}
.card-head::-webkit-details-marker { display: none; }
.card-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-acts { flex-shrink: 0; }
.card-body { padding: 8px 10px 10px; }
.section {
  margin-bottom: 8px;
  border: 1px dashed color-mix(in srgb, var(--ink) 28%, transparent);
  border-radius: 6px;
  padding: 6px;
}
.section-head {
  font-size: var(--font-sm);
  font-weight: 800;
  cursor: pointer;
  list-style: none;
  margin-bottom: 6px;
  padding: 2px 0 2px 6px;
  border-left: 3px solid var(--cyan);
}
.section-head.static { cursor: default; }
.section-head::-webkit-details-marker { display: none; }
.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  contain: layout style;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  min-height: 30px;
  contain: layout;
}
.field.full { grid-column: 1 / -1; }
.field.switch {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.field label {
  font-size: var(--font-sm);
  font-weight: 700;
}
.desc {
  margin: 0;
  font-size: var(--font-xs);
  color: var(--muted);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.nested {
  border: 1px solid color-mix(in srgb, var(--ink) 22%, transparent);
  border-radius: 6px;
  padding: 6px;
  background: color-mix(in srgb, var(--paper) 50%, var(--card));
}
.nested-title {
  font-size: var(--font-sm);
  font-weight: 800;
  margin-bottom: 4px;
}
.mono :deep(textarea) {
  font-family: var(--mono);
  font-size: var(--font-xs);
}
.ico-btn {
  display: inline-flex !important;
  align-items: center;
  gap: 4px;
  font-weight: 700 !important;
}
.ico-only {
  min-width: 28px;
  padding: 0 4px !important;
}

/* 紧凑 = 仅 2 列 → 3 列，不改高度 */
.dense .field-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 10px;
}
</style>
