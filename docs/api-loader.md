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

**API加载完整流程**:

```mermaid
flowchart TB
    A[ApiLoader.load] --> B[确保core/http目录存在]
    B --> C[getApiFiles递归扫描]
    C --> D[收集.js文件<br/>跳过.和_开头]
    D --> E[遍历每个文件]
    E --> F[loadApi加载单个API]
    F --> G[生成相对路径key]
    G --> H{key是否已存在}
    H -->|是| I[unloadApi卸载旧API]
    H -->|否| J[构建file://URL]
    I --> J
    J --> K[动态导入模块]
    K --> L{导出类型}
    L -->|类| M[new module.default]
    L -->|对象| N[new HttpApi包装]
    M --> O[校验routes数组]
    N --> O
    O --> P[确保getInfo方法存在]
    P --> Q[存入apis Map]
    Q --> R[sortByPriority排序]
    R --> S[过滤enable=false]
    S --> T[按priority排序]
    T --> U[loaded=true]
    
    style A fill:#E6F3FF
    style F fill:#FFE6CC
    style U fill:#90EE90
```

**步骤说明**：

1. 确保 `paths.coreHttp` 目录存在
2. 调用 `getApiFiles` 递归扫描，收集 `.js` 文件
3. 对每个文件调用 `loadApi`：
   - 生成相对路径 key
   - 动态导入模块并实例化
   - 校验并存入 `apis` Map
4. 调用 `sortByPriority` 排序
5. 标记 `loaded = true`

---

## 注册流程：`register(app, bot)`

**API注册完整流程**:

```mermaid
sequenceDiagram
    participant Bot as Bot.run
    participant Loader as ApiLoader
    participant Express as Express
    participant API as HttpApi实例
    
    Bot->>Loader: register(app, bot)
    Loader->>Loader: 保存app和bot引用
    Loader->>Express: 注册全局中间件<br/>注入req.bot和req.apiLoader
    loop 按优先级遍历API
        Loader->>API: api.init(app, bot)
        API->>Express: 注册HTTP路由
        API->>Bot: 注册WebSocket处理器
        API-->>Loader: 返回路由和WS数量
    end
    Loader->>Express: 添加/api/* 404兜底处理
    Loader-->>Bot: 注册完成
```

**步骤说明**：

1. 保存 `app` 与 `bot` 引用
2. 注册全局中间件，注入 `req.bot` 和 `req.apiLoader`
3. 按优先级初始化每个 API，注册路由和 WebSocket
4. 添加 `/api/*` 404 兜底处理

> 所有 API 路由都会经过 Bot 的认证中间件与通用中间件栈，确保有统一的安全与日志策略

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

**热加载流程**:

```mermaid
flowchart TB
    A[watch启用] --> B{enable参数}
    B -->|false| C[关闭所有watcher]
    B -->|true| D[chokidar.watch监视core/http]
    D --> E[监听文件事件]
    E --> F{事件类型}
    F -->|add新增| G[loadApi加载新API]
    F -->|change修改| H[changeApi热重载]
    F -->|unlink删除| I[unloadApi卸载API]
    G --> J[sortByPriority排序]
    H --> J
    I --> J
    J --> K{是否有app/bot}
    K -->|是| L[调用init即时挂载]
    K -->|否| M[等待register时挂载]
    L --> N[热加载完成]
    M --> N
    
    style A fill:#E6F3FF
    style E fill:#FFE6CC
    style N fill:#90EE90
```

**事件处理**：

- `add` - 新增文件时加载并排序，若已初始化则即时挂载
- `change` - 文件修改时热重载
- `unlink` - 文件删除时卸载并重新排序

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


