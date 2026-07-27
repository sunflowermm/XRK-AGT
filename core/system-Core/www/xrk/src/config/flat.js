/**
 * 配置扁平路径工具（对齐原 config-manager.js）
 */

import { deepClone } from '@/utils/http';

export function getNestedValue(obj = {}, path = '') {
  if (!path) return obj;
  return path.split('.').reduce((cur, key) => (cur != null ? cur[key] : undefined), obj);
}

export function castFieldValue(value, type, component) {
  const t = String(type || '').toLowerCase();
  const c = String(component || '').toLowerCase();
  if (t === 'number' || c === 'inputnumber' || c === 'number' || c === 'slider' || c === 'range') {
    if (value === '' || value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (t === 'boolean' || c === 'switch') {
    if (typeof value === 'string') {
      const s = value.toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(s)) return true;
      if (['false', '0', 'no', 'off'].includes(s)) return false;
    }
    return Boolean(value);
  }
  if (t === 'array<object>' || c === 'arrayform') {
    return Array.isArray(value) ? value : [];
  }
  if (t === 'array' || c === 'tags' || c === 'multiselect') {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return [];
  }
  if (t === 'object' || t === 'map' || c === 'json' || c === 'subform') {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    }
    return {};
  }
  return value;
}

/** 规范化后端 flat-structure 为可渲染字段列表 */
export function normalizeFlatFields(flat) {
  if (!flat) return [];
  let list = [];
  if (Array.isArray(flat)) list = flat.map(normalizeOneField).filter(Boolean);
  else if (typeof flat === 'object') {
    if (Array.isArray(flat.fields)) list = flat.fields.map(normalizeOneField).filter(Boolean);
    else {
      list = Object.entries(flat)
        .map(([path, schema]) => normalizeOneField({ ...(schema || {}), path: schema?.path || path }))
        .filter(Boolean);
    }
  }

  const paths = list.map((f) => f.path);
  /** @type {Map<string, { label: string, description: string }>} */
  const containers = new Map();

  for (const f of list) {
    const isObjLike =
      f.type === 'object' ||
      f.type === 'map' ||
      f.component === 'subform' ||
      f.component === 'json';
    if (!isObjLike) continue;
    const hasChildren = paths.some((p) => p.startsWith(`${f.path}.`) && !p.includes('[]'));
    // API 已标 container，或本地检测有子路径 → 分组壳，不进表单编辑
    if (f.container || hasChildren) {
      f.container = true;
      containers.set(f.path, { label: f.label, description: f.description });
    }
  }

  // 子字段归入最近容器的 label 分组（对齐原 buildFieldTree subGroups）
  for (const f of list) {
    if (f.container) continue;
    let best = '';
    for (const cpath of containers.keys()) {
      if (f.path.startsWith(`${cpath}.`) && cpath.length > best.length) best = cpath;
    }
    if (!best) continue;
    const info = containers.get(best);
    // 仅覆盖默认「基础」；显式 meta.group 保留
    if (!f.group || f.group === '基础' || f.group === '__default__') {
      f.group = info?.label || best.split('.').pop() || best;
    }
    if (!f.groupDesc && info?.description) f.groupDesc = info.description;
  }

  return list.filter((f) => !f.container);
}

function normalizeOneField(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
  const path = raw.path || raw.key || raw.name || meta.path;
  if (!path) return null;
  // 模板路径（providers[].model）仅服务 ArrayForm，首轮表单跳过
  if (String(path).includes('[]')) return null;
  const type = raw.type || meta.type || 'string';
  const component = String(
    raw.component || meta.component || mapTypeToComponent(type) || 'input',
  ).toLowerCase();
  const itemSchema = meta.itemSchema || raw.itemSchema || null;
  const itemFields = itemSchema?.fields || meta.fields || raw.fields || null;
  const container = Boolean(raw.container ?? meta.container);
  return {
    path,
    type,
    component,
    container,
    label: meta.label || meta.title || raw.label || raw.title || path.split('.').pop(),
    description: meta.description || meta.desc || raw.description || raw.desc || '',
    required: Boolean(meta.required ?? raw.required),
    options: normalizeOptions(meta.options || meta.enum || meta.choices || raw.options || raw.enum),
    group: meta.group || meta.section || raw.group || '基础',
    groupDesc: meta.groupDesc || raw.groupDesc || '',
    default: Object.prototype.hasOwnProperty.call(meta, 'default')
      ? meta.default
      : raw.default,
    min: meta.min ?? raw.min,
    max: meta.max ?? raw.max,
    step: meta.step ?? raw.step,
    placeholder: meta.placeholder || raw.placeholder || '',
    sensitive: Boolean(meta.sensitive || component === 'inputpassword'),
    layout: meta.layout || raw.layout,
    span: meta.span || raw.span,
    example: Object.prototype.hasOwnProperty.call(meta, 'example')
      ? meta.example
      : raw.example,
    itemLabel: meta.itemLabel || raw.itemLabel || '条目',
    itemFields: itemFields && typeof itemFields === 'object' ? itemFields : null,
  };
}

