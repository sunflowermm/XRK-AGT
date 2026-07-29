<script setup>
/**
 * 动态键对象（map / keyedObject）：表单新增条目 + 字段翻译编辑，可切 JSON
 * 对齐 ArrayForm / LLM 工厂交互；值模板来自 itemFields 或 example 推断
 */
import { computed, ref, watch } from 'vue';
import { NButton, NInput, NSpace, useMessage } from 'naive-ui';
import {
  buildDefaultsFromFields,
  getNestedValue,
  inferFieldsFromExample,
  isFieldFullSpan,
  resolveFieldControl,
  setNestedValue,
} from '@/config/flat';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { randomId } from '@/utils/http';
import ConfigFieldControl from '@/components/ConfigFieldControl.vue';
import ConfigJsonEditor from '@/components/ConfigJsonEditor.vue';
import XrkIcon from '@/components/XrkIcon.vue';

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
  label: { type: String, default: '条目' },
  itemFields: { type: Object, default: () => ({}) },
  example: { type: [Object, Array, String, Number, Boolean, null], default: null },
  keyLabel: { type: String, default: '键' },
  keyPlaceholder: { type: String, default: '输入键名' },
  dense: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue']);
const message = useMessage();
const { confirm } = useConfirmDialog();

const viewMode = ref('form'); // form | json
const draftKey = ref('');
const rowKeys = ref([]);
const entryOrder = ref([]);

const resolvedFields = computed(() => {
  const fromProp = props.itemFields && typeof props.itemFields === 'object' ? props.itemFields : {};
  if (Object.keys(fromProp).length) return fromProp;
  return inferFieldsFromExample(props.example) || inferFieldsFromExample(props.modelValue) || {};
});

const hasSchema = computed(() => Object.keys(resolvedFields.value).length > 0);

const entries = computed(() => {
  const obj =
    props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue)
      ? props.modelValue
      : {};
  const keys = entryOrder.value.filter((k) => Object.prototype.hasOwnProperty.call(obj, k));
  for (const k of Object.keys(obj)) {
    if (!keys.includes(k)) keys.push(k);
  }
  return keys.map((key) => ({ key, value: obj[key] }));
});

watch(
  () => props.modelValue,
  (v) => {
    const obj = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const keys = Object.keys(obj);
    const nextOrder = entryOrder.value.filter((k) => keys.includes(k));
    for (const k of keys) {
      if (!nextOrder.includes(k)) nextOrder.push(k);
    }
    entryOrder.value = nextOrder;
    while (rowKeys.value.length < nextOrder.length) rowKeys.value.push(randomId());
    rowKeys.value = rowKeys.value.slice(0, nextOrder.length);
  },
  { immediate: true, deep: true },
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
    ctrl === 'tags' ||
    ctrl === 'keyed'
  );
}

function emitObj(next) {
  emit('update:modelValue', next);
}

function commitEntries(list) {
  const out = {};
  for (const row of list) {
    const k = String(row.key ?? '').trim();
    if (!k) continue;
    out[k] =
      row.value && typeof row.value === 'object' && !Array.isArray(row.value)
        ? row.value
        : row.value ?? {};
  }
  entryOrder.value = Object.keys(out);
  emitObj(out);
}

function renameKey(i, nextKey) {
  const list = entries.value.map((e) => ({ ...e, value: deepCloneObj(e.value) }));
  list[i] = { ...list[i], key: nextKey };
  commitEntries(list);
}

function patchValue(i, relPath, value) {
  const list = entries.value.map((e) => ({ ...e, value: deepCloneObj(e.value) }));
  const cur = list[i].value && typeof list[i].value === 'object' ? list[i].value : {};
  list[i] = {
    ...list[i],
    value: relPath ? setNestedValue(cur, relPath, value) : value,
  };
  commitEntries(list);
}

function readValue(item, relPath) {
  return getNestedValue(item || {}, relPath);
}

function deepCloneObj(v) {
  if (v && typeof v === 'object') {
    try {
      return structuredClone(v);
    } catch {
      return JSON.parse(JSON.stringify(v));
    }
  }
  return v;
}

function addEntry() {
  const key = String(draftKey.value || '').trim();
  if (!key) {
    message.warning(`请先填写${props.keyLabel || '键名'}`);
    return;
  }
  const obj =
    props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue)
      ? { ...props.modelValue }
      : {};
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    message.warning(`${props.keyLabel || '键'}「${key}」已存在`);
    return;
  }
  const blank = hasSchema.value ? buildDefaultsFromFields(resolvedFields.value) : {};
  obj[key] = blank;
  draftKey.value = '';
  rowKeys.value = [...rowKeys.value, randomId()];
  entryOrder.value = [...entryOrder.value, key];
  emitObj(obj);
}

async function removeEntry(i) {
  const key = entries.value[i]?.key;
  if (!key) return;
  const ok = await confirm({
    title: `删除${props.keyLabel || '条目'}`,
    content: `确认删除「${key}」？未保存前可点重载撤销。`,
    positiveText: '删除',
    negativeText: '取消',
  });
  if (!ok) return;
  const obj = { ...(props.modelValue || {}) };
  delete obj[key];
  const keys = [...rowKeys.value];
  keys.splice(i, 1);
  rowKeys.value = keys;
  entryOrder.value = entryOrder.value.filter((k) => k !== key);
  emitObj(obj);
}

async function applyExample() {
  const ex = props.example;
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return;
  if (Object.keys(props.modelValue || {}).length) {
    const ok = await confirm({
      title: '填入示例',
      content: '将用示例覆盖当前内容，继续？',
      positiveText: '覆盖',
      negativeText: '取消',
    });
    if (!ok) return;
  }
  emitObj(deepCloneObj(ex));
}

