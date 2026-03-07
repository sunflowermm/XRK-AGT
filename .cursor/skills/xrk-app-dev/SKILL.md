---
name: xrk-app-dev
description: 当你需要从“应用视角”看 XRK-AGT（启动流程、Web 控制台、前后端协作、典型技术栈组合）时使用。
---

## 权威文档

- `docs/app-dev.md`

## 你要掌握的要点

- 启动链路：`node app` → `app.js`（环境/依赖/imports）→ `start.js` → `src/bot.js`。
- Web 控制台：`core/system-Core/www/xrk/*`，通过 `/xrk` 访问，调用 `core/system-Core/http/*` 暴露的 API。
- cfg 配置体系：全局 `data/server_bots/*.yaml` + 端口 `data/server_bots/{port}/*.yaml`。
- 典型技术栈：简单 AI 对话（插件+工作流）；复杂 Agent（插件+工作流+Python 子服务端）；Web 应用（前端+HTTP API+工作流）；数据可视化（工作流+渲染器）；多平台（Tasker+插件+事件系统）。

