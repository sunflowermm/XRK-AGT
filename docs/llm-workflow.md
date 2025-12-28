# LLM 调用工作流文档

本文档说明 XRK-AGT 中 LLM 工厂的完整调用流程和消息格式规范。

## 架构概览

**LLM调用完整流程**:

```mermaid
flowchart TB
    subgraph Plugin["插件层"]
        A[插件监听事件]
        B[提取消息内容]
        C[构建messages数组]
    end
    
    subgraph Stream["工作流层"]
        D[接收messages]
        E[合并历史消息]
        F[增强上下文<br/>embedding检索]
    end
    
    subgraph Factory["工厂层"]
        G[LLM工厂]
        H{是否有图片?}
        I[识图工厂<br/>VisionFactory]
        J[调用LLM提供商API]
    end
    
    subgraph Provider["提供商层"]
        K[GPTGod/Volcengine/MiMo]
        L[Vision提供商]
    end
    
    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H
    H -->|有图片| I
    H -->|无图片| J
    I --> L
    L --> J
    J --> K
    
    style Plugin fill:#E6F3FF
    style Stream fill:#FFE6CC
    style Factory fill:#90EE90
    style Provider fill:#87CEEB
```

## 职责划分

**职责划分架构图**:

```mermaid
flowchart LR
    subgraph Plugin["插件层职责"]
        P1[监听事件]
        P2[提取消息]
        P3[构建messages]
        P4[包含人设]
    end
    
    subgraph Stream["工作流层职责"]
        S1[接收messages]
        S2[合并历史]
        S3[增强上下文]
        S4[执行函数调用]
        S5[存储回复]
    end
    
    subgraph Factory["工厂层职责"]
        F1[读取配置]
        F2[检测图片]
        F3[调用识图工厂]
        F4[调用LLM API]
    end
    
    Plugin --> Stream
    Stream --> Factory
    
    style Plugin fill:#E6F3FF
    style Stream fill:#FFE6CC
    style Factory fill:#90EE90
```

### 插件 (Plugin)

**职责**：
- 监听 tasker 事件（如 OneBot、Web 等）
- 从事件中提取消息内容（文本、图片URL等）
- 构建标准化的 `messages` 数组
- 在 system prompt 中包含人设（persona）

**不负责**：
- ❌ 消息历史合并（由工作流负责）
- ❌ 图片识别（由工厂负责）
- ❌ 运营商配置读取（由工厂负责）

### 工作流 (Workflow/Stream)

**职责**：
- 接收插件传入的 `messages` 数组
- 合并消息历史（从内部存储获取）
- 增强上下文（embedding 检索）
- 执行 AI 返回的函数调用
- 存储 Bot 回复到历史记录

### LLM 工厂 (LLMFactory) 与 识图工厂 (VisionFactory)

**LLM 工厂职责**：
- 读取 LLM 运营商配置（baseUrl、apiKey、model 等）
- 检测消息中是否包含图片（仅做格式识别，不执行识图）
- 如果存在图片，则根据 `aistream.yaml` 中的 `vision.Provider` 把图片 URL / 本地路径交给识图工厂
- 接收识图工厂返回的描述文本，并按既有格式（如 `[图片:描述]`）拼接回 user 文本
- 构建符合运营商 API 格式的消息并调用 LLM API

**识图工厂职责**：
- 读取各自识图工厂配置（`god_vision.yaml`、`volcengine_vision.yaml` 等）
- 针对不同运营商执行下载/上传/vision 模型调用，输出纯文本描述
- 对上只暴露统一接口（如 `recognizeImages`），不与工作流直接耦合

## Messages 格式规范

### 基本结构

`messages` 是一个数组，每个元素包含 `role` 和 `content`：

```javascript
[
  {
    role: 'system',
    content: '系统提示词（包含人设）'
  },
  {
    role: 'user',
    content: '...' // 见下方说明
  }
]
```

### System Message

```javascript
{
  role: 'system',
  content: '完整的人设和系统提示词字符串'
}
```

**注意：** 人设（persona）应该在插件中构建到 system prompt 中。

### User Message（纯文本）

```javascript
{
  role: 'user',
  content: '用户消息文本'
}
```

### User Message（包含图片）

```javascript
{
  role: 'user',
  content: {
    text: '用户消息文本',
    images: ['图片URL1', '图片URL2'],      // 当前消息中的图片
    replyImages: ['回复图片URL1'],          // 回复消息中的图片（可选）
    isGlobalTrigger: false                  // 是否为全局触发（可选，用于工作流判断）
  }
}
```

**图片 URL 说明：**
- 插件只负责提取图片 URL，不做识别
- URL 可以是完整 HTTP/HTTPS 地址
- 工厂会根据运营商要求处理（上传或直接使用）

