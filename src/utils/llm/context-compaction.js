import LLMFactory from '#factory/llm/LLMFactory.js';
import RuntimeUtil from '#utils/runtime-util.js';
import { getAiWorkflowConfigOptional } from '#utils/ai-workflow-config.js';
import { resolveAuxLLMConfig } from '#utils/llm/llm-config-resolve.js';
import { estimateTokensMixed } from '#utils/token-estimate.js';
import {
  COMPACTION_SYSTEM,
  buildCompactionUserPrompt,
  formatCheckpointMessage
} from '#utils/llm/compaction-prompt.js';
import { unpackFactoryChatRaw } from '#utils/llm/llm-nonstream-reply.js';
import { stripReasoningContent } from '#utils/llm/strip-reasoning.js';
import { backupMessagesBeforeCompact } from '#utils/llm/compaction-backup.js';
import { redactSecrets } from '#utils/llm/secret-redact.js';
import { tryRenderStructuredSummary } from '#utils/llm/structured-summary.js';
import {
  projectCachedCompaction,
  storeCompactionSession
} from '#utils/llm/compaction-session-cache.js';
import { getWorkflowRequestContext } from '#infrastructure/ai-workflow/workflow-request-context.js';
import MonitorService from '#infrastructure/ai-workflow/monitor-service.js';

/**
 * 上下文压缩（融合 opencode head+recent / goose 阈值+结构化摘要 / aider ChatSummary / agent-zero 脱敏）。
 * 超预算或超消息条数时用 llm.aux（或主模型）摘要中间段，保留尾部原文。
 */

function getCompactionCfg() {
  const raw = getAiWorkflowConfigOptional().context?.compaction
    ?? getAiWorkflowConfigOptional().compaction
    ?? {};
  return {
    enabled: raw.enabled !== false && raw.auto !== false,
    threshold: typeof raw.threshold === 'number' ? raw.threshold : 0.9,
    keepRecentTokens: typeof raw.keepRecentTokens === 'number' ? raw.keepRecentTokens : 12000,
    toolOutputMaxChars: typeof raw.toolOutputMaxChars === 'number' ? raw.toolOutputMaxChars : 3500,
    summaryMaxTokens: typeof raw.summaryMaxTokens === 'number' ? raw.summaryMaxTokens : 1024,
    preserveLastUser: raw.preserveLastUser !== false,
    useAux: raw.useAux !== false,
    // OpenHands condenser_max_size：按消息条数触发
    maxMessages: typeof raw.maxMessages === 'number' ? raw.maxMessages : 48
  };
}

/** @param {unknown} content */
function contentToText(content, toolMax = 3500) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => {
      if (typeof p === 'string') return p;
      if (p?.type === 'text') return String(p.text ?? '');
      if (p?.type === 'tool_result' || p?.type === 'tool_use') {
        const s = JSON.stringify(p);
        return s.length > toolMax ? `${s.slice(0, toolMax)}…` : s;
      }
      return String(p?.text ?? p?.content ?? '');
    }).join('\n');
  }
  if (typeof content === 'object' && content.text) return String(content.text);
  try {
    const s = JSON.stringify(content);
    return s.length > toolMax ? `${s.slice(0, toolMax)}…` : s;
  } catch {
    return '';
  }
}

/**
 * @param {Array<Object>} messages
 * @param {number} toolMax
 */
export function serializeMessagesForCompaction(messages, toolMax = 3500) {
  const lines = [];
  for (const m of messages || []) {
    const role = String(m?.role || 'unknown').toUpperCase();
    let body = contentToText(m?.content, toolMax);
    if (Array.isArray(m?.tool_calls) && m.tool_calls.length) {
      body += `\n[tool_calls] ${JSON.stringify(m.tool_calls).slice(0, toolMax)}`;
    }
    body = redactSecrets(body.trim());
    if (!body) continue;
    lines.push(`${role}: ${body}`);
  }
  return lines.join('\n\n');
}

/**
 * @param {Array<Object>} messages
 * @param {number} keepTokens
 * @param {(t: unknown) => number} estimate
 */
export function splitHeadAndRecent(messages, keepTokens, estimate = estimateTokensMixed) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return { head: [], recent: [], headText: '', recentText: '' };

  const system = [];
  const rest = [];
  for (const m of list) {
    if ((m?.role || '').toLowerCase() === 'system' && system.length < 3) system.push(m);
    else rest.push(m);
  }

  let used = 0;
  const recentRev = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estimate(contentToText(rest[i]?.content))
      + (rest[i]?.tool_calls ? estimate(JSON.stringify(rest[i].tool_calls)) : 0);
    if (used + cost > keepTokens && recentRev.length > 0) break;
    recentRev.push(rest[i]);
    used += cost;
  }
  recentRev.reverse();
  const cut = rest.length - recentRev.length;
  const head = [...system, ...rest.slice(0, cut)];
  const recent = recentRev;
  return {
    head,
    recent,
    headText: serializeMessagesForCompaction(head),
    recentText: serializeMessagesForCompaction(recent)
  };
}

function extractPreviousSummary(messages) {
  for (let i = (messages?.length || 0) - 1; i >= 0; i--) {
    const t = contentToText(messages[i]?.content);
    const m = t.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/i);
    if (m) return m[1].trim();
  }
  return '';
}

function resolveCompactionSessionKey(opts = {}) {
  if (opts.sessionKey) return String(opts.sessionKey);
  const e = getWorkflowRequestContext()?.e;
  const parts = [
    opts.label || 'stream',
    e?.group_id ?? e?.groupId,
    e?.user_id ?? e?.userId ?? e?.sender?.user_id
  ].filter((x) => x != null && String(x).trim() !== '');
  return parts.join(':') || String(opts.label || 'default');
}

