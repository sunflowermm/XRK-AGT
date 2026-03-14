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

## Tasker 级 WebSocket 免鉴权（v2.1）

- 所有 Tasker 的 WebSocket 入口仍统一由 `src/bot.js` 的 `wsConnect` 处理；
- 默认规则：非本地/内网、且 `server.auth.apiKey.enabled !== false` 时，必须通过系统级 API Key；
- 扩展规则：若某个 WS 路径在 `Bot.wsf[path]` 中注册的条目为对象 `{ handler, skipAuth: true }`，则该路径会**跳过系统级 API Key 校验**（仍保留本地/内网判断），典型用途是：
  - 内部语音端/设备端（如 xiaozhi-Core）走自定义鉴权或配对逻辑；
  - 需要无 Key 的长连接通道，但又不想关闭全局 API Key。

调试这类问题时：

- 先确认 `Bot.wsf[path]` 的结构（函数 vs `{ handler, skipAuth }`）；
- 再结合 `cfg.server.auth.apiKey.enabled` 与客户端携带的 Key 来判断是“被系统级拦截”还是“交给 Tasker 内部业务鉴权”。

## API Key 携带方式（任意一种）

- `X-API-Key: <key>`
- `Authorization: Bearer <key>`
- `?api_key=<key>`
- JSON body：`{ "api_key": "<key>" }`

