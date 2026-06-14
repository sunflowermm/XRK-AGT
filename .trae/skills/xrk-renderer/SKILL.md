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
- 配置来源：全局 `agt.browser.renderer`（**默认 playwright**；可选 puppeteer）；各渲染器 `data/server_bots/{port}/renderers/{type}/config.yaml`，缺省从 `src/renderers/{type}/config_default.yaml` 合并。
- Playwright Chromium 不在 bootstrap 自动安装；菜单「Playwright 浏览器」或 `pnpm run setup:browsers`。
- 典型使用：插件中 `RendererLoader.getRenderer()`（无参即当前配置后端），`dealTpl` 渲染 HTML，再 `renderImage` 输出图片。

## Node 26

- 渲染器在 `src/renderers/*`（基础设施层）；Core 插件只调用 Loader API，**不修改** `src/infrastructure/renderer/`。
- 截图输出二进制若需编码：用 `toBase64()` / `toHex()`（skill **`xrk-node-runtime`**）。