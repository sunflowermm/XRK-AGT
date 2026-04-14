# AIStream 工作流基类文档

> **文件位置**：`src/infrastructure/aistream/aistream.js`  
> **说明**：Node 侧"多步工作流/WorkflowManager/TODO"已移除；复杂多步编排请使用 Python 子服务端（LangChain/LangGraph）。本文档描述的是 Node 侧 `AIStream` 基类与 LLM/MCP 集成方式。  
> **可扩展性**：AIStream是工作流系统的核心扩展点。通过继承AIStream，开发者可以快速创建自定义工作流。详见 **[框架可扩展性指南](框架可扩展性指南.md)** ⭐
> **相关文档**：关于 LLM/Vision/ASR/TTS 工厂系统的详细说明，请参考 **[工厂系统文档](factory.md)** 📖
> **底层基线**：架构边界与调用链路以 **[底层架构设计](底层架构设计.md)** 为准。

`AIStream` 是 XRK-AGT 中的 **AI 工作流基类**，用于封装 LLM 调用、向量服务、上下文增强等能力（工具调用由 LLM 工厂的 tool calling + MCP 统一处理，AIStream 本身**不再解析函数调用文本**）。

### 核心特性

- ✅ **零配置扩展**：放置到任意 `core/*/stream/` 目录即可自动加载
- ✅ **函数注册系统**：统一使用 MCP 工具注册
- ✅ **向量服务集成**：统一通过子服务端向量服务进行文本向量化和检索
- ✅ **工作流合并**：支持主工作流合并和工具工作流整合
- ✅ **上下文增强**：自动上下文检索和增强（RAG流程）
- ✅ **热重载支持**：修改代码后自动重载

### 工作流分类

- **主/合并向**：`chat`、`desktop` 等（可经 `mergeStreams` 与上下文合并）
- **工具向 MCP**：`tools`、`memory`、`database`、`web`（`web_fetch` 等）
- **其它 Core**：任意 `core/<包名>/stream/*.js` 均由同一 `StreamLoader` 扫描加载

所有自定义 AI 工作流都应继承此类，可选择实现 `buildSystemPrompt` 与 `buildChatContext`。

---

## 📚 目录

