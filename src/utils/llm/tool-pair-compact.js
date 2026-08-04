import RuntimeUtil from '#utils/runtime-util.js';
import { getAiWorkflowConfigOptional } from '#utils/ai-workflow-config.js';
import { estimateTokensMixed } from '#utils/token-estimate.js';
import LLMFactory from '#factory/llm/LLMFactory.js';
import { resolveAuxLLMConfig } from '#utils/llm/llm-config-resolve.js';
import { unpackFactoryChatRaw } from '#utils/llm/llm-nonstream-reply.js';
import { stripReasoningContent } from '#utils/llm/strip-reasoning.js';
import { redactSecrets } from '#utils/llm/secret-redact.js';

/**
 * 旧 tool 结果压缩（对齐 goose tool_pair_summarization）。
 * 默认启发式；useLlm=true 时用 aux 对一批旧 tool 各写一句话（不改持久历史）。
 */

const BATCH = 8;

function getToolPairCfg() {
  const raw = getAiWorkflowConfigOptional().context?.toolPair ?? {};
  return {
    enabled: raw.enabled !== false,
    protectLastN: typeof raw.protectLastN === 'number' ? raw.protectLastN : 8,
    maxResultChars: typeof raw.maxResultChars === 'number' ? raw.maxResultChars : 800,
    batchSize: typeof raw.batchSize === 'number' ? Math.min(30, Math.max(1, raw.batchSize)) : BATCH,
    useLlm: raw.useLlm === true
  };
}

/** goose: (3 * effective_limit / 20000).clamp(10, 500) */
export function computeToolPairCutoff(contextWindow, threshold = 0.85) {
  const t = threshold > 0 && threshold <= 1 ? threshold : 0.85;
  const ctx = Number(contextWindow) || 128_000;
  const effective = Math.floor(ctx * t);
  return Math.min(500, Math.max(10, Math.floor((3 * effective) / 20_000)));
}

/**
 * @param {string} name
 * @param {unknown} content
 * @param {number} maxChars
 */
export function heuristicToolSummary(name, content, maxChars = 400) {
  const tool = String(name || 'tool');
  const raw = typeof content === 'string' ? content : (() => {
    try { return JSON.stringify(content); } catch { return String(content ?? ''); }
  })();
  if (!raw) return `[${tool}] (空结果)`;

  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') {
      if (j.success === false) {
        const err = typeof j.error === 'string' ? j.error : (j.error?.message || JSON.stringify(j.error));
        return `[${tool}] 失败: ${String(err).slice(0, maxChars)}`;
      }
      if (typeof j.raw === 'string' && j.raw.trim()) {
        const s = j.raw.trim();
        return `[${tool}] ${s.length > maxChars ? `${s.slice(0, maxChars)}…` : s}`;
      }
      if (typeof j.message === 'string') {
        return `[${tool}] ${j.message.slice(0, maxChars)}`;
      }
      if (j.data != null) {
        const d = typeof j.data === 'string' ? j.data : JSON.stringify(j.data);
        return `[${tool}] ${d.length > maxChars ? `${d.slice(0, maxChars)}…` : d}`;
      }
    }
  } catch {
    /* plain text */
  }
  return `[${tool}] ${raw.length > maxChars ? `${raw.slice(0, maxChars)}…` : raw}`;
}

