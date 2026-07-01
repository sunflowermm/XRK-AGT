import StreamLoader from '#infrastructure/aistream/loader.js';

/**
 * 在单次 stream 执行期间绑定 StreamLoader.currentEvent（供 MCP 工具读会话上下文）
 * @template T
 * @param {object|null} e
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withStreamLoaderEvent(e, fn) {
  let loader = null;
  try {
    loader = StreamLoader;
    if (loader) loader.currentEvent = e || null;
    if (typeof Bot !== 'undefined' && Bot?.StreamLoader) {
      Bot.StreamLoader.currentEvent = e || null;
    }
    return await fn();
  } finally {
    if (loader?.currentEvent === e) loader.currentEvent = null;
  }
}
