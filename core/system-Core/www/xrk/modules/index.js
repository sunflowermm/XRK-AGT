/**
 * 模块索引文件
 * 统一导出所有模块，方便使用
 */

// 工具函数模块
export * from './utils.js';

// DOM 操作模块
export * from './dom.js';

// 文件管理模块
export * from './file-manager.js';

// Markdown 渲染模块
export * from './markdown.js';

// 配置管理模块
export { default as ConfigManager } from './config-manager.js';

// UI 工具模块
export * from './ui-kit.js';
export * from './ui/toast.js';
export * from './ui/prompt-dialog.js';
export * from './pages/home.js';
export {
  loadPluginsInfoPanel,
  renderWorkflowInfoPanel
} from './pages/home-plugins-workflow.js';
export * from './pages/chat.js';
export * from './pages/config.js';

/**
 * 使用示例：
 *
 * // 导入所有模块
 * import * as Modules from './modules/index.js';
 *
 * // 或者按需导入
 * import { formatBytes, showToast } from './modules/index.js';
 * import { $, $$, createElement } from './modules/index.js';
 * import { fileManager } from './modules/index.js';
 * import { markdownRenderer } from './modules/index.js';
 * import { ConfigManager } from './modules/index.js';
 */
