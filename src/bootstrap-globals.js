/**
 * 运行时全局引导（须在 bot / 插件加载前 import 一次）
 * - plugin / segment：见 docs/runtime-surface.md
 * - 业务层勿 import #oicq；插件请 import plugin 基类
 */
import plugin from '#infrastructure/plugins/plugin.js';
import { segment } from '#oicq';
import { setRuntimeGlobal } from '#utils/runtime-globals.js';

setRuntimeGlobal('plugin', plugin);
setRuntimeGlobal('segment', segment);
