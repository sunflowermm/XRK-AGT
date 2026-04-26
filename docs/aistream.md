 # AIStream 工作流基类文档

> **文件位置**：`src/infrastructure/aistream/aistream.js`  
> **说明**：本文档描述 Node 侧 `AIStream` 基类与 LLM/MCP 集成方式。  
> **底层基线**：架构边界与调用链路以 **[底层架构设计](底层架构设计.md)** 为准。

`AIStream` 是 XRK-AGT 的工作流基类，用于统一处理：
- 消息上下文构建
- LLM 调用（经 `LLMFactory`）
- MCP 工具调用（tool calling）
- 记忆/知识增强（按已加载工作流能力）

---

## 核心结论

- 工作流发现路径固定为 `core/*/stream/*.js`
- 工具调用统一走 **LLM tool calling + MCP**，不走文本函数解析
- 当前不依赖已下线的子服务端 AI 业务接口
- 配置以 `cfg.aistream` + `core/system-Core/commonconfig/system.js` 为准

---

## 配置要点（对齐现状）

运行时文件：`data/server_bots/{port}/aistream.yaml`  
模板文件：`config/default_config/aistream.yaml`

常用字段：
- `llm.Provider`
- `llm.timeout`
- `llm.retry.*`
- `embedding.enabled` / `embedding.maxContexts` / `embedding.similarityThreshold`
- `mcp.*`
- `agentWorkspace.*`
- `tools.file.*`

说明：
- `aistream.tools` 当前仅包含 `file` 配置段
- 工具工作流配置以现行 schema 与代码实现为准
- 工作流扫描路径固定为 `core/*/stream/*.js`

---

## 常用方法

### `async init()`

初始化工作流（仅执行一次），由 `StreamLoader` 在加载时自动调用。

**初始化内容**：
- 若尚未存在，则初始化 MCP 工具映射 `this.mcpTools = new Map()`
- 子类可重写此方法进行自定义初始化（例如注册 MCP 工具）

### `buildSystemPrompt(context)` / `buildChatContext(e, question)`

抽象方法（可选实现）：
- `buildSystemPrompt` - 构建系统级提示词（角色设定、回复风格等）
- `buildChatContext` - 将事件与用户问题转换为 `messages` 数组

> 若子类未实现，基类会提供默认实现（返回空字符串/空数组）

---

## Embedding 与上下文增强

`AIStream` 支持在工作流中执行上下文增强。是否使用、如何增强，以当前加载的记忆/知识工作流实现为准。

**核心方法**：

| 方法 | 说明 |
|------|------|
| `generateEmbedding(text)` | 生成向量（具体实现以当前代码为准） |
| `storeMessageWithEmbedding(groupId, message)` | 存储消息到向量数据库和Redis（key: `ai:memory:${name}:${groupId}`） |
| `retrieveRelevantContexts(groupId, query)` | 检索相关上下文 |
| `buildEnhancedContext(e, question, baseMessages)` | 构建增强上下文（完整RAG流程：历史对话 + 知识库） |

## 函数调用与 MCP 工具

AIStream **不再解析/执行任何“文本函数调用 / ReAct”**，所有工具调用均通过 **LLM 工厂的 tool calling + MCP 协议** 完成：

- **tool calls 多轮交互**：由 `LLMFactory` 及各提供商客户端内部处理 `tool_calls` 循环，最终返回整理好的 `assistant.content` 文本给 AIStream；流式场景下，客户端一边向前端推送 `delta.content`，一边在遇到 `finish_reason = "tool_calls"` 时收集并执行 MCP 工具。
- **MCP 工具注册**：AIStream 通过 `registerMCPTool(name, options)` 将工具注册到 `this.mcpTools`，供 MCP 服务器发现和调用。
- **工作流工具作用域（streams）**：当通过 `/api/v3/chat/completions` 调用时，前端选择的工作流名称会被整理为 `streams` 白名单，传递给 LLM 客户端和 `MCPToolAdapter`，保证只有这些工作流下的工具可以被使用。

### `registerMCPTool(name, options)`

注册 MCP 工具（供 MCP 协议调用的标准工具）。

