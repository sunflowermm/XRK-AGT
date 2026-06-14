---
name: xrk-http-api
description: 当你需要开发或排查 HTTP API（core/*/http/*.js）、理解 HttpApi 基类、ApiLoader、业务层约定时使用。
---

## 文档与代码

- 文档：`docs/http-api.md`、`docs/runtime-surface.md`、`docs/api-loader.md`
- 基类：`src/infrastructure/http/http.js`
- 加载器：`src/infrastructure/http/loader.js`

## 核心约定

- API 模块放在 `core/*/http/*.js`，导出对象或继承 HttpApi。
- 路由数组 `routes` 中声明 method/path/handler/middleware。
- 鉴权策略由各模块自行决定：system-Core HTTP 推荐在模块内通过 `Bot.checkApiAuthorization(req)` 统一使用系统级 API Key，其他 Core 可自定义或选择接入该能力（详见 `xrk-auth` skill）。
- handler 用 **`req.bot` 或第三参 `Bot`**，勿 `global.Bot`。

## HttpResponse

`import { HttpResponse } from '#utils/http-utils.js'`。handler 用 `return HttpResponse.success/error/asyncHandler/...`，勿混用 `res.json()`。

## Node 26（Core HTTP）

- 模块内出站请求：`fetch` + `AbortSignal.timeout`。
- catch：`Error.isError` / `normalizeError`（见 skill **`xrk-node-runtime`**）。
- 禁止 `node-fetch`、手写 `AbortController` 超时。