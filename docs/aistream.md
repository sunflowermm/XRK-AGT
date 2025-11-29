## AIStream 文档（src/infrastructure/aistream/aistream.js）

`AIStream` 是 XRK-AGT 中的 **AI 工作流基类**，用于封装：

- 调用外部 Chat Completion API（如 OpenAI 兼容接口）。
- 多种 Embedding 提供商（ONNX/HuggingFace/FastText/API/轻量级 BM25）。
- 相似度检索与历史上下文增强。
- 函数调用（Function Calling）与权限控制。

所有自定义 AI 工作流都应继承此类，并实现 `buildSystemPrompt` 与 `buildChatContext`。

---

## 基础属性与配置

- **基础信息**
  - `name`：工作流名称（默认 `base-stream`）。
  - `description`：描述（默认 `基础工作流`）。
  - `version`：版本号。
  - `author`：作者标识。
  - `priority`：工作流优先级。

- **AI 调用配置 `this.config`**
  - `enabled`：是否启用（默认 `true`）。
  - `temperature`、`maxTokens`、`topP`、`presencePenalty`、`frequencyPenalty` 等。
  - 运行时可在插件中额外传入 `apiConfig` 覆盖部分字段（如 `model/baseUrl/apiKey`）。

### 运行时配置来源（`config/default_config/aistream.yaml`）

`cfg.aistream` 会在 `AIStream` 和设备管理模块中统一读取，结构示例：

```yaml
enabled: true
streamDir: "core/stream"

llm:
  enabled: true
  defaultWorkflow: device
  defaultProfile: balanced
  persona: "你是一名友好、简洁的智能语音助手。"
  displayDelay: 1500
  defaults:
    provider: generic
    baseUrl: https://api.example.com/v1
    apiKey: ""
    model: general-task
    temperature: 0.8
    maxTokens: 2000
    timeout: 30000
  profiles:
    balanced:
      label: 通用对话
      model: smart-balanced
      maxTokens: 4096
    fast:
      label: 极速润色
      model: smart-fast
      maxTokens: 1024
    long:
      label: 长文本
      model: smart-long
      maxTokens: 8000
    device:
      label: 设备友好
      model: smart-device
      maxTokens: 1024
    creative:
      label: 灵感工坊
      model: smart-creative
      maxTokens: 4096
  workflows:
    device:
      label: 设备
      profile: device
      persona: "你是一个语音设备助手，输出需简洁，可加表情指令。"
    assistant:
      label: 日常助手
      profile: balanced
    polish:
      label: 润色助手
      profile: fast
    analysis:
      label: 长文本分析
      profile: long
    creative:
      label: 灵感创作
      profile: creative
    chat:
      label: OneBot 聊天
      profile: balanced
      uiHidden: true

embedding:
  enabled: true
  defaultProfile: lightweight
  defaults:
    provider: lightweight
    maxContexts: 5
    similarityThreshold: 0.6
    cacheExpiry: 86400
    cachePath: ./data/models
  profiles:
    lightweight:
      provider: lightweight
    onnx:
      provider: onnx
      onnxModel: Xenova/all-MiniLM-L6-v2
    hf:
      provider: hf
      hfModel: sentence-transformers/all-MiniLM-L6-v2
    fasttext:
      provider: fasttext
      fasttextModel: cc.zh.300.bin
    api:
      provider: api
      apiUrl: ""
      apiKey: ""
      apiModel: text-embedding-3-small

tts:
  defaultProvider: volcengine
  providers:
    volcengine:
      wsUrl: wss://openspeech.bytedance.com/api/v3/tts/bidirection
      appKey: YOUR_APP_KEY

asr:
  defaultProvider: volcengine
  providers:
    volcengine:
      wsUrl: wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async

device:
  heartbeatInterval: 30
  heartbeatTimeout: 180
  messageQueueSize: 100

emotions:
  keywords:
    开心: happy
  supported:
    - happy
    - sad

drawing:
  defaultModel: sketch
  models:
    sketch:
      provider: generic
      baseUrl: https://api.example.com/draw
```

> `drawing` 段目前仅提供占位符，方便后续扩展图像/渲染模型。

### 调用优先级（LLM & Embedding）