**参数**：
- `name` - 工具名称
- `options.handler` - 工具处理函数 `async (args, context) => {...}`，返回结构化结果
- `options.description` - 工具描述
- `options.inputSchema` - JSON Schema 格式的输入参数定义
- `options.enabled` - 是否启用（可被 `functionToggles` 覆盖）

> 工具返回值推荐使用 `successResponse(data)` / `errorResponse(code, message)` 进行包装：
> - `successResponse(data)` → `{ success: true, data: { ...data, timestamp } }`
> - `errorResponse(code, message)` → `{ success: false, error: { code, message } }`

---

## LLM 调用

> **提示**：关于 LLM 工厂的详细说明、支持的提供商列表、如何扩展新提供商等，请参考 **[工厂系统文档](factory.md)**。

```mermaid
sequenceDiagram
    participant Plugin as 🔌 插件
    participant Stream as 🌊 AIStream
    participant LLM as 🤖 LLM工厂
    participant Memory as 🧠 记忆/知识能力
    
    Note over Plugin,Memory: 🔄 LLM 调用流程
    
    Plugin->>Stream: 📞 process(e, question, options)<br/>调用工作流
    Stream->>Stream: 📝 buildChatContext(e, question)<br/>构建基础消息
    Stream->>Stream: 🔍 buildEnhancedContext(e, question)<br/>RAG增强上下文
    Stream->>LLM: 📡 调用 LLMFactory
    LLM-->>Stream: ✅ 返回响应
    Stream->>Memory: 💾 按工作流能力存储/检索上下文
    Stream-->>Plugin: ✅ 返回结果<br/>最终响应
    
    Note over Plugin: ✨ 调用完成
```

**核心方法**：

| 方法 | 说明 |
|------|------|
| `callAI(messages, apiConfig)` | 非流式调用 AI 接口 |
| `callAIStream(messages, apiConfig, onDelta, options)` | 流式调用AI接口，通过 `onDelta` 回调返回增量文本 |
| `execute(e, question, config)` | 执行：构建上下文 → 调用LLM（含 MCP tool calling）→ 存储记忆 |
| `process(e, question, options)` | 工作流处理入口（单次对话 + MCP 工具调用） |

**process 方法参数**：
- `mergeStreams` - 要合并的主工作流名称列表（`device`、`chat`、`desktop`）
- `enableMemory` - 是否启用记忆系统，自动整合 `memory` 工具工作流（默认 `false`）
- `enableDatabase` - 是否启用知识库系统，自动整合 `database` 工具工作流（默认 `false`）
- `enableTools` - 是否启用文件操作工具，自动整合 `tools` 工具工作流（默认 `false`）
- `apiConfig` - LLM配置（可选，会与 `this.config` 合并）

**工作流分类**：
- **主工作流**：`device`、`chat`、`desktop`（通过 `mergeStreams` 合并）
- **工具工作流**：`memory`、`database`、`tools`（通过标志启用）

**调用流程**：
1. `buildChatContext` - 构建基础消息数组
2. `buildEnhancedContext` - RAG流程：检索历史对话和知识库
3. `callAI` - 调用 LLM
4. `storeMessageWithEmbedding` - 存储到记忆系统（按当前工作流实现）
5. 自动发送回复（插件不需要再次调用 `reply()`）

## 完整API参考

### 核心方法详解

#### `async process(e, question, options)`

工作流处理入口，支持工作流合并和上下文增强。

**参数**：
- `e` - 事件对象（QQ/IM/Chatbot 等消息事件）
- `question` - 用户问题（字符串或对象）
- `options` - 选项对象
  - `mergeStreams` - 要合并的主工作流名称数组（`device`、`chat`、`desktop`）
  - `enableMemory` - 是否启用记忆系统（自动整合 `memory` 工具工作流）
  - `enableDatabase` - 是否启用知识库系统（自动整合 `database` 工具工作流）
  - `enableTools` - 是否启用文件操作工具（自动整合 `tools` 工具工作流）
  - `apiConfig` - LLM配置覆盖（provider, model, temperature等）

**返回**：`Promise<string|null>` - AI回复文本

**工作流分类**：
- **主工作流**：`device`、`chat`、`desktop`（通过 `mergeStreams` 合并）
- **工具工作流**：`memory`、`database`、`tools`（通过标志启用）

