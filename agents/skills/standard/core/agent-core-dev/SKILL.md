---
name: agent-core-dev
description: 工作区 Core 全扩展点写法清单（PluginBase/HTTP/workflow/events/commonconfig）：写插件、#命令、notice、HTTP、工作流、配置、事件监听时加载
---

> 读者：办事助手。只写本工作区 `core/workspace-Core/`。  
> **常驻**：rules `workspace-dev` 每轮带边界 + message 骨架；说「写插件」等时 microagent **plugin-write** 注入通用选型。  
> **常见任务有常驻/注入则直接 write**；本文件给各基类完整字段，勿翻 `src/`。

相对工作区：项目根 = `../../../`。

---

## 0. 总清单（放哪 / 基类 / 导出）

| 扩展点 | 工作区路径 | 基类 / 形态 | 加载器扫描 |
|--------|------------|-------------|------------|
| 消息/通知插件 | `plugin/*.js` | 裸名 **PluginBase**（或 Enhancer） | PluginLoader |
| HTTP API | `http/*.js` | **对象导出**（推荐）或 HttpApi | HttpApiLoader |
| AI 工作流 | `workflow/*.js` | `import AiWorkflow from '#infrastructure/ai-workflow/ai-workflow.js'` | AiWorkflowLoader |
| 事件监听 | `events/*.js` | ListenerBase（见下） | Listener Loader |
| 配置 Schema | `commonconfig/*.js` | ConfigBase（见下） | CommonConfigRegistry |
| Tasker | `tasker/*.js` | **无统一基类**；工作区一般不写 | TaskerLoader |
| 静态页 | `www/<应用名>/` | 静态文件；根名勿用 `api\|core\|media\|uploads\|File\|shared` | mountCoreWwwStatic |

热加载：已有 `workspace-Core/plugin/` 内增改 `.js` 通常可热加载；**新建另一个 Core 目录名**需重启 / `#重启`。

---

## 1. PluginBase（最常用）

### 1.1 `super({...})` 字段

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `name` | string | — | 插件名 |
| `dsc` | string | — | 描述 / 帮助文案 |
| `event` | string | `'message'` | 事件键（见 1.3） |
| `priority` | number \| `'extended'` | `5000` | **越小越先**；`'extended'` 进扩展队列（先于普通插件） |
| `rule` | array | `[]` | 规则（见 1.2）；notice 常配合空数组 + `accept()` |
| `task` | array | — | Cron：`{ name?, cron, fnc, log? }` |
| `handler` | array/object | — | 默认消息处理器 |
| `eventSubscribe` | array/object | — | 自定义事件订阅 |
| `bypassThrottle` | boolean | `false` | 绕过节流 |
| `namespace` | string | `''` | 与 handler 配合 |

类字段存缓存（`cache = new Map()`）；**禁止**在 constructor 里 `this.cache = new Map()`。

导出：`export class Xxx extends PluginBase`（可多个类）。可选 `async init()` / `async destroy()`。

### 1.2 `rule[]` 字段

| 字段 | 说明 |
|------|------|
| `reg` | 匹配 `e.msg`（string → 正则 / RegExp） |
| `fnc` | **方法名**字符串 |
| `event` | 可选，再滤子事件 |
| `permission` | `master` / `owner` / `admin` / `all` |
| `log` | 默认 true |

返回：`false` = 未处理（同优先级继续）；其它 = 已处理。

### 1.3 `event` 常用键

Loader 会拼：`{post}.{notice_type|message_type}.{sub_type}` 等；也支持 `*` 段匹配（段数须一致）。

| 场景 | `event` 示例 |
|------|----------------|
| 群/私聊消息 | `message` · `message.group` · `message.private` |
| 戳一戳等通知 | `notice.*.poke` · `notice.group.poke` · `notice.friend.poke`（**示例**；同类还有 increase 等） |
| 进群等 | `notice.group.increase` 等（按实际 `notice_type`/`sub_type`） |
| 请求 | `request` · `request.friend` … |
| 通配（慎用） | `notice.*`（段数不够时用 `accept` 里自己判断） |

