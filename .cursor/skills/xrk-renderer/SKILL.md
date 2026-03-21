---
name: xrk-renderer
description: 当你需要使用/扩展渲染器（HTML 模板渲染、截图输出）或让 AI 生成图片报表/可视化时使用。
---

## 权威文档与入口

- 文档：`docs/renderer.md`
- 基类：`src/infrastructure/renderer/Renderer.js`
- 渲染器目录：`src/renderers/*`

## 你要掌握的要点

- Renderer 基类只负责：模板读写/缓存/监听（`dealTpl`），具体截图逻辑由 Puppeteer/Playwright 等具体实现负责。
- 配置来源：全局 `agt.browser.renderer`（puppeteer/playwright）；各渲染器 `data/server_bots/{port}/renderers/{type}/config.yaml`，缺省从 `src/renderers/{type}/config_default.yaml` 合并。
- 典型使用：插件中通过 `RendererLoader.getRenderer('puppeteer')` 拿到实例，调用 `dealTpl` 渲染 HTML，再调用 `renderImage` 输出图片。

## 权威入口

- 项目概览：`PROJECT_OVERVIEW.md`
- 代码入口：`src/` 与 `core/` 对应子目录
- 相关文档：`docs/` 下对应主题文档

## 适用场景

- 需要定位该子系统的实现路径与配置入口。
- 需要快速给出改动落点与兼容性注意事项。

## 非适用场景

- 不用于替代其他子系统的实现说明。
- 不在缺少证据时臆造路径或字段。

## 执行步骤

1. 先确认需求属于该技能的职责边界。
2. 再给出代码路径、配置路径与关键字段。
3. 最后补充风险点、验证步骤与回归范围。

## 常见陷阱

- 只给概念，不给具体文件路径。
- 文档与代码冲突时未标注以代码为准。
- 忽略配置、Schema 与消费代码的一致性。