1. **显式传自定义配置**  
   `apiConfig` 中包含 `baseUrl/apiKey`（或完整 headers/body）时，直接以调用方参数为准。
2. **仅指定模型/档位 key**  
   `apiConfig.profile / profileKey / modelKey / llm`，甚至 `model: fast`（且未自定义 endpoint）时，会在 `llm.profiles` 中查找并落到对应参数。
3. **完全未指定**  
   按 `workflow → workflows.*.profile → defaultProfile → defaults` 的顺序解析；Embedding 档位也遵循相同策略。

### 前端可用的工作流

- `device`：设备语音/屏显默认体验（网页聊天默认）。
- `assistant`：结构化日常问答、建议。
- `polish`：短文本润色/改写。
- `analysis`：长文本总结、报告拆解。
- `creative`：故事、脚本、营销灵感。
- `chat`：OneBot/群聊专用，通过 `uiHidden: true` 隐藏在前端下拉中。

- **Embedding 配置 `this.embeddingConfig`**
  - `enabled`：是否启用向量检索。
  - `provider`：`lightweight/onnx/hf/fasttext/api`。
  - `maxContexts`：最多拼接多少条历史上下文。
  - `similarityThreshold`：相似度阈值。
  - `cacheExpiry`：Redis 缓存过期时间。
  - 模型配置：
    - ONNX：`onnxModel/onnxQuantized`。
    - HuggingFace：`hfToken/hfModel`。
    - FastText：`fasttextModel`。
    - API：`apiUrl/apiKey/apiModel`。

---

## 生命周期与初始化

- `init()`：基本初始化（仅执行一次）
  - 初始化函数映射 `this.functions = new Map()`。
  - 初始化与 Embedding 相关的内部字段。

- `initEmbedding()`：Embedding 初始化
  - 根据 `embeddingConfig.provider` 调用：
    - `initLightweightEmbedding()`：使用 `LightweightSimilarity` 与 BM25 风格计算。
    - `initONNXEmbedding()`：加载 ONNX 模型与简易 tokenizer。
    - `initHFEmbedding()`：通过 `@huggingface/inference` 接入在线模型。
    - `initFastTextEmbedding()`：下载 fastText 向量并加载。
    - `initAPIEmbedding()`：调用外部 Embedding API。
  - 若指定 provider 初始化失败，会尝试降级到 `lightweight`，否则关闭 Embedding 功能。

> 通常由工作流加载器在系统启动时统一初始化，插件只需假定可用即可。

---

## Embedding 与上下文增强

- **生成向量：`generateEmbedding(text)`**
  - 根据当前 provider 路由到：
    - `generateONNXEmbedding` / `generateHFEmbedding` / `generateFastTextEmbedding` / `generateAPIEmbedding`。
  - 对于 `lightweight`，直接返回原文本，稍后用 BM25 计算。

- **存储对话：`storeMessageWithEmbedding(groupId, message)`**
  - 将 `message`（包含 `message/nickname/user_id/time/embedding` 等）写入 Redis 列表：
    - key：`ai:embedding:${this.name}:${groupId}`。
  - 仅在 `embeddingConfig.enabled` 且初始化成功时生效。

- **检索相关上下文：`retrieveRelevantContexts(groupId, query)`**
  - 从 Redis 列表读取历史消息，解析为结构化对象。
  - 若 provider 为 `lightweight`，使用 `LightweightSimilarity` 计算 BM25 风格分数。
  - 否则使用 `cosineSimilarity` 计算向量余弦相似度。
  - 过滤低于阈值的结果，并按分数降序返回前 `maxContexts` 条。

- **构建增强上下文：`buildEnhancedContext(e, question, baseMessages)`**
  - 使用 `retrieveRelevantContexts` 获取相关历史。
  - 将其以「系统提示」形式附加到 `messages` 开头（或合并到首条 `system` 消息中）。

---

## 函数调用（Function Calling）

- **注册函数：`registerFunction(name, options)`**
  - `options` 字段：
    - `handler(params, context)`：实际执行函数。
    - `prompt`：用于在系统提示中对该函数进行说明。
    - `parser(text, context)`：从 AI 输出中解析出待执行的函数列表。
    - `enabled`：是否启用。
    - `permission`：自定义权限标识。
    - `description`：函数描述。