async function llmSummarizeToolBatch(items, maxChars) {
  const aux = resolveAuxLLMConfig({});
  if (!aux?.provider && !aux?.baseUrl && !aux?.model) return null;

  const listing = items.map((it, i) => {
    const body = redactSecrets(String(it.content || '').slice(0, 2500));
    return `### ${i + 1}. ${it.name}\n${body}`;
  }).join('\n\n');

  try {
    const client = LLMFactory.createClient({
      ...aux,
      enableTools: false,
      maxTokens: Math.min(1200, maxChars * items.length),
      temperature: 0.2
    });
    const raw = await client.chat([
      {
        role: 'system',
        content:
          '将每条工具调用结果压缩为一句中文（保留关键路径/错误/数量）。按输入编号输出，每行：N|一句话。不要密钥明文。'
      },
      { role: 'user', content: listing }
    ], { enableTools: false, tool_choice: 'none', mcpToolMode: 'passthrough' });
    const { text } = unpackFactoryChatRaw(raw);
    const lines = stripReasoningContent(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const map = new Map();
    for (const line of lines) {
      const m = line.match(/^(\d+)\s*[|:.、]\s*(.+)$/);
      if (m) map.set(Number(m[1]), m[2].slice(0, maxChars));
    }
    if (!map.size) return null;
    return map;
  } catch (err) {
    RuntimeUtil.makeLog(
      'warn',
      `[tool-pair] LLM 批摘要失败，回退启发式: ${Error.isError(err) ? err.message : String(err)}`,
      'AiWorkflow'
    );
    return null;
  }
}

/**
 * 同步投影（仅启发式）。
 * @param {Array<Object>} messages
 * @param {{ contextWindow?: number, threshold?: number }} [opts]
 */
export function projectToolPairView(messages, opts = {}) {
  const cfg = getToolPairCfg();
  if (!cfg.enabled || !Array.isArray(messages) || messages.length === 0) {
    return { messages: messages || [], summarized: 0 };
  }

  const cutoff = computeToolPairCutoff(opts.contextWindow, opts.threshold);
  const toolIdx = [];
  for (let i = 0; i < messages.length; i++) {
    if ((messages[i]?.role || '').toLowerCase() === 'tool') toolIdx.push(i);
  }

  const eligible = toolIdx.length - cfg.protectLastN;
  if (eligible <= cutoff + cfg.batchSize) {
    return { messages: messages.map((m) => ({ ...m })), summarized: 0 };
  }

  const toCompact = toolIdx.slice(0, cfg.batchSize);
  const out = messages.map((m) => ({ ...m }));
  let summarized = 0;

  for (const idx of toCompact) {
    const m = out[idx];
    const content = m.content;
    const len = typeof content === 'string' ? content.length : JSON.stringify(content ?? '').length;
    if (len <= cfg.maxResultChars) continue;
    out[idx] = {
      ...m,
      content: heuristicToolSummary(m.name || 'tool', content, cfg.maxResultChars),
      _toolPairCompacted: true
    };
    summarized++;
  }

  if (summarized > 0) {
    RuntimeUtil.makeLog(
      'info',
      `[tool-pair] 投影压缩 ${summarized} 条旧 tool 结果（total=${toolIdx.length}, cutoff=${cutoff}, protect=${cfg.protectLastN}）`,
      'AiWorkflow'
    );
  }

  return { messages: out, summarized };
}

/**
 * 异步投影：可选 aux LLM 批摘要，失败回退启发式。
 * @param {Array<Object>} messages
 * @param {{ contextWindow?: number, threshold?: number, fallbackConfig?: object }} [opts]
 */
export async function projectToolPairViewAsync(messages, opts = {}) {
  const cfg = getToolPairCfg();
  const sync = projectToolPairView(messages, opts);
  if (!cfg.useLlm || !sync.summarized) return sync;

  const toolIdx = [];
  for (let i = 0; i < sync.messages.length; i++) {
    if ((sync.messages[i]?.role || '').toLowerCase() === 'tool' && sync.messages[i]._toolPairCompacted) {
      toolIdx.push(i);
    }
  }
  if (!toolIdx.length) return sync;

  // 用原始 messages 内容做 LLM 摘要（投影前）
  const items = toolIdx.map((idx) => ({
    name: messages[idx]?.name || 'tool',
    content: messages[idx]?.content
  }));
  const map = await llmSummarizeToolBatch(items, cfg.maxResultChars);
  if (!map) return sync;

  const out = sync.messages.map((m) => ({ ...m }));
  let i = 1;
  for (const idx of toolIdx) {
    const line = map.get(i);
    if (line) {
      out[idx] = {
        ...out[idx],
        content: `[${out[idx].name || 'tool'}] ${line}`,
        _toolPairCompacted: true,
        _toolPairLlm: true
      };
    }
    i++;
  }
  RuntimeUtil.makeLog('info', `[tool-pair] LLM 批摘要 ${toolIdx.length} 条`, 'AiWorkflow');
  return { messages: out, summarized: toolIdx.length };
}

export function estimateToolPairSavings(before, after) {
  const a = (before || []).reduce((s, m) => s + estimateTokensMixed(
    typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
  ), 0);
  const b = (after || []).reduce((s, m) => s + estimateTokensMixed(
    typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
  ), 0);
  return { before: a, after: b, saved: Math.max(0, a - b) };
}
