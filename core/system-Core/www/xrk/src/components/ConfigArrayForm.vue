<script setup>
import { computed } from 'vue';
import { NButton, NInput, NInputNumber, NSelect, NSpace, NSwitch } from 'naive-ui';
import {
  buildDefaultsFromFields,
  getNestedValue,
  isFieldFullSpan,
  setNestedValue,
} from '@/config/flat';
import {
  getProviderEntrySummary,
  groupProviderSchemaFields,
  isLlmProvidersArray,
} from '@/config/llm-provider-ui';
import XrkIcon from '@/components/XrkIcon.vue';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  path: { type: String, default: '' },
  label: { type: String, default: '条目' },
  itemFields: { type: Object, default: () => ({}) },
  dense: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue']);

const items = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []));
const isProviders = computed(() => isLlmProvidersArray(props.path));
const hasSchema = computed(() => Object.keys(props.itemFields || {}).length > 0);

const sectionsForItem = computed(() => {
  if (!hasSchema.value) return [];
  if (isProviders.value) return groupProviderSchemaFields(props.itemFields);
  return [{ id: 'all', label: '', collapsible: false, entries: Object.entries(props.itemFields) }];
});

function normalizeOptions(schema) {
  const opts = schema?.options || schema?.enum || schema?.choices;
  if (!opts) return [];
  if (Array.isArray(opts)) {
    return opts.map((o) => {
      if (o && typeof o === 'object') {
        return { label: o.label ?? o.name ?? String(o.value), value: o.value ?? o.key ?? o.name };
      }
      return { label: String(o), value: o };
    });
  }
  if (typeof opts === 'object') {
    return Object.entries(opts).map(([value, label]) => ({ value, label: String(label) }));
  }
  return [];
}

function fieldControl(schema) {
  const c = String(schema?.component || '').toLowerCase();
  const t = String(schema?.type || '').toLowerCase();
  if (c === 'switch' || t === 'boolean') return 'switch';
  if (c === 'select' || c === 'radio' || schema?.enum || schema?.options) return 'select';
  if (c === 'number' || c === 'inputnumber' || c === 'slider' || t === 'number') return 'number';
  if (c === 'inputpassword' || c === 'password') return 'password';
  if (c === 'textarea' || c === 'text-area') return 'textarea';
  if (c === 'subform' || c === 'json' || t === 'object' || t === 'map') {
    if (schema?.fields && Object.keys(schema.fields).length) return 'nested';
    return 'json';
  }
  return 'input';
}

function asFieldMeta(key, schema) {
  return {
    path: key,
    type: schema?.type || 'string',
    component: String(schema?.component || '').toLowerCase(),
    layout: schema?.layout,
    span: schema?.span,
  };
}

function isFull(key, schema) {
  const ctrl = fieldControl(schema);
  return isFieldFullSpan(asFieldMeta(key, schema)) || ctrl === 'json' || ctrl === 'textarea' || ctrl === 'nested';
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
  emit('update:modelValue', [
    ...items.value,
    hasSchema.value ? buildDefaultsFromFields(props.itemFields) : {},
  ]);
}

function removeItem(i) {
  const next = [...items.value];
  next.splice(i, 1);
  emit('update:modelValue', next);
}

function moveItem(i, delta) {
  const next = [...items.value];
  const j = i + delta;
  if (j < 0 || j >= next.length) return;
  [next[i], next[j]] = [next[j], next[i]];
  emit('update:modelValue', next);
}

function summary(item, index) {
  if (isProviders.value) return getProviderEntrySummary(item) || `${props.label} #${index + 1}`;
  return `${props.label} #${index + 1}`;
}
</script>

<template>
  <div class="array-form" :class="{ dense, providers: isProviders }">
    <div class="bar">
      <span class="count">{{ items.length }} 项</span>
      <NButton size="small" type="primary" class="ico-btn" @click="addItem">
        <XrkIcon name="plus" :size="14" />
        <span>新增{{ label }}</span>
      </NButton>
    </div>

    <p v-if="!items.length" class="empty">暂无{{ label }}，点击下方按钮新增。</p>

    <details v-for="(item, i) in items" :key="i" class="card" open>
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
                        full: isFieldFullSpan(asFieldMeta(nk, ns)),
                        switch: fieldControl(ns) === 'switch',
                      }"
                    >
                      <label :title="ns.description || nk">{{ ns.label || nk }}</label>
                      <NSwitch
                        v-if="fieldControl(ns) === 'switch'"
                        :value="Boolean(readItem(item, `${key}.${nk}`))"
                        size="small"
                        @update:value="(v) => patchItem(i, `${key}.${nk}`, v)"
                      />
                      <NInput
                        v-else
                        :value="String(readItem(item, `${key}.${nk}`) ?? '')"
                        size="small"
                        @update:value="(v) => patchItem(i, `${key}.${nk}`, v)"
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
                  <NSwitch
                    v-if="fieldControl(schema) === 'switch'"
                    :value="Boolean(readItem(item, key))"
                    size="small"
                    @update:value="(v) => patchItem(i, key, v)"
                  />
                  <NSelect
                    v-else-if="fieldControl(schema) === 'select'"
                    :value="readItem(item, key)"
                    size="small"
                    :options="normalizeOptions(schema)"
                    clearable
                    @update:value="(v) => patchItem(i, key, v)"
                  />
                  <NInputNumber
                    v-else-if="fieldControl(schema) === 'number'"
                    :value="readItem(item, key)"
                    size="small"
                    :min="schema.min"
                    :max="schema.max"
                    :step="schema.step || 1"
                    style="width: 100%"
                    @update:value="(v) => patchItem(i, key, v)"
                  />
                  <NInput
                    v-else-if="fieldControl(schema) === 'password'"
                    :value="String(readItem(item, key) ?? '')"
                    type="password"
                    show-password-on="click"
                    size="small"
                    @update:value="(v) => patchItem(i, key, v)"
                  />
                  <NInput
                    v-else-if="fieldControl(schema) === 'textarea'"
                    :value="String(readItem(item, key) ?? '')"
                    type="textarea"
                    size="small"
                    :rows="dense ? 2 : 3"
                    @update:value="(v) => patchItem(i, key, v)"
                  />
                  <NInput
                    v-else-if="fieldControl(schema) === 'json'"
                    :value="jsonText(item, key)"
                    type="textarea"
                    size="small"
                    class="mono"
                    :rows="dense ? 3 : 5"
                    @update:value="(v) => patchItemJson(i, key, v)"
                  />
                  <NInput
                    v-else
                    :value="String(readItem(item, key) ?? '')"
                    size="small"
                    :placeholder="schema.placeholder || ''"
                    @update:value="(v) => patchItem(i, key, v)"
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
          :rows="dense ? 4 : 6"
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
}
.bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
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
}
.section-head.static { cursor: default; }
.section-head::-webkit-details-marker { display: none; }
.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
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

.dense { gap: 6px; }
.dense .card-head { padding: 6px 8px; }
.dense .card-body { padding: 6px 8px 8px; }
.dense .section { margin-bottom: 6px; padding: 4px; }
.dense .field-grid { gap: 6px; }
.dense .field { gap: 1px; }
.dense .field label { font-size: var(--font-xs); }
.dense .desc {
  -webkit-line-clamp: 1;
  max-height: 1.35em;
}

@media (max-width: 720px) {
  .field-grid { grid-template-columns: 1fr; }
}
</style>
