/**
 * Loader 扫描约定（FileLoader / core-fs / 框架基准测试共用）
 */

/** 扫描时忽略的文件名前缀 */
export const SCAN_IGNORE_PREFIXES = Object.freeze(['.', '_']);

/**
 * system-Core/plugin 下的第三方/外挂脚本：
 * 运行时仍会加载，但不计入官方内置插件数量基准（当前 15）
 */
export const SYSTEM_CORE_VENDOR_PLUGINS = Object.freeze(['lkwg.js']);
