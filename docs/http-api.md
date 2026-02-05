# HttpApi 文档

> **文件位置**: `src/infrastructure/http/http.js`  
> **可扩展性**：HttpApi是HTTP/API系统的核心扩展点。通过继承HttpApi或导出对象，开发者可以快速创建自定义API，无需修改底层代码。详见 **[框架可扩展性指南](框架可扩展性指南.md)** ⭐

`HttpApi` 是 XRK-AGT 中的 **HTTP API 基类**，用于统一定义 REST 路由、WebSocket 处理器、中间件等。

所有位于 `core/*/http` 目录下的 API 模块都可以：
- **直接导出对象（推荐）**：由 `ApiLoader` 自动包装为 `HttpApi` 实例
- **继承 HttpApi 类**：手动控制初始化逻辑，适合复杂场景

### 扩展特性

- ✅ **零配置扩展**：放置到任意 `core/*/http/` 目录即可自动加载
- ✅ **标准化接口**：统一的基类和接口规范
- ✅ **灵活路由**：支持REST API和WebSocket
- ✅ **中间件支持**：支持全局和路由级中间件
- ✅ **热重载支持**：修改代码后自动重载

---

## 架构概览

```mermaid
flowchart TB
    subgraph Core["Core模块"]
        API["core/*/http/*.js<br/>API模块"]
    end
    
    subgraph Loader["ApiLoader"]
        Scan["扫描API模块"]
        Wrap["包装为HttpApi实例"]
        Init["调用init()"]
    end
    
    subgraph HttpApi["HttpApi基类"]
        Routes["注册HTTP路由"]
        WS["注册WebSocket"]
        Middleware["挂载中间件"]
    end
    
    subgraph Express["Express应用"]
        REST["REST API路由"]
        WSHandler["WebSocket处理器"]
    end
    
    Core -->|自动加载| Loader
    Loader -->|创建实例| HttpApi
    HttpApi -->|注册路由| Express
    HttpApi -->|注册处理器| Express
    
    style Core fill:#E6F3FF
    style Loader fill:#FFE6CC
    style HttpApi fill:#90EE90
    style Express fill:#FFD700
```

---

## 构造参数

```javascript
constructor(data = {})
```

**参数说明**：

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `name` | `string` | API名称（必填，用于标识和日志） | `'unnamed-api'` |
| `dsc` | `string` | API描述 | `'暂无描述'` |
| `routes` | `Array` | 路由配置数组 | `[]` |
| `priority` | `number` | 优先级（数字越大优先级越高） | `100` |
| `enable` | `boolean` | 是否启用 | `true` |
| `init` | `Function` | 自定义初始化钩子 `(app, bot) => {}` | `null` |
| `ws` | `Object` | WebSocket处理器 `{ '/path': handler \| [handlers] }` | `{}` |
| `middleware` | `Array` | 全局中间件数组（在路由注册前执行） | `[]` |

**路由配置** (`routes` 数组元素)：

| 字段 | 类型 | 说明 |
|------|------|------|
| `method` | `string` | HTTP方法（GET/POST/PUT/DELETE等，不区分大小写） |
| `path` | `string` | 路由路径（如 `/api/example/ping`） |
| `handler` | `Function` | 处理函数 `(req, res, bot, next) => {}` |
| `middleware` | `Array` | 可选的路由级中间件数组 |

**内部属性**（由框架自动设置）：

- `this.createTime` - 创建时间戳
- `this.wsHandlers` - WebSocket处理器集合（从 `ws` 参数初始化）
- `this.initHook` - 初始化钩子函数（从 `init` 参数初始化）

---

## 核心方法

### `async init(app, bot)`

初始化API，注册路由和WebSocket处理器。

```mermaid
flowchart LR
    A["init(app, bot)"] --> B{"中间件存在?"}
    B -->|是| C["挂载全局中间件"]
    B -->|否| D["注册HTTP路由"]
    C --> D
    D --> E["注册WebSocket处理器"]
    E --> F{"initHook存在?"}
    F -->|是| G["执行自定义初始化钩子"]
    F -->|否| H["完成"]
    G --> H
    
    style A fill:#E6F3FF
    style D fill:#90EE90
    style E fill:#87CEEB
    style H fill:#FFD700
```