### 1.4 实例 API（够用）

| API | 用途 |
|-----|------|
| `this.e` | 当前事件 |
| `this.reply(msg)` | 回复；段用裸名 `msgSegment` |
| `this.accept()` | 前置；`false` 跳过；`'return'` 截断整条链 |
| `setContext` / `getContext` / `finish` | 多轮上下文 |
| `this.getWorkflow(name)` | 取已加载工作流 |

纯 **notice**（含戳一戳、进群等）：逻辑放 **`accept()`**（常无可靠 `e.msg`）。

### 1.5 配方 A — `#命令`

```js
export class MyCmd extends PluginBase {
  constructor() {
    super({
      name: '我的命令', dsc: '#我的命令', event: 'message', priority: 5000,
      rule: [{ reg: '^#我的命令$', fnc: 'run' }],
    });
  }
  async run() { await this.reply(this.e?.msg || 'ok'); }
}
```

### 1.6 配方 B — notice + `accept()`（示例：被戳反戳）

任意 notice 子类型同一模式；下面**仅一例**，不要默认所有需求都写成反戳。

```js
export class PokeBack extends PluginBase {
  constructor() {
    super({
      name: '反戳', dsc: '被戳则反戳', event: 'notice.*.poke', priority: 5000, rule: [],
    });
  }
  async accept() {
    const e = this.e;
    if (!e || e.sub_type !== 'poke') return false;
    if (String(e.target_id) !== String(e.self_id)) return false;
    if (String(e.operator_id) === String(e.self_id)) return false;
    const who = e.operator_id;
    if (e.group?.pokeMember) await e.group.pokeMember(who);
    else if (e.friend?.poke) await e.friend.poke();
    else await e.reply({ type: 'poke', qq: who });
    return 'return';
  }
}
```

### 1.7 Enhancer（少用）

继承增强基类思路同插件，`priority: 'extended'` 或框架 Enhancer；对照只读 `../../../core/system-Core/plugin/OneBotEnhancer.js`。工作区一般写普通 PluginBase 即可。

---

## 2. HTTP（HttpApi / 对象导出）

路径：`core/workspace-Core/http/<名>.js`

| 项 | 约定 |
|----|------|
| 推荐导出 | `export default { name?, priority?, routes: [...] }` |
| route | `method` · `path` · `handler` · 可选 `systemAuth` / middleware |
| 运行时 | `req.agentRuntime` 或 handler 第三参；勿 `global.AgentRuntime` |
| `/api/*` | 默认要系统鉴权；公开：`systemAuth: false` |

### `HttpResponse.success` 形状

| 第二参 | JSON |
|--------|------|
| 普通对象 | `{ success, message, ...字段 }`（**拍平**） |
| 数组 / 标量 | `{ success, message, data: 值 }` |
| `null` | `{ success, message }` |

```js
import { HttpResponse } from '#utils/http-utils.js';

export default {
  name: 'workspace-ping',
  priority: 100,
  routes: [{
    method: 'GET',
    path: '/api/workspace/ping',
    systemAuth: false, // 若需免 Key；默认 true 更安全
    handler: HttpResponse.asyncHandler(async (req, res) => {
      return HttpResponse.success(res, { ok: true });
    }, 'workspace-ping'),
  }],
};
```

也可用：`HttpResponse.error` / `validationError` / `notFound` / `unauthorized`。

---

## 3. AiWorkflow（工作流）

路径：`core/workspace-Core/workflow/<名>.js`  
办公优先 MCP；**仅用户要自定义工具面时再写**。

```js
import AiWorkflow from '#infrastructure/ai-workflow/ai-workflow.js';

export default class MyStream extends AiWorkflow {
  constructor() {
    super({
      name: 'my-stream',           // getWorkflow('my-stream')；工具前缀 my-stream.*
      description: '……',
      capabilities: ['tools'],     // 可选 'prompt' 等
      // frameworkToolSurface: true, // 要始终进 chat MCP 白名单再开
    });
  }
  async init() {
    await super.init();
    this.registerMCPTool('tool_name', {
      description: '……',
      inputSchema: { type: 'object', properties: {} },
      handler: async (args, ctx) => ({ success: true }),
    });
  }
  buildSystemPrompt() {
    return '需要时调用 my-stream.tool_name。';
  }
  async cleanup() {}
}
```

