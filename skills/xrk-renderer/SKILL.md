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
- 配置来源：\n
  - 全局选择 `agt.browser.renderer`（puppeteer/playwright）。\n
  - 每种渲染器：`data/server_bots/{port}/renderers/{type}/config.yaml`，缺失时从 `src/renderers/{type}/config_default.yaml` 合并。\n
- 典型使用：插件中通过 `RendererLoader.getRenderer('puppeteer')` 拿到实例，调用 `dealTpl` 渲染 HTML，再调用 `renderImage` 输出图片。

