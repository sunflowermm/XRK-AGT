## ApiLoader 文档（src/infrastructure/http/loader.js）

`ApiLoader` 负责从 `core/http` 目录动态加载所有 HTTP API 模块，并完成：

- API 实例化与优先级排序。
- 将路由与 WebSocket 处理器注册到 Express 与 Bot。
- 监控 API 文件变更，实现热加载。

---

## 核心属性

- `apis: Map<string, apiInstance>`：以相对路径 key 存储所有 API 实例。
- `priority: apiInstance[]`：按优先级排序后的 API 列表。
- `watcher: { [name: string]: FSWatcher }`：文件监视器。
- `loaded: boolean`：是否已经完成初次加载。
- `app`：当前 Express 实例。
- `bot`：当前 Bot 实例。

---

## 加载流程：`load()`

1. 输出「开始加载 API 模块」日志。
2. 确保 `paths.coreHttp` 目录存在。
3. 调用 `getApiFiles(apiDir)`：
   - 递归扫描所有子目录。
   - 收集 `.js` 文件，跳过以 `.` 或 `_` 开头的文件。
4. 对每个文件调用 `loadApi(filePath)`：
   - 生成相对路径 key（相对于 `paths.coreHttp`，去掉扩展名，统一为 `/` 分隔）。
   - 若该 key 已存在，先执行 `unloadApi(key)`。
   - 构建 `file://` URL 并附加时间戳查询参数，避免缓存。
   - `await import(fileUrl)` 动态导入模块。
   - 若导出对象含有 `default`：
     - 若 `default` 是类，则 `new module.default()`。
     - 若 `default` 是对象，则使用 `new HttpApi(module.default)` 包装。
   - 校验 `routes` 是否为数组，否则置空。
   - 确保存在 `getInfo()` 方法：
     - 若未实现，自动给出一个用于展示的默认实现。
   - 记录 `key/filePath`，并将实例存入 `apis`。
5. 调用 `sortByPriority()`：
   - 过滤掉 `enable === false` 的实例。
   - 按 `priority` 从大到小排序。
6. 标记 `loaded = true` 并输出统计日志。

---

## 注册流程：`register(app, bot)`

由 `Bot.run()` 在初始化中间件之后调用，负责与 Express/Bot 结合：

1. 保存 `app` 与 `bot` 引用到实例属性。
2. 注册一个全局中间件：
   - 为每个请求注入：
     - `req.bot = bot`。
     - `req.apiLoader = this`。
3. 按优先级顺序初始化每个 API：
   - 仅处理 `enable !== false` 的实例。
   - 调用 `api.init(app, bot)`：
     - 在 `HttpApi` 内部会注册路由与 WebSocket 处理器。
   - 记录每个 API 的路由与 WS 数量。
4. 为 `/api/*` 添加兜底 404 处理：
   - 若无其它 API 匹配，则返回结构化 JSON 错误。

> 所有 API 路由都会经过 Bot 的认证中间件与通用中间件栈，确保有统一的安全与日志策略。

---

## 单个 API 重载：`changeApi(key)`

- 使用场景：文件变化触发，或手动重载单个 API。

1. 通过 key 找到旧 API 实例。
2. 输出「重载 API」日志。
3. 调用 `loadApi(api.filePath)` 重新加载模块。
4. `sortByPriority()` 调整顺序。
5. 若新 API 存在且已经有 `app` 和 `bot`：
   - 调用 `newApi.init(this.app, this.bot)` 重新注册其路由。
6. 输出重载完成日志。

> 注意：旧路由不会自动卸载，通常需要配合 `Bot` 重启或明确设计幂等初始化逻辑。

---

## 文件监视与热加载：`watch(enable = true)`

- `enable = false`：关闭所有已有 watcher 并清空。
- `enable = true`：
  1. 使用 `chokidar.watch(apiDir, { ignored: /(^|[\/\\])\../, ignoreInitial: true })` 监视 `core/http`。
  2. 监听事件：
     - `add(filePath)`：
       - 新增文件时，调用 `loadApi(filePath)` 并 `sortByPriority()`。
       - 若已存在 `app/bot`，调用新 API 的 `init` 完成即时挂载。
     - `change(filePath)`：
       - 将路径转换为 key，调用 `changeApi(key)` 热重载。
     - `unlink(filePath)`：
       - 将路径转换为 key，调用 `unloadApi(key)` 删除实例，并重新排序。
  3. 输出「文件监视已启动」日志。

---

## API 信息获取：`getApiList()` 与 `getApi(key)`

- `getApiList()`：
  - 遍历 `this.apis`，对每个实例调用 `getInfo()`（若存在），否则构造基本信息。
  - 返回数组，适合用于：
    - 后台管理面板展示。
    - 对外提供 API 文档与统计。

- `getApi(key)`：
  - 按 key 返回对应实例，不存在则返回 `null`。

---

## 使用建议

- **新增 API 模块**
  - 在 `core/http` 下创建新的 `.js` 文件。
  - 按 `docs/http-api.md` 中的推荐方式导出 `default`。
  - `ApiLoader` 会在启动或文件变更时自动加载。

- **调试路由问题**
  - 确认 API 是否出现在 `getApiList()` 输出中。
  - 查看启动日志中对应 API 的「注册路由」信息。
  - 检查是否被 `enable === false` 禁用。

- **热更新注意事项**
  - 若 API 内部在 `init` 中注册了全局中间件，应确保多次调用不会产生重复挂载的问题（可用 idempotent 逻辑）。
  - 对于复杂 API，必要时仍建议重启进程以获得更清晰的状态。


