# 鉴权与认证

> 项目内所有 HTTP/WebSocket 鉴权由 **Server 层（`src/bot.js`）统一负责**，业务路由不再做重复校验。详见 [Server 文档](server.md)。

## 职责划分

| 层级 | 职责 |
|------|------|
| **Server 层**（`src/bot.js`） | 统一鉴权：白名单、本地连接、同源 Cookie、API Key。未通过则 401/拒绝连接，请求不会进入业务路由。 |
| **业务层**（`core/*/http/*.js`） | 仅做参数校验与业务逻辑，**不进行鉴权**。 |

**「业务层不鉴权」的含义**：鉴权只在 Server 的中间件里做**一次**，每个接口的 handler 里不再重复写「检查 API Key」的代码；请求是否带 Key 仍由中间件判断，带错了或没带照样 401。

**控制台（www/xrk）里填写的 API Key 有没有必要？**  
**有必要**。控制台前端请求的都是 `/api/*`（如配置列表、机器人状态、插件列表等），这些请求在到达业务代码前会先经过中间件：要么通过「同源 Cookie」放行（同一浏览器同源访问且带 `xrk_ui=1` 的 Cookie），要么必须带上正确的 API Key（请求头 `X-API-Key` 或 `Authorization: Bearer <key>`）。控制台里填写的 Key 会被保存到 localStorage，并在每次请求时自动带上。若你关闭了同源 Cookie 或从别的域名/客户端访问，就必须填 Key，否则接口会返回 401。

---

## HTTP 鉴权流程

请求经过认证中间件 `_authMiddleware` 时，按下列顺序判断，任一通过即放行：

1. **白名单路径**  
   路径与配置的 `server.auth.whitelist` 匹配则放行。支持：
   - 精确：`/health`、`/status`
   - 前缀：`/xrk/*`、`/media/*`
   - 目录：`/uploads/`（等价于该目录下所有路径）

2. **静态资源**  
   请求路径为常见静态扩展名（如 `.html`、`.js`、`.ico` 等）且**不以** `/api/` 开头时，直接放行。

3. **本地连接**  
   `req.ip` 为 localhost、127.0.0.1、::1 或内网 IP 时放行。

4. **同源 Cookie（前端 UI）**  
   请求带 Cookie `xrk_ui=1` 且 Origin/Referer 与当前服务同源时放行，便于控制台免 Key 访问。

5. **API Key（仅对 `/api/*`）**  
   路径以 `/api/` 开头时**必须**通过 API Key 校验，否则返回 401，且**不会进入任何业务 handler**。  
   若配置中 `server.auth.apiKey.enabled === false`，则跳过本步。

---

## API Key 校验

- **实现位置**：`src/bot.js` 的 `_checkApiAuthorization(req)`。
- **密钥来源**：`server.auth.apiKey.file`（如 `config/server_config/api_key.json`）中的 `key`；未配置则启动时自动生成并写入该文件。
- **请求中如何携带**（任选其一即可）：
  - 请求头：`X-API-Key: <key>`
  - 请求头：`Authorization: Bearer <key>`
  - 查询参数：`?api_key=<key>`
  - 请求体（JSON）：`{ "api_key": "<key>" }`
- **校验方式**：使用 `crypto.timingSafeEqual` 做常量时间比较，防止时序攻击。

---

## WebSocket 鉴权

WebSocket 升级请求使用与 HTTP **相同的鉴权逻辑**（`src/bot.js` 的 `wsConnect`）：

- 使用同一套 **白名单**（`_isPathWhitelisted`，与 HTTP 共用）。
- 白名单或**本地连接**则放行。
- 否则若 `server.auth.apiKey.enabled !== false`，则要求通过 `_checkApiAuthorization(req)`，失败则返回 `401 Unauthorized` 并关闭连接。

客户端可在连接 URL 中带参：`wss://host/device?api_key=<key>`。

---

## 配置示例

```yaml
# config/system.yaml 或通过控制台「认证配置」修改
server:
  auth:
    apiKey:
      enabled: true
      file: "config/server_config/api_key.json"
      length: 64
    whitelist:
      - "/"
      - "/favicon.ico"
      - "/health"
      - "/status"
      - "/robots.txt"
      - "/media/*"
      - "/uploads/*"
```

- **关闭 API Key**：将 `apiKey.enabled` 设为 `false`，则所有请求仅按白名单/本地/同源放行，不再校验 Key。
- **白名单**：列表中的路径（及前缀/目录规则）无需 API Key 即可访问。

---

## 相关文件

- **鉴权实现**：`src/bot.js`  
  - `_isPathWhitelisted(pathName, whitelist)`：白名单匹配（HTTP/WS 共用）  
  - `_authMiddleware(req, res, next)`：HTTP 认证中间件  
  - `_checkApiAuthorization(req)`：API Key 校验  
  - `wsConnect`：WebSocket 升级时的鉴权
- **业务层说明**：`core/system-Core/http/config.js` 顶部注释（鉴权由 Server 统一处理，业务层不校验）。
- **配置结构**：`core/system-Core/commonconfig/system.js` 中 `server.auth` 的 schema。

---

## 常见问题

**Q：为什么业务接口里看不到鉴权代码？**  
A：有意为之。所有以 `/api/` 开头的请求在到达 `core/*/http/*` 前已由 `_authMiddleware` 校验，未通过会直接 401，业务层只需关心参数与逻辑。

**Q：如何允许某路径免 Key 访问？**  
A：将该路径加入 `server.auth.whitelist`（支持精确、前缀 `*`、目录 `/` 匹配）。

**Q：本地调试不想带 Key？**  
A：用 `localhost` / 127.0.0.1 访问会走「本地连接」分支自动放行；或临时将 `apiKey.enabled` 设为 `false`（仅建议在受控环境使用）。
