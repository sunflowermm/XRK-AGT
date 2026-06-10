/** 写入 OpenAI 风格 SSE data 行 */
export function writeSSEChunk(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

/** 构造 chat.completion.chunk 事件体 */
export function createOpenAIChunk({
  id,
  created,
  model,
  index = 0,
  delta = {},
  finishReason = null,
  usage,
  mcpTools,
  extra = {}
}) {
  const chunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    ...extra
  };

  if (Object.keys(delta || {}).length > 0 || finishReason !== null || usage) {
    chunk.choices = [{
      index,
      delta,
      finish_reason: finishReason
    }];
  }

  if (usage) chunk.usage = usage;
  if (Array.isArray(mcpTools) && mcpTools.length > 0) chunk.mcp_tools = mcpTools;

  return chunk;
}
