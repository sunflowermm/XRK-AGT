/** chat reply / 表情标记等对用户可见内容的 MCP 回执文案 */

export function createUserVisibleTurnState() {
  return {
    queuedReplyContent: '',
    queuedReplyMessageId: null,
    lastOutboundSummary: ''
  };
}

export const TOOL_DELIVERED_FOOTER = '已送达。';

export function formatSessionWhere(e) {
  if (e?.group_id) return `群 ${e.group_id}`;
  if (e?.user_id) return `用户 ${e.user_id}(私聊)`;
  return '当前会话';
}

export function formatUserVisibleSentAck(where, summary) {
  const line = String(summary ?? '').trim();
  if (!line) {
    return `你未向${where}发出新的可见内容。\n${TOOL_DELIVERED_FOOTER}`;
  }
  return `你已在${where}发出：${line}。用户在 QQ 里已能看到。\n${TOOL_DELIVERED_FOOTER}`;
}

export function formatUserVisibleDuplicateAck(where, alreadySent, attemptedTool) {
  const prev = String(alreadySent ?? '').trim();
  const tool = String(attemptedTool ?? 'reply').trim();
  return `你已在本次对话中向${where}发出过：${prev || '可见内容'}，用户已看到。本次 ${tool} 未再发送。\n${TOOL_DELIVERED_FOOTER}`;
}

/** AGT：reply 工具拟定正文，由 execute 在 tool 轮结束后统一 sendMessages */
export function formatReplyQueuedAck(where, content, messageId) {
  const line = String(content ?? '').trim();
  const ref = messageId != null && String(messageId).trim()
    ? `（引用消息 ${String(messageId).trim()}）`
    : '';
  return `你已通过 reply 拟定${where}的回复${ref}：「${line}」。框架将在本轮 tool 轮结束后统一发到 QQ，用户届时可见。若无其它工具任务，结束 tool 调用即可。\n${TOOL_DELIVERED_FOOTER}`;
}

export function formatDeliveredAck(where, sentLines) {
  const items = (Array.isArray(sentLines) ? sentLines : [sentLines]).map((s) => String(s ?? '').trim()).filter(Boolean);
  if (!items.length) {
    return `你未向${where}发出可见文字。\n${TOOL_DELIVERED_FOOTER}`;
  }
  const body = items.map((c, i) => `${i + 1}. ${c}`).join('\n');
  return `你已在${where}发出 ${items.length} 条文字：\n${body}\n用户在 QQ 里已能看到。若无其它待办，本轮结束。\n${TOOL_DELIVERED_FOOTER}`;
}

export function actionAck(detail) {
  const line = String(detail ?? '').trim();
  if (!line) return TOOL_DELIVERED_FOOTER;
  return `${line}\n${TOOL_DELIVERED_FOOTER}`;
}

function normalizeVisibleCompare(text) {
  return String(text ?? '')
    .replace(/\[回复:(?:ID:)?\d+\]/gi, '')
    .replace(/\[CQ:reply,id=\d+\]/gi, '')
    .replace(/\[at:\d{5,10}\]/gi, '')
    .replace(/\[(开心|惊讶|伤心|大笑|害怕|生气)\]/g, '')
    .replace(/[，。！？~、|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isOverlappingUserVisible(nextText, prevText) {
  const a = normalizeVisibleCompare(nextText);
  const b = normalizeVisibleCompare(prevText);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const words = (s) => s.split(/\s+/).filter((w) => w.length >= 4);
  const aw = words(a);
  const bw = words(b);
  if (!bw.length) return false;
  let hit = 0;
  for (const w of bw) {
    if (aw.some((x) => x.includes(w) || w.includes(x))) hit++;
  }
  return hit / bw.length >= 0.45;
}
