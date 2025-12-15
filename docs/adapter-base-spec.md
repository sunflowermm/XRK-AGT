# 适配器底层规范

本文档定义了所有适配器最底层应该具备的属性和函数，这些是适配器的基础接口，不包含任何特定适配器（如OneBot、stdin、device）的专有逻辑。

## 适配器基础属性

### 适配器实例属性

每个适配器实例应该具备以下属性：

```javascript
{
  id: string,        // 适配器唯一标识（如 'QQ', 'WeChat'）
  name: string,       // 适配器名称（如 'OneBotv11', 'stdin'）
  path: string,       // 适配器路径
}
```

### Bot实例中的适配器信息

```javascript
bot.adapter = {
  id: string,        // 适配器ID
  name: string,      // 适配器名称
  // 其他适配器特定属性...
}
```

## 事件对象基础属性

所有适配器的事件对象都应该具备以下基础属性：

### 必需属性

```javascript
{
  // 基础标识
  self_id: string,           // Bot自身ID
  adapter: string,            // 适配器类型（'onebot', 'stdin', 'device'等）
  adapter_id: string,         // 适配器ID（从bot.adapter.id获取）
  adapter_name: string,        // 适配器名称（从bot.adapter.name获取）
  
  // 事件标识
  event_id: string,            // 事件唯一ID
  time: number,                // 事件时间戳（Unix时间戳，秒）
  
  // Bot对象
  bot: Bot,                    // Bot实例（只读，不可修改）
  
  // 发送者基础信息
  user_id: string|number,       // 用户ID（如果适用）
  sender: {                    // 发送者信息对象
    user_id: string|number,     // 用户ID
    nickname?: string,          // 昵称（适配器特定）
    card?: string,              // 名片/备注（适配器特定）
    // 其他适配器特定字段...
  },
  
  // 回复方法（通用）
  reply: Function,             // 通用回复方法
}
```

### 可选属性（根据事件类型）

```javascript
{
  // 设备相关（device适配器）
  device_id?: string,           // 设备ID
  device_name?: string,         // 设备名称
  
  // 消息相关（message类型事件）
  message?: Array,              // 消息段数组
  raw_message?: string,        // 原始消息文本
  msg?: string,                // 处理后的消息文本
  message_id?: string|number,   // 消息ID
  
  // 群组相关（群消息事件）
  group_id?: string|number,     // 群组ID
  
  // 事件类型标识
  post_type?: string,          // 事件类型（'message', 'notice', 'request'等）
  event_type?: string,          // 事件类型（device适配器）
  
  // 适配器类型标识（由适配器设置）
  isOneBot?: boolean,           // OneBot适配器标识
  isDevice?: boolean,           // Device适配器标识
  isStdin?: boolean,           // Stdin适配器标识
}
```

## 适配器特定属性（由增强插件处理）

以下属性不应该在底层设置，而应该由对应的适配器增强插件通过`accept`方法处理：

### OneBot特定属性

```javascript
{
  // 对象引用（延迟加载）
  friend?: Friend,              // 好友对象（通过bot.pickFriend获取）
  group?: Group,               // 群组对象（通过bot.pickGroup获取）
  member?: Member,             // 群成员对象（通过bot.pickMember获取）
  
  // 类型标识
  isPrivate?: boolean,         // 是否为私聊
  isGroup?: boolean,           // 是否为群聊
  message_type?: string,       // 消息类型（'private', 'group', 'guild'）
  
  // @相关
  atList?: Array<string>,      // @列表
  at?: string,                 // 第一个@的用户ID（兼容）
  atBot?: boolean,            // 是否@了机器人
  
  // 群组信息
  group_name?: string,         // 群名称
  
  // 其他OneBot特定属性...
}
```

### Device特定属性

```javascript
{
  device_id: string,           // 设备ID（必需）
  device_name?: string,       // 设备名称
  event_type?: string,        // 事件类型
  // 其他device特定属性...
}
```

### Stdin特定属性

```javascript
{
  command?: string,            // 命令（如果适用）
  // 其他stdin特定属性...
}
```

## Bot实例基础方法

所有Bot实例都应该具备以下基础方法：

### 消息发送（通用接口）

```javascript
// 发送消息（适配器需要实现）
bot.sendMsg(msg, quote?, extraData?) => Promise<any>

// 通用辅助方法（由bot.js提供）
bot.makeForwardMsg(msg) => Object
bot.sendForwardMsg(sendFn, msg) => Promise<any>
bot.fileToUrl(file, opts?) => Promise<string>
```

### Bot选择方法（适配器特定）

```javascript
// OneBot特定（由 OneBot 适配器内部直接提供）
bot.pickFriend(user_id, strict?) => Friend
bot.pickGroup(group_id, strict?) => Group
bot.pickMember(group_id, user_id) => Member

// 其他适配器可能有不同的选择方法
```

## 事件处理流程

### 1. 适配器发送事件

适配器在接收到事件后，应该：

1. 设置基础属性（self_id, adapter, adapter_id, adapter_name等）
2. 调用 `Bot.em(eventName, data)` 发送事件
3. `Bot.em` 会自动调用 `Bot.prepareEvent(data)` 设置通用属性

### 2. Bot.prepareEvent（底层通用逻辑）

`Bot.prepareEvent` 只处理所有适配器通用的属性：

- 确保 `bot` 对象存在
- 设置 `adapter_id` 和 `adapter_name`
- 初始化基础 `sender` 对象
- 调用 `_extendEventMethods` 添加通用方法

### 3. 适配器增强插件（适配器特定逻辑）

适配器增强插件通过 `accept` 方法处理适配器特定属性：

- OneBot增强插件：处理 friend、group、member、atBot 等
- Device增强插件：处理 device 特定属性
- Stdin增强插件：处理 stdin 特定属性

### 4. 插件系统处理

插件系统会：

1. 调用适配器增强插件的 `accept` 方法
2. 调用其他插件的 `accept` 方法
3. 执行匹配的插件规则

## 适配器Loader规范

适配器Loader应该：

1. 扫描适配器目录
2. 加载适配器文件
3. 适配器文件应该通过 `Bot.adapter.push()` 注册适配器实例
4. 适配器实例应该设置 `id` 和 `name` 属性

## 注意事项

1. **不要假设特定适配器**：底层代码不应该假设 OneBot、stdin 或 device 的存在
2. **使用适配器标识**：通过 `e.adapter` 或 `e.adapter_name` 判断适配器类型
3. **延迟加载对象**：friend、group、member 等对象应该使用 getter 延迟加载
4. **插件处理特定逻辑**：所有适配器特定逻辑都应该在增强插件中处理
5. **保持底层通用**：底层代码应该对所有适配器通用

