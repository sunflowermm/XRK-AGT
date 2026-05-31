# HTTP API 框架

Loader 扫描 `core/*/http/*.js` 自动注册路由。业务 handler 优先使用 `HttpResponse`，输入校验用 `InputValidator`。

## API 模块

**对象导出（推荐）**

```javascript
export default {
  name: 'my-api',
  dsc: '说明',
  priority: 100,
  enable: true,
  routes: [
    {
      method: 'GET',
      path: '/api/test',
      handler: async (req, res, Bot) => {
        return HttpResponse.success(res, { hello: 'world' });
      }
    }
  ],
  init: async (app, Bot) => {}
};
```

**类导出**：继承 `#infrastructure/http/http.js` 的 `HttpApi`，在 `constructor` 中传入 `name`、`routes` 等。

### 路由字段

| 字段 | 说明 |
|------|------|
| `method` | `GET` / `POST` / `PUT` / `DELETE` / `PATCH` |
| `path` | Express 路径 |
| `handler` | `(req, res, Bot, next?) => ...` |
| `middleware` | 可选，路由级中间件数组 |

`priority` 越大越先初始化（默认 100）。公开接口在路由或 API 上设 `systemAuth: false`，详见 `docs/AUTH.md`。

## 响应与错误

```javascript
import { HttpResponse } from '#utils/http-utils.js';

// handler 内统一 return，勿与 res.json 混用
return HttpResponse.success(res, data, '成功');
return HttpResponse.error(res, err, 500, 'context');
return HttpResponse.validationError(res, '参数无效');
return HttpResponse.notFound(res);
return HttpResponse.unauthorized(res);
return HttpResponse.forbidden(res);

// 异步包装：自动 try/catch + HttpResponse.error
export const handler = HttpResponse.asyncHandler(async (req, res, Bot) => {
  // ...
}, 'my-api');
```

## 输入校验

```javascript
import { InputValidator } from '#utils/input-validator.js';

InputValidator.validatePath(relativePath, baseDir);
InputValidator.validateCommand(command);
// 失败抛 BotError，handler 内 catch 后 HttpResponse.error / validationError
```

## 框架内部工具

| 模块 | 导出 | 用途 |
|------|------|------|
| `#infrastructure/http/utils/helpers.js` | `getApiPriority`, `validateApiInstance` | ApiLoader 注册前规范化 |
| `#infrastructure/http/utils/botInventory.js` | `collectBotInventory`, `summarizeBots` | Bot 列表 HTTP API |

## 数据库示例

```javascript
import { getMongoDb } from '#infrastructure/database/index.js';

const db = getMongoDb();
const users = await db.collection('users').find({}).toArray();
return HttpResponse.success(res, users);
```

## WebSocket

```javascript
export default {
  name: 'ws-api',
  ws: {
    '/ws/chat': (conn, req, bot) => {
      conn.on('message', (message) => conn.send(JSON.stringify({ echo: message })));
    }
  }
};
```

## 参考

- 鉴权：`src/infrastructure/http/auth.js`、`docs/AUTH.md`
- 基类：`src/infrastructure/http/http.js`
- Loader：`src/infrastructure/http/loader.js`
- 业务示例：`core/system-Core/http/*.js`