**示例**：
```javascript
// 基础调用（仅使用当前工作流）
await stream.process(e, e.msg);

// 启用工具工作流（记忆、知识库、文件操作）
await stream.process(e, e.msg, {
  enableMemory: true,
  enableDatabase: true,
  enableTools: true
});

// 合并主工作流（chat + desktop）
await stream.process(e, e.msg, {
  mergeStreams: ['desktop']
});

// 完整示例：主工作流 + 工具工作流
await stream.process(e, e.msg, {
  mergeStreams: ['desktop'],  // 合并主工作流
  enableMemory: true,         // 整合工具工作流
  enableDatabase: true,      // 整合工具工作流
  enableTools: true          // 整合工具工作流
});

// 自定义LLM配置
await stream.process(e, e.msg, {
  enableMemory: true,
  apiConfig: {
    provider: 'volcengine',
    model: 'gpt-4',
    temperature: 0.7
  }
});
```

#### `async callAI(messages, apiConfig)`

非流式调用AI接口，支持重试和错误处理。

**参数**：
- `messages` - 消息数组（OpenAI格式）
- `apiConfig` - API配置（可选）

**返回**：`Promise<string>` - AI回复文本

**特点**：
- 通过 LLMFactory 执行统一调用
- 支持重试机制（可配置）
- 自动记录 Token 使用和成本

#### `async callAIStream(messages, apiConfig, onDelta, options)`

流式调用AI接口，实时返回增量文本。

**参数**：
- `messages` - 消息数组
- `apiConfig` - API配置
- `onDelta` - 增量回调函数 `(delta: string) => void`
- `options` - 选项（可选）

**返回**：`Promise<string>` - 完整回复文本

**示例**：
```javascript
let fullText = '';
await stream.callAIStream(messages, {}, (delta) => {
  fullText += delta;
  // 实时发送增量文本
  e.reply(delta);
});
```

#### `async buildEnhancedContext(e, question, baseMessages)`

构建增强上下文（RAG流程）。

**流程**：
1. 提取查询文本
2. 检索历史对话（`retrieveRelevantContexts`）
3. 检索知识库（`retrieveKnowledgeContexts`）
4. 优化和压缩上下文
5. 合并到消息数组

**返回**：`Promise<Array>` - 增强后的消息数组

### 上下文检索方法

#### `async retrieveRelevantContexts(groupId, query)`

检索相关历史对话。

**参数**：
- `groupId` - 群组ID或用户ID
- `query` - 查询文本

**返回**：`Promise<Array>` - 上下文数组，每个元素包含：
- `message` - 消息内容
- `similarity` - 相似度分数（0-1）
- `time` - 时间戳
- `userId` - 用户ID
- `nickname` - 昵称

#### `async retrieveKnowledgeContexts(query)`

检索知识库上下文（从合并的工作流中查找）。

**参数**：
- `query` - 查询文本

**返回**：`Promise<Array>` - 知识库上下文数组

### 工作流合并

#### `merge(stream, options)`

合并其他工作流的功能。

**参数**：
- `stream` - 要合并的工作流实例
- `options` - 选项
  - `overwrite` - 是否覆盖同名函数（默认 `false`）
  - `prefix` - 函数名前缀（默认 `''`）

**返回**：`Object` - `{ mergedCount, skippedCount }`

**注意**：`merge()` 方法主要用于框架内部的工作流合并机制。在实际开发中，**不建议在 `init()` 方法中主动合并工作流**，而应通过调用参数控制：

```javascript
// ❌ 不推荐：在 init() 中主动合并
async init() {
const toolsStream = StreamLoader.getStream('tools');
  this.merge(toolsStream);
}

// ✅ 推荐：通过调用参数控制合并
await stream.process(e, question, {
  enableTools: true,      // 自动整合 tools 工作流
  enableMemory: true,    // 自动整合 memory 工作流
  enableDatabase: true   // 自动整合 database 工作流
});
```

---

## 使用示例

### 基础工作流实现