/** 从 /structure 取当前配置的 schema 根（对齐原 extractActiveSchema） */
export function extractActiveSchema(structure, name, child) {
  if (!structure) return null;
  if (name === 'system') {
    if (!child) return null;
    const target = structure.configs?.[child];
    return target?.schema ?? { fields: target?.fields ?? {} };
  }
  return structure.schema ?? { fields: structure.fields ?? {} };
}

/** 扫描 schema，得到 path → 数组项 fields（对齐原 buildArraySchemaIndex） */
export function buildArraySchemaIndex(schema, prefix = '', map = {}) {
  if (!schema || !schema.fields) return map;
  for (const [key, fieldSchema] of Object.entries(schema.fields)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (fieldSchema.type === 'array' && fieldSchema.itemType === 'object') {
      map[path] = fieldSchema.itemSchema?.fields ?? fieldSchema.fields ?? {};
    }
    if ((fieldSchema.type === 'object' || fieldSchema.type === 'map') && fieldSchema.fields) {
      buildArraySchemaIndex(fieldSchema, path, map);
    }
  }
  return map;
}

/** 从 flat-structure 的 providers[].x 模板路径补全 arraySchemas */
export function arraySchemasFromFlatTemplates(flat) {
  const map = {};
  const list = Array.isArray(flat) ? flat : Array.isArray(flat?.fields) ? flat.fields : [];
  for (const raw of list) {
    const path = raw?.path || raw?.meta?.path;
    if (!path || !String(path).includes('[]')) continue;
    const m = String(path).match(/^(.*)\[\](?:\.(.+))?$/);
    if (!m) continue;
    const parent = m[1];
    const rel = m[2];
    if (!map[parent]) map[parent] = {};
    if (!rel) continue;
    const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
    const node = {
      type: raw.type || meta.type || 'string',
      label: meta.label || raw.label || rel.split('.').pop(),
      description: meta.description || raw.description || '',
      component: raw.component || meta.component,
      default: Object.prototype.hasOwnProperty.call(meta, 'default') ? meta.default : raw.default,
      enum: meta.enum || meta.options || raw.enum,
      options: meta.options || meta.enum,
      min: meta.min ?? raw.min,
      max: meta.max ?? raw.max,
      step: meta.step ?? raw.step,
      placeholder: meta.placeholder || raw.placeholder || '',
      fields: meta.fields || raw.fields,
      layout: meta.layout || raw.layout,
      span: meta.span || raw.span,
    };
    setNestedSchemaField(map[parent], rel, node);
  }
  return map;
}

function setNestedSchemaField(root, relPath, node) {
  const parts = String(relPath).split('.');
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    if (i === parts.length - 1) {
      cur[key] = { ...(cur[key] || {}), ...node };
      return;
    }
    if (!cur[key] || typeof cur[key] !== 'object') {
      cur[key] = { type: 'object', fields: {} };
    }
    if (!cur[key].fields) cur[key].fields = {};
    cur = cur[key].fields;
  }
}

export function setNestedValue(source = {}, path = '', value) {
  if (!path) return deepClone(value);
  const clone = Array.isArray(source) ? [...source] : { ...source };
  const keys = path.split('.');
  let cursor = clone;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (i === keys.length - 1) {
      cursor[key] = deepClone(value);
    } else {
      const next = cursor[key];
      const blank = /^\d+$/.test(keys[i + 1]) ? [] : {};
      cursor[key] =
        next && typeof next === 'object' ? (Array.isArray(next) ? [...next] : { ...next }) : blank;
      cursor = cursor[key];
    }
  }
  return clone;
}

/** 按 itemSchema 生成新增条目默认值（对齐原 buildDefaultsFromFields） */
export function buildDefaultsFromFields(fields = {}) {
  const result = {};
  for (const [key, schema] of Object.entries(fields || {})) {
    if (!schema || typeof schema !== 'object') continue;
    if (schema.type === 'object' && schema.fields) {
      result[key] = buildDefaultsFromFields(schema.fields);
      continue;
    }
    if (schema.type === 'array') {
      result[key] = Array.isArray(schema.default) ? deepClone(schema.default) : [];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
      result[key] = deepClone(schema.default);
    }
  }
  return result;
}

export function resolveArrayItemFields(path, arraySchemas = {}, field = null) {
  if (arraySchemas?.[path] && Object.keys(arraySchemas[path]).length) {
    return arraySchemas[path];
  }
  if (field?.itemFields && Object.keys(field.itemFields).length) return field.itemFields;
  return {};
}

function mapTypeToComponent(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'boolean') return 'switch';
  if (t === 'number') return 'number';
  if (t === 'array<object>') return 'arrayform';
  if (t === 'array') return 'tags';
  if (t === 'object' || t === 'map') return 'json';
  if (t.includes('password')) return 'inputpassword';
  return 'input';
}

