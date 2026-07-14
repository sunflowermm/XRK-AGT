const MCP_TOOL_TEXT_MAX_JSON = 8000;

function capToolText(text, maxLen = MCP_TOOL_TEXT_MAX_JSON) {
  const s = String(text ?? '');
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}\n…(工具输出已截断 ${s.length} 字符，请概括要点后结束 tool 轮)`;
}

/** 将工具返回值整理为 AI 可读文本（优先 raw / message，避免整段 JSON 误导模型重复调用） */
export function summarizeToolResultText(result, maxLen = MCP_TOOL_TEXT_MAX_JSON) {
  if (result == null) return '已执行';
  if (typeof result !== 'object') return capToolText(String(result), maxLen);
  if (result.success === false) {
    const err = result.error;
    const out = typeof err === 'string' ? err : (err?.message || JSON.stringify(err));
    return capToolText(out, maxLen);
  }
  if (typeof result.raw === 'string' && result.raw.trim()) {
    return capToolText(result.raw.trim(), maxLen);
  }
  const msg = result.message;
  if (msg != null && msg !== '') {
    return capToolText(String(msg), maxLen);
  }
  const data = result.data;
  if (data != null) {
    if (typeof data === 'string') return capToolText(data, maxLen);
    try {
      const str = JSON.stringify(data);
      if (str && str !== '{}') return capToolText(str, maxLen);
    } catch {
      /* ignore */
    }
  }
  try {
    const str = JSON.stringify(result);
    if (str && str !== '{}') return capToolText(str, maxLen);
  } catch {
    /* ignore */
  }
  return '已执行';
}

const HISTORY_ARG_KEYS = ['command', 'query', 'path', 'url', 'messageId', 'limit', 'content', 'saveAs'];

/**
 * 写入下一轮群聊 prompt 的工具摘要（短；对外 reply 类工具应跳过记录）。
 * 语义对齐 XRK-Yunzai：只进历史，不出现在用户可见气泡。
 *
 * @param {string} toolName
 * @param {unknown} result
 * @param {Record<string, unknown> | null} [args]
 * @param {number} [maxLen=600]
 * @returns {string}
 */
export function summarizeToolForHistory(toolName, result, args = null, maxLen = 600) {
  const full = String(toolName || 'tool');
  const shortName = full.includes('.') ? full.split('.').slice(-2).join('.') : full;
  let argHint = '';
  if (args && typeof args === 'object') {
    for (const key of HISTORY_ARG_KEYS) {
      if (args[key] == null || args[key] === '') continue;
      const s = String(args[key]).replace(/\s+/g, ' ').trim();
      if (!s) continue;
      argHint = s.length > 100 ? `${s.slice(0, 100)}…` : s;
      break;
    }
  }
  const head = argHint ? `${shortName}「${argHint}」` : shortName;
  if (result && typeof result === 'object' && /** @type {{ success?: boolean }} */ (result).success === false) {
    const err = typeof /** @type {{ error?: unknown }} */ (result).error === 'string'
      ? /** @type {{ error: string }} */ (result).error
      : (/** @type {{ error?: { message?: string } }} */ (result).error?.message || summarizeToolResultText(result, 200));
    return capToolText(`${head} → 失败: ${String(err).slice(0, 220)}`, maxLen);
  }
  const body = summarizeToolResultText(result, Math.max(80, maxLen - head.length - 4));
  return `${head} → ${body}`.slice(0, maxLen + 80);
}
