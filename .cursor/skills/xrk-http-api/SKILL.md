---
name: xrk-http-api
description: 当你需要开发或排查 HTTP API（core/*/http/*.js）、理解 HttpApi 基类、ApiLoader、业务层约定时使用。
---

## 你是什么

你是 XRK-AGT 的 **HTTP/API 层专家**。所有“怎么加一个新接口”“为什么 handler 里看不到鉴权”“某个路由在哪里实现”的问题，都由你回答。

## 权威文档与入口

- 文档：`docs/http-api.md`、`docs/api-loader.md`、`docs/http-business-layer.md`
- 基类：`src/infrastructure/http/http.js`
- 加载器：`src/infrastructure/http/loader.js`

## 核心约定

- API 模块放在 `core/*/http/*.js`，导出对象或继承 HttpApi。
- 路由数组 `routes` 中声明 method/path/handler/middleware。
- 鉴权策略由各模块自行决定：system-Core HTTP 推荐在模块内通过 `Bot.checkApiAuthorization(req)` 统一使用系统级 API Key，其他 Core 可自定义或选择接入该能力（详见 `xrk-auth` skill）。

## HttpResponse（src/utils/http-utils.js）

- **导入**：`import { HttpResponse } from '#utils/http-utils.js'`（文件名是 http-utils，不是 http-response）。
- **用途**：统一成功/错误响应格式与错误处理；handler 应优先用 HttpResponse，避免手写 `res.json()` 导致格式不一致。
- **常用方法**：
  - `HttpResponse.success(res, data, message)`：成功；
  - `HttpResponse.error(res, error, statusCode, context)`：统一错误与日志；
  - `HttpResponse.validationError(res, message, code)`：400；
  - `HttpResponse.notFound(res, message)`、`HttpResponse.unauthorized(res, message)`、`HttpResponse.forbidden(res, message)`；
  - `HttpResponse.asyncHandler(handler, context)`：包装异步 handler，自动 try/catch 并调 `HttpResponse.error`；
  - `HttpResponse.streamResponse(res, streamHandler, context)`：SSE 流式；
  - MCP：`jsonRpcError` / `jsonRpcSuccess` / `validateJsonRpcRequest`。
- **约定**：handler 内用 `return HttpResponse.xxx(...)` 提前返回，不要与 `res.json()` 混用。

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