## 完整调用流程

### 1. 插件构建 Messages

```javascript
// 插件示例（godai.js）
async buildMessages(e, questionData, isGlobalTrigger, chatStream) {
  const messages = [];
  
  // 构建 system prompt（包含人设）
  const systemPrompt = chatStream.buildSystemPrompt({
    e,
    question: {
      persona: '我是AI助手...',  // 人设在这里
      isGlobalTrigger,
      botRole,
      dateStr
    }
  });
  
  messages.push({
    role: 'system',
    content: systemPrompt
  });

  // 构建 user message（包含图片URL）
  const userMessageContent = {
    text: `[当前消息]\n${userInfo}(${e.user_id}): ${content}`,
    images: questionData.images || [],      // 图片URL数组
    replyImages: questionData.replyImages || [],
    isGlobalTrigger
  };
  
  messages.push({
    role: 'user',
    content: userMessageContent
  });
  
  return messages;
}
```

### 2. 工作流接收并处理

```javascript
// 工作流（chat.js）
async execute(e, question, config) {
  const context = { e, question, config };
  
  // 构建基础上下文
  const baseMessages = await this.buildChatContext(e, question);
  
  // 增强上下文（RAG流程：历史对话 + 知识库）
  const messages = await this.buildEnhancedContext(e, question, baseMessages);
  
  // 调用 LLM 工厂
  const response = await this.callAI(messages, config);
  
  // 解析函数调用
  const { functions, cleanText } = this.parseFunctions(response, context);
  
  // 先发送自然语言回复（如果有）
  if (cleanText && cleanText.trim() && e?.reply) {
    await e.reply(cleanText.trim());
  }
  
  // 执行函数（ReAct模式）
  await this.executeFunctionsWithReAct(functions, context, question);
  
  // 存储到记忆系统
  if (this.embeddingConfig.enabled && cleanText && e) {
    const groupId = e.group_id || `private_${e.user_id}`;
    await this.storeMessageWithEmbedding(groupId, {
      user_id: e.self_id,
      nickname: e.bot?.nickname || 'Bot',
      message: cleanText,
      message_id: Date.now().toString(),
      time: Date.now()
    });
  }
  
  return cleanText;
}
```

### 3. 工厂处理图片并调用 API

#### GPTGod 工厂 + 识图工厂处理流程

```javascript
// GPTGodLLMClient.js
async chat(messages, overrides = {}) {
  // 1. 转换 messages，处理图片
  const transformedMessages = await this.transformMessages(messages);

  // transformMessages 内部会：
  // - 检测 user message 中的 images / replyImages
  // - 基于 aistream.vision.Provider 选择 VisionFactory 提供商（如 GPTGodVision）
  // - 调用识图工厂把每张图转成描述文本
  // - 按 "[图片:描述]" / "[回复图片:描述]" 的格式拼回到文本中

  // 2. 构建请求体（使用运营商配置）
  const body = this.buildBody(transformedMessages, overrides);

  // 3. 调用 API
  const resp = await fetch(this.endpoint, { ... });

  return result;
}
```

#### 火山引擎工厂 + 识图工厂处理流程

```javascript
// VolcengineLLMClient.js
async chat(messages, overrides = {}) {
  // 1. 转换 messages，处理图片
  const transformedMessages = await this.transformMessages(messages);

  // transformMessages 内部会：
  // - 检测 user message 中的 images / replyImages
  // - 基于 aistream.vision.Provider 选择 VisionFactory 提供商（如 VolcengineVision）
  // - 调用识图工厂把每张图转成描述文本
  // - 按 "[图片:描述]" / "[回复图片:描述]" 的格式拼回到文本中

  // 2. 构建请求体（使用运营商配置）
  const body = this.buildBody(transformedMessages, { ...overrides });

  // 3. 调用 API
  const resp = await fetch(this.endpoint, { ... });

  return result;
}
```

## 配置说明

### 运营商配置（仅工厂读取）

工厂从 `config/default_config/aistream.yaml` 以及各自的 LLM/识图配置文件中读取配置：

```yaml
llm:
  Provider: gptgod

vision:
  Provider: gptgod

# 文本 LLM 工厂配置（举例：data/server_bots/{port}/god.yaml）
baseUrl: https://api.gptgod.online/v1
apiKey: "..."
chatModel: gemini-exp-1114

# 识图工厂配置（举例：data/server_bots/{port}/god_vision.yaml）
baseUrl: https://api.gptgod.online/v1
apiKey: "..."
fileUploadUrl: https://api.gptgod.online/v1/files
visionModel: glm-4-alltools
```

