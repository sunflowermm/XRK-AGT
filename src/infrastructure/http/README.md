# HTTP API 框架文档

## 概述

这是一个强大的、可扩展的 HTTP API 框架，支持模块化 API 开发、自动路由注册、中间件管理、WebSocket 支持等功能。

## 核心概念

### API 模块

API 模块是一个独立的 HTTP API 单元，可以导出为对象或类。

#### 对象导出方式（推荐）

```javascript
export default {
  name: 'my-api',
  dsc: '我的API模块',
  priority: 100,
  enable: true,
  routes: [
    {
      method: 'GET',
      path: '/api/test',
      handler: async (req, res, Bot) => {
        res.json({ success: true, data: 'Hello World' });
      }
    }
  ],
  init: async (app, Bot) => {
    // 初始化逻辑
  }
};
```

#### 类导出方式

```javascript
import HttpApi from '#infrastructure/http/http.js';

export default class MyApi extends HttpApi {
  constructor() {
    super({
      name: 'my-api',
      dsc: '我的API模块',
      priority: 100,
      routes: [
        {
          method: 'GET',
          path: '/api/test',
          handler: async (req, res, Bot) => {
            res.json({ success: true });
          }
        }
      ]
    });
  }
}
```

### 路由配置

```javascript
{
  method: 'GET|POST|PUT|DELETE|PATCH',  // HTTP方法
  path: '/api/example',                  // 路由路径
  handler: async (req, res, Bot, next) => {
    // 处理函数
  },
  middleware: [                          // 可选：路由级中间件
    (req, res, next) => { /* ... */ }
  ]
}
```

### 优先级

优先级决定 API 模块的初始化顺序，数字越大优先级越高：
- 默认优先级：100
- 高优先级（如代理）：200+
- 低优先级（如工具API）：50-

## 工具函数

### 响应处理

推荐使用 `HttpResponse` 类进行统一的响应处理：

```javascript
import { HttpResponse } from '#utils/http-utils.js';
import { sendPaginatedResponse } from '#infrastructure/http/utils/helpers.js';

// 发送成功响应
HttpResponse.success(res, { data: 'value' }, '成功');

// 发送错误响应
HttpResponse.error(res, new Error('错误信息'), 400);

// 发送验证错误响应
HttpResponse.validationError(res, '验证失败', 4001);

// 发送未找到响应
HttpResponse.notFound(res, '资源未找到');

// 发送分页响应
sendPaginatedResponse(res, items, { page: 1, pageSize: 10, total: 100 });
```

### 请求验证

```javascript
import { validateRequest } from '#infrastructure/http/utils/helpers.js';

const schema = {
  username: {
    required: true,
    type: 'string',
    validator: (value) => value.length >= 3 || '用户名至少3个字符'
  },
  email: {
    required: true,
    type: 'string',
    validator: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || '无效的邮箱格式'
  }
};

const { valid, errors } = validateRequest(req, schema);
if (!valid) {
  return HttpResponse.error(res, new Error(errors.join(', ')), 400);
}
```

### 中间件创建

```javascript
import { 
  createRateLimiter, 
  createAuthMiddleware, 
  createCorsMiddleware,
  createRequestLogger 
} from '#infrastructure/http/utils/helpers.js';

// 速率限制
const rateLimiter = createRateLimiter({
  windowMs: 60000,  // 1分钟
  max: 100,         // 最大100次请求
  keyGenerator: (req) => req.ip
});

// 认证中间件
const authMiddleware = createAuthMiddleware(async (req) => {
  const token = req.headers['authorization'];
  // 验证token逻辑
  return { valid: true, user: { id: 1 } };
});

// CORS中间件
const corsMiddleware = createCorsMiddleware({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

// 请求日志
const logger = createRequestLogger({
  logLevel: 'info',
  skipPaths: ['/health']
});
```

## 复杂业务场景

### 1. 代理转发

```javascript
import { createProxyMiddleware } from 'http-proxy-middleware';

export default {
  name: 'proxy-api',
  priority: 200,
  init: async (app, Bot) => {
    const proxy = createProxyMiddleware({
      target: 'http://target-server.com',
      changeOrigin: true,
      pathRewrite: {
        '^/api/proxy': ''
      }
    });
    app.use('/api/proxy', proxy);
  }
};
```

### 2. 文件上传

```javascript
import multer from 'multer';

const upload = multer({ dest: 'uploads/' });

export default {
  name: 'upload-api',
  routes: [
    {
      method: 'POST',
      path: '/api/upload',
      middleware: [upload.single('file')],
      handler: async (req, res) => {
        const file = req.file;
        // 处理文件
        HttpResponse.success(res, { fileId: file.filename });
      }
    }
  ]
};
```

### 3. WebSocket 支持

```javascript
export default {
  name: 'ws-api',
  ws: {
    '/ws/chat': (conn, req, bot) => {
      conn.on('message', (message) => {
        // 处理消息
        conn.send(JSON.stringify({ echo: message }));
      });
    }
  }
};
```

### 4. 数据库操作

```javascript
import { getCollection } from '#infrastructure/mongodb.js';

export default {
  name: 'data-api',
  routes: [
    {
      method: 'GET',
      path: '/api/users',
      handler: async (req, res) => {
        const collection = getCollection('users');
        const users = await collection.find({}).toArray();
        HttpResponse.success(res, users);
      }
    }
  ]
};
```

## 最佳实践

1. **错误处理**：始终使用 try-catch 包装异步操作
2. **响应标准化**：使用工具函数发送响应，保持格式一致
3. **参数验证**：使用 validateRequest 验证输入
4. **日志记录**：使用 BotUtil.makeLog 记录重要操作
5. **优先级设置**：合理设置优先级，确保依赖关系正确

## 常见问题

### Q: 如何确保API在404处理器之前注册？

A: 设置较高的优先级（如200+），确保在排序时排在前面。

### Q: 如何处理跨域请求？

A: 使用 createCorsMiddleware 创建CORS中间件，或在全局配置中设置。

### Q: 如何实现请求限流？

A: 使用 createRateLimiter 创建速率限制中间件。

### Q: API模块加载失败怎么办？

A: 检查控制台日志，确保模块导出格式正确，所有必需属性都已设置。

## API参考

### HttpApi 类

- `init(app, bot)` - 初始化API
- `registerRoutes(app, bot)` - 注册路由
- `wrapHandler(handler, bot)` - 包装处理器
- `getInfo()` - 获取API信息
- `start()` - 启用API
- `stop()` - 停用API
- `reload(app, bot)` - 重载API

### ApiLoader

- `load()` - 加载所有API模块
- `register(app, bot)` - 注册所有API到Express
- `getApi(key)` - 获取API实例
- `getApiList()` - 获取API列表
- `changeApi(key)` - 重载API

## 更新日志

### v2.0.0
- 增强健壮性，修复优先级读取错误
- 添加工具函数库
- 优化API实例验证
- 改进错误处理