**执行流程**：
1. 挂载全局中间件（如果存在）
2. 注册HTTP路由
3. 注册WebSocket处理器
4. 执行自定义初始化钩子（如果存在）

**返回值**：`Promise<boolean>` - 始终返回 `true`

### `registerRoutes(app, bot)`

注册HTTP路由到Express应用。

**流程**：
1. 验证 `routes` 数组
2. 遍历每个路由，验证 `method`、`path`、`handler`
3. 使用 `wrapHandler` 包装处理函数（自动注入 `req.bot` 和 `req.api`）
4. 注册到Express（支持路由级中间件）

**处理函数签名**：
```javascript
async (req, res, bot, next) => {
  // req.bot - Bot实例（已自动注入）
  // req.api - 当前API实例（已自动注入）
  // bot - Bot实例（参数传递）
  // next - Express next函数（可选）
  
  // 推荐：直接发送响应
  res.json({ success: true, data: result });
}
```

**错误处理**：
- 自动捕获handler内部错误并记录日志
- 若响应未发送，返回500 JSON错误（开发环境包含错误详情）
- 若响应已发送，只记录警告日志

### `wrapHandler(handler, bot)`

包装路由处理函数，注入上下文并处理错误。

**注入的上下文**：
- `req.bot = bot` - Bot实例
- `req.api = this` - 当前API实例

### `registerWebSocketHandlers(bot)`

注册WebSocket处理器到 `bot.wsf`。

**WebSocket配置格式**：
```javascript
ws: {
  '/ws/chat': handler,                    // 单个处理器
  '/ws/notify': [handler1, handler2]      // 多个处理器（数组）
}
```

**处理函数签名**：
```javascript
(conn, req, bot, socket, head) => {
  conn.on('message', (msg) => {
    conn.sendMsg('响应消息');
  });
}
```

**错误处理**：自动捕获异常并记录日志，不会导致连接断开

### `getInfo()`

返回API信息对象，包含 `name`、`dsc`、`priority`、`routes`数量、`ws`数量、`enable`、`createTime`。

**返回格式**：
```javascript
{
  name: string,        // API名称
  dsc: string,         // API描述
  priority: number,    // 优先级
  routes: number,      // 路由数量
  ws: number,          // WebSocket处理器数量
  enable: boolean,     // 是否启用
  createTime: number   // 创建时间戳
}
```

### `start()` / `stop()` / `async reload(app, bot)`

- `start()` - 启用API（设置 `enable = true`）
- `stop()` - 停用API（设置 `enable = false`）
- `reload(app, bot)` - 重载API（stop → init → start）

> **注意**：文件级别的重载由 `ApiLoader` 负责，`reload` 更适用于逻辑级微调。

---

## 使用示例

### 方式1：对象导出（推荐）

```javascript
// core/my-core/http/example.js
export default {
  name: 'example-api',
  dsc: '示例 API',
  priority: 100,
  
  // 全局中间件（可选）
  middleware: [
    (req, res, next) => {
      // 全局中间件逻辑
      next();
    }
  ],
  
  // HTTP路由
  routes: [
    {
      method: 'GET',
      path: '/api/example/ping',
      handler: async (req, res, bot) => {
        // req.bot 和 req.api 已自动注入
        res.json({
          success: true,
          message: 'pong',
          botOnline: bot.uin?.length > 0,
          apiName: req.api.name
        });
      }
    },
    {
      method: 'POST',
      path: '/api/example/echo',
      middleware: [(req, res, next) => next()], // 路由级中间件
      handler: async (req, res, bot) => {
        const { message } = req.body;
        res.json({ success: true, echo: message });
      }
    }
  ],
  
  // WebSocket处理器（可选）
  ws: {
    '/ws/example': (conn, req, bot) => {
      conn.on('message', (msg) => {
        conn.sendMsg(`echo: ${msg}`);
      });
    }
  },
  
  // 自定义初始化钩子（可选）
  init: async (app, bot) => {
    console.log('Example API 初始化完成');
  }
};
```

