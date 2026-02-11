/**
 * 通用 SSE 解析器（适用于各类 LLM / 子进程流式接口）
 *
 * 特性：
 * - 兼容 chunk 边界：单个 JSON 事件可能被拆分到多个 chunk 中
 * - 以空行（\n\n）分隔事件，兼容多行 data: 形式
 * - 自动处理 CRLF（\r\n）与 LF，避免换行差异导致解析失败
 * - 默认在遇到 data: [DONE] 时结束迭代（可通过 options.stopOnDone 关闭）
 *
 * 用法示例：
 * for await (const { event, data } of iterateSSE(resp)) {
 *   // event: 可选的事件名（来自 event: xxx）
 *   // data:  单条 data: 的聚合内容（多行 data 会按 \n 拼接）
 * }
 *
 * 本工具被以下组件复用：
 * - 所有 OpenAI-like LLM 工厂的 chatStream（OpenAI/Azure/Volcengine/XiaomiMiMo 等）
 * - aistream 子服务器调用（src/infrastructure/aistream/aistream.js）
 * - 其他需要稳健解析 SSE 的场景
 */
export async function* iterateSSE(resp, options = {}) {
  const { stopOnDone = true } = options || {};
  if (!resp?.body?.getReader) throw new Error('SSE响应无效：resp.body 不可读');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    // 统一 CRLF -> LF，避免分隔符匹配失败
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let sep;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      const lines = rawEvent.split('\n');
      let event = null;
      const dataParts = [];

      for (let line of lines) {
        if (!line) continue;
        // 允许前导空格，但不强求 trim 以避免破坏 data 内容
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('event:')) {
          event = trimmed.slice(6).trim();
          continue;
        }
        if (trimmed.startsWith('data:')) {
          // data: 后面可能紧跟空格；保持原 payload 的换行结构
          dataParts.push(trimmed.slice(5).trimStart());
        }
      }

      if (!dataParts.length) continue;
      const data = dataParts.join('\n');

      if (stopOnDone && data === '[DONE]') return;
      yield { event, data, rawEvent };
    }
  }
}

