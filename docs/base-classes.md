# 业务扩展基类契约

业务代码放在 `core/<Core名>/` 对应子目录；**必须**继承或符合下列基类/导出约定。状态容器（`Map`/`Set`/数组缓存）用**类字段**声明，禁止在 `constructor` 内 `new Map()`（热重载会重复执行 constructor）。

## plugin（`plugins/plugin.js`）

```javascript
import plugin from '#infrastructure/plugins/plugin.js';

export default class MyPlugin extends plugin {
  constructor() {
    super({
      name: 'my-plugin',
      dsc: '说明',
      event: 'message',           // 或 ['message', 'notice']
      priority: 5000,
      rule: [{ reg: /^#命令/ }],
      handler: { 命令: 'run' },   // 或 handler: 'run'
      task: [{ cron: '0 9 * * *', fnc: 'daily' }],
      eventSubscribe: [{ eventType: 'device', fnc: 'onDevice' }]
    });
  }
  async run(e) { /* ... */ }
}
```

Enhancer 继承 `plugins/enhancer-base.js`（内部 extends `plugin`）。

持有 chokidar / 定时器等资源的插件，实现 `async destroy()`；热重载/卸载时 `PluginsLoader.unloadPlugin` 会调用。文件监视优先用 `HotReloadBase`（`#utils/hot-reload-base.js`），勿在业务里直接 `chokidar.watch`。

> 历史插件可依赖 `global.plugin`（`bootstrap-globals.js` 注入）；新插件应 `import plugin from '#infrastructure/plugins/plugin.js'`。

## HttpApi（`http/http.js`）

推荐**对象导出**，由 `ApiLoader` 包装为 `HttpApi`：

```javascript
export default {
  name: 'my-api',
  dsc: '说明',
  priority: 100,
  routes: [{ method: 'GET', path: '/api/foo', handler: async (req, res, Bot) => { ... } }],
  ws: { '/ws/foo': (conn, req, bot) => {} },
  init: async (app, Bot) => {}
};
```

`/api/*` 路由默认 `systemAuth`；公开接口设 `systemAuth: false`。响应统一 `HttpResponse`（`#utils/http-utils.js`）。

## AIStream（`aistream/aistream.js`）

```javascript
import AIStream from '#infrastructure/aistream/aistream.js';

export default class MyStream extends AIStream {
  constructor() {
    super({
      name: 'my-stream',          // 必填，与文件名建议一致
      description: '...',
      priority: 100,
      config: { enabled: true },
      embedding: { enabled: true }
    });
  }
  async init() {
    await super.init();
    this.registerMcpTool('tool_name', { description, inputSchema, handler });
  }
  async cleanup() { /* 可选，热重载/停机释放资源 */ }
}
```

## ConfigBase（`commonconfig/commonconfig.js`）

```javascript
import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

export default class MyConfig extends ConfigBase {
  constructor() {
    super({
      name: 'myconfig',
      displayName: '显示名',
      filePath: 'data/.../my.yaml',  // 或函数 (cfg) => path
      schema: { /* ConfigBase 字段定义 */ }
    });
  }
}
```

模板：`core/<Core>/default/<name>.yaml`；运行时：`data/<产品>/`。

## EventListenerBase（`listener/base.js`）

```javascript
import EventListenerBase from '#infrastructure/listener/base.js';

export default class MyEvent extends EventListenerBase {
  constructor() { super('MyAdapter'); }
  async init() { /* 在 bot.on('adapter.event', handler) 注册 */ }
}
```

Loader 会 `new default()` 并注入 `instance.bot`，**必须**实现 `async init()`。去重用 `markProcessed(e)`、`markAdapter(e, flags)`。

> 旧 `listener/listener.js` 的 `EventListener` 已移除，勿再使用。

## Tasker（`bot/tasker.js` 工具类）

Tasker 模块通过 `Bot.tasker.push(new (class { ... })())` 注册，无统一继承；事件标准化用 `TaskerBase.createEvent()` / `EventNormalizer`。

## 停机与热重载

- 停机：`stopAllLoaderWatchers()`（`#utils/loader-shutdown.js`）在 `Bot.closeServer()` 调用（含 cfg YAML、Renderer 模板 watcher）
- 热重载：各 Loader 使用 `HotReloadBase` + `FileLoader.importFresh`
