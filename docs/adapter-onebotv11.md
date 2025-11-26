## OneBotv11 适配器文档（core/adapter/OneBotv11.js）

OneBotv11 适配器负责对接 QQ/OneBotv11 协议，实现：

- WebSocket 上报解析与事件转译。
- 好友、群、频道等高层对象的封装（`pickFriend/pickGroup/pickMember`）。
- 统一的消息发送、消息历史、文件操作等接口。

---

## 注册与入口

- 在模块加载时，适配器会执行：
  - `Bot.adapter.push(new OneBotv11Adapter())`。
- 适配器在 `load()` 方法中向 `Bot.wsf[this.path]` 注册 WebSocket 处理函数：
  - `this.path = 'OneBotv11'`，对应的路径由 `Bot.wsConnect` 解析。
  - 每当有新连接时，会将 `ws.on('message', ...)` 绑定到 `this.message` 方法。

---

## 核心能力概览

- **API 调用**
  - `sendApi(data, ws, action, params)`：
    - 为每个请求生成唯一 `echo`，构造 `{ action, params, echo }`。
    - 通过 `ws.sendMsg(request)` 发送 JSON。
    - 使用 `Promise.withResolvers()` 与 Map `this.echo` 管理响应回调。
    - 超时时自动终止连接并记录日志。

- **消息封装**
  - `makeFile(file, opts)`：将文件路径/URL/Buffer 转换为 `base64://...` 形式。
  - `makeMsg(msg)`：
    - 将多种输入（字符串、对象、转发节点等）标准化为 OneBotv11 支持的消息段数组。
    - 分离普通消息 `msgs` 与转发消息 `forward`。
  - `sendMsg(msg, send, sendForwardMsg)`：
    - 先处理转发消息（如有），再发送普通消息。
    - 对返回结果进行统一包装。

- **消息发送接口**
  - `sendFriendMsg(data, msg)`：发送好友消息。
  - `sendGroupMsg(data, msg)`：发送群消息。
  - `sendGuildMsg(data, msg)`：发送频道消息。
  - `recallMsg(data, message_id)`：撤回消息。

- **消息与历史**
  - `parseMsg(msg)`：将 OneBot 消息段转换为内部统一格式。
  - `getMsg(data, message_id)`：获取单条消息。
  - `getFriendMsgHistory/getGroupMsgHistory/getForwardMsg`：获取好友/群/转发消息历史。

- **好友与群（频道）管理**
  - 获取列表与映射：
    - `getFriendArray/List/Map`。
    - `getGroupArray/List/Map`。
    - `getMemberArray/List/Map`。
    - `getGuildArray/getGuildChannelArray/getGuildMemberArray` 等。
  - 高层对象封装：
    - `pickFriend(data, user_id)`：
      - 返回带有 `sendMsg/getMsg/recallMsg/sendFile/getInfo/getAvatarUrl` 等方法的好友对象。
    - `pickGroup(data, group_id)`：
      - 针对 QQ 群或频道，封装群级方法：发送消息、获取历史、管理文件、禁言/踢人等。
    - `pickMember(data, group_id, user_id)`：
      - 在群/频道下封装成员对象，提供 `mute/kick/getInfo/getAvatarUrl` 等方法。

- **群管理与文件系统**
  - 设置群名/头像/管理员/头衔等。
  - 群级文件操作：
    - `sendGroupFile/deleteGroupFile/createGroupFileFolder/getGroupFileSystemInfo/getGroupFiles/getGroupFileUrl`。
  - 统一群文件系统接口：
    - `getGroupFs(data)` 返回一个类文件系统对象 `{ upload/rm/mkdir/df/ls/download }`。

---

## 连接与初始化：`connect(data, ws)`

当 OneBotv11 报告 lifecycle 事件时，适配器会：

1. 在 `Bot[self_id]` 下创建底层 Bot 对象：
   - 挂载：
     - `adapter/ws/sendApi/stat/model/info/version` 等基础字段。
     - 多种工具方法（如 `pickFriend/pickGroup/getFriendMap/getGroupMemberMap` 等）。
   - 将 `data.bot` 指向新创建的 `Bot[self_id]`。
   - 将 `self_id` 加入 `Bot.uin`。
2. 发送 `_set_model_show` 设置展示模型。
3. 调用 OneBot API 获取：
   - 登录信息 `get_login_info`。
   - 协议端版本 `get_version_info`。
4. 立即触发 `connect.${self_id}` 事件，通知上层框架 Bot 已可用。
5. 在异步任务中：
   - 加载频道资料与在线客户端列表。
   - 获取多域名 cookies 与 CSRF token。
   - 加载好友列表与群/成员列表。
   - 标记 `_ready` 并触发 `ready.${self_id}` 事件。

---

## 上报处理

- **消息：`makeMessage(data)`**
  - 将 `data.message` 转为内部统一格式。
  - 根据私聊/群聊/频道构建日志文本（含群名/昵称等）。
  - 最终通过 `Bot.em("${post_type}.${message_type}.${sub_type}", data)` 抛给上层。

- **通知：`makeNotice(data)`**
  - 处理群撤回、成员增减、禁言、荣誉、资料卡点赞、文件等多种场景。
  - 根据不同 `notice_type/sub_type` 更新：
    - 群信息、成员信息、本地缓存等。
  - 适当转译为消息事件（例如群文件上传映射为一条携带 `file` 消息段的消息）。

- **请求：`makeRequest(data)`**
  - 包装好友/群请求，提供 `approve` 方法以调用对应的 OneBot API。

- **心跳与元事件：`heartbeat/makeMeta`**
  - 更新统计信息。
  - 处理生命周期事件（如 Bot 上线）。

- **WebSocket 消息入口：`message(data, ws)`**
  - 尝试解析 JSON 上报。
  - 根据 `post_type` 路由到对应处理函数。
  - 对带有 `echo` 的响应，唤醒 `sendApi` 中挂起的 Promise。

---

## 开发与调试建议

- **观察日志**
  - 适配器大量使用 `Bot.makeLog` 打印信息、警告与错误，包含：
    - 收/发消息。
    - 群与好友变动。
    - 文件操作和请求处理。
  - 建议在开发环境下开启 `debug` 日志级别，以便追踪问题。

- **与插件的关系**
  - 所有通过 OneBotv11 接入的消息最终都会转译为统一事件格式，并经由 `PluginsLoader.deal(e)` 处理。
  - 插件通过 `e.friend/e.group/e.member` 调用的方法，实际上都由适配器封装与执行。


