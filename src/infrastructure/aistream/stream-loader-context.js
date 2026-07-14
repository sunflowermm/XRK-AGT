import StreamLoader from '#infrastructure/aistream/loader.js';
import { getStreamRequestContext } from '#infrastructure/aistream/stream-request-context.js';

/**
 * 遗留：在无 ALS 时绑定 StreamLoader.currentEvent。
 * chat / 基类 execute 已用 runWithStreamRequestContext；有 ALS 时不再写 currentEvent。
 * @deprecated 新代码只依赖 ALS。
 * @template T
 * @param {object|null} e
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withStreamLoaderEvent(e, fn) {
  if (getStreamRequestContext()) {
    return fn();
  }
  try {
    StreamLoader.currentEvent = e || null;
    return await fn();
  } finally {
    if (StreamLoader.currentEvent === e) StreamLoader.currentEvent = null;
  }
}