- **启用状态与开关**
  - `isFunctionEnabled(name)`：是否启用。
  - `toggleFunction(name, enabled)`：运行时开关。
  - `getEnabledFunctions()`：获取所有启用函数列表。

- **解析与执行**
  - `parseFunctions(text, context)`：
    - 遍历已注册函数，调用各自的 `parser`。
    - 汇总所有需要执行的函数调用 `functions` 与清洗后的文本 `cleanText`。
  - `executeFunction(type, params, context)`：
    - 按名称在 `this.functions` 中查找。
    - 检查权限（`checkPermission`），然后执行 `handler`。

---

## 抽象方法（必须由子类实现）

- `buildSystemPrompt(context)`  
  - 构建系统级提示词，如：
    - 角色设定。
    - 回复风格约束。
    - 场景限制等。

- `buildChatContext(e, question)`  
  - 将事件与用户问题转换为 Chat Completion 的 `messages` 数组：
    - `[{ role: 'system', content: ... }, { role: 'user', content: ... }, ...]`。
  - 可以根据群聊 / 私聊 / 设备事件等差异，做不同上下文拼装。

> 若子类未实现上述方法，会抛出错误，提示必须实现。

---

## 调用流程与 execute

- `callAI(messages, apiConfig = {})`
  - 以非流式方式调用兼容 OpenAI 的 `/chat/completions` 接口。
  - 组合 `this.config` 与 `apiConfig`，支持覆盖 `model/baseUrl/apiKey` 等。
  - 若未显式提供 `baseUrl/apiKey`，优先级遵循：`workflow` 预设 → `profile/profileKey/modelKey/llm` → `defaultProfile` → `defaults`。
    - `apiConfig.workflow` 指定工作流预设（自动带 persona + overrides）。
    - `apiConfig.profile`/`profileKey`/`modelKey`/`llm`/`model`（匹配 profile key）可切换档位。
    - 底层由 `LLMFactory`（`src/factory/llm/LLMFactory.js`）创建具体客户端，默认实现了通用 OpenAI 兼容客户端。

- `callAIStream(messages, apiConfig = {}, onDelta)`
  - 使用 `stream: true` 方式调用 Chat Completion。
  - 逐行解析 `data: ...` SSE 流，将增量文本通过 `onDelta(delta)` 回调返回。

- `execute(e, question, config)`
  1. 构造上下文对象 `{ e, question, config }`。
  2. 调用子类的 `buildChatContext` 生成基础 `messages`。
  3. 通过 `buildEnhancedContext` 加入历史上下文。
  4. 调用 `callAI` 获取回复文本。
  5. 调用 `parseFunctions` 解析函数调用，并依次执行。
  6. 如启用 Embedding，则将 Bot 回复写入 Redis 以备后续检索。
  7. 返回清洗后的文本 `cleanText`。

- `process(e, question, apiConfig = {})`
  - 一个轻量包装，内部调用 `execute`，适合插件直接调用。

---

### 配置探查 API

- `GET /api/ai/models`
  - 返回 `profiles`（模型档位列表）、`workflows`（预设工作流）、`defaultProfile`、`defaultWorkflow`。
  - 前端（如 `www/xrk`）可动态渲染模型选择器，不必硬编码配置。

---

## 与插件系统的协作方式

插件通常通过以下方式使用 `AIStream`：

1. 在插件构造函数中指定依赖工作流名称（可选）。
2. 在规则处理方法中：
   - `const stream = this.getStream('my-stream')`。
   - 调用 `const reply = await stream.process(this.e, questionText, apiConfig)`。
   - 使用 `this.reply(reply)` 将结果发送给用户。
3. 如需 Function Calling：
   - 在自定义 `AIStream` 子类的构造函数中注册函数：
     - `this.registerFunction('xxx', {...})`。
   - 在 `buildSystemPrompt` 中利用 `buildFunctionsPrompt()` 拼接功能描述。

---

## 清理与关闭：`cleanup()`

- 记录日志 `[name] 清理资源`。
- 若存在可释放的资源（如 ONNX Session、FastText 模型等），尝试释放。
- 重置 Embedding 状态与初始化标记。

> 框架层可在应用关闭或热重载时调用该方法，以避免内存泄漏。


