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

## 核心原则（v2.2）

- Server 层只做静态资源基础放行，不再对 `/api/*` 做统一鉴权。
- **system-Core HTTP**（`core/system-Core/http/*.js`）在模块内使用 `Bot.checkApiAuthorization(req)` 做系统级 API Key 校验。
- 其他 Core 的 HTTP / Tasker 可以自由选择鉴权方式；如需复用系统 API Key，同样调用 `Bot.checkApiAuthorization(req)`。
- 仅 `127.*`（含 `::ffff:127.*`）会在底层被视为免鉴权来源；内网网段（`10.*`、`172.16-31.*`、`192.168.*`）不再自动放行。

## Tasker 级 WebSocket 免鉴权

- 所有 Tasker 的 WebSocket 入口仍统一由 `src/bot.js` 的 `wsConnect` 处理；
- 默认规则：非 `127.*` 回环来源、且 `server.auth.apiKey.enabled !== false` 时，必须通过系统级 API Key；
- 扩展规则：若某个 WS 路径在 `Bot.wsf[path]` 中注册的条目为对象 `{ handler, skipAuth: true }`，则该路径会**跳过系统级 API Key 校验**，典型用途是：
  - 内部语音端/设备端（如 xiaozhi-Core）走自定义鉴权或配对逻辑；
  - 需要无 Key 的长连接通道，但又不想关闭全局 API Key。

调试这类问题时：

- 先确认 `Bot.wsf[path]` 的结构（函数 vs `{ handler, skipAuth }`）；
- 再结合 `cfg.server.auth.apiKey.enabled`、来源 IP 是否 `127.*`，以及客户端携带的 Key 来判断是“被系统级拦截”还是“交给 Tasker 内部业务鉴权”。

## API Key 携带方式（任意一种）

- `X-API-Key: <key>`
- `Authorization: Bearer <key>`
- `?api_key=<key>`
- JSON body：`{ "api_key": "<key>" }`

## 权威入口

- 项目概览：`PROJECT_OVERVIEW.md`
- 代码入口：`src/` 与 `core/` 对应子目录
- 相关文档：`docs/` 下对应主题文档

## 适用场景

- 需要定位该子系统的实现路径与配置入口。
- 需要快速给出改动落点与兼容性注意事项。

## 非适用场景

- 不用于替代其他子系统的实现说明。
- 不在缺少证据时臆造路径或字段。

## 执行步骤

1. 先确认需求属于该技能的职责边界。
2. 再给出代码路径、配置路径与关键字段。
3. 最后补充风险点、验证步骤与回归范围。

## 常见陷阱

- 只给概念，不给具体文件路径。
- 文档与代码冲突时未标注以代码为准。
- 忽略配置、Schema 与消费代码的一致性。
