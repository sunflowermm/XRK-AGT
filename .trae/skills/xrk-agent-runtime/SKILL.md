---
name: xrk-agent-runtime
description: 当你需要理解 XRK-AGT 的运行时核心（AgentRuntime 主类）、事件总线、HTTP/WS 启动流程与全局对象时使用。
---

## 文档与代码

- 文档：`docs/agent-runtime.md`、`docs/server.md`
- 代码：`src/agent-runtime.js`

## 关键职责

- 启动 HTTP/HTTPS/WebSocket 服务器，以及基础中间件（压缩、安全头、CORS、日志、基础认证等）。
- 初始化加载器：TaskerLoader / HttpApiLoader / AiStreamLoader / PluginLoader。
- 维护全局 `AgentRuntime` 对象：`AgentRuntime`（EventEmitter 实例）、`AgentRuntime[self_id]`（具体 AgentRuntime 会话）、`AgentRuntime.tasker` / `AgentRuntime.wsf` / `AgentRuntime.uin` / `AgentRuntime.em()` / `AgentRuntime.makeLog()`。

## 充分利用 AgentRuntime 对象

- 业务代码**不要** `import AgentRuntime` 或 `new AgentRuntime()`；由 `node app` / `start.js` 创建并挂载全局 `AgentRuntime`。
- **插件 / Tasker / 事件监听器**：直接使用全局 `AgentRuntime`、`AgentRuntime[self_id]`、`AgentRuntime.em()`、`AgentRuntime.tasker`、`AgentRuntime.makeLog()` 等。
- **HTTP API**：使用注入的 `req.agentRuntime` 或路由 handler 的第三参 `AgentRuntime`，获取 `getServerUrl()`、`callRoute()`、多 AgentRuntime 列表等。
- `callRoute` / 公网探测：全局 `fetch` + `AbortSignal.timeout`（见 `src/agent-runtime.js`）。
- 详见 `docs/agent-runtime.md`、skill **`xrk-node-runtime`**。