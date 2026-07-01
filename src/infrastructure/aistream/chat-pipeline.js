import BotUtil from '#utils/botutil.js';

/**
 * LLM 消息组装（工作流 / HTTP 共用，保证 prompt 结构与成本策略一致）
 */
export async function assembleChatLlmMessages(stream, e, question) {
  const questionObj = question != null && typeof question === 'object' && !Array.isArray(question)
    ? question
    : null;
  const enhancedQuestion = questionObj ?? (Array.isArray(question) ? undefined : question);

  let messages = Array.isArray(question)
    ? question
    : await stream.buildChatContext(e, questionObj ?? question);

  if (e && typeof stream.mergeMessageHistory === 'function') {
    messages = await stream.mergeMessageHistory(messages, e);
  }
  if (typeof stream.buildEnhancedContext === 'function') {
    messages = await stream.buildEnhancedContext(e, enhancedQuestion, messages);
  }
  return messages;
}

/** 调试：LLM 消息预览（role + 文本摘要） */
export function previewLlmMessages(messages) {
  return (messages || []).map((m, idx) => {
    const role = m.role || `msg${idx}`;
    let text = m.content;
    if (typeof text === 'object') {
      text = text?.text || text?.content || '';
    }
    return { idx, role, text: String(text ?? '') };
  });
}

/** 统一 debug 日志：最终送入 LLM 的消息结构 */
export function logLlmMessagePreview(stream, messages, tag = 'AIStream') {
  try {
    BotUtil.makeLog(
      'debug',
      `[${stream?.name || tag}] LLM消息预览: ${JSON.stringify(previewLlmMessages(messages), null, 2)}`,
      tag
    );
  } catch {
    /* ignore */
  }
}
