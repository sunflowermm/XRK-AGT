import AiStreamLoader from '#infrastructure/ai-workflow/loader.js';
import { getStreamRequestContext } from '#infrastructure/ai-workflow/stream-request-context.js';

/**
 * 遗留：在无 ALS 时绑定 AiStreamLoader.currentEvent。
 * chat / 基类 execute 已用 runWithStreamRequestContext；有 ALS 时不再写 currentEvent。
 * @deprecated 新代码只依赖 ALS。
 * @template T
 * @param {object|null} e
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withAiStreamLoaderEvent(e, fn) {
  if (getStreamRequestContext()) {
    return fn();
  }
  try {
    AiStreamLoader.currentEvent = e || null;
    return await fn();
  } finally {
    if (AiStreamLoader.currentEvent === e) AiStreamLoader.currentEvent = null;
  }
}
