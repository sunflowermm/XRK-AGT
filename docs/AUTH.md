# 鉴权与认证（v2 设计）

> 当前版本中，Server 层 **不再内置通用的 HTTP 白名单 / `/api/*` 统一鉴权逻辑**，仅负责静态资源与本地连接的“基础放行”。真正的鉴权由各 Core 自行负责，其中：
> - **system-Core 下的所有 HTTP API 默认使用系统级 API Key**；
> - 其他 Core（插件 HTTP / 业务 HTTP / 自定义 Tasker 等）由开发者自行实现鉴权，需要时可以复用 `Bot.apiKey`。

## 职责划分

| 层级 | 职责 |
|------|------|
| **Server 层**（`src/bot.js`） | 仅做基础网络层处理：速率限制、Body 解析、静态资源映射、本地连接放行等；不再对 `/api/*` 做统一鉴权。 |
| **system-Core HTTP**（`core/system-Core/http/*.js`） | 内置使用 `Bot.checkApiAuthorization(req)` 检查系统级 API Key，例如配置管理、AI 接口、设备管理、插件管理等。 |
| **其他 Core HTTP / Tasker** | 自行决定是否以及如何鉴权；需要接入系统 API Key 时，可在模块内调用 `Bot.checkApiAuthorization(req)`。 |

---

## Server 层基础处理流程（HTTP）

请求经过 `src/bot.js` 中的中间件时，认证相关只做两类“放行”判断：

1. **静态资源**  
   路径为常见静态扩展名（如 `.html`、`.js`、`.ico`、图片、字体等）时直接放行。

2. **127 回环连接**  
   来源 IP 为 `127.*`（包含 `::ffff:127.*`）时直接放行，便于本机调试。

除此之外，Server 不再基于 URL 前缀、白名单配置或 Cookie 自动放行/拒绝；是否需要 Key、如何校验，完全交给上层模块处理。

---

## API Key 校验

- **实现位置**：
  - 底层比对逻辑：`src/bot.js` 的 `_checkApiAuthorization(req)`；
  - system-Core HTTP 统一入口：各 `core/system-Core/http/*.js` 文件顶部的 `ensureSystemCoreAuth`。
- **密钥来源**：`server.auth.apiKey.file`（如 `config/server_config/api_key.json`）中的 `key`；未配置则启动时自动生成并写入该文件。
- **请求中如何携带**（任选其一即可）：
  - 请求头：`X-API-Key: <key>`
  - 请求头：`Authorization: Bearer <key>`
  - 查询参数：`?api_key=<key>`
  - 请求体（JSON）：`{ "api_key": "<key>" }`
- **校验方式**：使用 `crypto.timingSafeEqual` 做常量时间比较，防止时序攻击。

---

## WebSocket 鉴权

所有通过 Tasker 暴露的 WebSocket 路径（`Bot.wsf`）都会先经过 `src/bot.js` 的 `wsConnect` 统一鉴权：
 
- **127 回环连接**：直接放行（仅 `127.*` / `::ffff:127.*`）；
- **远程连接**：若 `server.auth.apiKey.enabled !== false`，则默认必须通过 `Bot.apiKey` 校验，否则返回 `401 Unauthorized` 并拒绝升级；
- **Tasker 级免鉴权**：若某个 WS 路径在 `Bot.wsf[path]` 中包含形如 `{ handler, skipAuth: true }` 的条目，则视为该路径整体“跳过系统级 API Key 鉴权”。

客户端可以通过以下任一方式携带系统 API Key（与 HTTP 一致）：

- 头部：`X-API-Key: <key>`
- 头部：`Authorization: Bearer <key>`
- 查询：`?api_key=<key>`（如 `wss://host/device?api_key=<key>`）

各 Tasker 若还需要额外的业务级鉴权（例如设备 ID 白名单），可以在各自的 WS handler 内再做一层校验；对于显式声明 `skipAuth: true` 的路径，推荐在 Tasker 内自行实现细粒度的业务鉴权逻辑。

---

## 相关文件

- HTTP 基础与 API Key 校验：`src/bot.js`  
  - `_authMiddleware(req, res, next)`：HTTP 基础放行（静态资源）  
  - `_checkApiAuthorization(req)` / `checkApiAuthorization(req)`：API Key 校验  
  - `wsConnect`：WebSocket 升级与连接管理（不做统一鉴权）
- system-Core HTTP 模块：`core/system-Core/http/*.js`  
  - 在各自文件顶部定义 `ensureSystemCoreAuth`，内部调用 `Bot.checkApiAuthorization(req)` 做系统级鉴权。

---

## 常见问题

**Q：现在鉴权到底写在哪一层？**  
A：Server 层只做“静态资源”放行；系统级接口（system-Core HTTP）在各自模块里显式调用 `Bot.checkApiAuthorization(req)`，其他 Core 可自由选择是否接入系统 API Key 或自定义鉴权。

**Q：如何使用系统 API Key 保护自定义 HTTP 接口？**  
A：在自定义 `core/<your-core>/http/*.js` 里，按 system-Core 的写法增加一个 `ensureAuth` 函数，在 handler 开头调用 `Bot.checkApiAuthorization(req)`，失败时返回 401 即可。

**Q：本地调试可以不带 Key 吗？**  
A：可以，但仅当来源是 `127.*`（或 `::ffff:127.*`）时自动放行；内网地址（如 `192.168.*`、`10.*`、`172.16-31.*`）不会自动放行。