调用方：`process({ mergeWorkflows: ['my-stream'] })`。细则不够再 read `../../../.cursor/skills/xrk-ai-workflow/SKILL.md` **一次**。

---

## 4. ConfigBase（commonconfig）

路径：`core/workspace-Core/commonconfig/<名>.js`  
**配置只在主服编辑**；工作区模块提供 schema。运行时 yaml 建议：`data/ai-workspace/...` 或产品 `data/<名>/`（勿塞进 `config/default_config/`）。

```js
export default class MyConfig extends ConfigBase {
  constructor() {
    super({
      name: 'workspace-demo',
      displayName: '工作区示例配置',
      filePath: 'data/ai-workspace/default/workspace-demo.yaml',
      defaultTemplatePath: 'agents/workspace/core/workspace-Core/default/workspace-demo.yaml', // 若有模板
      schema: { fields: { /* 控制台字段 */ } },
    });
  }
}
```

裸名或 `import` ConfigBase：`#infrastructure/commonconfig/commonconfig.js`（与仓库示例一致即可）。

---

## 5. ListenerBase（events）

路径：`core/workspace-Core/events/<名>.js`  
工作区**少用**（通道级）；优先 PluginBase 的 `event`。

```js
export default class MyEvent extends ListenerBase {
  constructor() { super('MyAdapter'); }
  async init() {
    // this.bot.on(...); 处理完 markProcessed(e)
  }
}
```

导入：`#infrastructure/listener/base.js`（以仓库 `system-Core/events` 示例为准）。

---

## 6. Tasker / www

| | 说明 |
|--|------|
| **tasker** | 无统一基类；工作区默认**不写**。用户点名再对照 `../../../docs/tasker-base-spec.md` 与 `system-Core/tasker` **只读**。 |
| **www** | `www/<应用名>/` 静态页；兼容层见只读 `xrk-www-compat`；勿用保留根名。 |

---

## 7. 引入速查

| 符号 / 模块 | 写法 |
|-------------|------|
| PluginBase / msgSegment / AgentRuntime | **裸名**（勿 `global.`、勿 `import AgentRuntime`） |
| HttpResponse | `import { HttpResponse } from '#utils/http-utils.js'` |
| normalizeError | `#utils/normalize-error.js` |
| exec | `#utils/exec-async.js` |
| AiWorkflow | `#infrastructure/ai-workflow/ai-workflow.js` |
| runtimeConfig | `#infrastructure/config/config.js` |

`#` ← 仓库根 `package.json` → `imports`。工作区**不要**自建 `package.json`。

禁止：`node-fetch`、文件内 `promisify(exec)`、`instanceof Error` 判错、改 `src/` / 仓库 `core/system-Core`。

---

## 8. 工作方式

1. 常驻配方 / microagent 已够 → **直接 write**。  
2. 需要字段表 / 非 message 扩展点 → read **本文件对应节**（勿整份 docs + src）。  
3. 用户已要求写 → 不要再确认；「继续」后禁止重读。  
4. 写完：路径 + 验收方式。

## 9. 可选深读（每个缺口最多 1 个）

| 缺口 | 读 |
|------|-----|
| Node/编码禁令 | `../../../.cursor/skills/xrk-node-runtime/SKILL.md` |
| HTTP 细节 | `../../../.cursor/skills/xrk-http-api/SKILL.md` |
| 工作流细节 | `../../../.cursor/skills/xrk-ai-workflow/SKILL.md` |
| 架构总览 | `../../../.cursor/skills/xrk-project-overview/SKILL.md` |
| 人读契约 | `../../../docs/base-classes.md` |

**不要默认读**：`src/infrastructure/**`、整份框架可扩展性指南、Tasker 全文。
