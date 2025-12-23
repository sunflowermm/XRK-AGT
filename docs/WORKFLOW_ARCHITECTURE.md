# 工作流系统架构文档

## 系统概述

工作流系统是一个**通用、可扩展、标准化**的多步骤任务执行框架。它采用插件化架构，允许开发者快速构建自定义工作流，而无需修改底层代码。

**设计目标**：
- 通用性：适用于所有业务场景，无特化逻辑
- 可扩展性：通过函数注册快速扩展，无需修改底层
- 标准化：统一的接口和规范，易于集成和维护

## 架构层次

```
┌─────────────────────────────────────┐
│     业务层 (Business Layer)         │
│  - 自定义工作流 (Custom Workflows)   │
│  - 业务逻辑 (Business Logic)         │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│     工作流层 (Workflow Layer)        │
│  - WorkflowManager                  │
│  - 任务规划与执行                    │
│  - 上下文管理                        │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│     流层 (Stream Layer)             │
│  - AIStream (基类)                  │
│  - 函数注册与解析                    │
│  - 消息处理                          │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│     基础设施层 (Infrastructure)     │
│  - StreamLoader                     │
│  - LLM集成                          │
│  - 配置管理                          │
└─────────────────────────────────────┘
```

## 核心组件

### 1. WorkflowManager

**职责**：
- 工作流的创建、执行和管理
- 任务规划和步骤分解
- 上下文在步骤间的传递
- 状态管理和错误处理

**关键方法**：
- `createWorkflow(e, goal, todos)` - 创建工作流
- `executeWorkflow(workflowId)` - 执行工作流
- `decideWorkflowMode(e, goal)` - 判断是否需要工作流
- `buildSystemPrompt(workflow)` - 构建系统提示

**设计特点**：
- 单例模式，全局共享
- 无状态设计（状态存储在workflow对象中）
- 通用上下文合并机制

### 2. AIStream

**职责**：
- 工作流的基类
- 函数注册和解析
- 消息构建和处理
- 与LLM的交互

**关键方法**：
- `registerFunction(name, config)` - 注册函数
- `parseFunctions(text, context)` - 解析函数调用
- `buildSystemPrompt(context)` - 构建系统提示
- `buildChatContext(e, question)` - 构建聊天上下文

**设计特点**：
- 抽象基类，提供通用功能
- 模板方法模式
- 可扩展的提示构建

### 3. StreamLoader

**职责**：
- 工作流的加载和初始化
- 依赖注入（workflowManager）
- 工作流合并
- 配置管理

**关键方法**：
- `load(isRefresh)` - 加载所有工作流
- `injectWorkflowManagerToStreams(stream)` - 注入工作流管理器
- `mergeStreams(config)` - 合并工作流

**设计特点**：
- 延迟加载
- 自动依赖注入
- 支持工作流合并

## 数据流

### 工作流执行流程

```
用户请求
    ↓
decideWorkflowMode() - 判断是否需要工作流
    ↓
createWorkflow() - 创建工作流
    ↓
executeWorkflow() - 执行工作流循环
    ↓
executeTodo() - 执行单个任务
    ↓
buildTodoPrompt() - 构建任务提示
    ↓
callAI() - 调用AI
    ↓
parseAIResponse() - 解析AI响应
    ↓
executeAction() - 执行动作（函数调用）
    ↓
mergeContext() - 合并上下文
    ↓
下一个任务...
```

### 上下文传递机制

```
步骤1执行
    ↓
设置 context.fileContent
    ↓
mergeContext() - 合并到 workflow.context
    ↓
步骤2执行
    ↓
从 workflow.context 读取 fileContent
    ↓
使用 fileContent 完成任务
    ↓
设置新的 context.xxx
    ↓
继续传递...
```

## 扩展点

### 1. 创建新工作流

```javascript
export default class MyWorkflow extends AIStream {
  // 实现必要的方法
}
```

### 2. 注册函数

