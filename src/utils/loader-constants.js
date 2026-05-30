/**
 * Loader 扫描约定（FileLoader / core-fs / 框架基准测试共用）
 */

/** 扫描时忽略的文件名前缀 */
export const SCAN_IGNORE_PREFIXES = Object.freeze(['.', '_']);

/** system-Core/plugin：不计入框架插件数量基准的文件名 */
export const SYSTEM_CORE_VENDOR_PLUGINS = Object.freeze(['lkwg.js']);
