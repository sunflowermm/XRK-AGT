---
name: xrk-bot
description: 当你需要理解 XRK-AGT 的运行时核心（Bot 主类）、事件总线、HTTP/WS 启动流程与全局对象时使用。
---

## 文档与代码

- 文档：`docs/bot.md`、`docs/server.md`
- 代码：`src/bot.js`

## 关键职责

- 启动 HTTP/HTTPS/WebSocket 服务器，以及基础中间件（压缩、安全头、CORS、日志、基础认证等）。
- 初始化加载器：TaskerLoader / ApiLoader / StreamLoader / PluginsLoader。
- 维护全局 `Bot` 对象：`Bot`（EventEmitter 实例）、`Bot[self_id]`（具体 Bot 会话）、`Bot.tasker` / `Bot.wsf` / `Bot.uin` / `Bot.em()` / `Bot.makeLog()`。

## 充分利用 Bot 对象

- 业务代码**不要** `import Bot` 或 `new Bot()`；由 `node app` / `start.js` 创建并挂载全局 `Bot`。
- **插件 / Tasker / 事件监听器**：直接使用全局 `Bot`、`Bot[self_id]`、`Bot.em()`、`Bot.tasker`、`Bot.makeLog()` 等。
- **HTTP API**：使用注入的 `req.bot` 或路由 handler 的第三参 `Bot`，获取 `getServerUrl()`、`callRoute()`、多 Bot 列表等。
- `callRoute` / 公网探测：全局 `fetch` + `AbortSignal.timeout`（见 `src/bot.js`）。
- 详见 `docs/bot.md`、skill **`xrk-node-runtime`**。