### 方式2：继承HttpApi类

```javascript
// core/my-core/http/advanced-api.js
import HttpApi from '#infrastructure/http/http.js';

export default class AdvancedAPI extends HttpApi {
  constructor() {
    super({
      name: 'advanced-api',
      dsc: '高级API示例',
      priority: 200,
      routes: [
        {
          method: 'GET',
          path: '/api/advanced/status',
          handler: this.handleStatus.bind(this)
        }
      ]
    });
  }
  
  async handleStatus(req, res, bot) {
    const info = this.getInfo();
    res.json({ success: true, api: info });
  }
}
```

### 方式3：调用工作流系统

```javascript
// core/my-core/http/ai-chat-api.js
import StreamLoader from '#infrastructure/aistream/loader.js';

export default {
  name: 'ai-chat-api',
  routes: [
    {
      method: 'POST',
      path: '/api/ai/chat',
      handler: async (req, res, bot) => {
        const { message, streamName = 'chat' } = req.body;
        const stream = StreamLoader.getStream(streamName);
        
        if (!stream) {
          return res.status(404).json({
            success: false,
            message: '工作流未找到'
          });
        }
        
        const e = {
          user_id: req.user?.id || 'web_user',
          msg: message,
          reply: async (msg) => {
            res.json({ success: true, response: msg });
          }
        };
        
        try {
          await stream.process(e, message, {
            enableMemory: true,
            enableDatabase: true
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: error.message
          });
        }
      }
    }
  ]
};
```

> **注意**：API文件放置在 `core/*/http/` 目录后，`ApiLoader` 会自动加载并注册。

---

## 与其他系统的集成

### 中间件执行顺序

所有 `HttpApi` 路由都运行在 **Bot 的中间件栈之后**（CORS、安全头、认证等已处理）。

### 常见集成模式

**调用工作流系统**：
```javascript
import StreamLoader from '#infrastructure/aistream/loader.js';

handler: async (req, res, bot) => {
  const stream = StreamLoader.getStream('chat');
  const e = {
    user_id: req.user?.id || 'web_user',
    msg: req.body.message,
    reply: async (msg) => res.json({ success: true, response: msg })
  };
  await stream.process(e, req.body.message, {
    enableMemory: true,
    enableDatabase: true
  });
}
```

**桥接到插件系统**：
```javascript
handler: async (req, res, bot) => {
  const e = {
    event_id: `api_${Date.now()}`,
    tasker: 'stdin',
    user_id: req.user?.id || 'api_user',
    msg: req.body.message,
    reply: async (msg) => res.json({ success: true, response: msg })
  };
  bot.em('stdin.message', e);
}
```

**配置管理接口**：
```javascript
import MyConfig from '#infrastructure/commonconfig/myconfig.js';

handler: async (req, res, bot) => {
  const config = new MyConfig();
  if (req.method === 'GET') {
    const data = await config.read();
    res.json({ success: true, data });
  } else if (req.method === 'POST') {
    await config.write(req.body);
    res.json({ success: true });
  }
}
```

---

## 最佳实践

1. **业务逻辑分层**：业务逻辑沉淀在插件与工作流中，HTTP层提供入口和管理界面
2. **统一错误处理**：使用 `{ success: false, message: string }` 格式，利用自动错误捕获
3. **与前端协作**：统一使用JSON格式，提供清晰的API文档
4. **性能优化**：合理使用中间件，异步操作使用 `async/await`

---

## 相关文档

- **[API加载器](api-loader.md)** - API自动加载和热重载机制
- **[system-Core 特性](system-core.md)** - system-Core 内置模块完整说明，包含10个HTTP API模块的实际示例 ⭐
- **[HTTP业务层](http-business-layer.md)** - 重定向、CDN、反向代理增强功能
- **[Server服务器架构](server.md)** - 完整的服务器架构说明
- **[框架可扩展性指南](框架可扩展性指南.md)** - 扩展开发完整指南
