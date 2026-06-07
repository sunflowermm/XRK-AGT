import { AsyncLocalStorage } from 'node:async_hooks';
import StreamLoader from '#infrastructure/aistream/loader.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import { auditToolUse, formatAuditDetail } from './ai-workspace-audit.js';
import { normalizePresetId } from './ai-workspace-runtime.js';

const consoleContext = new AsyncLocalStorage();
const auditByWorkspace = new Map();
const MAX_AUDIT_ENTRIES = 200;
let mcpAuditHookInstalled = false;

function normalizeWorkspaceId(id) {
  return normalizePresetId(id);
}

function isAuditEnabled() {
  const cfg = getAistreamConfigOptional();
  return cfg?.workspace?.audit?.enabled !== false;
}

async function recordToolAudit(toolName, { ok = true, detail = '' } = {}) {
  if (!isAuditEnabled()) return;
  const ctx = getAiConsoleContext();
  const workspaceId = ctx.workspaceId;
  if (!workspaceId || !toolName) return;

  const formatted = formatAuditDetail(detail);
  appendAiWorkspaceAudit({ workspaceId, tool: toolName, ok, detail: formatted });
  try {
    await auditToolUse(workspaceId, toolName, { ok, detail: formatted });
  } catch { /* 审计失败不阻断 */ }
}

/**
 * 包装 MCPServer.handleToolCall，在工作区上下文中记录工具审计。
 * MCP 尚未挂载时返回 false，调用方可稍后重试。
 */
export function installMcpAuditHook() {
  if (mcpAuditHookInstalled) return true;

  const server = StreamLoader.mcpServer;
  if (!server || typeof server.handleToolCall !== 'function') return false;

  const original = server.handleToolCall.bind(server);
  server.handleToolCall = async (request) => {
    const toolName = request?.name;
    try {
      const result = await original(request);
      if (toolName) {
        const ok = !result?.isError;
        const detail = ok ? '' : (result?.content?.[0]?.text || '');
        await recordToolAudit(toolName, { ok, detail });
      }
      return result;
    } catch (err) {
      if (toolName) {
        await recordToolAudit(toolName, { ok: false, detail: err?.message || String(err) });
      }
      throw err;
    }
  };

  mcpAuditHookInstalled = true;
  return true;
}

export function runWithAiConsoleContext(ctx = {}, fn) {
  const parent = consoleContext.getStore() || {};
  const next = { ...parent, ...ctx };
  return consoleContext.run(next, fn);
}

export function getAiConsoleContext() {
  return consoleContext.getStore() || {};
}

export function appendAiWorkspaceAudit(entry = {}) {
  const ctx = getAiConsoleContext();
  const workspaceId = normalizeWorkspaceId(entry.workspaceId ?? ctx.workspaceId);
  const list = auditByWorkspace.get(workspaceId) || [];
  list.unshift({
    ts: Date.now(),
    tool: entry.tool || entry.name || 'unknown',
    ok: entry.ok !== false,
    detail: entry.detail || entry.error || ''
  });
  if (list.length > MAX_AUDIT_ENTRIES) list.length = MAX_AUDIT_ENTRIES;
  auditByWorkspace.set(workspaceId, list);
}

/** @deprecated 审计以 jsonl 为准；保留供调试 */
export function listAiWorkspaceAudit(workspaceId, { limit = 50 } = {}) {
  const id = normalizeWorkspaceId(workspaceId);
  const list = auditByWorkspace.get(id) || [];
  const n = Math.max(1, Math.min(Number(limit) || 50, MAX_AUDIT_ENTRIES));
  return list.slice(0, n);
}
