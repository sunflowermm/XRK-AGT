/**
 * 停机时统一停止各 Loader 热重载与插件资源，避免 chokidar / 定时器泄漏。
 */
import PluginsLoader from '#infrastructure/plugins/loader.js';
import ApiLoader from '#infrastructure/http/loader.js';
import ConfigLoader from '#infrastructure/commonconfig/loader.js';
import StreamLoader from '#infrastructure/aistream/loader.js';

export async function stopAllLoaderWatchers() {
  await Promise.allSettled([
    PluginsLoader.destroy(),
    StreamLoader.cleanupAll(),
    ApiLoader.watch(false),
    ConfigLoader.watch(false)
  ]);
}
