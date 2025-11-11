# XRK-AGT (葵子) 重构总结

## 重构目标
将系统从QQ特定实现重构为通用的多平台机器人框架，确保：
1. 系统配置不特定于QQ
2. Loader逻辑保持通用
3. 适配器可以有自己特定的逻辑
4. 规范化对象构建和事件对象构建
5. 优化文件创建逻辑，避免重复创建

## 已完成的重构

### 1. 配置文件优化

#### ✅ 系统配置通用化
- **文件**: `config/default_config/other.yaml`
- **变更**: 
  - `masterQQ` → `masterUsers` (通用用户ID)
  - `blackQQ` → `blackUsers` (通用黑名单)
  - `whiteQQ` → `whiteUsers` (通用白名单)
  - 添加 `blackDevice` (设备黑名单)
- **说明**: 保持向后兼容，支持旧的QQ配置

#### ✅ 配置类优化
- **文件**: `config/commonconfig/system.js`
- **变更**: 更新配置项定义，使用通用命名
- **说明**: 适配器可以将通用配置映射到自己的用户ID格式

### 2. Loader逻辑通用化

#### ✅ 插件Loader优化
- **文件**: `lib/plugins/loader.js`
- **变更**:
  - `checkPermissions()`: 使用 `masterUsers` 替代 `masterQQ`
  - `checkBlacklist()`: 使用 `blackUsers`/`whiteUsers` 替代 `blackQQ`/`whiteQQ`
  - `oicq segment`: 改为可选导入，提供基础实现
- **说明**: Loader逻辑完全通用，不依赖QQ特定实现

#### ✅ 配置Loader优化
- **文件**: `lib/config/loader.js`
- **变更**: 
  - `updateTitle()`: 使用通用模式/ID，不再特定于QQ
  - 进程标题设置通用化
- **说明**: 支持多种运行模式（server、adapter等）

#### ✅ 配置类优化
- **文件**: `lib/config/config.js`
- **变更**:
  - `masterQQ` → `masterUsers` (通用getter)
  - 保持向后兼容，支持旧的 `masterQQ` 配置
- **说明**: 适配器可以将通用用户ID映射到自己的格式

### 3. Bot核心类优化

#### ✅ Bot类优化
- **文件**: `lib/bot.js`
- **变更**:
  - `sendMasterMsg()`: 使用 `masterUsers` 替代 `masterQQ`
  - 保持向后兼容
- **说明**: 通用方法，适配器可以调用

### 4. 目录结构优化

#### ✅ .gitignore优化
- **文件**: `.gitignore`
- **变更**: 
  - 添加通用运行时数据目录规则
  - 移除QQ特定硬编码
  - 添加更多通用忽略规则
- **说明**: 覆盖所有环境（Windows/Linux/macOS）

#### ✅ Dockerfile优化
- **文件**: `Dockerfile`
- **变更**: 
  - 移除 `data/bots` 目录创建
  - 改为 `data/adapters` 通用目录
  - 优化目录结构
- **说明**: 支持多平台部署

#### ✅ Start.js优化
- **文件**: `start.js`
- **变更**: 
  - `BOTS` → `ADAPTERS` (通用适配器目录)
  - 配置文件复制跳过平台特定配置（qq.yaml等）
- **说明**: 适配器可以有自己的配置

### 5. 文件创建优化

#### ✅ 目录创建工具
- **文件**: `lib/common/DirectoryManager.js` (新建)
- **功能**: 
  - 统一目录创建方法
  - 避免重复创建
  - 支持缓存检查
- **说明**: 所有目录创建都应使用此工具

#### ✅ 配置类目录创建
- **文件**: `lib/config/config.js`
- **变更**: 所有 `mkdirSync` 调用添加错误处理，避免重复创建
- **说明**: 使用统一的错误处理模式

#### ✅ App.js目录创建
- **文件**: `app.js`
- **变更**: 目录创建前检查是否存在
- **说明**: 避免重复创建

### 6. 事件对象构建规范化

#### ✅ 事件构建器
- **文件**: `lib/common/EventBuilder.js` (新建)
- **功能**: 
  - 标准化事件对象构建
  - 支持多种事件类型（message、notice、request、device）
  - 规范化ID处理
  - 通用事件属性
- **说明**: 适配器可以使用此工具构建标准化事件对象

#### ✅ 事件对象结构
```javascript
{
  // 事件标识
  post_type: 'message',
  event_type: 'message',
  adapter: 'OneBotv11',
  bot_id: 'bot123',
  self_id: 'bot123',
  time: 1234567890,
  timestamp: 1234567890000,
  
  // 用户信息（通用）
  user_id: 'user123',
  user_name: '用户名',
  user_avatar: 'avatar_url',
  
  // 群组信息
  group_id: 'group123',
  group_name: '群组名',
  
  // 消息信息
  message: [],
  raw_message: '原始消息',
  message_id: 'msg123',
  message_type: 'group',
  
  // 权限信息
  isMaster: false,
  
  // 原始数据
  _raw: {},
  _adapter: 'OneBotv11'
}
```

### 7. 适配器逻辑

#### ✅ 适配器可以有自己逻辑
- **OneBotv11适配器**: 可以有QQ特定的实现
- **Stdin适配器**: 可以有标准输入特定的实现
- **其他适配器**: 可以有各自平台的特定实现
- **说明**: Loader不关心适配器的具体实现，只处理标准化的事件对象

## 向后兼容性

### 配置兼容
- 支持旧的 `masterQQ` 配置，自动映射到 `masterUsers`
- 支持旧的 `blackQQ`/`whiteQQ` 配置，自动映射到 `blackUsers`/`whiteUsers`
- 适配器可以读取旧的配置并转换

### API兼容
- `cfg.masterQQ` 仍然可用（通过getter映射到 `masterUsers`）
- `cfg.master` 仍然可用（返回映射对象）
- 事件对象的属性保持兼容

## 使用指南

### 适配器开发
1. 适配器应该将平台特定的事件转换为标准化事件对象
2. 可以使用 `EventBuilder` 构建标准化事件对象
3. 适配器可以有自己的配置和逻辑
4. 适配器应该将用户ID映射到通用格式

### 插件开发
1. 插件应该使用通用的事件对象属性
2. 不要依赖平台特定的属性
3. 使用 `e.user_id` 而不是 `e.qq`
4. 使用 `e.group_id` 而不是 `e.groupId`

### 配置管理
1. 使用 `masterUsers` 配置主人用户ID
2. 使用 `blackUsers`/`whiteUsers` 配置黑白名单
3. 适配器可以将通用配置映射到自己的格式

## 测试建议

1. **配置测试**: 测试新旧配置的兼容性
2. **适配器测试**: 测试不同适配器的事件对象构建
3. **插件测试**: 测试插件对通用事件对象的处理
4. **目录创建测试**: 测试目录创建的幂等性

## 注意事项

1. **适配器特定逻辑**: 适配器可以有自己特定的逻辑，但应该生成标准化的事件对象
2. **配置映射**: 适配器需要将通用配置映射到自己的格式
3. **事件对象**: 所有事件对象都应该符合标准化结构
4. **目录创建**: 使用统一的目录创建方法，避免重复创建

## 后续优化建议

1. **事件对象验证**: 添加事件对象结构验证
2. **适配器接口**: 定义标准适配器接口
3. **配置迁移工具**: 提供配置迁移工具
4. **文档完善**: 完善适配器开发文档

---

**XRK-AGT (葵子) - 通用多平台机器人框架**

