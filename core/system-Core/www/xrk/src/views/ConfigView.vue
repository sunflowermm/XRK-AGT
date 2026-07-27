<script>
export default { name: 'ConfigView' };
</script>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  NButton,
  NEmpty,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTag,
  useMessage,
} from 'naive-ui';
import { apiFetch, apiJson } from '@/api/client';
import { deepClone } from '@/utils/http';
import {
  arraySchemasFromFlatTemplates,
  buildArraySchemaIndex,
  buildDirtyFlat,
  extractActiveSchema,
  formatExample,
  formatGroupLabel,
  groupFields,
  isFieldFullSpan,
  normalizeFlatFields,
  resolveArrayItemFields,
  sameFieldValue,
  valuesFromFlat,
} from '@/config/flat';
import ConfigArrayForm from '@/components/ConfigArrayForm.vue';
import XrkIcon from '@/components/XrkIcon.vue';

const message = useMessage();
const loading = ref(false);
const saving = ref(false);
const listOpen = ref(false);
const configs = ref([]);
const filter = ref('');
const selected = ref(localStorage.getItem('lastConfigName') || '');
const selectedChild = ref(localStorage.getItem('lastConfigChild') || '');
const mode = ref(localStorage.getItem('configEditorMode') || 'form');
const dense = ref(localStorage.getItem('configEditorDense') === '1');

const fields = ref([]);
const arraySchemas = ref({});
const values = reactive({});
const original = reactive({});
const jsonText = ref('{}');
const children = ref([]);

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return configs.value;
  return configs.value.filter((c) => {
    const hay = `${c.displayName || ''} ${c.name || ''} ${c.description || ''}`.toLowerCase();
    return hay.includes(q);
  });
});

const groups = computed(() => groupFields(fields.value));
const showGroupHeaders = computed(() => {
  if (groups.value.length !== 1) return true;
  const only = groups.value[0]?.label;
  return only !== '基础' && only !== '__default__';
});
const selectedConfig = computed(() => configs.value.find((c) => c.name === selected.value) || null);
const isSystem = computed(() => selected.value === 'system');
const dirtyCount = computed(() => Object.keys(buildDirtyFlat(values, original, fields.value)).length);
const childOptions = computed(() => {
  const cfg = selectedConfig.value;
  if (cfg?.configs && typeof cfg.configs === 'object') {
    return Object.entries(cfg.configs).map(([key, meta]) => ({
      label: meta?.displayName || key,
      value: key,
    }));
  }
  return children.value.map((c) => ({
    label: typeof c === 'string' ? c : c.label || c.name || c.path,
    value: typeof c === 'string' ? c : c.name || c.path || c.id,
  }));
});

function persistSelection() {
  try {
    if (selected.value) localStorage.setItem('lastConfigName', selected.value);
    localStorage.setItem('lastConfigChild', selectedChild.value || '');
  } catch {
    /* ignore */
  }
}

function setMode(next) {
  mode.value = next;
  try {
    localStorage.setItem('configEditorMode', next);
  } catch {
    /* ignore */
  }
  if (next === 'json') syncJsonFromValues();
}

