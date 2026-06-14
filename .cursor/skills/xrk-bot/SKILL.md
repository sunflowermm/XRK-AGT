---
name: xrk-bot
description: 当你需要理解 XRK-AGT 的运行时核心（Bot 主类）、事件总线、HTTP/WS 启动流程与全局对象时使用。
---

## 文档与代码

- 文档：`docs/bot.md`、`docs/runtime-surface.md`、`docs/server.md`
- 代码：`src/bot.js`、`src/utils/runtime-globals.js`

## 关键职责

- 启动 HTTP/HTTPS/WebSocket 服务器，以及基础中间件（压缩、安全头、CORS、日志、基础认证等）。
- 初始化加载器：TaskerLoader / ApiLoader / StreamLoader / PluginsLoader。
- 维护运行时 `Bot`（Proxy）：`Bot[self_id]`、`Bot.tasker` / `Bot.wsf` / `Bot.uin` / `Bot.em()` / `Bot.makeLog()`。

## 全局写法（业务 `core/`）

- **裸名** `Bot`，勿 `import Bot`、`new Bot()`、**勿** `global.Bot`。
- HTTP handler：`req.bot` 或第三参 `Bot`。
- 挂载仅在 `src/`：`setRuntimeGlobal('Bot', bot)`（`start.js`、`tasker/loader.js`）。
- 详见 `docs/runtime-surface.md`、`.cursor/rules/xrk-dev-requirements.mdc`。

## 其它

- `callRoute` / 公网探测：全局 `fetch` + `AbortSignal.timeout`（见 `src/bot.js`）。
- Node 26 约定：skill **`xrk-node-runtime`**。
