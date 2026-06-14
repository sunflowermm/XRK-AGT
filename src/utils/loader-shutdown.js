/**
 * 停机时统一停止各 Loader 热重载与插件资源，避免 chokidar / 定时器泄漏。
 */
import PluginsLoader from '#infrastructure/plugins/loader.js';
import ApiLoader from '#infrastructure/http/loader.js';
import ConfigLoader from '#infrastructure/commonconfig/loader.js';
import StreamLoader from '#infrastructure/aistream/loader.js';
import cfg from '#infrastructure/config/config.js';
import RendererLoader from '#infrastructure/renderer/loader.js';
import { setShuttingDown } from '#utils/runtime-globals.js';

export async function stopAllLoaderWatchers() {
  setShuttingDown(true);
  // 先停业务 Loader，再停 YAML/模板 watcher，避免 close 事件回调重入
  await PluginsLoader.destroy().catch(() => {});
  await StreamLoader.cleanupAll().catch(() => {});
  await ApiLoader.watch(false).catch(() => {});
  await ConfigLoader.watch(false).catch(() => {});
  await RendererLoader.stopAllWatchers().catch(() => {});
  await cfg.destroy().catch(() => {});
}