const FULL_COMPONENTS = new Set([
  'textarea',
  'text-area',
  'tags',
  'arrayform',
  'subform',
  'inputpassword',
  'json',
  'multiselect',
]);

const FULL_KEY_PATTERN =
  /^(wsUrl|baseUrl|path|instructions|promptCacheKey|safetyIdentifier|anthropicVersion|apiVersion|deployment|headers|extraBody|proxy|description|content|.*[Uu]rl)$/;

/**
 * 对齐原 config-page.resolveFieldSpanClass：
 * 半宽进两列网格；全宽占满一行。
 */
export function isFieldFullSpan(field) {
  if (!field) return true;
  const meta = field;
  if (meta.layout === 'full' || meta.span === 'full') return true;
  if (meta.layout === 'half' || meta.span === 'half') return false;

  const component = String(meta.component || '').toLowerCase();
  const type = String(meta.type || '').toLowerCase();
  const path = String(meta.path || '');
  const key = path.split('.').pop() || path;

  if (FULL_COMPONENTS.has(component)) return true;
  if (type.startsWith('array') || type === 'object' || type === 'map' || type === 'array<object>') {
    return true;
  }
  if (FULL_KEY_PATTERN.test(key)) return true;
  return false;
}

function normalizeOptions(opts) {
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

export function groupFields(fields) {
  const map = new Map();
  for (const f of fields) {
    const g = f.group || '基础';
    if (!map.has(g)) {
      map.set(g, { label: g, desc: f.groupDesc || '', items: [] });
    }
    const entry = map.get(g);
    if (!entry.desc && f.groupDesc) entry.desc = f.groupDesc;
    entry.items.push(f);
  }
  return [...map.values()];
}

export function formatGroupLabel(label) {
  if (!label || label === '基础' || label === '__default__') return '基础设置';
  return String(label).replace(/_/g, ' ');
}

export function formatExample(example) {
  if (example == null) return '';
  if (typeof example === 'string') return example;
  try {
    return JSON.stringify(example, null, 2);
  } catch {
    return String(example);
  }
}

/** 深度相等（对齐原 utils.isSameValue） */
export function isSameValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => isSameValue(item, b[i]));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => isSameValue(a[key], b[key]));
}

/**
 * 表单控件会改写类型（string↔number、null↔''）。
 * 比较 / 落盘前统一成 schema 类型，避免「未改也显示待保存」。
 */
export function canonicalizeFieldValue(value, type, component) {
  const c = String(component || '').toLowerCase();
  const t = String(type || '').toLowerCase();
  let v = castFieldValue(value, type, component);
  if (t === 'number' || c === 'inputnumber' || c === 'number' || c === 'slider' || c === 'range') {
    if (v === '' || v === undefined) return null;
    return v;
  }
  if (t === 'boolean' || c === 'switch') return Boolean(v);
  if (
    t === 'array' ||
    t === 'array<object>' ||
    c === 'tags' ||
    c === 'multiselect' ||
    c === 'arrayform'
  ) {
    return Array.isArray(v) ? v : [];
  }
  if (t === 'object' || t === 'map' || c === 'json' || c === 'subform') {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  if (v == null) return '';
  return v;
}

export function sameFieldValue(a, b, type, component) {
  return isSameValue(
    canonicalizeFieldValue(a, type, component),
    canonicalizeFieldValue(b, type, component),
  );
}

export function buildDirtyFlat(values, original, fields) {
  const flat = {};
  for (const f of fields) {
    const next = canonicalizeFieldValue(values[f.path], f.type, f.component);
    const prev = canonicalizeFieldValue(original[f.path], f.type, f.component);
    if (!isSameValue(next, prev)) flat[f.path] = next;
  }
  return flat;
}

export function valuesFromFlat(flat, fields) {
  const out = {};
  const src = flat && typeof flat === 'object' ? flat : {};
  for (const f of fields) {
    let raw;
    if (Object.prototype.hasOwnProperty.call(src, f.path)) {
      raw = deepClone(src[f.path]);
    } else if (Object.prototype.hasOwnProperty.call(f, 'default')) {
      raw = deepClone(f.default);
    } else if (f.component === 'switch') {
      raw = false;
    } else if (
      f.component === 'tags' ||
      f.component === 'multiselect' ||
      f.type === 'array<object>' ||
      f.component === 'arrayform'
    ) {
      raw = [];
    } else if (f.component === 'json' || f.component === 'subform' || f.type === 'object' || f.type === 'map') {
      raw = {};
    } else if (f.component === 'number' || f.component === 'inputnumber' || f.type === 'number') {
      raw = null;
    } else {
      raw = '';
    }
    out[f.path] = canonicalizeFieldValue(raw, f.type, f.component);
  }
  return out;
}
