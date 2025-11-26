## 插件基类文档（src/infrastructure/plugins/plugin.js）

插件基类 `plugin` 定义了 XRK-AGT 插件系统的统一接口，所有业务插件都应继承此类。  
它提供 **规则匹配、定时任务、事件订阅、上下文管理、工作流集成与统一回复接口** 等能力。

---

## 核心概念

- **插件实例（this）**
  - `this.name`：插件名称（用于日志与开关）。
  - `this.dsc`：插件描述。
  - `this.event`：默认事件类型（如 `"message"`、`"notice"`、`"device"` 等）。
  - `this.priority`：优先级（数值越小越先执行，默认 `5000`）。
  - `this.rule`：规则数组，用于匹配消息与事件。
  - `this.task`：定时任务定义。
  - `this.handler`：通用 Handler 定义（配合 `Handler` 使用）。
  - `this.eventSubscribe`：事件订阅配置。
  - `this.bypassThrottle`：是否绕过节流与冷却限制。

- **运行时上下文**
  - `this.e`：当前事件对象，由 `PluginsLoader.initPlugins` 在运行时注入。
  - `this.reply(msg, quote?, data?)`：统一回复接口。
  - `this.getStream(name)` / `this.getAllStreams()`：访问 AI 工作流。

---

## 构造函数与标准化

构造函数接收一个 `options` 对象，并通过一系列标准化函数处理：

- `normalizeTasks(options.task)`  
  - 支持单个对象或数组。
  - 统一为 `{ name, cron, fnc, log, timezone, immediate }` 结构。
  - 仅保留 `cron` 与 `fnc` 均存在的任务。

- `normalizeHandlers(options.handler)`  
  - 支持字符串、函数或对象三种形式：
    - 字符串：视为 `key` 与 `fnc` 同名。
    - 函数：使用函数名作为 `key` 与 `fnc`。
    - 对象：支持 `{ key, fnc, priority, once }`。

- `normalizeEventSubscribe(options.eventSubscribe)`  
  - 支持数组或映射：
    - 数组形式：`{ eventType, handler | fnc }`。
    - 键值映射：`{ 'message.group.normal': handler }`。

- `normalizeRules(options.rule)`  
  - 支持字符串 / RegExp / 对象：
    - 字符串或正则：自动转换为 `{ reg }`。
    - 对象：统一为 `{ reg, fnc, ... }`，其中 `reg` 可从 `pattern/source/match` 派生。

> 插件开发者只需要提供「语义友好」的配置，基类会负责转换为加载器可以理解的标准形态。

---

## 规则与事件处理

- **规则结构（标准化后）**
  - `reg`：用于匹配 `e.msg` 的正则表达式。
  - `fnc`：当规则匹配时调用的插件方法名。
  - `event`：可选的事件过滤配置（如 `message.group.normal`）。
  - `log`：是否记录日志（默认 `true`）。
  - `permission`：权限要求（如 `master/owner/admin`）。

- **执行流程（由 PluginsLoader 负责）：**
  1. `PluginsLoader.deal(e)` 解析消息并构造事件对象。
  2. `initPlugins(e)` 为每个插件创建实例，并给 `plugin.e = e`。
  3. 为每条规则编译正则，调用 `createRegExp`。
  4. `processRules(plugins, e)` 遍历规则：
     - 检查 `event` 与 `post_type` 是否匹配。
     - 使用 `reg.test(e.msg)` 做匹配。
     - 若通过权限与限制检查，调用对应方法 `plugin[fnc](e)`。

**插件方法返回值约定：**

- 返回 `false`：表示「未处理」，允许后续插件继续处理。
- 返回其它值（或无返回）：视为「已处理」，阻止同优先级后续规则。

---

## 上下文管理（多轮对话与状态）

`plugin` 内置一套轻量级上下文管理机制，适合做「等待下一条消息继续操作」这种交互。

- `conKey(isGroup = false)`  
  - 根据 `插件名 + self_id + user_id/group_id` 生成上下文桶的 key。

- `setContext(type, isGroup = false, time = 120, timeoutMsg = "操作超时已取消")`
  - 为当前事件 `this.e` 写入一个上下文。
  - 若设置了 `time > 0`，将在超时时自动执行：
    - 若存在等待 `resolve`，则返回 `false`。
    - 否则自动调用 `this.reply(timeoutMsg)`。

- `getContext(type?, isGroup = false)`
  - 获取当前会话（或群）下的上下文。
  - 不传 `type` 时返回当前桶内所有键值对。

- `finish(type, isGroup = false)`
  - 主动结束指定类型的上下文，清理定时器与 `resolve`。

- `awaitContext(...args)`
  - 封装为 Promise 风格的等待：  
    - 内部调用 `setContext("resolveContext", ...args)` 并存储 `SymbolResolve`。
    - 后续通过 `resolveContext` 触发。

- `resolveContext(context)`
  - 读取 `resolveContext` 对应的上下文，执行 `resolve` 并调用 `finish`。

> 典型用法：  
> 第一次命令设置上下文，下一条消息自动进入对应处理函数，实现多轮输入。

---

## 与 AI 工作流集成

- `getStream(name)` / `getAllStreams()`
  - 通过 `StreamLoader` 获取 `AIStream` 实例。
  - 插件可以在规则方法中调用 `stream.process(e, question, config)` 来完成一次 AI 对话。

> 建议将 AI 调用封装在插件方法内部，并对失败情况进行友好提示，避免插件阻塞整体事件处理。

---

## 插件描述导出：`getDescriptor()`

`getDescriptor()` 用于向加载器暴露插件「结构化描述」，包括：

- 基本信息：`name/dsc/event/priority/namespace/bypassThrottle`。
- 规则：`normalizeRules(this.rule)`。
- 任务：`normalizeTasks(this.task)`。
- Handler：`normalizeHandlers(this.handler)`。
- 事件订阅：`normalizeEventSubscribe(this.eventSubscribe)`。

`PluginsLoader` 在加载与调试时可以使用这些描述做统计、可视化或管理控制台展示。

---

## 开发建议与最佳实践

- **命名与日志**
  - 为插件设置有意义的 `name` 与 `dsc`，便于在日志与管理界面中识别。
  - 对于高频触发的规则，可将 `rule.log` 设为 `false`，避免刷屏。

- **优先级与节流**
  - 与核心系统插件（如别名处理、调度插件）共存时，建议使用较大的 `priority`（例如 `5000` 以上）。
  - 对需要绕过全局冷却与只对少数命令生效的插件，可以将 `bypassThrottle` 设为 `true`，并结合严格的 `reg` 与 `permission`。

- **上下文使用**
  - 多轮对话时，请务必在流程结束或异常时调用 `finish` 清理上下文，避免长期占用。
  - 对超时提示文案可自定义，以符合具体业务交互风格。

- **AI 与外部接口**
  - 调用 `AIStream` 时注意捕获异常，对用户展示友好错误信息。
  - 避免在规则方法中做长时间阻塞操作（可拆分为异步步骤与回调事件）。


