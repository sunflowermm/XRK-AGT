/**
 * 停机时统一停止各 Loader 热重载与插件资源，避免 chokidar / 定时器泄漏。
 * 覆盖：Plugins / Stream / Api / CommonConfig / Renderer / runtimeConfig。
 * 不含 events / tasker（无热重载监视器）。
 */
import PluginLoader from '#infrastructure/plugins/loader.js';
import HttpApiLoader from '#infrastructure/http/loader.js';
import CommonConfigRegistry from '#infrastructure/commonconfig/loader.js';
import AiStreamLoader from '#infrastructure/ai-workflow/loader.js';
import runtimeConfig from '#infrastructure/config/config.js';
import RendererLoader from '#infrastructure/renderer/loader.js';
import { setShuttingDown } from '#utils/runtime-globals.js';

export async function stopAllLoaderWatchers() {
  setShuttingDown(true);
  // 先停业务 Loader，再停 YAML/模板 watcher，避免 close 事件回调重入
  await PluginLoader.destroy().catch(() => {});
  await AiStreamLoader.cleanupAll().catch(() => {});
  await HttpApiLoader.watch(false).catch(() => {});
  await CommonConfigRegistry.watch(false).catch(() => {});
  await RendererLoader.stopAllWatchers().catch(() => {});
  await runtimeConfig.destroy().catch(() => {});
}
