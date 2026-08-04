/**
 * goose 式结构化摘要：若模型输出 JSON，渲染为 Markdown；否则原样返回。
 */

/**
 * @param {string} text
 * @returns {string|null} JSON 对象字符串
 */
function extractJsonObject(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : s).trim();
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

function asList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean);
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  return [String(v)];
}

/**
 * @param {unknown} raw
 * @returns {string|null} 渲染后的 Markdown；无法解析则 null
 */
export function tryRenderStructuredSummary(raw) {
  const jsonStr = extractJsonObject(String(raw || ''));
  if (!jsonStr) return null;
  let obj;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const lines = [];
  const pushSec = (title, items) => {
    const list = asList(items);
    if (!list.length) return;
    lines.push(`## ${title}`);
    for (const it of list.slice(0, 12)) lines.push(`- ${it}`);
    lines.push('');
  };

  pushSec('Objective', obj.user_intent ?? obj.objective ?? obj.current_objective);
  pushSec('Decisions', obj.decisions ?? obj.assumptions ?? obj.technical_concepts);
  if (obj.current_work || obj.pending_tasks || obj.work_state) {
    lines.push('## Work State');
    if (obj.current_work) lines.push(`- Active: ${obj.current_work}`);
    for (const t of asList(obj.pending_tasks).slice(0, 8)) lines.push(`- Pending: ${t}`);
    for (const t of asList(obj.work_state).slice(0, 8)) lines.push(`- ${t}`);
    lines.push('');
  }
  const files = obj.files ?? obj.relevant_files;
  if (Array.isArray(files) && files.length) {
    lines.push('## Relevant Files');
    for (const f of files.slice(0, 16)) {
      if (typeof f === 'string') lines.push(`- ${f}`);
      else if (f && typeof f === 'object') {
        lines.push(`- ${f.path || '?'}${f.summary ? `: ${f.summary}` : ''}`);
      }
    }
    lines.push('');
  }
  pushSec('Errors', obj.errors_and_fixes ?? obj.blockers);
  if (obj.next_step || obj.nextMove) {
    lines.push('## Next Move');
    lines.push(`- ${obj.next_step || obj.nextMove}`);
    lines.push('');
  }

  const out = lines.join('\n').trim();
  return out.length >= 40 ? out : null;
}
