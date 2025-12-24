## TaskerLoader 文档（src/infrastructure/tasker/loader.js）

`TaskerLoader` 负责从 `core/tasker` 目录动态加载各类 Tasker（事件生成器，如 QQ OneBotv11、企业微信等），并与 `Bot` 主类配合，为整个系统提供统一的事件入口。

---

## 职责与定位

- 扫描 `paths.coreTasker`（即 `core/tasker`）目录中的所有 `.js` 文件。
- 使用 `import()` 动态载入 Tasker 模块。
- 通过 Tasker 内部代码将自身注册到：
  - `Bot.tasker`：Tasker 列表。
  - `Bot.wsf[path]`：WebSocket 路径与处理函数映射。
- 提供加载过程的统计与日志：
  - 扫描数量、加载成功/失败数量、实际注册数量、错误列表等。

> Tasker 文件通常不需要直接依赖 `TaskerLoader`，只要在模块内调用 `Bot.tasker.push(...)` 即可被框架识别。

---

## 关键属性

- `this.baseDir`：Tasker 所在目录，来自 `paths.coreTasker`。
- `this.loggerNs`：日志命名空间，固定为 `'TaskerLoader'`。

---

## 加载流程：`load(bot = Bot)`

1. 初始化统计对象 `summary`：
   - `scanned`：扫描到的Tasker文件数。
   - `loaded`：成功 `import` 的数量。
   - `failed`：导入失败数量。
   - `registered`：新注册的 Tasker 数量（`bot.tasker.length` 的增量）。
   - `errors`：失败详情 `{ name, message }[]`。

2. 调用 `getTaskerFiles()`：
   - 使用 `fs.readdir(baseDir, { withFileTypes: true })`。
   - 筛选出 `.js` 文件并转换为 `{ name, href }`，其中：
     - `href` 使用 `pathToFileURL` 生成 `file://` URL，适配 ES Module 动态导入。

3. 批量导入：
   - 对每个 `{ name, href }` 执行：
     - `await import(href)`。
     - 成功则 `summary.loaded++`。
     - 失败则 `summary.failed++`，并记录错误。

4. 统计注册数量：
   - 假设 Tasker 内部会向 `bot.tasker` 数组追加自身：
     - `summary.registered = bot.tasker.length - taskerCountBefore`。

5. 输出总结日志：
   - 类似：  
     `Tasker 加载完成: 成功X个, 注册Y个, 失败Z个`。

6. 返回 `summary`，便于 API 或调试页面展示。

---

## 扫描逻辑：`getTaskerFiles()`

- 使用 `fs.readdir(this.baseDir, { withFileTypes: true })` 读取目录。
- 过滤出「普通文件 + `.js` 扩展名」。
- 为每个文件构造：
  - `name`：文件名（如 `OneBotv11.js`）。
  - `href`：完整 `file://` URL 路径，用于 `import(href)`。
- 若目录不存在（`ENOENT`），输出告警日志并返回空数组。

---

## 与 Tasker 实现的关系

- **Tasker 文件（例如 `core/tasker/OneBotv11.js`）的典型结构：**
  - 在模块顶层执行：
    - `Bot.tasker.push(new OneBotv11Tasker())`。
  - 在 Tasker 类中实现：
    - `load()`：向 `Bot.wsf[path]` 注册 WebSocket 消息处理函数。
    - `message(wsMessage, ws)`：解析 OneBotv11 上报并调用 `Bot.em` 触发框架事件。
    - 各种 send/get 接口封装（发送私聊、群聊、频道消息，获取好友/群列表等）。

- **事件流向：**
  1. 外部平台通过 WebSocket 与 XRK-AGT 建立连接（如 OneBotv11）。
  2. `Bot.wsConnect` 根据路径选择对应的 Tasker 处理函数。
  3. Tasker 解析 JSON 上报，将其转换为统一事件结构（`post_type/message_type/...`）。
  4. 调用 `Bot.em("message.group.normal", data)` 等事件，交由 `PluginsLoader` 进一步处理。

---

## 扩展与调试建议

- **新增 Tasker**
  - 在 `core/tasker` 中新建 `XXX.js`。
  - 在文件内：
    - 通过 `Bot.tasker.push(new XXXTasker())` 注册 Tasker。
    - 在 `load()` 中向 `Bot.wsf` 映射对应 WebSocket 路径。
    - 在 `message()` 中解析上报并调用 `Bot.em`。
  - 重启或通过相应命令触发 Tasker 重载后，`TaskerLoader.load()` 会自动发现。

- **调试加载问题**
  - 查看启动日志中 `TaskerLoader` 名下的输出。
  - 若 `failed > 0`，可从 `summary.errors` 或控制台日志中找到对应错误。
  - 注意 Tasker 文件必须是 ES Module（`export` 语法），并确保所有依赖可用。


