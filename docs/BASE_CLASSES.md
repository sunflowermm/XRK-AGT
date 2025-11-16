# XRK-AGT 基类文档

本文档介绍XRK-AGT系统中所有基类的使用方法和最佳实践，为开发者提供完整的开发指南。

## 目录

- [ConfigBase - 配置文件管理基类](#configbase)
- [AIStream - AI工作流基类](#aistream)
- [HttpApi - HTTP API基础类](#httpapi)
- [plugin - 插件基类](#plugin)
- [Renderer - 渲染器基类](#renderer)
- [EventListener - 事件监听器基类](#eventlistener)
- [BaseManager - 基础管理类](#basemanager)
- [Runtime - 运行时类](#runtime)
- [BotUtil - 工具类](#botutil)
- [Bot - Bot主类](#bot)

---

## ConfigBase

### 概述

`ConfigBase` 是配置文件管理的基类，提供统一的配置文件读写接口，支持YAML和JSON格式。支持动态路径、缓存、备份、验证等功能。

### 位置

`lib/commonconfig/commonconfig.js`

### 核心功能

- ✅ 支持YAML和JSON格式
- ✅ 自动缓存（5秒TTL）
- ✅ 自动备份
- ✅ 数据验证
- ✅ 动态路径支持
- ✅ 文件监听（可选）

### 使用示例

```javascript
import ConfigBase from '../../lib/commonconfig/commonconfig.js';

class MyConfig extends ConfigBase {
  constructor() {
    super({
      name: 'myconfig',
      displayName: '我的配置',
      description: '自定义配置示例',
      filePath: 'config/myconfig.yaml',
      fileType: 'yaml',
      schema: {
        // 配置结构定义（用于验证）
        fields: {
          apiKey: {
            type: 'string',
            label: 'API密钥',
            required: true
          },
          timeout: {
            type: 'number',
            label: '超时时间',
            default: 5000,
            min: 1000,
            max: 30000
          }
        }
      }
    });
  }
}

// 使用
const config = new MyConfig();

// 读取配置
const data = await config.read();

// 写入配置
await config.write({
  apiKey: 'your-key',
  timeout: 10000
});

// 检查文件是否存在
const exists = await config.exists();

// 备份配置
await config.backup();
```

### 动态路径示例

```javascript
class ServerConfig extends ConfigBase {
  constructor() {
    super({
      name: 'server',
      filePath: (cfg) => {
        // 根据端口动态生成路径
        const port = cfg._port || 8086;
        return `data/server_bots/${port}/server.yaml`;
      },
      fileType: 'yaml'
    });
  }
}
```

### API参考

#### 方法

- `async read(useCache = true)`: 读取配置文件
- `async write(data, options = {})`: 写入配置文件
- `async exists()`: 检查文件是否存在
- `async backup()`: 备份配置文件
- `async validate(data)`: 验证配置数据
- `getFilePath()`: 获取配置文件完整路径

#### 属性

- `name`: 配置名称
- `displayName`: 显示名称
- `description`: 配置描述
- `filePath`: 文件路径
- `fileType`: 文件类型（'yaml'或'json'）
- `schema`: 配置结构定义

---

## AIStream

### 概述

`AIStream` 是AI工作流的基类，提供AI对话、函数调用、Embedding等核心功能的统一接口。支持多种Embedding提供商（ONNX、HuggingFace、FastText、API、Lightweight）。

### 位置

`lib/aistream/aistream.js`

### 核心功能

- ✅ AI对话（支持流式输出）
- ✅ 函数调用（Function Calling）
- ✅ Embedding支持（5种提供商）
- ✅ 上下文增强
- ✅ 相似度计算
- ✅ 缓存机制

### 使用示例

```javascript
import AIStream from '../../lib/aistream/aistream.js';

class MyStream extends AIStream {
  constructor() {
    super({
      name: 'my-stream',
      description: '我的工作流',
      version: '1.0.0',
      author: 'YourName',
      priority: 100,
      config: {
        temperature: 0.7,
        maxTokens: 4000,
        topP: 0.9
      },
      embedding: {
        enabled: true,
        provider: 'lightweight', // lightweight/onnx/hf/fasttext/api
        maxContexts: 5,
        similarityThreshold: 0.6
      }
    });
  }
  
  /**
   * 构建系统提示词（必须实现）
   */
  async buildSystemPrompt(context) {
    return `你是一个智能助手，专门帮助用户解决问题。
当前上下文：${JSON.stringify(context)}`;
  }
  
  /**
   * 注册自定义函数
   */
  async init() {
    await super.init();
    
    // 注册函数
    this.registerFunction({
      name: 'get_weather',
      description: '获取天气信息',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '城市名称'
          }
        },
        required: ['city']
      },
      handler: async (params) => {
        // 函数实现
        return { weather: '晴天', temperature: 25 };
      }
    });
  }
}

// 使用
const stream = new MyStream();
await stream.init();
await stream.initEmbedding();

// 调用AI
const response = await stream.callAI('今天天气怎么样？');
```

### Embedding提供商

1. **lightweight**: 轻量级BM25算法（零依赖，推荐）
2. **onnx**: ONNX Runtime（需要安装onnxruntime-node）
3. **hf**: HuggingFace API（需要Token）
4. **fasttext**: FastText.js（需要安装fasttext.js）
5. **api**: 自定义API（需要配置apiUrl和apiKey）

### API参考

#### 必须实现的方法（抽象方法）

- `async buildSystemPrompt(context)`: 构建系统提示词
  - `context`: 上下文对象
  - 返回: 系统提示词字符串
- `async buildChatContext(e, question)`: 构建对话上下文
  - `e`: 事件对象（可选）
  - `question`: 用户问题（字符串或对象）
  - 返回: 消息数组

#### 核心方法

- `async init()`: 初始化工作流（只执行一次）
- `async initEmbedding()`: 初始化Embedding
  - 支持5种提供商：lightweight/onnx/hf/fasttext/api
- `async callAI(messages, apiConfig)`: 调用AI（非流式）
  - `messages`: 消息数组
  - `apiConfig`: API配置（可选）
  - 返回: AI响应文本
- `async callAIStream(messages, apiConfig, onDelta)`: 调用AI（流式）
  - `onDelta`: 增量回调函数 (delta) => {}
  - 返回: 完整响应文本

#### 函数管理

- `registerFunction(name, options)`: 注册函数
  - `name`: 函数名称
  - `options.handler`: 处理函数
  - `options.prompt`: 函数描述
  - `options.enabled`: 是否启用
  - `options.permission`: 权限要求
- `isFunctionEnabled(name)`: 检查函数是否启用
- `toggleFunction(name, enabled)`: 切换函数启用状态
- `getEnabledFunctions()`: 获取所有启用的函数
- `getFunction(name)`: 获取函数对象

#### Embedding方法

- `async generateEmbedding(text)`: 生成文本的Embedding向量
- `async searchSimilarMessages(query, groupId)`: 搜索相似消息
- `cosineSimilarity(vec1, vec2)`: 计算余弦相似度

---

## HttpApi

### 概述

`HttpApi` 是HTTP API的基础类，提供统一的HTTP API接口结构，支持路由注册、WebSocket处理、中间件等。

### 位置

`lib/http/http.js`

### 核心功能

- ✅ RESTful路由注册
- ✅ WebSocket支持
- ✅ 中间件支持
- ✅ 错误处理
- ✅ 优先级控制

### 使用示例

#### 方式1: 对象导出（推荐）

```javascript
export default {
  name: 'my-api',
  dsc: '我的API',
  priority: 100,
  enable: true,
  
  routes: [
    {
      method: 'GET',
      path: '/api/test',
      handler: async (req, res, Bot) => {
        res.json({ 
          success: true, 
          message: 'Hello World',
          timestamp: Date.now()
        });
      }
    },
    {
      method: 'POST',
      path: '/api/data',
      middleware: [
        // 自定义中间件
        (req, res, next) => {
          // 验证逻辑
          next();
        }
      ],
      handler: async (req, res, Bot) => {
        const data = req.body;
        // 处理数据
        res.json({ success: true, data });
      }
    }
  ],
  
  ws: {
    '/ws/chat': (conn, req, Bot) => {
      conn.on('message', (message) => {
        // 处理WebSocket消息
        conn.send(JSON.stringify({ type: 'response', data: message }));
      });
    }
  },
  
  init: async (app, Bot) => {
    // 初始化逻辑
    console.log('API初始化完成');
  }
};
```

#### 方式2: 继承类

```javascript
import HttpApi from '../../lib/http/http.js';

export default class MyApi extends HttpApi {
  constructor() {
    super({
      name: 'my-api',
      dsc: '我的API',
      priority: 100,
      routes: [
        {
          method: 'GET',
          path: '/api/test',
          handler: this.handleTest.bind(this)
        }
      ]
    });
  }
  
  async handleTest(req, res, Bot) {
    res.json({ success: true });
  }
}
```

### API参考

#### 路由配置

```javascript
{
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  path: '/api/path',
  handler: async (req, res, Bot, next) => {
    // req: Express请求对象
    // res: Express响应对象
    // Bot: Bot实例
    // next: Express next函数
  },
  middleware: [/* 中间件数组 */]
}
```

#### WebSocket配置

```javascript
ws: {
  '/ws/path': (conn, req, Bot, socket, head) => {
    // conn: WebSocket连接
    // req: HTTP请求对象
    // Bot: Bot实例
    // socket: 底层socket
    // head: 升级头
  }
}
```

---

## plugin

### 概述

`plugin` 是所有插件的基类，提供事件处理、工作流集成、上下文管理等功能。

### 位置

`lib/plugins/plugin.js`

### 核心功能

- ✅ 消息事件处理
- ✅ 定时任务
- ✅ 工作流集成
- ✅ 上下文管理
- ✅ 状态管理

### 使用示例

```javascript
import plugin from '../../lib/plugins/plugin.js';

export default class MyPlugin extends plugin {
  constructor() {
    super({
      name: 'my-plugin',
      dsc: '我的插件',
      event: 'message', // 监听消息事件
      priority: 5000, // 优先级
      
      // 规则配置
      rule: [
        {
          reg: '^#测试$', // 正则表达式
          fnc: 'test', // 处理方法名
          log: false // 是否记录日志
        },
        {
          reg: '^#帮助$',
          fnc: 'help'
        }
      ],
      
      // 定时任务
      task: {
        name: '定时任务',
        fnc: 'scheduledTask',
        cron: '0 0 * * *' // 每天0点执行
      }
    });
  }
  
  /**
   * 测试方法
   */
  async test(e) {
    await this.reply('测试成功！', false);
  }
  
  /**
   * 帮助方法
   */
  async help(e) {
    const helpText = `可用命令：
#测试 - 测试功能
#帮助 - 显示帮助`;
    await this.reply(helpText);
  }
  
  /**
   * 定时任务
   */
  async scheduledTask() {
    console.log('执行定时任务');
  }
  
  /**
   * 使用工作流
   */
  async useStream(e) {
    const stream = this.getStream('device');
    if (stream) {
      const response = await stream.callAI('你好');
      await this.reply(response);
    }
  }
  
  /**
   * 使用上下文
   */
  async useContext(e) {
    // 设置上下文
    this.setContext('waiting_input', false, 60, '操作超时');
    
    // 等待用户输入
    const nextEvent = await this.awaitContext(false, 60);
    if (nextEvent) {
      await this.reply(`收到：${nextEvent.msg}`);
    }
  }
}
```

### API参考

#### 核心方法

- `reply(msg, quote, data)`: 回复消息
- `getStream(name)`: 获取工作流
- `getAllStreams()`: 获取所有工作流
- `setContext(type, isGroup, time, timeout)`: 设置上下文
- `getContext(type, isGroup)`: 获取上下文
- `finish(type, isGroup)`: 结束上下文
- `awaitContext(isGroup, time)`: 等待上下文

#### 事件类型

- `message`: 消息事件
- `notice`: 通知事件
- `request`: 请求事件
- `online`: 上线事件

---

## Renderer

### 概述

`Renderer` 是渲染器的基类，提供HTML模板渲染、图片生成等功能的统一接口。

### 位置

`lib/renderer/Renderer.js`

### 核心功能

- ✅ HTML模板渲染
- ✅ 模板文件监听
- ✅ 自动重载
- ✅ 资源路径处理

### 使用示例

```javascript
import Renderer from '../../lib/renderer/Renderer.js';

export default class MyRenderer extends Renderer {
  constructor(config) {
    super({
      id: 'my-renderer',
      type: 'image',
      render: 'renderImage'
    });
  }
  
  /**
   * 渲染图片
   */
  async renderImage(data) {
    // 使用模板
    const htmlPath = this.dealTpl('my-template', {
      tplFile: './templates/my-template.html',
      title: data.title,
      content: data.content,
      saveId: data.id
    });
    
    // 使用渲染器渲染
    const renderer = RendererLoader.getRenderer('puppeteer');
    const imagePath = await renderer.render(htmlPath, {
      width: 1280,
      height: 720
    });
    
    return imagePath;
  }
}
```

### API参考

#### 核心方法

- `dealTpl(name, data)`: 处理模板
- `watch(tplFile)`: 监听模板文件
- `createDir(dirname)`: 创建目录

---

## EventListener

### 概述

`EventListener` 是事件监听器的基类，提供事件监听和处理的统一接口。

### 位置

`lib/listener/listener.js`

### 核心功能

- ✅ 事件监听
- ✅ 插件分发
- ✅ 一次性监听支持

### 使用示例

```javascript
import EventListener from '../../lib/listener/listener.js';

export default class MyListener extends EventListener {
  constructor() {
    super({
      prefix: 'my-prefix',
      event: 'message', // 或 ['message', 'notice']
      once: false
    });
  }
  
  /**
   * 执行事件处理
   */
  async execute(e) {
    // 处理事件
    console.log('收到消息:', e.msg);
    
    // 分发到插件
    this.plugins.deal(e);
  }
  
  /**
   * 也可以实现具体的事件处理方法
   */
  async message(e) {
    // 处理消息事件
    this.plugins.deal(e);
  }
}
```

### API参考

#### 属性

- `prefix`: 事件前缀
- `event`: 监听的事件
- `once`: 是否只监听一次
- `plugins`: 插件加载器实例

#### 方法

- `async execute(e)`: 默认执行方法

---

## BaseManager

### 概述

`BaseManager` 是基础管理类，提供所有管理器的公共功能。

### 位置

`start.js`

### 核心功能

- ✅ 目录管理
- ✅ 日志记录

### 使用示例

```javascript
import BaseManager from './start.js';

class MyManager extends BaseManager {
  constructor(logger) {
    super(logger);
  }
  
  async doSomething() {
    // 确保目录存在
    await this.ensureDirectories();
    
    // 记录日志
    await this.logger.log('执行操作');
    await this.logger.success('操作成功');
  }
}
```

### API参考

#### 方法

- `async ensureDirectories()`: 确保所有必要目录存在

#### 属性

- `logger`: 日志实例

---

## 最佳实践

### 1. 继承基类时

- ✅ 始终调用 `super()` 构造函数
- ✅ 实现所有抽象方法
- ✅ 遵循命名约定
- ✅ 添加适当的错误处理

### 2. 配置管理

- ✅ 使用 `ConfigBase` 管理所有配置
- ✅ 提供合理的默认值
- ✅ 实现数据验证
- ✅ 定期备份配置

### 3. 插件开发

- ✅ 使用 `plugin` 基类
- ✅ 合理设置优先级
- ✅ 使用上下文管理状态
- ✅ 集成工作流功能

### 4. API开发

- ✅ 使用 `HttpApi` 或对象导出
- ✅ 实现错误处理
- ✅ 使用中间件验证
- ✅ 提供清晰的文档

### 5. 工作流开发

- ✅ 继承 `AIStream`
- ✅ 实现 `buildSystemPrompt`
- ✅ 注册必要的函数
- ✅ 配置合适的Embedding

---

## Runtime

### 概述

`Runtime` 是核心运行时类，提供插件运行时的核心功能，包括扩展管理、渲染、消息处理等。

### 位置

`lib/plugins/runtime.js`

### 核心功能

- ✅ 扩展管理
- ✅ 模板渲染
- ✅ 消息处理
- ✅ 截图功能

### 使用示例

```javascript
import Runtime from '../../lib/plugins/runtime.js';

export default class MyPlugin extends plugin {
  async test(e) {
    // 初始化运行时
    const runtime = await Runtime.init(e);
    
    // 渲染模板
    const imagePath = await runtime.render(this, 'template', {
      title: '标题',
      content: '内容'
    });
    
    // 获取扩展
    const ext = runtime.getExtension('myExtension');
    if (ext) {
      await ext.doSomething();
    }
    
    // 使用处理器
    if (runtime.handler.has('myHandler')) {
      await runtime.handler.call('myHandler', e);
    }
  }
}
```

### API参考

#### 静态方法

- `static async init(e)`: 初始化运行时实例

#### 实例方法

- `getExtension(name)`: 获取扩展实例
- `async render(plugin, path, data, cfg)`: 渲染模板
- `handler.has(name)`: 检查处理器是否存在
- `handler.call(name, ...args)`: 调用处理器

---

## BotUtil

### 概述

`BotUtil` 是Bot实用工具类，提供各种实用函数，包括文件操作、字符串处理、网络请求、缓存管理等。

### 位置

`lib/common/util.js`

### 核心功能

- ✅ 文件操作
- ✅ 字符串处理
- ✅ 网络请求
- ✅ 缓存管理
- ✅ 数据转换
- ✅ 日志记录

### 使用示例

```javascript
import BotUtil from '../../lib/common/util.js';

// 文件操作
await BotUtil.mkdir('./data');
const content = await BotUtil.readFile('./config.yaml');
await BotUtil.writeFile('./output.txt', 'content');

// 字符串处理
const uuid = BotUtil.uuid();
const randomStr = BotUtil.randomString(32);
const md5Hash = BotUtil.md5('text');

// 网络请求
const response = await BotUtil.fetch('https://api.example.com', {
  method: 'POST',
  body: JSON.stringify({ data: 'value' })
});

// 缓存管理
const cache = BotUtil.getMap('my-cache', { 
  ttl: 60000, // 1分钟过期
  autoClean: true 
});
cache.set('key', 'value');
const value = cache.get('key');

// 日志记录
BotUtil.makeLog('info', '信息', '标签');
BotUtil.makeLog('error', '错误', '标签', error);
```

### API参考

#### 文件操作

- `static async mkdir(dir)`: 创建目录
- `static async readFile(path)`: 读取文件
- `static async writeFile(path, content)`: 写入文件
- `static async glob(pattern)`: 文件匹配

#### 字符串处理

- `static uuid()`: 生成UUID
- `static randomString(length)`: 生成随机字符串
- `static md5(text)`: MD5哈希

#### 网络请求

- `static async fetch(url, options)`: HTTP请求

#### 缓存管理

- `static getMap(name, options)`: 获取缓存Map

---

## Bot

### 概述

`Bot` 是系统的核心类，负责HTTP服务器、WebSocket、插件管理、配置管理等。继承自EventEmitter，支持事件驱动架构。

### 位置

`lib/bot.js`

### 核心功能

- ✅ HTTP/HTTPS服务器
- ✅ WebSocket支持
- ✅ 插件管理
- ✅ 配置管理
- ✅ 反向代理
- ✅ 事件系统

### 使用示例

```javascript
import Bot from './lib/bot.js';

// 创建Bot实例
const bot = new Bot();

// 启动服务器
await bot.run({ port: 8086 });

// 监听事件
bot.on('online', ({ url, apis, proxyEnabled }) => {
  console.log(`服务器已启动: ${url}`);
  console.log(`已加载 ${apis.length} 个API`);
});

// 获取服务器URL
const url = bot.getServerUrl();

// 生成API密钥
const apiKey = await bot.generateApiKey();
```

### API参考

#### 核心方法

- `async run(options)`: 启动Bot服务器
- `getServerUrl()`: 获取服务器URL
- `async generateApiKey()`: 生成API密钥
- `emit(event, data)`: 触发事件

#### 事件

- `online`: 服务器启动完成
- `error`: 发生错误

---

## 总结

所有基类都经过精心设计，提供了统一的接口和最佳实践。开发者应该：

1. **理解基类的设计意图**
2. **遵循基类的接口约定**
3. **利用基类提供的功能**
4. **扩展而非修改基类**

通过正确使用这些基类，可以快速开发出高质量、可维护的扩展功能。

---

## 相关文档

- [插件开发指南](./PLUGIN_DEVELOPMENT.md)
- [API开发指南](./API_DEVELOPMENT.md)
- [工作流开发指南](./STREAM_DEVELOPMENT.md)
- [配置管理指南](./CONFIG_DEVELOPMENT.md)

