import { AsyncLocalStorage } from 'node:async_hooks';

/** 单次 stream.execute / callAI 异步链上的会话与 turn 状态（并发消息互不干扰） */
export const streamRequestAls = new AsyncLocalStorage();

export function runWithStreamRequestContext(ctx, fn) {
  return streamRequestAls.run(ctx, fn);
}

export function getStreamRequestContext() {
  return streamRequestAls.getStore() ?? null;
}
