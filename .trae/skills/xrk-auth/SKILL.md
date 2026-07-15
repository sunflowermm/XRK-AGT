---
name: xrk-auth
description: 当你需要解释/排查 HTTP 或 WebSocket 的 401、127 回环例外、API Key 机制时使用；确保业务层不重复鉴权。
---

## 文档与代码

`docs/AUTH.md`、`src/agent-runtime.js`（`_authMiddleware`、`checkApiAuthorization`、`wsConnect`）

## 原则

- `/api/` 由 `HttpApi` + `AgentRuntime.checkApiAuthorization`；公开路由 `systemAuth: false`。
- 仅 `127.*` 回环免系统 Key；内网私网段不自动放行。
- WS：`wsConnect` 统一入口；`AgentRuntime.wsf[path]` 可为 `{ handler, skipAuth: true }` 跳过系统 Key。

## API Key 携带

Header：`X-API-Key`、`Authorization: Bearer|Token|ApiKey <key>`、`X-Auth-Token` 等；或 query/body 的 `api_key`（及别名）。

## Node 26

- 鉴权逻辑在 `src/agent-runtime.js`；扩展时判错用 `Error.isError`，勿 `instanceof Error`（skill **`xrk-node-runtime`**）。
- 业务 Core **不重复**实现鉴权；HTTP 超时仍用 `AbortSignal.timeout`。
