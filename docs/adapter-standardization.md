# 适配器标准化架构文档

## 概述

本次重构将插件系统从OneBot特定实现改为适配器无关的标准化架构，使框架能够在不同平台（OneBot、Device、Stdin等）上运行。

## 核心改进

### 1. 适配器抽象层 (`src/infrastructure/bot/adapter.js`)

创建了适配器抽象层，包含：

- **适配器能力定义** (`AdapterCapabilities`): 定义所有适配器可能支持的能力
  - 消息能力：发送、撤回、回复、转发
  - 联系人能力：好友、群组、成员
  - 文件能力：上传、下载
  - 其他能力：编辑资料、管理员操作

- **适配器能力检测器** (`AdapterCapabilityChecker`): 
  - 自动检测事件对象所属的适配器类型
  - 检测适配器是否支持特定能力
  - 提供便捷的能力检测方法

- **事件对象标准化器** (`EventNormalizer`):
  - 标准化所有适配器的事件对象，确保基础字段统一
  - 为不支持回复的适配器添加通用回复方法

### 2. 插件基类改进 (`src/infrastructure/plugins/plugin.js`)

- **适配器无关的回复方法**: `reply()` 方法现在自动适配不同适配器
  - OneBot: 使用 `e.reply()` 或 `friend/group.sendMsg()`
  - Device: 使用 `bot.sendMsg()`
  - Stdin: 使用 `e.respond()` 或日志输出

### 3. 插件加载器优化 (`src/infrastructure/plugins/loader.js`)

- **事件标准化**: 在处理事件前自动标准化事件对象
- **适配器检测**: 使用适配器检测替代硬编码判断
- **能力感知**: 根据适配器能力决定是否执行某些功能（如群组别名处理）

### 4. 事件处理改进

- **移除硬编码**: 将 `!e.isDevice && !e.isStdin` 等硬编码判断改为适配器检测
- **统一接口**: 所有适配器的事件对象都有统一的基础字段
- **向后兼容**: 保持对现有代码的兼容性

## 适配器支持

### OneBot适配器
- ✅ 完整支持所有能力
- ✅ 消息、群组、好友系统
- ✅ 文件上传下载
- ✅ 管理员操作

### Device适配器
- ✅ 基础消息发送
- ⚠️ 不支持群组/好友系统
- ⚠️ 不支持消息撤回、转发等高级功能

### Stdin适配器
- ✅ 基础消息发送
- ✅ 标准输入/输出
- ⚠️ 不支持群组/好友系统
- ⚠️ 不支持消息撤回、转发等高级功能

## 使用示例

### 插件开发（适配器无关）

```javascript
export default class MyPlugin extends plugin {
  constructor() {
    super({
      name: 'my-plugin',
      event: 'onebot.message', // 或 'device.message', 'stdin.*'
      rule: [{ reg: '^#测试$', fnc: 'test' }]
    })
  }

  async test(e) {
    // reply方法现在适配器无关，自动适配不同适配器
    await this.reply('测试成功')
    
    // 可以通过适配器检测来判断能力
    const { AdapterCapabilityChecker } = await import('#infrastructure/bot/adapter.js')
    if (AdapterCapabilityChecker.hasGroupSupport(e)) {
      // 只有支持群组的适配器才会执行
      await this.reply('这是群组消息')
    }
  }
}
```

### 适配器能力检测

```javascript
import { AdapterCapabilityChecker, AdapterCapabilities } from '#infrastructure/bot/adapter.js'

// 检测适配器类型
const adapter = AdapterCapabilityChecker.detectAdapter(e)

// 检测是否支持某个能力
if (AdapterCapabilityChecker.hasCapability(e, AdapterCapabilities.CONTACT_GROUP)) {
  // 处理群组相关逻辑
}

// 获取适配器完整信息
const info = AdapterCapabilityChecker.getAdapterInfo(e)
console.log(info) // { type: 'onebot', canReply: true, hasGroup: true, ... }
```

## 迁移指南

### 对于插件开发者

1. **事件监听**: 继续使用 `event: 'onebot.message'` 等格式，系统会自动处理
2. **回复消息**: 直接使用 `this.reply()`，无需关心适配器类型
3. **能力检测**: 如需适配器特定功能，使用 `AdapterCapabilityChecker` 检测

### 对于适配器开发者

1. **事件对象**: 确保事件对象包含 `adapter` 字段
2. **回复方法**: 如果适配器支持回复，实现 `e.reply()` 方法
3. **能力声明**: 在适配器中声明支持的能力（可选，系统会自动检测）

## 向后兼容性

- ✅ 现有OneBot插件无需修改即可继续工作
- ✅ 现有事件处理逻辑保持兼容
- ✅ 新增的适配器检测机制不影响现有功能

## 未来扩展

该架构设计支持未来添加新的适配器类型，只需：
1. 在适配器中设置 `e.adapter` 字段
2. 实现适配器支持的方法（如 `reply`）
3. 系统会自动识别并适配

