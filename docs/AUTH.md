# 鉴权与认证（以代码为准）

> Server 层 **不会**在 `src/agent-runtime.js` 对全部 `/api/*` 做统一拦截；经 **`HttpApi` 注册**且路径以 `/api/` 开头时，由基础设施层**默认**校验系统 API Key（见 `src/infrastructure/http/http.js`）。
> - **system-Core 的 HTTP 路由**：默认需 API Key（可用 `systemAuth: false` 关闭）；
> - **其他 Core**：同样走 `HttpApi` 时规则一致；未使用 `HttpApi` 时需自行调用 `AgentRuntime.checkApiAuthorization(req)` 或 `ensureSystemCoreAuth`。

## 职责划分

| 层级 | 职责 |
|------|------|
| **Server 层**（`src/agent-runtime.js`） | 仅做基础网络层处理：速率限制、Body 解析、静态资源映射等；不再对 `/api/*` 做统一鉴权。鉴权比对委托 `#infrastructure/http/runtime-auth.js`。 |
| **HttpApi 路由**（`src/infrastructure/http/http.js`） | 路径以 `/api/` 开头时默认调用 `ensureSystemCoreAuth` → `AgentRuntime.checkApiAuthorization(req)`。 |
| **system-Core HTTP**（`core/system-Core/http/*.js`） | 仅定义路由与 handler，**无需**在每个 handler 内重复写鉴权代码。 |
| **其他 Core HTTP / Tasker** | 自行决定是否以及如何鉴权；需要接入系统 API Key 时，可在模块内调用 `AgentRuntime.checkApiAuthorization(req)`。 |

---

## Server 层基础处理流程（HTTP）

请求经过 `src/agent-runtime.js` 中的中间件时，认证相关只做静态资源放行：

1. **静态资源**  
   路径为常见静态扩展名（如 `.html`、`.js`、`.ico`、图片、字体等）时直接放行。

除此之外，Server 不会基于 URL 前缀自动放行/拒绝；是否需要 Key、如何校验，完全交给上层模块处理。  
当上层调用 `AgentRuntime.checkApiAuthorization(req)` 时，底层会统一执行（实现：`runtime-auth.js` + `auth.js`）：

- **一般** `127.*`（含 `::ffff:127.*`）来源免鉴权；
- **例外**：当 `ai-workflow.tools.file.runEnabled === true`（或同类危险能力开启）时，loopback **也强制** API Key（可用 `server.auth.requireLoopbackAuthWhenToolsRun: false` 显式关闭，不推荐）；
- **可选白名单**：若 `server.auth.whitelist` 配置了前缀/正则规则，命中时免鉴权；
- 非 `127.*` 来源按 API Key 规则严格校验。

默认 `tools.file.runEnabled: false`（见 `config/default_config/ai-workflow.yaml`）。

---

## API Key 校验

- **实现位置**：
  - 薄包装：`src/agent-runtime.js` 的 `checkApiAuthorization(req, options?)`
  - 实际比对：`src/infrastructure/http/runtime-auth.js`
  - loopback / tools 强制策略：`src/infrastructure/http/auth.js`（`isLoopback127Connection`、`shouldForceAuthOnLoopbackWhenToolsRun`）
  - HTTP 路由包装：`ensureSystemCoreAuth`（由 `HttpApi.wrapHandler` 自动调用）
- **密钥来源**：`server.auth.apiKey.file`（如 `config/server_config/api_key.json`）中的 `key`；未配置则启动时自动生成并写入该文件。
- **请求中如何携带**（任选其一即可）：
  - 请求头：`X-API-Key: <key>`
  - 请求头：`Authorization: Bearer <key>` / `Authorization: Token <key>` / `Authorization: ApiKey <key>`
  - 请求头：`X-Auth-Token: <key>` / `X-Access-Token: <key>` / `Api-Key: <key>`
  - 查询参数：`?api_key=<key>`（同时兼容 `apiKey/apikey/access_token/token/key`）
  - 请求体（JSON）：`{ "api_key": "<key>" }`（同时兼容 `apiKey/apikey/access_token/token/key`）
- **校验方式**：使用 `crypto.timingSafeEqual` 做常量时间比较，防止时序攻击。

---

## WebSocket 鉴权

所有通过 Tasker 暴露的 WebSocket 路径（`AgentRuntime.wsf`）都会先经过 `runtime-ws.js`（由 `AgentRuntime.wsConnect` 委托）统一鉴权：
 
- **127 回环连接**：一般直接放行（仅 `127.*` / `::ffff:127.*`）；`runEnabled` 开启时与 HTTP 相同，强制 API Key；
- **远程连接**：若 `server.auth.apiKey.enabled !== false`，则默认必须通过 `AgentRuntime.apiKey` 校验，否则返回 `401 Unauthorized` 并拒绝升级；
- **Tasker 级免鉴权**：若某个 WS 路径在 `AgentRuntime.wsf[path]` 中包含形如 `{ handler, skipAuth: true }` 的条目，则视为该路径整体“跳过系统级 API Key 鉴权”。

客户端可以通过以下任一方式携带系统 API Key（与 HTTP 一致）：

- 头部：`X-API-Key: <key>`
- 头部：`Authorization: Bearer <key>` / `Authorization: Token <key>` / `Authorization: ApiKey <key>`
- 查询：`?api_key=<key>`（如 `wss://host/device?api_key=<key>`，并兼容 `apiKey/apikey/access_token/token/key`）

各 Tasker 若还需要额外的业务级鉴权（例如设备 ID 白名单），可以在各自的 WS handler 内再做一层校验；对于显式声明 `skipAuth: true` 的路径，推荐在 Tasker 内自行实现细粒度的业务鉴权逻辑。

---

## 相关文件

- HTTP 基础与委托入口：`src/agent-runtime.js`  
  - `_authMiddleware(req, res, next)`：HTTP 基础放行（静态资源）  
  - `checkApiAuthorization(req)` → `runtime-auth.js`  
  - `wsConnect` → `runtime-ws.js`
- 鉴权实现：`src/infrastructure/http/runtime-auth.js`、`auth.js`、`http.js`（`route.systemAuth` / `_withDefaultSystemAuth`）
- system-Core 路由定义：`core/system-Core/http/*.js`

---

## 常见问题

**Q：现在鉴权到底写在哪一层？**  
A：`src/agent-runtime.js` 只做静态资源放行；`/api/*` 由 `HttpApi` 在 `wrapHandler` 中默认鉴权。业务 handler 内一般不必再写鉴权。

**Q：如何使用系统 API Key 保护自定义 HTTP 接口？**  
A：在 `core/<your-core>/http/*.js` 导出 `HttpApi` 路由对象即可；路径以 `/api/` 开头会自动鉴权。非 `/api/` 路径或不用 `HttpApi` 时，在 handler 内调用 `ensureSystemCoreAuth(req, res, bot, 'context')`（`src/infrastructure/http/auth.js`）。

**Q：本地调试可以不带 Key 吗？**  
A：默认可以——仅当来源是 `127.*`（或 `::ffff:127.*`）时自动放行；内网地址（如 `192.168.*`、`10.*`、`172.16-31.*`）不会自动放行。若开启了 `ai-workflow.tools.file.runEnabled`，则 loopback 也必须带 Key。

**Q：新增 HTTP 路由时鉴权要注意什么？**  
A：经 `HttpApi` 注册且路径以 `/api/` 开头时**默认**鉴权；公开接口写 `systemAuth: false`。实现见 `src/infrastructure/http/http.js` 与 `src/infrastructure/http/auth.js`。
