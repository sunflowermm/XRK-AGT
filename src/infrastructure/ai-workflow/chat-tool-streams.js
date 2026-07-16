/**
 * chat 对话 MCP 工具流白名单：mergeWorkflows 副流 + frameworkToolSurface 流 + 远程 MCP
 */
import RuntimeUtil from '#utils/runtime-util.js';
import AiWorkflowLoader from '#infrastructure/ai-workflow/loader.js';

/** 未声明 frameworkToolSurface 时的兼容回退（web/browser） */
export const CHAT_FRAMEWORK_TOOL_WORKFLOWS = ['web', 'browser'];

/** 是否对话 Agent 工具表面（chat 或以其为主流的合成实例） */
export function isChatToolSurface(stream) {
  if (!stream) return false;
  if (stream.name === 'chat') return true;
  if (stream.primaryStream === 'chat') return true;
  if (Array.isArray(stream._mergedStreams) && stream._mergedStreams.some((s) => s?.name === 'chat')) {
    return true;
  }
  // 兼容历史命名 chat-* / chat-merged
  if (typeof stream.name === 'string' && (stream.name === 'chat-merged' || stream.name.startsWith('chat-'))) {
    return true;
  }
  return false;
}

/** 扫描已加载流上的 frameworkToolSurface；若无则回退硬编码名单 */
export function getFrameworkToolWorkflowNames() {
  const fromMeta = [];
  try {
    for (const s of AiWorkflowLoader.workflows.values()) {
      if (!s?.frameworkToolSurface || !s.name) continue;
      if (Array.isArray(s._mergedStreams) && s._mergedStreams.length > 0) continue;
      if (!fromMeta.includes(s.name)) fromMeta.push(s.name);
    }
  } catch (err) {
    RuntimeUtil.makeLog('debug', `扫描 frameworkToolSurface 失败: ${err?.message || err}`, 'ChatToolStreams');
  }
  if (fromMeta.length) return fromMeta;
  return [...CHAT_FRAMEWORK_TOOL_WORKFLOWS];
}

export function appendRemoteMcpStreamNames(names) {
  try {
    for (const k of AiWorkflowLoader.remoteMCPServers.keys()) {
      const n = `remote-mcp.${k}`;
      if (!names.includes(n)) names.push(n);
    }
  } catch (err) {
    RuntimeUtil.makeLog('debug', `读取远程 MCP 流名失败: ${err?.message || err}`, 'ChatToolStreams');
  }
}

/** 在已有流名基础上追加框架自研流与 remote-mcp.* */
export function expandChatToolWorkflowWhitelist(baseNames) {
  const names = [];
  const add = (n) => {
    const s = String(n ?? '').trim();
    if (s && !names.includes(s)) names.push(s);
  };
  if (Array.isArray(baseNames)) {
    for (const n of baseNames) add(n);
  }
  for (const n of getFrameworkToolWorkflowNames()) add(n);
  appendRemoteMcpStreamNames(names);
  return names;
}

/** 供 AiWorkflow / HTTP 解析 LLM 工具白名单 */
export function resolveToolStreamNames(stream) {
  const base =
    stream?._mergedStreams && Array.isArray(stream._mergedStreams) && stream._mergedStreams.length > 0
      ? stream._mergedStreams.map((s) => s.name)
      : [stream?.name].filter(Boolean);

  if (!isChatToolSurface(stream)) {
    return base;
  }
  return expandChatToolWorkflowWhitelist(base);
}

/**
 * 收集 mergeWorkflows / 框架副流上的 buildSystemPrompt，拼入主 chat system。
 * @param {import('./ai-workflow.js').default} stream
 * @param {object} [context]
 */
export function collectAuxiliaryStreamPrompts(stream, context = {}) {
  if (!stream || !isChatToolSurface(stream)) return '';
  const names = resolveToolStreamNames(stream);
  const skip = new Set(['chat', stream.name].filter(Boolean));
  const parts = [];

  for (const name of names) {
    if (skip.has(name) || name.startsWith('remote-mcp.') || name.startsWith('chat-')) continue;
    const aux = AiWorkflowLoader.getWorkflow(name);
    if (!aux || typeof aux.buildSystemPrompt !== 'function') continue;
    try {
      const out = aux.buildSystemPrompt(context);
      const text = typeof out === 'string' ? out : (out != null ? String(out) : '');
      if (text.trim()) parts.push(`### ${name}\n${text.trim()}`);
    } catch {
      /* 非 chat 副流可能仍为抽象基类默认实现 */
    }
  }

  if (!parts.length) return '';
  return `\n\n## 可用能力\n\n${parts.join('\n\n')}`;
}
