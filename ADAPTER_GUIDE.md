# XRK-AGT (葵子) 适配器开发指南

## 概述

XRK-AGT 是一个通用的多平台机器人框架，支持通过适配器接入不同的消息平台。适配器可以将平台特定的事件转换为标准化的事件对象，供插件系统处理。

## 适配器架构

### 核心原则

1. **Loader通用化**: Loader逻辑完全通用，不依赖任何特定平台
2. **适配器特定化**: 适配器可以有自己特定的逻辑和实现
3. **事件对象标准化**: 所有适配器生成的事件对象必须符合标准结构

### 适配器职责

1. **事件转换**: 将平台特定的事件转换为标准化事件对象
2. **消息发送**: 实现平台特定的消息发送逻辑
3. **用户管理**: 实现平台特定的用户/群组管理逻辑
4. **配置映射**: 将通用配置映射到平台特定格式

## 事件对象标准结构

### 基础事件对象

```javascript
{
  // 事件标识（必需）
  post_type: 'message',        // 事件类型: message|notice|request|device
  event_type: 'message',       // 事件类型（同post_type）
  adapter: 'OneBotv11',        // 适配器名称
  adapter_id: 'OneBotv11',     // 适配器ID
  bot_id: 'bot123',            // 机器人ID
  self_id: 'bot123',           // 机器人自身ID
  time: 1234567890,            // 事件时间戳（秒）
  timestamp: 1234567890000,    // 事件时间戳（毫秒）
  
  // 用户信息（通用）
  user_id: 'user123',          // 用户ID（字符串格式）
  user_name: '用户名',          // 用户名
  user_avatar: 'avatar_url',   // 用户头像URL
  
  // 群组信息（如果是群组消息）
  group_id: 'group123',        // 群组ID（字符串格式）
  group_name: '群组名',         // 群组名
  
  // 消息信息
  message: [],                 // 消息数组
  raw_message: '原始消息',      // 原始消息文本
  message_id: 'msg123',        // 消息ID
  message_type: 'group',       // 消息类型: private|group
  
  // 权限信息
  isMaster: false,             // 是否为主人
  
  // 原始数据（保留）
  _raw: {},                    // 原始事件数据
  _adapter: 'OneBotv11'        // 适配器名称
}
```

### 消息事件对象

```javascript
{
  // ... 基础事件对象属性
  
  // 消息相关属性
  img: [],                     // 图片数组
  video: [],                   // 视频数组
  audio: [],                   // 音频数组
  file: [],                    // 文件数组
  msg: '',                     // 文本消息
  atList: [],                  // @列表
  atBot: false,                // 是否@了机器人
  
  // 发送者信息
  sender: {
    user_id: 'user123',
    nickname: '昵称',
    card: '群昵称',
    avatar: 'avatar_url'
  },
  
  // 回复方法
  reply: async (msg) => {},    // 回复消息
  recall: () => {},            // 撤回消息
}
```

## 适配器开发步骤

### 1. 创建适配器文件

在 `plugins/adapter/` 目录下创建适配器文件，例如 `MyAdapter.js`：

```javascript
Bot.adapter.push(
  new class MyAdapter {
    id = "MyAdapter"
    name = "MyAdapter"
    path = this.name
    
    // 适配器特定逻辑
    // ...
  }
)
```

### 2. 实现事件转换

将平台特定的事件转换为标准化事件对象：

```javascript
makeMessage(data) {
  // 构建标准化事件对象
  const event = {
    post_type: "message",
    event_type: "message",
    adapter: this.id,
    adapter_id: this.id,
    bot_id: data.self_id,
    self_id: data.self_id,
    time: data.time,
    timestamp: Date.now(),
    
    // 用户信息
    user_id: String(data.user_id),
    user_name: data.sender?.nickname || '',
    
    // 消息信息
    message: data.message || [],
    raw_message: data.raw_message || '',
    message_id: String(data.message_id),
    message_type: data.message_type || 'private',
    
    // ... 其他属性
  }
  
  // 触发事件
  Bot.em(`${event.post_type}.${event.message_type}`, event)
}
```

### 3. 实现消息发送

实现平台特定的消息发送逻辑：

```javascript
async sendMsg(msg, send, sendForwardMsg) {
  // 处理消息格式
  const [msgs, forward] = await this.makeMsg(msg)
  
  // 发送消息（平台特定实现）
  // ...
}
```

### 4. 配置映射

将通用配置映射到平台特定格式：

```javascript
// 在适配器中读取通用配置
const masterUsers = cfg.masterUsers || []
// 映射到平台特定的用户ID格式
const platformUserIds = masterUsers.map(userId => {
  // 适配器特定的映射逻辑
  return this.mapToPlatformUserId(userId)
})
```

## 适配器示例

### Stdin适配器

`plugins/adapter/stdin.js` 是一个简单的适配器示例，展示了如何：
1. 创建标准化事件对象
2. 实现消息发送
3. 处理用户输入

### OneBotv11适配器

`plugins/adapter/OneBotv11.js` 是一个完整的适配器示例，展示了如何：
1. 连接WebSocket
2. 处理OneBot协议事件
3. 实现完整的消息发送功能

## 配置说明

### 通用配置

- `masterUsers`: 主人用户ID列表（通用）
- `blackUsers`: 黑名单用户ID列表（通用）
- `whiteUsers`: 白名单用户ID列表（通用）
- `blackGroup`: 黑名单群组ID列表（通用）
- `whiteGroup`: 白名单群组ID列表（通用）

### 适配器特定配置

适配器可以在自己的配置文件中定义特定配置，例如：
- QQ适配器: `config/default_config/qq.yaml` (如果 needed)
- 微信适配器: `config/default_config/wechat.yaml` (如果 needed)

## 事件处理流程

1. **适配器接收事件**: 适配器从平台接收原始事件
2. **事件转换**: 适配器将原始事件转换为标准化事件对象
3. **事件触发**: 适配器触发 `Bot.em()` 事件
4. **Loader处理**: Loader接收事件并处理
5. **插件执行**: 插件处理事件并响应

## 最佳实践

1. **事件对象标准化**: 确保事件对象符合标准结构
2. **错误处理**: 妥善处理平台特定的错误
3. **配置映射**: 将通用配置映射到平台特定格式
4. **向后兼容**: 支持旧的配置格式（如果可能）
5. **文档完善**: 为适配器编写完整的文档

## 注意事项

1. **不要依赖QQ特定逻辑**: 适配器内部可以有QQ特定逻辑，但不要在其他地方使用
2. **使用通用属性**: 在事件对象中使用通用属性（如 `user_id` 而不是 `qq`）
3. **错误处理**: 妥善处理平台不可用的情况
4. **性能优化**: 避免阻塞主线程的操作

---

**XRK-AGT (葵子) - 通用多平台机器人框架**

