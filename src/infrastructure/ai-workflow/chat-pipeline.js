import RuntimeUtil from '#utils/runtime-util.js';

/**
 * LLM 消息组装（工作流 / HTTP 共用）。
 *
 * 稳定分层（内容语义对齐 Yunzai，实现仍走本仓库 Loader / AiWorkflow）：
 * 1. `buildChatContext` — `system`（人设+协议+工作区）+ 当前用户消息骨架
 * 2. `mergeMessageHistory` — 群/会话笔录为 user 块（【我】/【我·工具】/他人），当前轮 `[当前消息]`
 * 3. `buildEnhancedContext` — 易变切片（时间/会话/主人）插入 system 后，勿塞进 system 以免搅乱前缀缓存
 *
 * 工具调用轨迹：用户可见靠 reply MCP；下一轮延续靠 `recordToolCallResult`，不往用户气泡贴「使用了」。
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
export function logLlmMessagePreview(stream, messages, tag = 'AiWorkflow') {
  try {
    RuntimeUtil.makeLog(
      'debug',
      `[${stream?.name || tag}] LLM消息预览: ${JSON.stringify(previewLlmMessages(messages), null, 2)}`,
      tag
    );
  } catch {
    /* ignore */
  }
}
