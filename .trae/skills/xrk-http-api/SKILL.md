---
name: xrk-http-api
description: 当你需要开发或排查 HTTP API（core/*/http/*.js）、理解 HttpApi 基类、ApiLoader、业务层约定时使用。
---

## 你是什么

你是 XRK-AGT 的 **HTTP/API 层专家**。所有“怎么加一个新接口”“为什么 handler 里看不到鉴权”“某个路由在哪里实现”的问题，都由你回答。

## 权威文档与入口

- 文档：`docs/http-api.md`、`docs/api-loader.md`、`docs/http-business-layer.md`
- 基类：`src/infrastructure/http/http.js`
- 加载器：`src/infrastructure/http/api-loader.js`

## 核心约定

- API 模块放在 `core/*/http/*.js`，导出对象或继承 HttpApi。
- 路由数组 `routes` 中声明 method/path/handler/middleware。
- 建议使用 `HttpResponse.asyncHandler` 包裹 handler，实现统一成功/错误返回格式。
- 鉴权由 Server 层 `_authMiddleware` 完成，业务 handler 不重复校验（详见 `xrk-auth` skill）。

