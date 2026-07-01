/**
 * chat 对话 MCP 工具流白名单：mergeStreams 副流 + 框架自研能力 + 远程 MCP
 */
import BotUtil from '#utils/botutil.js';
import StreamLoader from '#infrastructure/aistream/loader.js';

/** 框架自研能力流：chat 白名单始终包含（无需写入 mergeStreams） */
export const CHAT_FRAMEWORK_TOOL_STREAMS = ['web', 'browser'];

export function isChatToolSurface(stream) {
  if (!stream) return false;
  if (stream.name === 'chat' || stream.name === 'chat-merged') return true;
  if (stream.primaryStream === 'chat') return true;
  if (Array.isArray(stream._mergedStreams) && stream._mergedStreams.some((s) => s?.name === 'chat')) {
    return true;
  }
  return false;
}

export function appendRemoteMcpStreamNames(names) {
  try {
    for (const k of StreamLoader.remoteMCPServers.keys()) {
      const n = `remote-mcp.${k}`;
      if (!names.includes(n)) names.push(n);
    }
  } catch (err) {
    BotUtil.makeLog('debug', `读取远程 MCP 流名失败: ${err?.message || err}`, 'ChatToolStreams');
  }
}

/** 在已有流名基础上追加框架自研流与 remote-mcp.* */
export function expandChatToolStreamWhitelist(baseNames) {
  const names = [];
  const add = (n) => {
    const s = String(n ?? '').trim();
    if (s && !names.includes(s)) names.push(s);
  };
  if (Array.isArray(baseNames)) {
    for (const n of baseNames) add(n);
  }
  for (const n of CHAT_FRAMEWORK_TOOL_STREAMS) add(n);
  appendRemoteMcpStreamNames(names);
  return names;
}

/** 供 AIStream / HTTP 解析 LLM 工具白名单 */
export function resolveToolStreamNames(stream) {
  const base =
    stream?._mergedStreams && Array.isArray(stream._mergedStreams)
      ? stream._mergedStreams.map((s) => s.name)
      : [stream?.name].filter(Boolean);

  if (!isChatToolSurface(stream)) {
    return base;
  }
  return expandChatToolStreamWhitelist(base);
}

/**
 * 收集 mergeStreams / 框架副流上的 buildSystemPrompt，拼入主 chat system。
 * @param {import('./aistream.js').default} stream
 * @param {object} [context]
 */
export function collectAuxiliaryStreamPrompts(stream, context = {}) {
  if (!stream || !isChatToolSurface(stream)) return '';
  const names = resolveToolStreamNames(stream);
  const skip = new Set(['chat', 'chat-merged', stream.name].filter(Boolean));
  const parts = [];

  for (const name of names) {
    if (skip.has(name) || name.startsWith('remote-mcp.')) continue;
    const aux = StreamLoader.getStream(name);
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