function toggleDense() {
  dense.value = !dense.value;
  try {
    localStorage.setItem('configEditorDense', dense.value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function clearValues() {
  for (const k of Object.keys(values)) delete values[k];
  for (const k of Object.keys(original)) delete original[k];
}

function applyFlatData(flatSchema, flatData, structure = null) {
  const list = normalizeFlatFields(flatSchema);
  fields.value = list;
  clearValues();
  const fromStructure = buildArraySchemaIndex(
    extractActiveSchema(structure, selected.value, selectedChild.value) || { fields: {} },
  );
  const fromTemplates = arraySchemasFromFlatTemplates(flatSchema);
  const merged = { ...fromTemplates, ...fromStructure };
  for (const f of list) {
    if (f.type !== 'array<object>' && f.component !== 'arrayform') continue;
    if ((!merged[f.path] || !Object.keys(merged[f.path]).length) && f.itemFields) {
      merged[f.path] = f.itemFields;
    }
  }
  arraySchemas.value = merged;
  const next = valuesFromFlat(flatData || {}, list);
  Object.assign(values, next);
  Object.assign(original, deepClone(next));
  syncJsonFromValues();
}

function syncJsonFromValues() {
  const obj = {};
  for (const f of fields.value) obj[f.path] = values[f.path];
  jsonText.value = JSON.stringify(obj, null, 2);
}

function applyJsonToValues() {
  let parsed;
  try {
    parsed = JSON.parse(jsonText.value);
  } catch {
    message.error('JSON 无法解析');
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    message.error('JSON 需为对象（path → value）');
    return false;
  }
  for (const f of fields.value) {
    if (Object.prototype.hasOwnProperty.call(parsed, f.path)) {
      values[f.path] = parsed[f.path];
    }
  }
  return true;
}

async function loadList() {
  loading.value = true;
  try {
    const data = await apiFetch('/api/config/list');
    configs.value = Array.isArray(data?.configs) ? data.configs : Array.isArray(data) ? data : [];
    if (!selected.value && configs.value[0]) {
      selected.value = configs.value[0].name;
    }
    if (selected.value) await loadOne(selected.value);
  } catch (err) {
    message.error(err?.message || String(err));
  } finally {
    loading.value = false;
  }
}

function childQuery() {
  if (isSystem.value && selectedChild.value) {
    return `?path=${encodeURIComponent(selectedChild.value)}`;
  }
  return '';
}

async function loadOne(name) {
  if (!name) return;
  if (name === 'system' && !selectedChild.value) {
    const cfg = configs.value.find((c) => c.name === 'system');
    if (cfg?.configs) {
      children.value = Object.keys(cfg.configs);
    }
    fields.value = [];
    arraySchemas.value = {};
    clearValues();
    // 展示子配置卡片，不强制立即选中
    return;
  }

  await loadFlat(name);
}

async function loadFlat(name) {
  loading.value = true;
  try {
    const q = childQuery();
    const tasks = [
      apiFetch(`/api/config/${encodeURIComponent(name)}/flat-structure${q}`),
      apiFetch(`/api/config/${encodeURIComponent(name)}/flat${q}`),
      apiFetch(`/api/config/${encodeURIComponent(name)}/structure`).catch(() => null),
    ];
    const [schemaRes, dataRes, structureRes] = await Promise.all(tasks);
    const flatSchema = schemaRes?.flat ?? schemaRes;
    const flatData = dataRes?.flat ?? dataRes;
    const structure = structureRes?.structure ?? structureRes;
    applyFlatData(flatSchema, flatData, structure);
    persistSelection();
  } catch (err) {
    message.error(err?.message || String(err));
    fields.value = [];
    arraySchemas.value = {};
    clearValues();
  } finally {
    loading.value = false;
  }
}

function itemFieldsFor(f) {
  return resolveArrayItemFields(f.path, arraySchemas.value, f);
}

async function save() {
  if (!selected.value) return;
  if (isSystem.value && !selectedChild.value) {
    message.warning('system 需选择子配置');
    return;
  }
  if (mode.value === 'json' && !applyJsonToValues()) return;

  const flat = buildDirtyFlat(values, original, fields.value);
  if (!Object.keys(flat).length) {
    message.info('无变更');
    return;
  }

  saving.value = true;
  try {
    const body = { flat, backup: true, validate: true };
    if (isSystem.value && selectedChild.value) body.path = selectedChild.value;
    await apiJson(`/api/config/${encodeURIComponent(selected.value)}/batch-set`, body, 'POST');
    message.success(`已保存 ${Object.keys(flat).length} 项`);
    await loadFlat(selected.value);
  } catch (err) {
    message.error(err?.message || String(err));
  } finally {
    saving.value = false;
  }
}

async function backup() {
  if (!selected.value || selected.value === 'system') {
    message.warning('请选择非 system 配置，或对子配置使用保存时自动备份');
    return;
  }
  try {
    const res = await apiJson(`/api/config/${encodeURIComponent(selected.value)}/backup`, {}, 'POST');
    message.success(res?.backupPath ? `已备份：${res.backupPath}` : '已备份');
  } catch (err) {
    message.error(err?.message || String(err));
  }
}

async function resetCfg() {
  if (!selected.value || selected.value === 'system') {
    message.warning('system 子配置请在确认后于服务端重置');
    return;
  }
  if (!window.confirm(`确认将 ${selected.value} 重置为默认值？`)) return;
  try {
    await apiJson(`/api/config/${encodeURIComponent(selected.value)}/reset`, { backup: true }, 'POST');
    message.success('已重置');
    await loadFlat(selected.value);
  } catch (err) {
    message.error(err?.message || String(err));
  }
}

function selectConfig(name) {
  if (selected.value === name) {
    listOpen.value = false;
    return;
  }
  selected.value = name;
  if (name !== 'system') selectedChild.value = '';
  children.value = [];
  listOpen.value = false;
  persistSelection();
  void loadOne(name);
}

function fieldControl(f) {
  const c = f.component;
  if (c === 'switch') return 'switch';
  if (c === 'select' || c === 'radio') return 'select';
  if (c === 'multiselect' || c === 'tags') return 'tags';
  if (c === 'textarea' || c === 'text-area') return 'textarea';
  if (c === 'number' || c === 'inputnumber' || c === 'slider' || c === 'range') return 'number';
  if (c === 'inputpassword') return 'password';
  if (c === 'arrayform' || f.type === 'array<object>') return 'array';
  if (c === 'json' || c === 'subform' || f.type === 'object' || f.type === 'map') return 'json';
  return 'input';
}

function isDirty(path) {
  const f = fields.value.find((x) => x.path === path);
  if (!f) return false;
  return !sameFieldValue(values[path], original[path], f.type, f.component);
}

function tagsText(path) {
  const v = values[path];
  return Array.isArray(v) ? v.join(', ') : String(v ?? '');
}

function setTags(path, text) {
  values[path] = String(text || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function jsonFieldText(path) {
  try {
    return JSON.stringify(values[path] ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

function setJsonField(path, text) {
  try {
    values[path] = JSON.parse(text);
  } catch {
    /* keep typing */
  }
}

watch(selectedChild, (v) => {
  if (selected.value === 'system' && v) {
    persistSelection();
    void loadFlat('system');
  }
});

onMounted(loadList);
</script>

<template>
  <div class="config" :class="{ dense, 'list-open': listOpen }">
    <button type="button" class="list-toggle" @click="listOpen = !listOpen">
      <XrkIcon :name="listOpen ? 'close' : 'menu'" :size="14" />
      <span>{{ listOpen ? '关闭列表' : selectedConfig?.displayName || selected || '选择配置' }}</span>
    </button>
    <div v-if="listOpen" class="scrim" @click="listOpen = false" />

    <aside class="brutal-card side">
      <div class="side-head">
        <strong>配置管理</strong>
        <span class="sub">flat schema · batch-set</span>
      </div>
      <NInput v-model:value="filter" size="small" clearable placeholder="平铺搜索…" />
      <ul class="cfg-list">
        <li
          v-for="c in filtered"
          :key="c.name"
          class="cfg-item"
          :class="{ active: selected === c.name }"
          @click="selectConfig(c.name)"
        >
          <div class="cfg-meta">
            <span class="name">{{ c.displayName || c.name }}</span>
            <span v-if="c.description" class="desc">{{ c.description }}</span>
          </div>
          <span v-if="c.name === 'system'" class="cfg-tag">多文件</span>
        </li>
      </ul>
      <NEmpty v-if="!filtered.length" description="无配置项" size="small" />
      <NButton size="small" block @click="loadList">刷新列表</NButton>
    </aside>

    <section class="brutal-card editor">
      <header>
        <div class="hdr-left">
          <div class="hdr-titles">
            <h2>{{ selectedConfig?.displayName || selected || '未选择' }}</h2>
            <p v-if="selectedConfig?.description" class="hdr-desc">{{ selectedConfig.description }}</p>
            <p v-else-if="selected" class="hdr-desc mono">{{ selected }}</p>
          </div>
          <NTag v-if="dirtyCount" size="small" type="warning" :bordered="true">
            {{ dirtyCount }} 未保存
          </NTag>
        </div>
        <NSpace size="small" wrap>
          <NSelect
            v-if="isSystem"
            v-model:value="selectedChild"
            size="small"
            :options="childOptions"
            placeholder="子配置"
            style="width: 160px"
          />
          <NButton size="small" :type="mode === 'form' ? 'primary' : 'default'" class="tb-btn" @click="setMode('form')">
            <XrkIcon name="form" :size="14" />
            <span>表单</span>
          </NButton>
          <NButton size="small" :type="mode === 'json' ? 'primary' : 'default'" class="tb-btn" @click="setMode('json')">
            <XrkIcon name="json" :size="14" />
            <span>JSON</span>
          </NButton>
          <NButton
            size="small"
            secondary
            class="tb-btn"
            :type="dense ? 'primary' : 'default'"
            :title="dense ? '切换舒适布局' : '切换紧凑布局'"
            @click="toggleDense"
          >
            <XrkIcon :name="dense ? 'comfortable' : 'dense'" :size="14" />
            <span>{{ dense ? '舒适' : '紧凑' }}</span>
          </NButton>
          <NButton size="small" class="tb-btn" :loading="loading" @click="loadOne(selected)">
            <XrkIcon name="reload" :size="14" />
            <span>重载</span>
          </NButton>
          <NButton size="small" secondary class="tb-btn" @click="backup">
            <XrkIcon name="backup" :size="14" />
            <span>备份</span>
          </NButton>
          <NButton size="small" secondary class="tb-btn" @click="resetCfg">
            <XrkIcon name="reset" :size="14" />
            <span>重置</span>
          </NButton>
          <NButton size="small" type="primary" class="tb-btn" :loading="saving" @click="save">
            <XrkIcon name="save" :size="14" />
            <span>保存</span>
          </NButton>
        </NSpace>
      </header>

      <div class="editor-body ink-scroll">
        <NSpin :show="loading">
          <div v-if="!selected" class="placeholder">
            <NEmpty description="从左侧选择配置" />
          </div>

          <div v-else-if="isSystem && !selectedChild" class="sys-chooser">
            <p class="hint">SystemConfig 为多文件配置，请选择子项：</p>
            <div class="sys-grid">
              <button
                v-for="opt in childOptions"
                :key="opt.value"
                type="button"
                class="sys-card"
                @click="selectedChild = opt.value"
              >
                <strong>{{ opt.label }}</strong>
                <span class="mono">system/{{ opt.value }}</span>
              </button>
            </div>
            <NEmpty v-if="!childOptions.length" description="SystemConfig 未定义子配置" size="small" />
          </div>

          <div v-else-if="mode === 'json'" class="json-wrap">
            <NInput v-model:value="jsonText" type="textarea" class="mono" :rows="dense ? 18 : 22" />
            <p class="hint">JSON 为 path → value 扁平对象；保存时只提交相对原始值的变更。</p>
          </div>

          <div v-else-if="!fields.length" class="placeholder">
            <NEmpty description="无扁平字段（可切 JSON，或检查 system 子配置）" />
          </div>

          <div v-else class="form-wrap">
            <section v-for="g in groups" :key="g.label" class="group">
              <div v-if="showGroupHeaders" class="group-h">
                <div class="group-h-text">
                  <h3>{{ formatGroupLabel(g.label) }}</h3>
                  <p v-if="g.desc" class="group-desc">{{ g.desc }}</p>
                </div>
                <span class="group-count">{{ g.items.length }} 项</span>
              </div>
              <div v-else class="group-rail" aria-hidden="true" />
              <div class="field-grid">
                <div
                  v-for="f in g.items"
                  :key="f.path"
                  class="field"
                  :class="{
                    full: isFieldFullSpan(f),
                    switch: fieldControl(f) === 'switch',
                    dirty: isDirty(f.path),
                  }"
                  :title="f.path"
                >
                  <div class="meta" :class="{ 'has-hint': !!f.description }">
                    <label :for="`f-${f.path}`" :title="f.description || f.path">
                      {{ f.label }}
                      <span v-if="f.required" class="req">*</span>
                    </label>
                    <p v-if="f.description" class="desc" :class="{ compact: !isFieldFullSpan(f) }">
                      {{ f.description }}
                    </p>
                  </div>
                  <div class="ctrl" :class="{ 'ctrl-switch': fieldControl(f) === 'switch' }">
                    <NSwitch
                      v-if="fieldControl(f) === 'switch'"
                      :id="`f-${f.path}`"
                      v-model:value="values[f.path]"
                      size="small"
                    />
                    <NSelect
                      v-else-if="fieldControl(f) === 'select'"
                      :id="`f-${f.path}`"
                      v-model:value="values[f.path]"
                      size="small"
                      :options="f.options"
                      clearable
                    />
                    <NInputNumber
                      v-else-if="fieldControl(f) === 'number'"
                      :id="`f-${f.path}`"
                      v-model:value="values[f.path]"
                      size="small"
                      :min="f.min"
                      :max="f.max"
                      :step="f.step || 1"
                      style="width: 100%"
                    />
                    <NInput
                      v-else-if="fieldControl(f) === 'password'"
                      :id="`f-${f.path}`"
                      v-model:value="values[f.path]"
                      type="password"
                      show-password-on="click"
                      size="small"
                      :placeholder="f.placeholder"
                    />
                    <NInput
                      v-else-if="fieldControl(f) === 'textarea'"
                      :id="`f-${f.path}`"
                      v-model:value="values[f.path]"
                      type="textarea"
                      size="small"
                      :rows="dense ? 2 : 3"
                      :placeholder="f.placeholder"
                    />
                    <NInput
                      v-else-if="fieldControl(f) === 'tags'"
                      :value="tagsText(f.path)"
                      size="small"
                      placeholder="逗号分隔"
                      @update:value="(v) => setTags(f.path, v)"
                    />
                    <ConfigArrayForm
                      v-else-if="fieldControl(f) === 'array'"
                      v-model="values[f.path]"
                      :path="f.path"
                      :label="f.itemLabel || f.label || '条目'"
                      :item-fields="itemFieldsFor(f)"
                      :dense="dense"
                    />
                    <NInput
                      v-else-if="fieldControl(f) === 'json'"
                      :value="jsonFieldText(f.path)"
                      type="textarea"
                      size="small"
                      class="mono"
                      :rows="dense ? 3 : 5"
                      @update:value="(v) => setJsonField(f.path, v)"
                    />
                    <NInput
                      v-else
                      :id="`f-${f.path}`"
                      v-model:value="values[f.path]"
                      size="small"
                      :placeholder="f.placeholder"
                    />
                  </div>
                  <div
                    v-if="f.example != null && f.example !== '' && !(dense && !isFieldFullSpan(f))"
                    class="example"
                  >
                    <strong>此为示例：</strong>
                    <pre>{{ formatExample(f.example) }}</pre>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </NSpin>
      </div>
    </section>
  </div>
</template>

<style scoped>
.config {
  --config-border: color-mix(in srgb, var(--ink) 55%, transparent);
  --config-border-strong: var(--ink);
  --config-divider: color-mix(in srgb, var(--ink) 42%, transparent);
  display: grid;
  grid-template-columns: minmax(240px, 30%) minmax(0, 1fr);
  gap: var(--gap);
  height: 100%;
  min-height: 100%;
  overflow: hidden;
  container-type: inline-size;
  container-name: config;
}
.list-toggle,
.scrim {
  display: none;
}
.side,
.editor {
  padding: 8px;
  min-height: 0;
  overflow: hidden;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
}
.side-head {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex-shrink: 0;
}
.side-head strong { font-size: 13px; }
.side-head .sub { font-size: var(--font-xs); color: var(--muted); }
.side > .n-input,
.side > .n-button { flex-shrink: 0; }
.cfg-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow: auto;
  flex: 1 1 0;
  min-height: 0;
  border: 2px solid var(--ink);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: color-mix(in srgb, var(--paper-2) 30%, var(--card));
}
.cfg-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 9px;
  border: 1.5px solid var(--config-border);
  border-radius: 7px;
  background: var(--card);
  cursor: pointer;
}
.cfg-item:hover {
  border-color: var(--ink);
  background: color-mix(in srgb, var(--cyan) 16%, var(--card));
}
.cfg-item.active {
  border-color: var(--ink);
  background: color-mix(in srgb, var(--yellow) 48%, var(--card));
  box-shadow: var(--shadow);
}
.cfg-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.cfg-item .name {
  display: block;
  font-size: var(--font-ui);
  font-weight: 700;
  line-height: 1.3;
}
.cfg-item .desc {
  display: block;
  font-size: var(--font-sm);
  color: var(--muted);
  line-height: 1.45;
  white-space: normal;
  word-break: break-word;
}
.cfg-tag {
  flex-shrink: 0;
  align-self: flex-start;
  font-size: var(--font-xs);
  font-weight: 800;
  line-height: 1.5;
  padding: 1px 8px;
  border: 1.5px solid var(--ink);
  border-radius: 999px;
  background: var(--cyan);
}
.editor {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.editor-body {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
}
.editor-body > :deep(.n-spin-container) { min-height: 100%; }
header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--ink);
}
.hdr-left {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}
.hdr-titles { min-width: 0; }
header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
}
.hdr-desc {
  margin: 3px 0 0;
  font-size: var(--font-sm);
  color: var(--muted);
  line-height: 1.4;
  max-width: 52ch;
}
.tb-btn {
  display: inline-flex !important;
  align-items: center;
  gap: 4px;
  font-weight: 700 !important;
}
.form-wrap,
.json-wrap {
  overflow: visible;
  min-height: 0;
}
.group {
  position: relative;
  margin-bottom: 14px;
  border: 2px solid var(--ink);
  border-radius: 8px;
  padding: 0;
  background: var(--card);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.group::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 5px;
  background: var(--cyan);
  border-right: 2px solid var(--ink);
  z-index: 1;
}
.group + .group { margin-top: 4px; }
.group-h {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  padding: 10px 12px 10px 16px;
  background: color-mix(in srgb, var(--yellow) 55%, var(--paper-2));
  border-bottom: 3px solid var(--ink);
}
.group-rail {
  height: 3px;
  background: var(--ink);
}
.group-h-text { min-width: 0; flex: 1; }
.group h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.02em;
}
.group-desc {
  margin: 4px 0 0;
  font-size: var(--font-sm);
  color: var(--muted);
  line-height: 1.4;
}
.group-count {
  font-size: var(--font-xs);
  color: var(--ink);
  font-weight: 800;
  flex-shrink: 0;
  border: 1.5px solid var(--ink);
  border-radius: 999px;
  padding: 1px 8px;
  line-height: 1.6;
  background: var(--card);
}
.group .field-grid { padding: 0 10px 4px 14px; }
.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 16px;
  row-gap: 0;
  align-items: stretch;
}
.field {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 9px 4px;
  border-bottom: 2px solid var(--config-divider);
}
.field.full { grid-column: 1 / -1; }
.field.dirty {
  background: color-mix(in srgb, var(--pink) 12%, transparent);
  border-radius: 4px;
  padding-left: 6px;
  padding-right: 6px;
}
.field:not(.full) { min-height: 100%; }
.field:not(.full) .ctrl { margin-top: auto; padding-top: 4px; }
.dense .field { padding: 4px 2px; }
.dense .field-grid { column-gap: 10px; row-gap: 0; }
.dense .group { margin-bottom: 8px; }
.dense .group-h { padding: 6px 8px 6px 12px; }
.dense .group .field-grid { padding: 0 6px 2px 10px; }
.dense .meta { gap: 0; }
.dense .meta label { font-size: var(--font-sm); }
.dense .meta .desc {
  -webkit-line-clamp: 1;
  max-height: 1.4em;
  font-size: var(--font-xs);
}
.dense .meta .desc.compact {
  -webkit-line-clamp: 1;
  max-height: 1.4em;
}
.dense .ctrl { min-height: 26px; }
.dense .example { margin-top: 4px; padding: 4px 6px; }
.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 0 0 auto;
}
.meta label {
  display: block;
  font-size: var(--font-sm);
  font-weight: 700;
  line-height: 1.3;
  margin: 0;
}
.req { color: var(--red); }
.meta .desc {
  margin: 0;
  font-size: var(--font-xs);
  color: var(--muted);
  line-height: 1.4;
}
.meta .desc.compact {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  max-height: 2.8em;
}
.ctrl {
  flex: 0 0 auto;
  min-height: 28px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.ctrl-switch {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  min-height: 28px;
}
.example {
  margin-top: 6px;
  padding: 6px 8px;
  border: 1.5px dashed var(--ink);
  border-radius: 6px;
  background: color-mix(in srgb, var(--paper-2) 50%, var(--card));
  font-size: var(--font-xs);
  line-height: 1.4;
}
.example pre {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--mono);
  font-size: var(--font-xs);
}
.hint { margin: 4px 0 0; font-size: var(--font-xs); color: var(--muted); }
.placeholder { padding: 20px 0; }
.sys-chooser { padding: 4px 0; }
.sys-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 6px;
  margin-top: 6px;
}
.sys-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  padding: 8px;
  border: 1.5px solid var(--ink);
  border-radius: 8px;
  background: color-mix(in srgb, var(--cyan) 14%, var(--card));
  font: inherit;
  box-shadow: var(--shadow);
}
.sys-card:hover {
  transform: translate(-1px, -1px);
  box-shadow: 3px 3px 0 var(--ink);
}
.sys-card strong { font-size: 12px; }
.sys-card span { font-size: var(--font-xs); color: var(--muted); }
@container config (max-width: 720px) {
  .field-grid { grid-template-columns: 1fr; }
}
@container config (min-width: 1100px) {
  .dense .field-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  .config {
    display: flex;
    flex-direction: column;
    grid-template-columns: none;
  }
  .list-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1.5px solid var(--ink);
    border-radius: 8px;
    background: var(--cyan);
    font: inherit;
    font-size: var(--font-sm);
    font-weight: 800;
    padding: 8px 10px;
    box-shadow: var(--shadow);
    width: fit-content;
    max-width: 100%;
    flex-shrink: 0;
  }
  .scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 40;
    background: color-mix(in srgb, #000 45%, transparent);
  }
  .side {
    display: none;
  }
  .config.list-open .side {
    display: flex;
    flex-direction: column;
    position: fixed;
    z-index: 50;
    left: max(var(--gap), env(safe-area-inset-left));
    top: calc(var(--topbar-h) + var(--gap) * 3 + 48px);
    bottom: max(var(--gap), env(safe-area-inset-bottom));
    width: min(320px, calc(100vw - var(--gap) * 2));
    box-shadow: 4px 4px 0 var(--ink);
  }
  .editor {
    flex: 1;
    min-height: 0;
  }
  .field-grid { grid-template-columns: 1fr; }
  header :deep(.n-space) {
    width: 100%;
  }
  .tb-btn span {
    display: none;
  }
}
@media (min-width: 1400px) {
  .dense .field-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
