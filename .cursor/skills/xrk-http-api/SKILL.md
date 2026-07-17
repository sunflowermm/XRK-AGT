---
name: xrk-http-api
description: 当你需要开发或排查 HTTP API（core/*/http/*.js）、理解 HttpApi 基类、HttpApiLoader、业务层约定时使用。
---

## 文档与代码

- 文档：`docs/http-api.md`、`docs/runtime-surface.md`、`docs/api-loader.md`
- 基类：`src/infrastructure/http/http.js`
- 加载器：`src/infrastructure/http/loader.js`

## 核心约定

- API 模块放在 `core/*/http/*.js`，导出对象或继承 HttpApi。
- 路由数组 `routes` 中声明 method/path/handler/middleware。
- 鉴权策略由各模块自行决定：system-Core HTTP 推荐在模块内通过 `AgentRuntime.checkApiAuthorization(req)` 统一使用系统级 API Key，其他 Core 可自定义或选择接入该能力（详见 `xrk-auth` skill）。
- handler 用 **`req.agentRuntime` 或第三参 `AgentRuntime`**，勿 `global.AgentRuntime`。

## HttpResponse

`import { HttpResponse } from '#utils/http-utils.js'`。handler 用 `return HttpResponse.success/error/asyncHandler/...`，勿混用 `res.json()`。

### `success` 响应形状（底层定义）

实现：`src/utils/http-utils.js` → `HttpResponse.success`。

| 第二参 `data` | 实际 JSON |
|---|---|
| 普通对象（非数组） | `{ success: true, message, ...data }`（**拍平**，无外层 `data`） |
| 数组 / 标量 | `{ success: true, message, data: <值> }` |
| `null` / 省略 | `{ success: true, message }` |

```javascript
// 服务端
HttpResponse.success(res, { assessments, webVersion });
// → { success: true, message: '操作成功', assessments, webVersion }

HttpResponse.success(res, { data: config }); // 刻意要顶层 data 字段
// → { success: true, message: '操作成功', data: config }

HttpResponse.success(res, items); // 数组
// → { success: true, message: '操作成功', data: items }
```

### 前端 / Core www 消费约定

**禁止**默认 `const data = json.data` 再读业务字段（对象拍平后 `json.data === undefined` → `Cannot read properties of undefined`）。

推荐解包（浏览器 ESM 优先用共享模块）：

```javascript
import { unwrapSuccess } from '/shared/xrk-web-compat.js';
// → core/system-Core/www/shared/xrk-web-compat.js，挂载 /shared/

function unwrapSuccess(json) {
  if (!json?.success) throw new Error(json?.message || '请求失败');
  if (json.data !== undefined) return json.data;
  const { success, message, ...rest } = json;
  return rest;
}
```

或直接读顶层：`json.assessments`、`json.configs`（system-Core `www/xrk` 即此风格）。

需要「整包在 `data` 下」时，服务端应写 `success(res, { data: payload })`（如 kaguya 行情、xiaozhi config），不要指望框架自动包一层。

详见 `docs/http-api.md`「响应格式」；WebView 兼容另见 skill **`xrk-app-dev`**（`randomId` / `abortTimeout`）。

## Node 26（Core HTTP）

- 模块内出站请求：`fetch` + `AbortSignal.timeout`。
- catch：`Error.isError` / `normalizeError`（见 skill **`xrk-node-runtime`**）。
- 禁止 `node-fetch`、手写 `AbortController` 超时。