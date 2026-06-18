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
