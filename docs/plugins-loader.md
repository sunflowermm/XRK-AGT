## PluginsLoader 文档（src/infrastructure/plugins/loader.js）

`PluginsLoader` 是 XRK-AGT 的 **插件调度核心**，负责：

- 扫描并加载 `core/plugin` 目录中的插件。
- 管理插件规则匹配、权限检查、上下文处理、冷却与节流。
- 处理多种事件源（普通消息、设备事件、STDIN/API 事件）。
- 维护定时任务、事件订阅与全局事件历史。

---

## 核心职责概览

- **插件生命周期**
  - 扫描插件目录并动态 `import` 插件模块。
  - 实例化插件、执行 `init()` 钩子。
  - 构建 `priority/extended/task/defaultMsgHandlers` 等内部结构。
  - 支持热更新、文件新增/删除监听。

- **事件分发与规则匹配**
  - 对 `Bot.em` 派发的事件进行预处理（消息解析、权限、黑白名单）。
  - 匹配插件规则并调用对应方法。
  - 支持「扩展插件 extended」与「普通插件」分组执行。

- **定时任务与统计**
  - 基于 `node-schedule` 创建 Cron 定时任务。
  - 统计截图与发送消息次数，并写入 Redis 计数键。

- **事件系统扩展**
  - 提供自定义事件 `emit(eventType, eventData)` 能力，统一走 `Bot.em`。
  - 维护事件历史 `eventHistory`，支持按条件查询。
  - 允许插件订阅任意事件（包括自定义事件）。

---

## 加载流程

### 1. `load(isRefresh = false)`

- 若不是刷新且已经加载过插件，则直接返回。
- 记录加载开始时间，重置内部状态：
  - `this.priority = []`：普通插件。
  - `this.extended = []`：扩展插件。
  - `this.task = []`：定时任务列表。
  - `this.delCount()`：重置 Redis 统计值。
- 调用 `getPlugins()` 获取插件文件列表：
  - 扫描目录 `this.dir = 'core/plugin'`。
  - 支持 `子目录/index.js` 或子目录内多个 `*.js` 文件。
- 分批（batchSize = 10）并发导入插件（`importPlugin`）。
- 统计加载时间、插件数量、任务数量与扩展插件数量。
- 调用：
  - `packageTips(packageErr)`：输出缺失依赖提示。
  - `createTask()`：创建定时任务。
  - `initEventSystem()`：初始化事件订阅与清理逻辑。
  - `sortPlugins()`：按优先级排序插件。
  - `identifyDefaultMsgHandlers()`：识别拥有 `handleNonMatchMsg` 方法的「默认消息处理器」。

> 插件开发者只需要在 `core/plugin` 下新建目录与 JS 文件，即可被自动发现和加载。

### 2. `importPlugin(file, packageErr)`

- `await import(file.path)` 动态导入模块。
- 支持导出对象 `apps`（多插件聚合）或单一导出。
- 对每个导出的插件类调用 `loadPlugin(file, p)`。
- 若遇到 `Cannot find package` 错误，记录在 `packageErr` 中，用于统一输出依赖缺失提示。

### 3. `loadPlugin(file, p)`

- 忽略无 `prototype` 的导出（非类）。
- 创建插件实例 `const plugin = new p()`：
  - 若定义了 `plugin.init()`，则以 5 秒超时限制执行初始化。
  - 支持在 `plugin.task` 中声明 Cron 任务，会被标准化并压入 `this.task`。
  - 编译 `plugin.rule` 中的正则表达式。
- 构建内部插件描述：
  - `priority` 为 `plugin.priority === 'extended' ? 0 : (plugin.priority ?? 50)`。
  - `bypassThrottle` 由 `plugin.bypassThrottle` 决定。
  - 归类到 `this.extended` 或 `this.priority`。
- 处理 `plugin.handler`：
  - 将各 handler 注册到 `Handler.add`，用于统一指令分发。
- 处理 `plugin.eventSubscribe`：
  - 通过 `subscribeEvent(eventType, callback)` 注册到 `this.eventSubscribers`。

---

## 事件处理主流程

### 1. 入口：`deal(e)`

1. `initEvent(e)`：补全 `self_id/bot/event_id`，统计接收计数。
2. 若为特殊事件（STDIN/API 或设备），交给 `dealSpecialEvent(e)`。
3. `checkBypassPlugins(e)`：检查是否有带 `bypassThrottle` 且规则匹配的插件。
4. `preCheck(e, hasBypassPlugin)`：
   - 忽略自身消息（可通过配置关闭）。
   - 检查「关机状态」（redis key `Yz:shutdown:${botUin}`）。
   - 检查频道消息、黑名单。
   - 若无 bypass 插件，检查消息冷却与节流。
5. `dealMsg(e)`：解析消息内容、构建日志文本、注入工具方法。
6. `setupReply(e)`：包装 `e.reply`，统一处理引用、@、撤回等逻辑。
7. `Runtime.init(e)`：插件运行时初始化。
8. `runPlugins(e, true)`：先执行扩展插件。
9. `runPlugins(e, false)`：再执行普通插件规则。

### 2. `dealMsg(e)`

