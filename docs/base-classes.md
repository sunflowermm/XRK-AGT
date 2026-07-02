# 业务扩展基类契约

> **源码**：`src/infrastructure/` 各基类文件  
> **读者**：在 `core/` 新建插件 / API / 工作流 / 配置 / 事件监听器的开发者  
> **挂载与全局**：完整表格见 **[runtime-surface.md](runtime-surface.md)**（Bot Proxy、`req.bot`、Loader 单例）  
> **Loader 模式**：[infrastructure-shared.md](infrastructure-shared.md)

以下仅为**最小 export 形状**；规则匹配、MCP、鉴权等细节见各 L2 专题。

---

## plugin（`plugins/plugin.js`）

| 项 | 说明 |
|----|------|
| 放置 | `core/<名>/plugin/*.js` 或 `subserver/*/apis/<group>/core/plugin/*.js` |
| 继承 | `import plugin from '#infrastructure/plugins/plugin.js'` |
| 实例 API | `getStream`、`reply`、`setContext` / `getContext` / `finish`、`getInfo()`（见 [plugin-base.md](plugin-base.md)） |

```javascript
export default class MyPlugin extends plugin {
  constructor() {
    super({
      name: 'my-plugin',
      event: 'message',
      priority: 5000,
      rule: [{ reg: /^#命令/ }],
      handler: 'run',
    });
  }
  async run(e) { /* Bot / segment / this.getStream 见 runtime-surface */ }
}
```

Enhancer → `plugins/enhancer-base.js`。资源释放 → `async destroy()`。

---

## HttpApi（`http/http.js`）

| 项 | 说明 |
|----|------|
| 放置 | `core/<名>/http/*.js` |
| 推荐 | **对象导出**（ApiLoader 包装为 HttpApi） |
| 注入 | handler `(req, res, Bot)` 与 `req.bot` 等价 |

```javascript
import { HttpResponse } from '#utils/http-utils.js';

export default {
  name: 'my-api',
  priority: 100,
  routes: [{
    method: 'GET',
    path: '/api/foo',
    handler: async (req, res, Bot) => HttpResponse.success(res, {}),
  }],
};
```

`/api/*` 默认 `systemAuth: true`；公开设 `systemAuth: false`。

---

## AIStream（`aistream/aistream.js`）

| 项 | 说明 |
|----|------|
| 放置 | `core/<名>/stream/*.js` |
| 加载 | StreamLoader 单例 → `getStream(name)` |
| 业务扩展 | 重写 `patchLLMConfig(merged, apiConfig)` 追加场景字段；request body 由各 `*LLMClient.buildBody` 按官方文档组装 |
| 厂商协议 | `openai_llm` / `deepseek_llm` 等 **builtin** 独立客户端；`openai_compat_llm` 仅用于第三方 OpenAI 形态网关 |

```javascript
import AIStream from '#infrastructure/aistream/aistream.js';

export default class MyStream extends AIStream {
  constructor() {
    super({ name: 'my-stream', description: '...' });
  }
  async init() {
    await super.init();
    this.registerMCPTool('tool_name', { description, inputSchema, handler });
  }
  async cleanup() { /* 热重载/停机 */ }
}
```

---

## ConfigBase（`commonconfig/commonconfig.js`）

**配置管理全在主服**；子服业务插件通过 `core/commonconfig/*.js` 接入同一套控制台（见 [subserver-commonconfig.md](subserver-commonconfig.md)）。

| 项 | 说明 |
|----|------|
| 主仓 Core | `core/<名>/commonconfig/*.js` |
| 子服业务插件 | `subserver/*/apis/<group>/core/commonconfig/*.js` |
| 运行时数据 | `data/<group>/config.yaml`（主服 write，子服只读） |
| 子服连接 | `aistream.yaml` → `cfg.subserver`（非业务 yaml） |

```javascript
export default class MyConfig extends ConfigBase {
  constructor() {
    super({
      name: 'mygroup',
      displayName: '显示名',
      filePath: 'data/mygroup/config.yaml',
      defaultTemplatePath: 'subserver/pyserver/apis/mygroup/default_config.yaml',
      schema: { fields: { /* ... */ } },
    });
  }
}
```

---

## EventListenerBase（`listener/base.js`）

| 项 | 说明 |
|----|------|
| 放置 | `core/<名>/events/*.js` |
| 生命周期 | Loader `new` 后调用 `async init()`；注入 `this.bot` |

```javascript
export default class MyEvent extends EventListenerBase {
  constructor() { super('MyAdapter'); }
  async init() { /* bot.on(...); markProcessed(e) */ }
}
```

---

## Tasker

无统一基类；模块内 `Bot.tasker.push(...)`、`Bot.wsf[path] = fn`。见 [tasker-base-spec.md](tasker-base-spec.md)。

---

## 相关文档

- [runtime-surface.md](runtime-surface.md) — 全局 / Bot 挂载面  
- [框架可扩展性指南.md](框架可扩展性指南.md) — Core 目录与扩展点  
- [DOCSTYLE.md](DOCSTYLE.md) — 文档编写规范  

---

*最后更新：2026-07-02*