- [架构概览](#架构概览)
- [构造参数与基础配置](#构造参数与基础配置)
- [核心方法](#核心方法)
- [Embedding 与上下文增强](#embedding-与上下文增强)
- [函数调用与 MCP 工具](#函数调用与-mcp-工具)
- [LLM 调用](#llm-调用)
- [完整API参考](#完整api参考)
- [使用示例](#使用示例)
- [子服务端集成](#子服务端集成)
- [错误处理与重试](#错误处理与重试)
- [性能优化](#性能优化)
- [监控与追踪](#监控与追踪)
- [相关文档](#相关文档)

---

## 架构概览

### 系统架构图

```mermaid
flowchart TB
    subgraph Plugin["🔌 插件层"]
        direction TB
        Call["调用工作流<br/>process()"]
    end
    
    subgraph AIStream["🌊 AIStream基类"]
        direction TB
        BuildCtx["构建基础消息<br/>buildChatContext()"]
        Enhance["RAG流程<br/>检索历史+知识库"]
        CallAI["调用LLM<br/>callAI()"]
        Store["存储到记忆系统"]
        Register["注册MCP工具<br/>registerMCPTool()"]
    end
    
    subgraph Subserver["🐍 Python子服务端"]
        direction TB
        LangChain["LangChain服务<br/>Agent编排+工具调用"]
        VectorAPI["向量服务<br/>embed/search/upsert"]
    end
    
    subgraph MainServer["⚙️ 主服务端"]
        direction TB
        LLMFactory["LLM工厂<br/>多厂商支持"]
        HTTPAPI["HTTP API<br/>v3接口"]
        MCP["MCP服务器<br/>工具调用协议"]
    end
    
    subgraph Memory["🧠 记忆系统"]
        direction TB
        ShortTerm["短期记忆"]
        LongTerm["长期记忆<br/>向量检索"]
    end
    
    Call -->|question| BuildCtx
    BuildCtx -->|messages| Enhance
    Enhance -->|enhanced| CallAI
    CallAI -->|请求| LangChain
    LangChain -->|调用| LLMFactory
    LangChain -->|工具调用| MCP
    CallAI -->|向量化| VectorAPI
    CallAI -->|存储| Store
    Store -->|保存| Memory
    Register -->|注册| MCP
    
    style Plugin fill:#E3F2FD,stroke:#1976D2,stroke-width:2px
    style AIStream fill:#E8F5E9,stroke:#388E3C,stroke-width:3px
    style Subserver fill:#FFF3E0,stroke:#F57C00,stroke-width:2px
    style MainServer fill:#FFF9C4,stroke:#F9A825,stroke-width:3px
    style Memory fill:#FCE4EC,stroke:#C2185B,stroke-width:2px
    style MCP fill:#F3E5F5,stroke:#7B1FA2,stroke-width:2px
```

### 工作流执行流程图

```mermaid
sequenceDiagram
    participant Plugin as 🔌 插件
    participant Stream as 🌊 AIStream
    participant Vector as 📊 向量服务
    participant LLM as 🤖 LLM服务
    participant Memory as 🧠 记忆系统
    
    Plugin->>Stream: 调用工作流
    Stream->>Stream: 构建基础消息
    
    alt 启用上下文增强
        Stream->>Vector: 检索历史上下文
        Vector-->>Stream: 历史上下文
        Stream->>Stream: 检索知识库
        Stream->>Stream: 构建增强上下文
    end
    
    Stream->>LLM: 调用LLM
    
    alt 子服务端可用
        LLM->>LLM: LangChain编排
        LLM->>LLM: 调用LLM工厂
        alt 需要工具调用
            LLM->>LLM: 执行MCP工具
        end
        LLM-->>Stream: LLM响应
    else 子服务端不可用
        Stream->>LLM: 直接调用LLM工厂
        LLM-->>Stream: LLM响应
    end
    
    alt 启用记忆存储
        Stream->>Memory: 存储消息和向量
        Memory->>Vector: 上传向量
    end
    
    Stream-->>Plugin: 返回最终响应
```

### 组件关系图

```mermaid
classDiagram
    class AIStream {
        +name: string
        +description: string
        +version: string
        +author: string
        +priority: number
        +config: Object
        +embeddingConfig: Object
        +mcpTools: Map
        +init()
        +initEmbedding()
        +buildSystemPrompt(context)
        +buildChatContext(e, question)
        +buildEnhancedContext(e, question, baseMessages)
        +generateEmbedding(text)
        +retrieveRelevantContexts(groupId, query)
        +retrieveKnowledgeContexts(query)
        +optimizeContexts(contexts, maxTokens)
        +callAI(messages, apiConfig)
        +callAIStream(messages, apiConfig, onDelta, options)
        +execute(e, question, config)
        +process(e, question, options)
        +resolveLLMConfig(apiConfig)
        +getProviderConfig(provider)
        +checkPermission(permission, context)
        +merge(stream, options)
        +autoMergeAuxiliaryStreams(stream, options)
        +extractStreamNames(options)
        +classifyError(error)
        +shouldRetry(errorInfo, retryConfig, attempt)
        +getRetryConfig()
        +calculateRetryDelay(attempt, retryConfig)
        +getTimeoutSeconds(config)
        +handleError(error, operation, context)
        +successResponse(data)
        +errorResponse(code, message)
        +getInfo()
        +cleanup()
    }
    
    class StreamLoader {
        +streams: Map
        +load()
        +getStream(name)
        +mergeStreams(options)
        +initMCP()
    }
    
    class MemoryManager {
        +addShortTermMemory(userId, memory)
        +addLongTermMemory(userId, memory)
        +searchLongTermMemories(userId, query, limit)
    }
    
    
    class MonitorService {
        +startTrace(traceId, context)
        +recordTokens(traceId, tokens)
        +endTrace(traceId, result)
    }
    
    AIStream --> StreamLoader : 通过Loader加载
    AIStream --> MemoryManager : 使用记忆系统
    AIStream --> MonitorService : 监控追踪
    StreamLoader --> AIStream : 管理实例
```

---

## 构造参数与基础配置

```javascript
constructor(options = {})
```

**参数说明**：

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `name` | `string` | 工作流名称 | `'base-stream'` |
| `description` | `string` | 描述 | `'基础工作流'` |
| `version` | `string` | 版本号 | `'2.0.0'` |
| `author` | `string` | 作者标识 | `'unknown'` |
| `priority` | `number` | 工作流优先级 | `100` |
| `config` | `Object` | AI调用配置 | `{ enabled: true, temperature: 0.8, ... }` |
| `embedding` | `Object` | Embedding配置 | `{ enabled: true, maxContexts: 5 }` |
| `functionToggles` | `Object` | 函数开关配置 | `{}` |

**AI调用配置** (`config`)：
- `enabled` - 是否启用（默认 `true`）
- `temperature`、`maxTokens`、`topP`、`presencePenalty`、`frequencyPenalty` 等
- 运行时可在插件中额外传入 `apiConfig` 覆盖部分字段

### 全局配置

工作流系统配置由 **`cfg.aistream`** 提供（`src/infrastructure/config/config.js`：`getServerConfig('aistream')`），运行时文件为 **`data/server_bots/{port}/aistream.yaml`**（随 Bot/端口变化）。仓库模板见 **`config/default_config/aistream.yaml`**，部署时应对齐该模板与 **`core/system-Core/commonconfig/system.js`** 中 `aistream.schema.fields`。

**关键配置项（节选）**：
- `llm.Provider` - 默认 LLM 提供商（示例：`volcengine`/`xiaomimimo`/`openai`/`gemini`/`anthropic`/`azure_openai`；兼容厂商由 `*_compat_llm.yaml` 的 `providers[].key` 动态扩展）
- `subserver.host` / `subserver.port` / `subserver.timeout` - Python 子服务端连接
- `embedding.enabled` / `maxContexts` / `similarityThreshold` - 由 `StreamLoader.applyEmbeddingConfig` 合并到各工作流 `embeddingConfig`（`loader.js`）
- `mcp.*` - 默认注入工作流、远程 MCP、工具合并策略等
- `agentWorkspace.*` - Skills/Rules/AGENT.md 等工作区上下文注入（见 `src/utils/agent-workspace.js`）
- `tools.file` - `ToolsStream`：工作区路径、`read` 截断、`run` 开关与超时（`core/system-Core/stream/tools.js`）
- `tools.web.fetch` - `WebStream` / `web_fetch`：OpenClaw 同源抓取逻辑（`core/system-Core/stream/web.js` + `core/system-Core/lib/openclaw-web/`）
- `tools.agentBrowser` - `BrowserStream`：Playwright 受控浏览器（`core/system-Core/stream/browser.js` + `lib/agent-browser/`），导航 SSRF 与 `ssrf-guard.js` 对齐
- **desktop 工作流**（`core/system-Core/stream/desktop.js`）的 MCP 工具（含剪贴板、`open_path` 等）无单独 `aistream.tools.*` 开关，与工作区解析内置在流内

**`streamDir` 说明（易误解）**：`StreamLoader` **不使用** `aistream.streamDir` 解析路径。工作流发现固定为 **`paths.getCoreSubDirs('stream')`**，即扫描所有 **`core/*/stream/*.js`**。YAML 中的 `streamDir` 仅为 Schema/控制台占位与文档备注，留空即可。

**LLM提供商配置**：
- 配置文件：`data/server_bots/{port}/{providerName}_llm.yaml`
- 配置合并优先级：`apiConfig` > `providerConfig` > `this.config` > 默认值
- 支持动态扩展，无需修改基类代码
- `enableTools`：控制是否启用工具调用，由各提供商配置决定
- `proxy`：可选代理配置，仅影响主服务端从 **本机到各厂商 LLM 接口** 的 HTTP 请求，不会修改系统全局代理  
  - 对象形式：
    - `proxy.enabled: true|false`：是否启用代理（默认为 `false`，未配置视为不启用）
    - `proxy.url: "http://user:pass@host:port"`：标准 HTTP/HTTPS/SOCKS5 代理地址
  - 简写形式：`proxy: "http://user:pass@host:port"`（等价于 `enabled: true` 且使用该地址）
  - 仅支持标准代理协议；**vmess/vless 等订阅需由 Clash / sing-box 等独立客户端转换为 HTTP 代理后再由 `proxy.url` 指向**

**关于 model（外部调用约定）**：
- 对外 v3 入口 `POST /api/v3/chat/completions`：外部调用只需要把 `model` 填成 **provider（运营商）**（如 `openai` / `gemini` / `ollama-local` 等），**不需要**再填写真实模型名。
- 真实模型名由 `{provider}_llm.yaml` 中的默认 `model`/`chatModel` 决定；你也可以通过工作流/内部配置覆盖，但外部调用不强制要求。

**Embedding 配置**：
- 向量计算统一走子服务端（`/api/vector/embed` 等，`AIStream.generateEmbedding`）
- **全局**：`aistream.embedding` 在加载阶段被合并进各流 `embeddingConfig`（含 `similarityThreshold`，供 `database` 等检索阈值使用）
- **工作流级**：构造函数仍可传 `embedding: { enabled, maxContexts }`；与全局合并后生效
- 子服务端模型/维度等见 `data/subserver/config.yaml`

---

## 核心方法

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

**重要说明**：
- **向量服务统一由子服务端提供**，主服务端只需配置子服务端连接信息（`subserver.host`、`subserver.port`、`subserver.timeout`）
- 向量服务配置（模型、维度等）位于子服务端配置文件（`data/subserver/config.yaml`）
- 工作流只需设置 `embedding: { enabled: true, maxContexts: 5 }` 即可启用
- `maxContexts` 为工作流级别配置，控制检索上下文条数，不是向量服务配置

**核心方法**：

| 方法 | 说明 |
|------|------|
| `generateEmbedding(text)` | 调用子服务端 `/api/vector/embed` 生成文本向量 |
| `storeMessageWithEmbedding(groupId, message)` | 存储消息到向量数据库和Redis（key: `ai:memory:${name}:${groupId}`） |
| `retrieveRelevantContexts(groupId, query)` | 检索相关上下文（优先使用MemoryManager，再调用子服务端向量检索） |
| `buildEnhancedContext(e, question, baseMessages)` | 构建增强上下文（完整RAG流程：历史对话 + 知识库） |

**向量服务接口**（子服务端）：
- `POST /api/vector/embed` - 文本向量化（由子服务端提供）
- `POST /api/vector/search` - 向量检索（由子服务端提供）
- `POST /api/vector/upsert` - 向量入库（由子服务端提供）

**子服务端配置**：
- 配置文件：`data/subserver/config.yaml`
- 向量模型、维度等配置在子服务端配置文件中设置

---

## 函数调用与 MCP 工具

AIStream **不再解析/执行任何“文本函数调用 / ReAct”**，所有工具调用均通过 **LLM 工厂的 tool calling + MCP 协议** 完成：

- **tool calls 多轮交互**：由 `LLMFactory` 及各提供商客户端内部处理 `tool_calls` 循环，最终返回整理好的 `assistant.content` 文本给 AIStream；流式场景下，客户端一边向前端推送 `delta.content`，一边在遇到 `finish_reason = "tool_calls"` 时收集并执行 MCP 工具。
- **MCP 工具注册**：AIStream 通过 `registerMCPTool(name, options)` 将工具注册到 `this.mcpTools`，供 MCP 服务器发现和调用。
- **工作流工具作用域（streams）**：当通过 `/api/v3/chat/completions` 或子服务端间接调用 LLM 时，前端选择的工作流名称会被整理为 `streams` 白名单，传递给 LLM 客户端和 `MCPToolAdapter`，保证只有这些工作流下的工具可以被使用。

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
    participant Subserver as 🐍 Python子服务端
    participant LLM as 🤖 LLM工厂
    participant Vector as 📊 向量服务
    
    Note over Plugin,Vector: 🔄 LLM 调用流程
    
    Plugin->>Stream: 📞 process(e, question, options)<br/>调用工作流
    Stream->>Stream: 📝 buildChatContext(e, question)<br/>构建基础消息
    Stream->>Stream: 🔍 buildEnhancedContext(e, question)<br/>RAG增强上下文
    Stream->>Subserver: 🌐 POST /api/langchain/chat<br/>LangChain编排
    
    alt 🐍 子服务端可用
        Subserver->>LLM: 📡 POST /api/v3/chat/completions<br/>调用LLM工厂
        LLM-->>Subserver: ✅ 返回响应<br/>AI回复文本
        Subserver-->>Stream: ✅ 返回结果<br/>Agent处理结果
    else ⚙️ 子服务端不可用
        Stream->>LLM: 📡 直接调用LLM工厂<br/>LLMFactory.createClient()
        LLM-->>Stream: ✅ 返回响应<br/>AI回复文本
    end
    
    Stream->>Vector: 💾 POST /api/vector/upsert<br/>存储消息向量
    Vector-->>Stream: ✅ 存储成功
    Stream-->>Plugin: ✅ 返回结果<br/>最终响应
    
    Note over Plugin: ✨ 调用完成
```

**核心方法**：

| 方法 | 说明 |
|------|------|
| `callAI(messages, apiConfig)` | 非流式调用AI接口（优先子服务端LangChain，失败时回退到LLM工厂） |
| `callAIStream(messages, apiConfig, onDelta, options)` | 流式调用AI接口，通过 `onDelta` 回调返回增量文本 |
| `execute(e, question, config)` | 执行：构建上下文 → 调用LLM（含 MCP tool calling）→ 存储记忆 |
| `process(e, question, options)` | 工作流处理入口（单次对话 + MCP 工具调用；复杂多步编排在 Python 子服务端） |

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
3. `callAI` - 调用LLM（优先子服务端LangChain，失败时回退到LLM工厂）
4. `storeMessageWithEmbedding` - 存储到记忆系统（通过子服务端向量服务）
5. 自动发送回复（插件不需要再次调用 `reply()`）

**子服务端集成详细流程**：

```mermaid
sequenceDiagram
    participant AIStream as 🌊 AIStream
    participant Subserver as 🐍 Python子服务端
    participant LangChain as 🌐 LangChain Agent
    participant MainServer as ⚙️ 主服务端v3
    participant MCP as 🔧 MCP服务器
    participant Vector as 📊 向量服务
    
    Note over AIStream,Vector: 🔄 LLM调用流程（子服务端）
    
    AIStream->>Subserver: 🌐 POST /api/langchain/chat<br/>请求Agent处理
    Subserver->>LangChain: 🤖 创建Agent并处理消息<br/>LangChain Agent
    LangChain->>MainServer: 📡 POST /api/v3/chat/completions<br/>调用LLM工厂
    
    alt 🔧 需要工具调用
        MainServer->>MCP: 🔧 执行MCP工具<br/>tools/call
        MCP-->>MainServer: ✅ 工具结果<br/>JSON格式
        MainServer-->>LangChain: 📤 包含工具结果的响应<br/>LLM响应+工具结果
        LangChain->>MainServer: 📡 再次调用（多轮对话）<br/>继续Agent流程
    end
    
    MainServer-->>LangChain: ✅ 最终LLM响应<br/>AI回复文本
    LangChain-->>Subserver: ✅ Agent处理结果<br/>最终响应
    Subserver-->>AIStream: ✅ 返回响应<br/>工作流结果
    
    Note over AIStream,Vector: 📊 向量服务流程
    
    AIStream->>Subserver: 🔍 POST /api/vector/search<br/>检索相关上下文
    Subserver->>Vector: 📊 ChromaDB检索<br/>向量相似度搜索
    Vector-->>Subserver: ✅ 检索结果<br/>相关上下文列表
    Subserver-->>AIStream: 📋 返回上下文<br/>增强消息
    
    AIStream->>Subserver: 💾 POST /api/vector/upsert<br/>存储消息向量
    Subserver->>Vector: 📊 存储向量<br/>ChromaDB upsert
    Vector-->>Subserver: ✅ 存储成功
    Subserver-->>AIStream: ✅ 确认<br/>存储完成
    
    Note over AIStream: ✨ 流程完成
```

---

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
- 优先使用子服务端（LangChain）
- 失败时自动回退到LLM工厂
- 支持重试机制（可配置）
- 自动记录Token使用和成本

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

## 子服务端集成

AIStream系统与Python子服务端紧密集成，实现LLM调用和向量服务的统一管理。

### 架构设计

```
主服务端 (Node.js)                    Python子服务端 (FastAPI)
├─ AIStream基类          ──────HTTP──────>  ├─ LangChain服务
├─ LLM工厂                                  │  └─ Agent编排
├─ MCP服务器                                │  └─ 工具调用
└─ 插件/工作流                             └─ 向量服务
                                              ├─ 向量化 (embed)
                                              ├─ 向量检索 (search)
                                              └─ 向量入库 (upsert)
```

**核心原则**：
- **主服务端**：统一LLM Provider入口、MCP工具执行、工作流管理
- **子服务端**：LangChain生态、向量服务、Python AI能力

### 向量服务接口

AIStream通过子服务端提供向量化服务（统一通过 `Bot.callSubserver` 调用）：

- **POST /api/vector/embed** - 文本向量化
  ```json
  {
    "texts": ["文本1", "文本2"]
  }
  ```
  返回：`{ embeddings: [{ text, embedding }] }`

- **POST /api/vector/search** - 向量检索
  ```json
  {
    "query": "查询文本",
    "collection": "memory_group123",
    "top_k": 5
  }
  ```
  返回：`{ results: [{ text, score, metadata }] }`

- **POST /api/vector/upsert** - 向量入库
  ```json
  {
    "collection": "memory_group123",
    "documents": [{
      "text": "文本内容",
      "metadata": {}
    }]
  }
  ```

### LLM调用接口

- **POST /api/langchain/chat** - LLM对话（优先使用）
  ```json
  {
    "messages": [...],
    "model": "volcengine",
    "enableTools": false
    "temperature": 0.8,
    "max_tokens": 2000,
    "stream": false,
    "enableTools": true
  }
  ```

**参数别名兼容（同义字段）**：
- `apiKey` ↔ `api_key`
- `max_tokens` ↔ `maxTokens` ↔ `max_completion_tokens`
- `top_p` ↔ `topP`
- `presence_penalty` ↔ `presencePenalty`
- `frequency_penalty` ↔ `frequencyPenalty`
- `tool_choice` ↔ `toolChoice`
- `parallel_tool_calls` ↔ `parallelToolCalls`
- `extraBody`：可选扩展字段（对象或 JSON 字符串）
  
  **调用流程**：
  1. AIStream调用子服务端 `/api/langchain/chat`
  2. 子服务端通过LangChain Agent处理消息
  3. 子服务端调用主服务端 `/api/v3/chat/completions` 获取LLM响应
  4. 如需工具调用，主服务端执行MCP工具并返回结果
  5. 子服务端返回最终响应给AIStream

  **回退机制**：如果子服务端不可用，AIStream自动回退到直接调用LLM工厂。

### 错误处理

- 子服务端调用失败时，自动回退到LLM工厂
- 向量服务调用失败时，记录日志但不中断流程
- 支持重试机制（可配置）

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

- Embedding结果缓存（通过子服务端）
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
- **[工厂系统](factory.md)** - LLM/Vision/ASR/TTS 工厂系统，统一管理多厂商 AI 服务提供商
- **[子服务端 API](subserver-api.md)** - LangChain + 向量服务 + 与主服务 v3 的衔接
- **[MCP 完整指南](mcp-guide.md)** - MCP 工具注册与连接

---

*最后更新：2026-04-14（对齐底层架构基线与 provider 动态扩展口径）*