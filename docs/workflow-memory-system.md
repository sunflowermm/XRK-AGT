# 工作流记忆系统完整文档

## 📚 目录导航

- [记忆系统概述](#记忆系统概述)
- [独立记忆系统设计](#独立记忆系统设计)
- [完整调用流程模拟](#完整调用流程模拟)
- [键值对设计](#键值对设计)
- [TODO临时记忆](#todo临时记忆)
- [使用示例](#使用示例)

---

## 记忆系统概述

XRK-AGT的记忆系统采用**工作流独立**的设计，确保：

- ✅ **每个工作流独立记忆**：不同工作流的记忆互不干扰
- ✅ **合并工作流独立记忆**：合并后的工作流有独立的记忆系统
- ✅ **键值对不冲突**：使用工作流名称作为键的一部分，确保唯一性
- ✅ **TODO临时记忆**：TODO笔记30分钟自动过期，只在TODO循环内有效

---

## 独立记忆系统设计

### 核心原则

1. **工作流名称作为键的一部分**
   - 单个工作流：`ai:memory:chat:group_123`
   - 合并工作流：`ai:memory:chat-desktop:group_123`
   - 确保每个工作流有独立的记忆空间

2. **记忆隔离**
   - `chat`工作流的记忆不会影响`desktop`工作流
   - `chat-desktop`合并工作流有独立的记忆系统
   - 用户对`desktop`工作流说"记住我是主人"，只对`desktop`工作流有效

3. **TODO临时记忆**
   - TODO笔记30分钟自动过期
   - 只在当前TODO工作流循环内有效
   - 工作流结束后自动清理

---

## 完整调用流程模拟

### 场景1：用户请求"帮我做一个表格"（简单任务）

详见 [`docs/workflow-architecture.md`](workflow-architecture.md#完整调用流程模拟)

### 场景2：用户请求"帮我依据报告.docx做一个表格"（复杂任务）

详见 [`docs/workflow-complex-task-example.md`](workflow-complex-task-example.md)

**核心特性**：
- ✅ **工作区概念**：desktop工作流默认在桌面工作
- ✅ **错误处理**：PowerShell命令执行失败时，记录错误并重试
- ✅ **TOKEN优化**：精简提示词，合理分配TOKEN
- ✅ **与大厂类似度**：90%+的类似度

#### 步骤1：用户发送请求

```
用户: xxx帮我做一个表格
```

#### 步骤2：插件触发工作流

```javascript
// core/plugin/example/xxx.js
const stream = StreamLoader.getStream('chat');
const response = await stream.process(this.e, question, {
  mergeStreams: ['desktop'],  // 合并desktop工作流
  enableTodo: true,           // 启用TODO智能决策
  enableMemory: true          // 启用记忆系统
});
```

**此时的工作流**：
- 工作流名称：`chat-desktop`（合并后的名称）
- 记忆键：`ai:memory:chat-desktop:group_123`

#### 步骤3：智能决策（第一次LLM调用）

**系统提示词构建**：
```javascript
buildSystemPrompt(context) {
  return `你是一个智能助手。
  
【可用功能】（包含合并工作流的所有指令）
${this.buildFunctionsPrompt()}  // 包含chat和desktop的所有函数

【记忆系统】
- 你的记忆存储在：ai:memory:chat-desktop:group_123
- 这是chat-desktop工作流的独立记忆空间
- 不会与其他工作流的记忆混淆`;
}
```

**LLM分析**：
```
用户请求：帮我做一个表格

分析：
- 这是一个复杂任务，需要多步骤完成
- 需要：1. 确定表格内容 2. 创建Excel文件 3. 填写数据

决策：需要TODO工作流
TODO列表:
1. 询问用户表格的具体内容和格式
2. 创建Excel文件
3. 填写数据到表格
```

#### 步骤4：创建工作流

```javascript
// WorkflowManager.createWorkflow()
const workflowId = 'workflow_1234567890_abc123';
const workflow = {
  id: workflowId,
  goal: '帮我做一个表格',
  todos: [
    { id: 'todo_0', content: '询问用户表格的具体内容和格式', status: 'pending' },
    { id: 'todo_1', content: '创建Excel文件', status: 'pending' },
    { id: 'todo_2', content: '填写数据到表格', status: 'pending' }
  ],
  notes: [],  // TODO临时笔记（30分钟过期）
  streamName: 'chat-desktop'  // 使用合并后的工作流名称
};
```

**记忆键值**：
- 消息记忆：`ai:memory:chat-desktop:group_123`
- TODO笔记：`ai:notes:workflow_1234567890_abc123`（30分钟过期）

#### 步骤5：执行TODO步骤1

**获取工作流笔记**：
```javascript
const notes = await this.stream.getNotes(workflowId);
// 返回：[]（第一次执行，没有笔记）
```

**构建提示词**：
```javascript
buildTodoPrompt(workflow, todo, notesText) {
  return `【当前任务】
${todo.content}

【工作流目标】
${workflow.goal}

【工作流笔记】（所有步骤共享，30分钟有效）
${notesText || '暂无笔记'}

【可用功能】（包含合并工作流的所有指令）
${this.stream.buildFunctionsPrompt()}

【输出格式】
完成度评估: [0-1之间的小数]
执行动作: [如果需要执行操作，使用命令格式]
下一步建议: [如果需要更多步骤，描述下一步操作，否则写"无"]
笔记: [如果需要记录重要信息，写入笔记；否则写"无"]`;
}
```

**LLM响应**：
```
完成度评估: 0.3
执行动作: 无
下一步建议: 需要询问用户表格的具体内容：行数、列数、表头、数据等
笔记: 用户需要创建表格，但具体内容未确定
```

**存储笔记**：
```javascript
await this.stream.storeNote(workflowId, '用户需要创建表格，但具体内容未确定', 'todo_0', true);
// 键：ai:notes:workflow_1234567890_abc123
// 过期时间：30分钟（1800秒）
```

**Redis存储**：
```json
{
  "content": "用户需要创建表格，但具体内容未确定",
  "source": "todo_0",
  "time": 1703123456789,
  "temporary": true
}
```

#### 步骤6：执行TODO步骤2

**获取工作流笔记**：
```javascript
const notes = await this.stream.getNotes(workflowId);
// 返回：[{ content: "用户需要创建表格，但具体内容未确定", source: "todo_0", time: 1703123456789, temporary: true }]
```

**构建提示词**（包含笔记）：
```
【工作流笔记】（所有步骤共享，30分钟有效）
1. 用户需要创建表格，但具体内容未确定
```

**LLM响应**：
```
完成度评估: 0.5
执行动作: [询问用户:请告诉我表格的具体内容，包括行数、列数、表头和数据]
下一步建议: 等待用户回复后创建Excel文件
笔记: 已询问用户表格内容，等待回复
```

**存储笔记**：
```javascript
await this.stream.storeNote(workflowId, '已询问用户表格内容，等待回复', 'todo_1', true);
```

**Redis存储**（追加）：
```json
[
  { "content": "已询问用户表格内容，等待回复", "source": "todo_1", "time": 1703123457890, "temporary": true },
  { "content": "用户需要创建表格，但具体内容未确定", "source": "todo_0", "time": 1703123456789, "temporary": true }
]
```

#### 步骤7：用户回复

```
用户: 3行3列，表头是姓名、年龄、城市，数据是张三25北京、李四30上海、王五28深圳
```

**系统处理**：
- 记忆键：`ai:memory:chat-desktop:group_123`
- 存储用户消息到chat-desktop工作流的记忆系统

#### 步骤8：执行TODO步骤3

**获取工作流笔记**（包含之前所有步骤的笔记）：
```javascript
const notes = await this.stream.getNotes(workflowId);
// 返回：
// [
//   { content: "已询问用户表格内容，等待回复", source: "todo_1", time: 1703123457890, temporary: true },
//   { content: "用户需要创建表格，但具体内容未确定", source: "todo_0", time: 1703123456789, temporary: true }
// ]
```

**检索相关记忆**：
```javascript
const contexts = await this.stream.retrieveRelevantContexts(groupId, '表格内容', true, workflowId);
// 从 ai:memory:chat-desktop:group_123 检索
// 返回：用户刚才回复的表格内容
```

**LLM响应**：
```
完成度评估: 0.8
执行动作: [生成Excel:表格.xlsx:[{"姓名":"张三","年龄":25,"城市":"北京"},{"姓名":"李四","年龄":30,"城市":"上海"},{"姓名":"王五","年龄":28,"城市":"深圳"}]]
下一步建议: 无
笔记: 已创建Excel文件，包含3行3列数据
```

**执行函数**：
```javascript
// 调用 desktop.create_excel_document
await this.stream._executeFunctionWithMerge({
  type: 'desktop.create_excel_document',
  params: { filename: '表格.xlsx', data: [...] }
}, context);
```

**存储笔记**：
```javascript
await this.stream.storeNote(workflowId, '已创建Excel文件，包含3行3列数据', 'todo_2', true);
```

#### 步骤9：工作流完成

**清理临时笔记**：
- TODO笔记键：`ai:notes:workflow_1234567890_abc123`
- 30分钟后自动过期（Redis expire）
- 或工作流结束时手动清理

**保留的记忆**：
- 消息记忆：`ai:memory:chat-desktop:group_123`（保留，用于后续对话）

---

## 键值对设计

### 消息记忆

**格式**：`ai:memory:{streamName}:{groupId}`

**示例**：
- `chat`工作流：`ai:memory:chat:group_123`
- `desktop`工作流：`ai:memory:desktop:group_123`
- `chat-desktop`合并工作流：`ai:memory:chat-desktop:group_123`

**特点**：
- 每个工作流独立
- 合并工作流使用合并后的名称
- 不会冲突

### TODO笔记

**格式**：`ai:notes:{workflowId}`

**示例**：
- `ai:notes:workflow_1234567890_abc123`

**特点**：
- 30分钟自动过期
- 只在TODO循环内有效
- 工作流结束后自动清理

### 工作流记忆

**格式**：`ai:workflow:{workflowId}`

**示例**：
- `ai:workflow:workflow_1234567890_abc123`

**特点**：
- 存储工作流元数据
- 3天过期

---

## TODO临时记忆

### 设计原理

TODO笔记是**临时记忆**，设计目的：

1. **只在TODO循环内有效**：工作流执行期间，所有TODO步骤共享笔记
2. **30分钟自动过期**：避免Redis积累过多临时数据
3. **自动清理**：工作流结束后，笔记自动过期

### 实现机制

```javascript
// 存储TODO笔记
await stream.storeNote(workflowId, content, source, true); // isTemporary = true

// Redis存储
{
  "content": "笔记内容",
  "source": "todo_0",
  "time": 1703123456789,
  "temporary": true
}

// Redis过期时间
await redis.expire(key, 1800); // 30分钟 = 1800秒

// 获取笔记时自动过滤过期笔记
const notes = await stream.getNotes(workflowId);
// 自动过滤超过30分钟的临时笔记
```

### 使用场景

- **步骤间信息传递**：TODO步骤1记录的信息，TODO步骤2可以看到
- **临时上下文**：只在当前工作流有效，不会影响其他工作流
- **自动清理**：工作流结束后，笔记自动过期

---

## 使用示例

### 示例1：独立记忆系统

```javascript
// 用户对desktop工作流说
用户: desktop你记住，下次见我要喊我主人

// 记忆存储
键：ai:memory:desktop:group_123
值：{ message: "desktop你记住，下次见我要喊我主人", ... }

// 用户对chat工作流说
用户: chat你好

// 记忆存储
键：ai:memory:chat:group_123
值：{ message: "chat你好", ... }

// desktop工作流有独立记忆，chat工作流看不到desktop的记忆
```

### 示例2：合并工作流记忆

```javascript
// 合并工作流
const stream = StreamLoader.mergeStreams({
  name: 'chat-desktop',
  main: 'chat',
  secondary: ['desktop']
});

// 用户说
用户: 记住我是主人

// 记忆存储
键：ai:memory:chat-desktop:group_123
值：{ message: "记住我是主人", ... }

// 只有chat-desktop合并工作流能看到这个记忆
// chat工作流和desktop工作流都看不到
```

### 示例3：TODO临时笔记

```javascript
// TODO步骤1
完成度评估: 0.5
笔记: 用户需要创建表格，但具体内容未确定

// 存储
键：ai:notes:workflow_1234567890_abc123
过期：30分钟

// TODO步骤2（可以看到步骤1的笔记）
【工作流笔记：
1. 用户需要创建表格，但具体内容未确定
】

// TODO步骤3（可以看到步骤1和步骤2的笔记）
【工作流笔记：
1. 已创建Excel文件，包含3行3列数据
2. 已询问用户表格内容，等待回复
3. 用户需要创建表格，但具体内容未确定
】

// 工作流结束后，30分钟自动过期
```

---

## 总结

XRK-AGT的记忆系统采用**工作流独立**的设计：

- ✅ **每个工作流独立记忆**：不会互相干扰
- ✅ **合并工作流独立记忆**：使用合并后的名称作为键
- ✅ **TODO临时记忆**：30分钟自动过期，只在TODO循环内有效
- ✅ **键值对不冲突**：使用工作流名称确保唯一性

这样的设计确保了记忆系统的**清晰、独立、可扩展**。

