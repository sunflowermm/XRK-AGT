/**
 * 运行时全局引导（须在 bot / 插件加载前 import 一次）
 * - global.plugin / global.segment 供 core 插件与 runtime 使用，业务层勿再 import #oicq
 */
import plugin from '#infrastructure/plugins/plugin.js';
import { segment } from '#oicq';

global.plugin = plugin;
global.segment = segment;
