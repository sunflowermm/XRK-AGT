# XRK-AGT (葵子) 重构变更记录

## 变更概述

本次重构将系统从QQ特定实现重构为通用的多平台机器人框架，确保系统配置和核心逻辑不特定于QQ，同时适配器可以有自己的特定逻辑。

## 主要变更

### 1. 配置文件变更

#### `config/default_config/other.yaml`
- ✅ `masterQQ` → `masterUsers` (通用用户ID)
- ✅ `blackQQ` → `blackUsers` (通用黑名单)
- ✅ `whiteQQ` → `whiteUsers` (通用白名单)
- ✅ 添加 `blackDevice` (设备黑名单)
- ✅ 保持向后兼容

#### `config/commonconfig/system.js`
- ✅ 更新配置项定义，使用通用命名
- ✅ 添加配置项描述

### 2. 核心逻辑变更

#### `lib/config/config.js`
- ✅ `masterQQ` getter → `masterUsers` getter
- ✅ 保持向后兼容（支持旧的 `masterQQ` 配置）
- ✅ 通用用户ID处理

#### `lib/bot.js`
- ✅ `sendMasterMsg()` 使用 `masterUsers` 替代 `masterQQ`
- ✅ 保持向后兼容

#### `lib/plugins/loader.js`
- ✅ `checkPermissions()` 使用 `masterUsers` 替代 `masterQQ`
- ✅ `checkBlacklist()` 使用 `blackUsers`/`whiteUsers` 替代 `blackQQ`/`whiteQQ`
- ✅ `oicq segment` 改为可选导入，提供基础实现
- ✅ `parseMessage()` 中的 `at` 处理改为通用ID获取
- ✅ 事件对象处理通用化

#### `lib/config/loader.js`
- ✅ `updateTitle()` 使用通用模式/ID，不再特定于QQ
- ✅ 进程标题设置通用化

### 3. 目录结构变更

#### `.gitignore`
- ✅ 优化运行时数据目录规则
- ✅ 移除QQ特定硬编码
- ✅ 添加通用忽略规则
- ✅ 覆盖所有环境

#### `Dockerfile`
- ✅ 移除 `data/bots` 目录创建
- ✅ 改为 `data/adapters` 通用目录
- ✅ 优化目录结构

#### `start.js`
- ✅ `BOTS` → `ADAPTERS` (通用适配器目录)
- ✅ 配置文件复制跳过平台特定配置

### 4. 文件创建优化

#### `lib/common/DirectoryManager.js` (新建)
- ✅ 统一目录创建方法
- ✅ 避免重复创建
- ✅ 支持缓存检查

#### `lib/config/config.js`
- ✅ 所有 `mkdirSync` 调用添加错误处理
- ✅ 避免重复创建

#### `app.js`
- ✅ 目录创建前检查是否存在
- ✅ 避免重复创建

### 5. 事件对象构建规范化

#### `lib/common/EventBuilder.js` (新建)
- ✅ 标准化事件对象构建
- ✅ 支持多种事件类型
- ✅ 规范化ID处理
- ✅ 通用事件属性

#### `plugins/adapter/stdin.js`
- ✅ 事件对象构建标准化
- ✅ 移除QQ特定引用（如QQ头像URL）
- ✅ 使用通用属性

### 6. 适配器优化

#### `plugins/adapter/stdin.js`
- ✅ 事件对象构建规范化
- ✅ 移除QQ特定引用
- ✅ 使用通用属性

#### `plugins/adapter/OneBotv11.js`
- ✅ 适配器可以有自己特定的逻辑（QQ特定实现）
- ✅ 生成标准化事件对象

## 向后兼容性

### 配置兼容
- ✅ 支持旧的 `masterQQ` 配置，自动映射到 `masterUsers`
- ✅ 支持旧的 `blackQQ`/`whiteQQ` 配置，自动映射到 `blackUsers`/`whiteUsers`
- ✅ 适配器可以读取旧的配置并转换

### API兼容
- ✅ `cfg.masterQQ` 仍然可用（通过getter映射到 `masterUsers`）
- ✅ `cfg.master` 仍然可用（返回映射对象）
- ✅ 事件对象的属性保持兼容

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

---

**XRK-AGT (葵子) - 通用多平台机器人框架**

