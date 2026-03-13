---
name: xrk-auth
description: 当你需要解释/排查 HTTP 或 WebSocket 的 401、白名单、同源 Cookie、API Key 机制时使用；确保业务层不重复鉴权。
---

## 权威文档与实现

- 文档：`docs/AUTH.md`
- 鉴权实现：`src/bot.js`
  - `_authMiddleware`
  - `_checkApiAuthorization`
  - `wsConnect`

## 核心原则（v2）

- Server 层只做静态资源、本地连接等基础放行，不再对 `/api/*` 做统一鉴权。
- **system-Core HTTP**（`core/system-Core/http/*.js`）在模块内使用 `Bot.checkApiAuthorization(req)` 做系统级 API Key 校验。
- 其他 Core 的 HTTP / Tasker 可以自由选择鉴权方式；如需复用系统 API Key，同样调用 `Bot.checkApiAuthorization(req)`。

## API Key 携带方式（任意一种）

- `X-API-Key: <key>`
- `Authorization: Bearer <key>`
- `?api_key=<key>`
- JSON body：`{ "api_key": "<key>" }`