function onJsonUpdate(v) {
  emitObj(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
}
</script>

<template>
  <div class="keyed-form" :class="{ dense }">
    <div class="bar">
      <span class="count">{{ entries.length }} 项</span>
      <NSpace size="small">
        <NButton
          size="tiny"
          :type="viewMode === 'form' ? 'primary' : 'default'"
          secondary
          @click="viewMode = 'form'"
        >
          表单
        </NButton>
        <NButton
          size="tiny"
          :type="viewMode === 'json' ? 'primary' : 'default'"
          secondary
          @click="viewMode = 'json'"
        >
          JSON
        </NButton>
        <NButton
          v-if="example && typeof example === 'object' && !Array.isArray(example)"
          size="tiny"
          quaternary
          @click="applyExample"
        >
          填入示例
        </NButton>
      </NSpace>
    </div>

    <ConfigJsonEditor
      v-if="viewMode === 'json'"
      :model-value="modelValue && typeof modelValue === 'object' ? modelValue : {}"
      @update:model-value="onJsonUpdate"
    />

    <template v-else>
      <div class="add-row">
        <NInput
          v-model:value="draftKey"
          size="small"
          class="add-key"
          :placeholder="keyPlaceholder || keyLabel"
          @keyup.enter="addEntry"
        />
        <NButton size="small" type="primary" class="ico-btn" @click="addEntry">
          <XrkIcon name="plus" :size="14" />
          <span>新增{{ label }}</span>
        </NButton>
      </div>

      <p v-if="!entries.length" class="empty">
        暂无{{ label }}。先填写{{ keyLabel || '键名' }}再点新增
        <template v-if="hasSchema">，再按字段编辑</template>
        <template v-else>；无字段模板时可切 JSON</template>
        。
      </p>

      <details v-for="(row, i) in entries" :key="rowKeys[i] || row.key" class="card" open>
        <summary class="card-head">
          <span class="card-title">{{ row.key || `(未命名 #${i + 1})` }}</span>
          <NButton
            size="tiny"
            tertiary
            type="error"
            class="ico-btn"
            title="删除"
            @click.stop.prevent="removeEntry(i)"
          >
            <XrkIcon name="trash" :size="13" />
            <span>删除</span>
          </NButton>
        </summary>
        <div class="card-body">
          <div class="key-edit">
            <label>{{ keyLabel }}</label>
            <NInput
              :value="row.key"
              size="small"
              :placeholder="keyPlaceholder"
              @update:value="(v) => renameKey(i, v)"
            />
          </div>

          <div v-if="hasSchema" class="field-grid">
            <template v-for="[fk, schema] in Object.entries(resolvedFields)" :key="fk">
              <div
                v-if="fieldControl(schema) === 'nested'"
                class="field full nested"
              >
                <div class="nested-title">{{ schema.label || fk }}</div>
                <div class="field-grid">
                  <div
                    v-for="[nk, ns] in Object.entries(schema.fields || {})"
                    :key="nk"
                    class="field"
                    :class="{ full: isFull(nk, ns), switch: fieldControl(ns) === 'switch' }"
                  >
                    <label :title="ns.description || nk">{{ ns.label || nk }}</label>
                    <ConfigFieldControl
                      :schema="ns"
                      :model-value="readValue(row.value, `${fk}.${nk}`)"
                      @update:model-value="(v) => patchValue(i, `${fk}.${nk}`, v)"
                    />
                  </div>
                </div>
              </div>
              <div
                v-else
                class="field"
                :class="{ full: isFull(fk, schema), switch: fieldControl(schema) === 'switch' }"
              >
                <label :title="schema.description || fk">{{ schema.label || fk }}</label>
                <p v-if="schema.description" class="desc">{{ schema.description }}</p>
                <ConfigFieldControl
                  :schema="schema"
                  :model-value="readValue(row.value, fk)"
                  @update:model-value="(v) => patchValue(i, fk, v)"
                />
              </div>
            </template>
          </div>

          <ConfigJsonEditor
            v-else
            :model-value="row.value && typeof row.value === 'object' ? row.value : {}"
            :rows="4"
            @update:model-value="(v) => patchValue(i, '', v)"
          />
        </div>
      </details>
    </template>
  </div>
</template>

<style scoped>
.keyed-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.count {
  font-size: var(--font-xs);
  font-weight: 800;
  color: var(--muted);
}
.add-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.add-key {
  flex: 1;
  min-width: 0;
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
  overflow: hidden;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--cyan) 14%, var(--card));
  font-weight: 800;
  cursor: pointer;
  list-style: none;
}
.card-head::-webkit-details-marker {
  display: none;
}
.card-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: var(--font-sm);
}
.card-body {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.key-edit {
  display: grid;
  gap: 4px;
}
.key-edit label {
  font-size: var(--font-sm);
  font-weight: 700;
}
.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
}
.dense .field-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.field.full {
  grid-column: 1 / -1;
}
.field.switch {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.field label {
  font-size: var(--font-sm);
  font-weight: 700;
}
.desc {
  margin: 0;
  font-size: var(--font-xs);
  color: var(--muted);
}
.nested {
  border: 1px dashed color-mix(in srgb, var(--ink) 30%, transparent);
  border-radius: 6px;
  padding: 6px;
}
.nested-title {
  font-weight: 800;
  font-size: var(--font-sm);
  margin-bottom: 4px;
}
.ico-btn {
  display: inline-flex !important;
  align-items: center;
  gap: 4px;
  font-weight: 700 !important;
}
</style>
