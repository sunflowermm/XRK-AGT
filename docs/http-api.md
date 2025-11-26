## HttpApi 文档（src/infrastructure/http/http.js）

`HttpApi` 是 XRK-AGT 中的 **HTTP API 基类**，用于统一定义：

- REST 路由（GET/POST/PUT/DELETE 等）。
- WebSocket 处理器。
- API 启用/停用与重载逻辑。

所有位于 `core/http` 下的 API 模块都可以：

- 直接导出对象（推荐），由 `ApiLoader` 自动包装为 `HttpApi` 实例。
- 或继承 `HttpApi` 类，手动控制初始化逻辑。

---

## 构造参数与属性

构造函数接收一个 `data` 对象，常用字段如下：

- `name`：API 名称（必填，用于标识与日志）。
- `dsc`：描述。
- `routes`：路由数组：
  - `method`：HTTP 方法（如 `GET`、`POST`）。
  - `path`：路由路径（通常以 `/api/` 为前缀）。
  - `handler(req, res, Bot, next)`：实际处理函数。
  - `middleware`：可选中间件数组，仅作用于该路由。
- `priority`：优先级，数值越大越先被初始化（默认 `100`）。
- `enable`：是否启用（默认 `true`）。
- `init(app, Bot)`：自定义初始化钩子。
- `ws`：WebSocket 处理器映射 `{ '/path': handler | handler[] }`。
- `middleware`：全局中间件数组，在该 API 的所有路由前调用。

内部重要属性：

- `this.loader`：指向 `ApiLoader` 单例。
- `this.wsHandlers`：WebSocket 处理器集合。
- `this.middleware`：API 级中间件。
- `this.createTime`：创建时间戳。

---

## 初始化流程：`init(app, bot)`

被 `ApiLoader.register(app, bot)` 调用，完成 API 的注册流程：

1. **挂载全局中间件**
   - 若 `this.middleware` 非空：
     - 依次 `app.use(mw)`，该 API 的所有路由都会经过这些中间件。

2. **注册 HTTP 路由**
   - 调用 `registerRoutes(app, bot)`：
     - 检查 `routes` 是否为数组。
     - 遍历每个路由：
       - 验证 `method/path/handler`。
       - 将 `method` 转为小写并检查 `app[method]` 是否存在。
       - 通过 `wrapHandler(handler, bot)` 包装处理函数。
       - 调用 `app[method](path, ...middleware, wrappedHandler)` 完成注册。

3. **注册 WebSocket 处理器**
   - 调用 `registerWebSocketHandlers(bot)`：
     - 遍历 `this.wsHandlers`：
       - 为 `bot.wsf[path]` 追加包装后的处理函数。
       - 处理函数在执行时会捕获异常并写入日志。

4. **执行自定义初始化钩子**
   - 若 `initHook` 存在，调用 `await this.initHook(app, bot)`，允许 API 做进一步初始化。

---

## 路由处理包装：`wrapHandler(handler, bot)`

- 封装通用逻辑：
  - 在执行前注入：
    - `req.bot = bot`：便于访问 `Bot` 实例。
    - `req.api = this`：便于在 handler 内访问当前 API 实例。
  - 捕获 handler 内部错误并统一处理：
    - 写日志：`[HttpApi] name 处理请求失败`。
    - 若响应未发送，则返回 `500` JSON 错误。
    - 若响应已发送，只记录警告日志，不再写响应。

> handler 内推荐直接使用 `res.json/res.send` 等返回结果，不依赖返回值自动发送响应。

---

## WebSocket 集成：`registerWebSocketHandlers(bot)`

- `this.wsHandlers` 结构示例：
  - `{ '/ws/chat': handler }` 或 `{ '/ws/chat': [handler1, handler2] }`。
- 注册流程：
  - 确保 `bot.wsf` 存在（即 `Bot.wsf` 用于保存路径到处理函数列表的映射）。
  - 对每个路径 `path`：
    - 确保 `bot.wsf[path]` 为数组。
    - 将包装后的处理函数加入数组：
      - 处理函数签名：`(conn, req, bot, socket, head)`。
      - 内部捕获异常并写日志。
- 最终由 `Bot.wsConnect` 根据路径将 WebSocket 连接挂到对应处理器上。

---

## 启停与重载

- `start()`：启用 API
  - 将 `this.enable` 标记为 `true`。
  - 输出日志 `[HttpApi] name 已启用`。

- `stop()`：停用 API
  - 将 `this.enable` 标记为 `false`。
  - 输出日志 `[HttpApi] name 已停用`。

- `reload(app, bot)`：重载 API
  - 典型流程：
    1. 记录日志 `[HttpApi] name 开始重载`。
    2. `this.stop()`。
    3. 重新调用 `init(app, bot)` 完成路由与 WS 注册。
    4. `this.start()`。
    5. 记录重载完成日志。

> 实际文件级别的重载由 `ApiLoader.changeApi` 负责，`HttpApi.reload` 更适用于逻辑级微调。

---

## 信息获取：`getInfo()`

返回结构化信息：

- `name/dsc/priority/routes/enable/createTime`。

`ApiLoader.getApiList()` 会调用该方法，生成对外 API 列表与文档展示数据。

---

## 使用示例（推荐写法）

在 `core/http` 下新建 `example.js`：

```js
// core/http/example.js
export default {
  name: 'example-api',
  dsc: '示例 API',
  priority: 100,
  routes: [
    {
      method: 'GET',
      path: '/api/example/ping',
      handler: async (req, res, Bot) => {
        res.json({
          success: true,
          message: 'pong',
          botOnline: Bot.uin?.length > 0,
        });
      }
    }
  ],
  ws: {
    '/ws/example': async (conn, req, Bot) => {
      conn.on('message', msg => {
        conn.sendMsg(`echo: ${msg}`);
      });
    }
  }
};
```

放入 `core/http` 后，`ApiLoader` 会在启动时自动加载并注册上述路由与 WebSocket。


