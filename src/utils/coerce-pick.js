/** 返回第一个 !== undefined 的值 */
export function pickFirstDefined(...vals) {
  return vals.find((v) => v !== undefined);
}

/** 从 obj 按 keys 顺序取第一个已定义字段 */
export function pickFirstKey(obj, keys) {
  for (const k of keys) {
    if (Object.hasOwn(obj, k) && obj[k] !== undefined) return obj[k];
  }
  return;
}

/** 返回第一个非空 trim 字符串；无匹配时返回 '' */
export function pickTrimmed(...vals) {
  for (const v of vals) {
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** 返回第一个非空 URL/baseUrl 字符串 */
export function pickNonEmptyUrl(...vals) {
  return vals.find((v) => v != null && v !== '' && String(v).trim() !== '');
}

/** 浅合并 plain object（嵌套 object 递归合并） */
export function shallowMergePlain(...sources) {
  const out = {};
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    for (const [k, v] of Object.entries(src)) {
      if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = { ...(out[k] || {}), ...v };
      } else if (v !== undefined) {
        out[k] = v;
      }
    }
  }
  return out;
}
