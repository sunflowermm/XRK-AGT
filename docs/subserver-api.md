# 子服务端API文档

## 概述

XRK-AGT Python子服务端提供AI生态相关的服务，包括：
- **LangChain集成**：通过主服务v1接口实现，支持MCP工具调用
- **向量服务**：文本向量化、向量检索、向量数据库管理
- **工具服务**：代码执行、数据分析、网络爬虫、文件处理
- **模型服务**：模型推理、模型管理
- **评估服务**：模型评估、对比、基准测试
- **数据管道**：数据预处理、分块、质量评估

## 架构设计

```
主服务端 (Node.js)
    ↓ HTTP调用
子服务端 (Python FastAPI)
    ├─ LangChain服务 → 调用主服务端 /api/v1/chat/completions
    ├─ 向量服务 → ChromaDB + SentenceTransformers
    ├─ 工具服务 → 专业工具集合
    └─ 其他服务
```

## LangChain服务

### POST /api/langchain/chat

LangChain聊天接口，使用主服务v1接口作为LLM provider，支持MCP工具调用。

**请求参数**：
```json
{
  "messages": [
    {"role": "user", "content": "你好"}
  ],
  "model": "gpt-3.5-turbo",
  "temperature": 0.8,
  "max_tokens": 2000,
  "stream": false,
  "provider": "gptgod",
  "use_tools": true
}
```

**响应格式**（非流式）：
```json
{
  "choices": [
    {
      "message": {
        "content": "你好！"
      }
    }
  ],
  "usage": {
    "total_tokens": 10
  },
  "model": "gpt-3.5-turbo",
  "tools": [...]
}
```

**流式响应**：返回SSE格式的流式数据。

### GET /api/langchain/models

获取可用模型列表，从主服务获取。

### GET /api/langchain/tools

获取MCP工具列表。

### POST /api/langchain/tools/call

调用MCP工具。

**请求参数**：
```json
{
  "name": "tool.name",
  "arguments": {}
}
```

## 向量服务

### POST /api/vector/embed

文本向量化接口。

**请求参数**：
```json
{
  "texts": ["文本1", "文本2"]
}
```

**响应格式**：
```json
{
  "success": true,
  "embeddings": [
    {
      "text": "文本1",
      "embedding": [0.1, 0.2, ...],
      "dimension": 384
    }
  ],
  "count": 2
}
```

**技术实现**：
- 使用 `sentence-transformers` 库
- 模型：`paraphrase-multilingual-MiniLM-L12-v2`
- 支持多语言文本向量化

### POST /api/vector/search

向量检索接口。

**请求参数**：
```json
{
  "query": "查询文本",
  "collection": "memory_group123",
  "top_k": 5
}
```

**响应格式**：
```json
{
  "success": true,
  "results": [
    {
      "id": "doc_1",
      "text": "相关文本",
      "score": 0.95,
      "metadata": {}
    }
  ],
  "count": 1
}
```

**技术实现**：
- 使用 `ChromaDB` 作为向量数据库
- 支持集合（collection）管理
- 返回相似度分数（0-1）

### POST /api/vector/upsert

向量入库接口。

**请求参数**：
```json
{
  "collection": "memory_group123",
  "documents": [
    {
      "text": "文本内容",
      "id": "doc_1",
      "metadata": {}
    }
  ]
}
```

**响应格式**：
```json
{
  "success": true,
  "collection": "memory_group123",
  "inserted": 1
}
```

## 调用流程

### 主服务端调用子服务端

主服务端通过 `Bot.callSubserver(path, options)` 统一调用子服务端：

```javascript
// 向量化
const result = await Bot.callSubserver('/api/vector/embed', {
  body: { texts: [text] }
});

// LangChain聊天
const response = await Bot.callSubserver('/api/langchain/chat', {
  body: payload,
  rawResponse: true  // 流式响应
});

// 向量检索
const result = await Bot.callSubserver('/api/vector/search', {
  body: { query, collection, top_k: 5 }
});
```

### 子服务端调用主服务端

子服务端通过HTTP调用主服务端：

```python
# 调用主服务v1接口
v1_url = f"{main_server_url}/api/v1/chat/completions"
response = await client.post(v1_url, json=payload)

# 获取MCP工具
mcp_url = f"{main_server_url}/api/mcp/tools"
response = await client.get(mcp_url)
```

## 配置

子服务端配置系统参考主服务端设计，支持默认配置和用户配置分离：

### 配置文件位置

- **默认配置**：`subserver/pyserver/config/default_config.yaml`（模板文件，不应修改）
- **用户配置**：`data/subserver/config.yaml`（首次启动时自动从默认配置复制）

### 配置加载流程

1. 优先从 `data/subserver/config.yaml` 读取（用户配置）
2. 如果不存在，从 `config/default_config.yaml` 复制并创建
3. 如果默认配置也不存在，使用内置默认配置

### 配置示例

```yaml
# 服务器配置
server:
  host: "0.0.0.0"
  port: 8000
  reload: false
  log_level: "info"

# 主服务端连接配置
main_server:
  host: "127.0.0.1"
  port: 1234        # 主服务端端口
  timeout: 300      # 请求超时时间（秒）

# CORS 配置
cors:
  origins: ["*"]

# LangChain 服务配置
langchain:
  enabled: true
  max_steps: 6
  verbose: false

# 向量服务配置
vector:
  model: "paraphrase-multilingual-MiniLM-L12-v2"
  dimension: 384
  persist_dir: "data/subserver/vector_db"

# 日志配置
logging:
  level: "info"
  file: "logs/app.log"
  max_bytes: 10485760
  backup_count: 5
```

### 配置管理

配置类 `Config` 提供以下方法：

- `get(key, default)` - 获取配置值（支持点号分隔的嵌套键）
- `set(key, value, save=False)` - 设置配置值
- `to_dict()` - 获取完整配置字典
- `reset_to_default()` - 重置为默认配置

## 依赖安装

```bash
# 向量服务依赖
pip install sentence-transformers chromadb

# HTTP客户端
pip install httpx

# FastAPI
pip install fastapi uvicorn
```

## 错误处理

所有接口统一错误处理：
- `400`：请求参数错误
- `500`：服务器内部错误
- `502`：无法连接到主服务
- `503`：服务不可用（依赖未安装）
- `504`：调用主服务超时

## 性能优化

1. **模型单例**：嵌入模型和向量数据库客户端使用单例模式，避免重复加载
2. **延迟加载**：模型在首次使用时加载
3. **错误降级**：依赖未安装时返回友好错误信息
4. **流式响应**：支持SSE流式传输，降低延迟