```javascript
this.registerFunction('my_function', {
  description: '...',
  prompt: '...',
  parser: (text, context) => {...},
  handler: async (params, context) => {...}
});
```

### 3. 自定义系统提示

```javascript
buildSystemPrompt(context) {
  return `【我的工作流】...`;
}
```

### 4. 扩展工作流管理器

```javascript
class CustomWorkflowManager extends WorkflowManager {
  // 重写方法以自定义行为
}
```

## 关键设计决策

### 1. 为什么使用单例模式？

- 工作流管理器需要全局共享
- 避免重复创建，节省资源
- 统一管理所有工作流状态

### 2. 为什么上下文存储在workflow对象中？

- 便于在步骤间传递数据
- 支持工作流的暂停和恢复
- 便于调试和日志记录

### 3. 为什么使用函数注册机制？

- 动态扩展，无需修改核心代码
- 支持工作流合并
- 统一的函数接口

### 4. 为什么系统提示是通用的？

- 避免特化逻辑
- 支持任意业务场景
- 易于维护和扩展

## 执行流程详解

### 工作流生命周期

```
创建 → 规划 → 执行 → 完成/失败
  ↓      ↓      ↓         ↓
初始化  分解任务  步骤循环  清理资源
```

### 步骤执行流程

```
1. 获取下一个待执行任务
2. 构建任务提示（包含上下文）
3. 调用AI生成响应
4. 解析响应（完成度、动作、下一步）
5. 执行函数调用
6. 合并上下文到workflow.context
7. 更新任务状态
8. 继续下一个任务
```

### 上下文传递机制

```
步骤1执行 → 设置context.xxx → mergeContext() → workflow.context
                                                      ↓
步骤2执行 ← 从workflow.context读取 ←──────────────────┘
```

## 性能优化策略

### 延迟加载
- 工作流按需加载，减少启动时间
- 函数按需解析，提升响应速度

### 异步处理
- 所有I/O操作异步执行
- 支持并行执行独立任务

### 资源管理
- 自动清理已完成的工作流
- 定期清理临时数据

## 错误处理机制

### 错误传播
- 错误自动传递到下一个步骤
- 支持错误重试机制（最多3次）
- 记录错误到笔记系统

### 错误恢复
- 工作流支持暂停和恢复
- 支持手动干预
- 自动清理失败的工作流（30秒后）

### 错误格式
```javascript
context.error = '通用错误';
context.commandError = '命令错误';
context.fileError = '文件错误';
// 支持任意以Error结尾的字段
```

## 扩展点说明

### 1. 自定义工作流管理器

```javascript
class CustomWorkflowManager extends WorkflowManager {
  // 重写方法以自定义行为
  async buildSystemPrompt(workflow) {
    // 自定义系统提示
    return super.buildSystemPrompt(workflow);
  }
}
```

### 2. 自定义函数解析

```javascript
parser: (text, context) => {
  // 自定义解析逻辑
  return { functions: [], cleanText: text };
}
```

### 3. 自定义错误处理

```javascript
handler: async (params, context) => {
  try {
    // 执行逻辑
  } catch (error) {
    // 自定义错误处理
    context.customError = error.message;
  }
}
```

## 设计模式应用

### 1. 单例模式
- `WorkflowManager`使用单例模式，全局共享
- 避免重复创建，节省资源

### 2. 模板方法模式
- `AIStream`提供模板方法
- 子类实现具体逻辑

### 3. 策略模式
- 函数注册机制使用策略模式
- 不同的函数实现不同的策略

### 4. 观察者模式
- 工作流状态变化通知
- 支持事件监听

## 总结

工作流系统采用**通用、可扩展、标准化**的设计，通过插件化架构和函数注册机制，允许开发者快速构建自定义工作流，而无需修改底层代码。系统设计遵循单一职责原则、开闭原则和依赖倒置原则，确保代码的可维护性和可扩展性。

**核心优势**：
- 无特化逻辑，适用于所有业务场景
- 快速扩展，无需修改底层代码
- 标准化接口，易于集成和维护

