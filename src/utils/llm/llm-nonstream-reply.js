/** 解析各工厂 `chat()` 返回值 */
export function unpackFactoryChatRaw(raw) {
  const TOOL_ROUNDS_EXHAUSTED_USER_TEXT =
    '本轮工具调用次数已达上限，任务还没收尾。你可以再说「继续」，或把需求拆小一点。';

  if (raw == null) {
    return { text: null, usedReplyTool: false, toolRoundsExhausted: false, executedToolNames: [] };
  }
  if (typeof raw === 'string') {
    return { text: raw, usedReplyTool: false, toolRoundsExhausted: false, executedToolNames: [] };
  }
  if (typeof raw !== 'object') {
    return { text: String(raw), usedReplyTool: false, toolRoundsExhausted: false, executedToolNames: [] };
  }

  const executedToolNames = Array.isArray(raw.executedToolNames) ? raw.executedToolNames : [];
  const usedReplyTool = !!raw.usedReplyTool;
  const toolRoundsExhausted = !!raw.toolRoundsExhausted;

  if (toolRoundsExhausted) {
    const text = raw.content != null ? String(raw.content) : TOOL_ROUNDS_EXHAUSTED_USER_TEXT;
    return { text, usedReplyTool, toolRoundsExhausted: true, executedToolNames };
  }
  if (raw.content === undefined && !usedReplyTool && !executedToolNames.length) {
    return { text: null, usedReplyTool: false, toolRoundsExhausted: false, executedToolNames };
  }

  const text = raw.content == null ? '' : String(raw.content);
  return { text, usedReplyTool, toolRoundsExhausted: false, executedToolNames };
}