- `initMsgProps(e)`：初始化 `e.img/e.video/e.audio/e.msg/e.atList/e.atBot` 等。
- `parseMessage(e)`：遍历 `e.message`，根据不同 `type` 填充：
  - `text/image/video/audio/at/reply/file/face` 等字段。
- `setupEventProps(e)`：
  - 标记 `isPrivate/isGroup/isGuild/isDevice/isStdin`。
  - 设置 `sender` / `group_name` 等。
  - 为 `e` 添加 `getReply` / `recall` 等辅助方法。
- `checkPermissions(e)`：识别主人（master）与 STDIN 默认主人权限。
- `processAlias(e)`：群聊场景下处理 Bot 别名（如「葵子」）。
- `addUtilMethods(e)`：注入 `getSendableMedia/throttle/getEventHistory` 等工具。

### 3. `runPlugins(e, isExtended)`

- `initPlugins(e, isExtended)`：
  - 遍历 `this.priority` 或 `this.extended`。
  - 实例化插件并设置 `plugin.e = e`。
  - 编译规则 `rule.reg`。
  - 按 `checkDisable` 与 `filtEvent` 过滤禁用或事件不匹配的插件。
- 若为扩展插件：
  - 直接调用 `processRules(plugins, e)`。
- 若为普通插件：
  - 先执行各插件的 `accept(e)`：
    - 若返回 `'return'`，则视为已完全处理。
    - 若返回 truthy 值，可中断后续插件。
  - 对非设备/STDIN 事件：
    - `handleContext(plugins, e)`：先处理上下文回调。
    - `onlyReplyAt(e)`：判断是否仅响应 @ 或别名。
    - 若插件不带 `bypassThrottle`，调用 `setLimit(e)` 设置冷却。
  - 最后执行 `processRules(plugins, e, false)` 并根据优先级分组执行。
  - 若仍未处理，调用 `processDefaultHandlers(e)`。

---

## 冷却、节流与黑白名单

- **冷却（CD）**
  - 使用 Map 维护：
    - `this.cooldowns.group`：群级别冷却。
    - `this.cooldowns.single`：群内单人冷却。
    - `this.cooldowns.device`：设备事件冷却。
  - `checkLimit(e)`：在前置检查中判断是否处于冷却期。
  - `setLimit(e)`：在确定要处理消息时写入冷却 Map。

- **节流**
  - `this.msgThrottle`：基于 `user_id:message_id` 的消息去重。
  - `this.eventThrottle`：按 (`user/device` + key) 的事件节流。

- **黑白名单**
  - `checkBlack(e)`：从配置 `other` 中读取：
    - `blackQQ/whiteQQ/blackGroup/whiteGroup/blackDevice` 等。
  - `onlyReplyAt(e)`：根据群配置 `onlyReplyAt` 与 `botAlias` 决定是否仅在有 @ 或前缀时响应。

---

## 事件系统与订阅

- **全局监听注册：`initEventSystem()`**
  - 定时清理：
    - `eventHistory` 超出上限。
    - 过期 `eventThrottle` 与 `msgThrottle` 记录。
    - 冷却 Map 中超时条目。
  - 在 `Bot` 上注册事件监听：
    - 对 `message/notice/request/device` 四类事件记录历史并分发订阅。

- **事件历史：`recordEventHistory(eventType, eventData)`**
  - 将事件以 `{ event_id, event_type, event_data, timestamp, source }` 形式追加到 `eventHistory`。

- **订阅与分发**
  - `subscribeEvent(eventType, callback)`：
    - 注册自定义事件回调。
    - 返回一个取消订阅函数。
  - `distributeToSubscribers(eventType, eventData)`：
    - 遍历订阅列表并安全执行回调。

- **自定义事件：`emit(eventType, eventData)`**
  - 构造 `post_type: 'custom'` 的事件对象。
  - 通过 `Bot.em(eventType, event)` 派发。
  - 同时记录历史并调用订阅者。

---

## 定时任务系统

- 插件可在 `plugin.task` 中定义任务，例如：
  - `{ name: 'heartbeat', cron: '0 */5 * * * *', fnc: 'heartbeat' }`。
- `createTask()`：
  - 使用 `schedule.scheduleJob` 创建 Cron 任务。
  - 支持重复检测与日志标记。
  - 执行函数 `task.fnc()` 时自动统计执行耗时并输出日志。

---

## 开发与调试建议

- **编写插件时**
  - 尽量让插件逻辑与 `PluginsLoader` 解耦，只依赖 `plugin` 基类与事件对象 `e`。
  - 使用明确的 `name` 与 `priority`，避免与系统插件产生抢占冲突。

- **排查问题时**
  - 查看插件是否被 `checkDisable` 或黑白名单过滤。
  - 检查是否被 `onlyReplyAt` 或冷却限制挡掉。
  - 通过 Redis（键前缀 `Yz:count:`、`Yz:shutdown:`）确认运行状态。

- **性能优化**
  - 对于高频事件，注意规则设计与日志级别，避免过多无效正则测试与日志输出。
  - 合理使用 `bypassThrottle`，只为少数必要命令开启。


