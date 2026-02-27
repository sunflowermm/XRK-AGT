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

## 核心原则

- **鉴权只在 Server 层做一次**；`core/*/http/*.js` 业务 handler 不做重复校验。

## HTTP 鉴权判定顺序（概念）

1. 白名单路径（`server.auth.whitelist`）
2. 静态资源（非 `/api/`）
3. 本地连接
4. 同源 Cookie（UI 免 Key）
5. `/api/*` 必须通过 API Key（除非 `server.auth.apiKey.enabled=false`）

## API Key 携带方式（任意一种）

- `X-API-Key: <key>`
- `Authorization: Bearer <key>`
- `?api_key=<key>`
- JSON body：`{ "api_key": "<key>" }`