/**
 * @param {Array<Object>} messages
 * @param {{ budgetTokens: number, estimate?: Function, label?: string, sessionKey?: string }} opts
 * @returns {Promise<{ messages: Array<Object>, compacted: boolean, reused?: boolean }>}
 */
export async function compactMessagesIfNeeded(messages, opts = {}) {
  const cfg = getCompactionCfg();
  if (!cfg.enabled) return { messages, compacted: false };

  const estimate = opts.estimate || estimateTokensMixed;
  const budget = Math.floor(Number(opts.budgetTokens) || 0);
  if (budget < 800) return { messages, compacted: false };

  const sessionKey = resolveCompactionSessionKey(opts);
  // cline：前缀未变则投影缓存，跳过辅模型
  const projected = projectCachedCompaction(sessionKey, messages);
  let working = messages;
  let reused = false;
  if (projected) {
    working = projected;
    reused = true;
  }

  const est = (working || []).reduce((s, m) => {
    return s + estimate(contentToText(m?.content))
      + (m?.tool_calls ? estimate(JSON.stringify(m.tool_calls)) : 0);
  }, 0);

  const threshold = Math.max(0.5, Math.min(1, cfg.threshold));
  const overTokens = est > budget * threshold;
  const overCount = cfg.maxMessages > 0 && (working?.length || 0) > cfg.maxMessages;
  if (!overTokens && !overCount) {
    return { messages: working, compacted: reused, reused };
  }

  const { head, recent, headText, recentText } = splitHeadAndRecent(
    working,
    cfg.keepRecentTokens,
    estimate
  );

  if (!headText.trim() || head.length < 2) {
    return { messages: working, compacted: reused, reused };
  }

  let auxCfg = cfg.useAux ? resolveAuxLLMConfig({}) : null;
  if (!auxCfg) {
    // 无辅模型时仍可用主模型配置（由调用方传入）做一次摘要
    auxCfg = opts.fallbackConfig || null;
  }
  if (!auxCfg?.provider && !auxCfg?.model && !auxCfg?.baseUrl) {
    RuntimeUtil.makeLog(
      'debug',
      `[compaction] 超预算(est=${est}>${Math.floor(budget * threshold)})但无可用摘要模型，跳过`,
      'AiWorkflow'
    );
    return { messages: working, compacted: reused, reused };
  }

  const summaryCfg = {
    ...auxCfg,
    enableTools: false,
    maxTokens: cfg.summaryMaxTokens,
    temperature: auxCfg.temperature ?? 0.2
  };

  try {
    const backupPath = await backupMessagesBeforeCompact(working, { label: opts.label });
    const client = LLMFactory.createClient(summaryCfg);
    const promptMessages = [
      { role: 'system', content: COMPACTION_SYSTEM },
      {
        role: 'user',
        content: buildCompactionUserPrompt({
          previousSummary: extractPreviousSummary(working),
          headText
        })
      }
    ];
    const raw = await client.chat(promptMessages, {
      enableTools: false,
      tool_choice: 'none',
      mcpToolMode: 'passthrough'
    });
    const { text } = unpackFactoryChatRaw(raw);
    const stripped = stripReasoningContent(text);
    const structured = tryRenderStructuredSummary(stripped);
    const summary = redactSecrets(structured || stripped);
    if (!summary) return { messages: working, compacted: reused, reused };

    const checkpoint = formatCheckpointMessage({
      summary,
      recentText: redactSecrets(recentText),
      backupPath
    });
    const out = [];
    for (const m of working || []) {
      if ((m?.role || '').toLowerCase() === 'system') out.push(m);
    }
    const systems = out.slice(0, 2);
    const recentNoSystem = recent.filter((m) => (m?.role || '').toLowerCase() !== 'system');
    let preservedUser = null;
    if (cfg.preserveLastUser) {
      for (let i = (working || []).length - 1; i >= 0; i--) {
        if ((working[i]?.role || '').toLowerCase() === 'user') {
          const c = contentToText(working[i].content);
          if (c && !c.includes('<conversation-checkpoint>')) {
            preservedUser = working[i];
            break;
          }
        }
      }
    }

    const compactedMessages = [
      ...systems,
      { role: 'user', content: checkpoint },
      ...recentNoSystem
    ];
    if (
      preservedUser
      && !recentNoSystem.includes(preservedUser)
      && !compactedMessages.some((m) => m === preservedUser)
    ) {
      compactedMessages.push(preservedUser);
    }

    // cline：整段 working 作为已消化前缀；后续只追加新消息
    storeCompactionSession(sessionKey, {
      sourceMessages: working,
      compactedMessages,
      prefixCount: working.length
    });

    RuntimeUtil.makeLog(
      'info',
      `[compaction] ${opts.label || 'stream'} 压缩 ${working.length}→${compactedMessages.length} 条（est ${est} / budget ${budget}${reused ? ', after-cache-project' : ''}）`,
      'AiWorkflow'
    );
    try {
      MonitorService.emit('context:compaction', {
        label: opts.label || 'stream',
        sessionKey,
        before: working.length,
        after: compactedMessages.length,
        est,
        budget,
        reused: false
      });
    } catch {
      /* ignore */
    }
    return { messages: compactedMessages, compacted: true, reused: false };
  } catch (err) {
    RuntimeUtil.makeLog(
      'warn',
      `[compaction] 摘要失败，回退裁剪: ${Error.isError(err) ? err.message : String(err)}`,
      'AiWorkflow'
    );
    return { messages: working, compacted: reused, reused };
  }
}