```javascript
import AIStream from '#infrastructure/aistream/aistream.js';

export default class MyStream extends AIStream {
  constructor() {
    super({
      name: 'my-stream',
      description: '我的自定义工作流',
      version: '1.0.5',
      priority: 50,
      config: {
        temperature: 0.8,
        maxTokens: 2000
      },
      embedding: { enabled: true }
    });
  }

  async init() {
    await super.init();
    // 在此注册 MCP 工具等初始化逻辑
    this.registerMCPTool('get_info', {
      description: '获取信息',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' }
        },
        required: ['key']
      },
      handler: async (args, context) => {
        // 返回统一结构
        return this.successResponse({ value: `you asked for ${args.key}` });
      }
    });
  }

  buildSystemPrompt(context) {
    return '你是一个智能助手...';
  }

  async buildChatContext(e, question) {
    const messages = [];
    messages.push({
      role: 'system',
      content: this.buildSystemPrompt({ e, question })
    });
    messages.push({
      role: 'user',
      content: typeof question === 'string' ? question : question?.text || ''
    });
    return messages;
  }
}
```

### 插件中调用工作流

```javascript
// 基础调用
const stream = this.getStream('chat');
await stream.process(e, e.msg);

// 启用记忆和知识库
await stream.process(e, e.msg, {
  enableMemory: true,
  enableDatabase: true
});

// 合并主工作流 + 整合工具工作流
await stream.process(e, e.msg, {
  mergeStreams: ['desktop'],  // 合并主工作流
  enableMemory: true,         // 整合工具工作流
  enableDatabase: true,       // 整合工具工作流
  enableTools: true          // 整合工具工作流
});

// 自定义LLM配置
await stream.process(e, e.msg, {
  apiConfig: {
    provider: 'volcengine',
    model: 'gpt-4',
    temperature: 0.7
  }
});

// 流式调用（需要手动发送回复）
let fullText = '';
await stream.callAIStream(messages, {}, (delta) => {
  fullText += delta;
  e.reply(delta);
});
```

### 工作流合并示例

```javascript
// 工作流合并应通过调用参数控制，不需要在 init() 中主动合并
// 调用时通过参数指定：
await stream.process(e, question, {
  enableTools: true,      // 自动整合 tools 工作流
  enableMemory: true,    // 自动整合 memory 工作流
  enableDatabase: true   // 自动整合 database 工作流
});
```

---

## 错误处理与重试

### 重试配置

与 **`core/system-Core/commonconfig/system.js`** 中 `aistream.schema.fields.llm.retry` 一致，仅下列字段有效：

```yaml
llm:
  retry:
    enabled: true
    maxAttempts: 3
    delay: 2000
    retryOn: ["timeout", "network", "5xx"]   # 可选含 all，见 schema enum
```

> 若文档其它处出现 `maxDelay`、`backoffMultiplier`、`rate_limit` 等而未写入 schema，以 **schema + 实际 LLM 工厂实现** 为准。

### 错误分类（概念）

工厂侧可能对错误做分类与重试策略；具体以 **`LLMFactory`** 及各 provider 客户端为准。

---

## 性能优化

### 上下文优化

- **自动去重**：`deduplicateContexts()` 去除重复上下文
- **智能压缩**：`optimizeContexts()` 按相似度排序并压缩
- **Token估算**：`estimateTokens()` 估算文本token数量

### 缓存机制

- Embedding结果缓存
- 上下文检索结果缓存
- 工作流实例缓存（StreamLoader）

---

## 监控与追踪

### MonitorService集成

工作流执行自动记录：
- 执行追踪（traceId）
- Token使用统计
- 成本统计
- 错误日志

**示例**：
```javascript
const traceId = MonitorService.startTrace(this.name, {
  agentId: e?.user_id,
  workflow: this.name
});

// ... 执行逻辑 ...

MonitorService.endTrace(traceId, { success: true });
```

---

## 相关文档

- **[system-Core 特性](system-core.md)** - system-Core 内置模块与工作流清单（以 `core/system-Core/stream/*.js` 为准，含 `web` 等） ⭐
- **[框架可扩展性指南](框架可扩展性指南.md)** - 扩展开发完整指南
- **[工厂系统](factory.md)** - LLM（含多模态）/ASR/TTS 工厂系统
- **[子服务端 API](subserver-api.md)** - 子服务端底层系统接口与扩展装载说明
- **[MCP 完整指南](mcp-guide.md)** - MCP 工具注册与连接

---

*最后更新：2026-04-26*