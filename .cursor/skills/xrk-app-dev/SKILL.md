---
name: xrk-app-dev
description: 当你需要从“应用视角”看 XRK-AGT（启动流程、Web 控制台、前后端协作、典型技术栈组合）时使用。
---

## 文档

`docs/app-dev.md`

## 要点

- 启动：`node app` → `app.js`（校验 Node ≥26）→ `start.js` → `src/agent-runtime.js`
- 控制台：`core/system-Core/www/xrk/`，路径 `/xrk`
- 配置：全局 `data/server_bots/*.yaml`；端口 `data/server_bots/{port}/*.yaml`（含 `aistream.yaml`）
- 运行时约定：`docs/node-26-runtime.md`、skill **`xrk-node-runtime`**