**重要：** 
- 只有工厂类读取这些配置
- 插件和工作流不应直接读取运营商配置
- 插件只需构建 messages，工厂会自动应用配置

## 上下文增强（RAG流程）

工作流的 `buildEnhancedContext` 方法实现了完整的RAG（检索增强生成）流程：

### 执行流程

```javascript
async buildEnhancedContext(e, question, baseMessages) {
  // 1. 提取查询文本
  const query = this.extractQuestionText(question);
  
  // 2. 检索历史对话上下文（如果启用Embedding）
  const historyContexts = this.embeddingConfig.enabled && this.embeddingReady
    ? await this.retrieveRelevantContexts(groupId, query)
    : [];
  
  // 3. 检索知识库上下文（如果合并了database stream）
  const knowledgeContexts = await this.retrieveKnowledgeContexts(query);
  
  // 4. 合并所有上下文
  const allContexts = [
    ...historyContexts.map(ctx => ({ type: 'history', ...ctx })),
    ...knowledgeContexts.map(ctx => ({ type: 'knowledge', ...ctx }))
  ];
  
  // 5. 使用注意力机制优化上下文选择
  const optimizedContexts = await this.optimizeContextsWithAttention(
    allContexts, 
    query, 
    maxTokens
  );
  
  // 6. 构建上下文提示词，附加到 baseMessages 开头
  if (optimizedContexts.length > 0) {
    const contextPrompt = this.buildContextPrompt(optimizedContexts);
    baseMessages.unshift({
      role: 'system',
      content: contextPrompt
    });
  }
  
  return baseMessages;
}
```

### 上下文检索机制

1. **历史对话检索**：
   - 使用Embedding相似度检索（本地BM25或远程向量相似度）
   - 支持时间衰减、关键词增强、长度惩罚等多因素评分
   - 使用注意力机制优化上下文选择

2. **知识库检索**：
   - 自动检查是否有合并的 `database` stream
   - 如果存在，调用 `database.retrieveKnowledgeContexts(query)`
   - 返回相关知识库内容

3. **上下文优化**：
   - 使用注意力机制计算上下文重要性
   - 按Token限制选择最优上下文组合
   - 自动压缩过长文本

## 示例：完整调用链

```javascript
// 1. 插件监听事件
async handleMessage(e) {
  const chatStream = StreamLoader.getStream('chat');
  
  if (await this.shouldTriggerAI(e)) {
    const questionData = await this.processMessageContent(e, chatStream);
    const question = questionData.text || e.msg;
    
    // 2. 调用工作流（工作流会自动处理历史、上下文增强、函数执行等）
    const result = await chatStream.process(e, question, {
      enableMemory: true,
      enableDatabase: true
    });
    
    // 注意：工作流内部已经发送了回复，插件不需要再次发送
    // 如果工作流返回了结果，可以用于日志记录等
  }
}

// 工作流内部构建的 messages（通过 buildChatContext + buildEnhancedContext）：
[
  {
    role: 'system',
    content: '【人设设定】\n我是AI助手...\n\n【相关历史对话】\n1. 用户: 你好 (相关度: 85%)\n\n【相关知识库】\n1. [知识库] 相关信息...'
  },
  {
    role: 'user',
    content: {
      text: '[当前消息]\n用户(123456): 你好',
      images: ['https://example.com/image.jpg'],
      replyImages: []
    }
  }
]

// 工厂处理后（GPTGod）：
[
  { role: 'system', content: '...' },
  { role: 'user', content: '[群聊记录]\n...\n[当前消息]\n用户(123456): 你好 [图片:这是一张图片的描述]' }
]

// 工厂处理后（火山引擎）：
[
  { role: 'system', content: '...' },
  { role: 'user', content: '[群聊记录]\n...' },
  {
    role: 'user',
    content: [
      { type: 'text', text: '[当前消息]\n用户(123456): 你好' },
      { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
    ]
  }
]
```

## 注意事项

1. **图片处理差异：**
   - GPTGod：需要上传图片到服务器，然后识图，将描述合并到文本
   - 火山引擎：直接使用图片 URL，使用 vision 模型

2. **消息历史：**
   - 工作流通过 `buildChatContext` 构建基础消息
   - 工作流通过 `buildEnhancedContext` 自动检索历史对话（使用Embedding相似度）
   - 历史消息存储在Redis中（key: `ai:memory:{streamName}:{groupId}`）
   - 工作流通过 `storeMessageWithEmbedding` 存储新消息

3. **人设传递：**
   - 人设在插件中传入到 system prompt
   - 工厂不需要关心人设内容

4. **配置隔离：**
   - 插件和工作流不读取运营商配置
   - 只有工厂读取和应用配置
