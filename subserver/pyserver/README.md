# XRK-AGT Python 子服务端

基于 FastAPI 的高性能独立服务，提供 AI 生态相关能力。

## 功能特性

- **LangChain 集成**：支持 Agent 编排和 MCP 工具调用
- **向量服务**：文本向量化、向量检索和向量数据库管理
- **高性能**：异步模型加载、结果缓存、连接池优化
- **易于扩展**：模块化 API 设计，支持多组结构

## 🚀 快速开始

```bash
# 安装依赖
uv sync

# 启动服务
uv run xrk
```

## 📋 API 地址

- **API 文档**: http://localhost:8000/docs
- **健康检查**: http://localhost:8000/health
- **API 列表**: http://localhost:8000/api/list

## 🔌 主要 API

- **LangChain 服务**: `/api/langchain/chat` - LangChain聊天接口，支持MCP工具调用
- **向量服务**: `/api/vector/embed`, `/api/vector/search`, `/api/vector/upsert` - 向量化、检索、入库
- **向量健康检查**: `/api/vector/health` - 向量模型/向量库状态

## 🔗 主服务端 v3（给 LangChain 的“类 ChatGPT 协议”入口）

Python 子服务端内部会调用主服务端的 `POST /api/v3/chat/completions`（OpenAI Chat Completions 兼容）。

- **base_url**：指向主服务端 `/api/v3`
- **apiKey（访问鉴权）**：需要携带主服务端 `Bot.apiKey`（等价于 Node 侧 `BotUtil.apiKey`），用于访问 `/api/v3/chat/completions`。在子服务端配置 `main_server.api_key` 后会自动带上。
- **model 字段约定**：这里填"运营商/provider"（例如 `volcengine` / `xiaomimimo` / `openai`）
- **真实模型ID**：由主服务端 `cfg.aistream.llm.defaults/profiles` 决定（也可在请求体内用自定义字段覆写，如 `chatModel`/`model` 等，以实际工厂实现为准）
- **tool calling + MCP**：由主服务端 NodeJS LLMFactory 自动处理（会把 MCP tools 注入到厂商工具协议，并执行多轮工具调用），返回最终 `assistant.content`

## 🔧 配置

### 配置文件位置

- **默认配置**：`config/default_config.yaml`（模板文件，不应修改）
- **用户配置**：`data/subserver/config.yaml`（首次启动时自动从默认配置复制）

### 环境变量

支持通过环境变量覆盖配置：

```bash
HOST=0.0.0.0 PORT=8000 RELOAD=true uv run xrk
```

### 主要配置项

- `server.host` / `server.port`：服务监听地址和端口
- `main_server.host` / `main_server.port`：主服务端连接地址
- `vector.model`：向量化模型名称
- `vector.cache_enabled`：是否启用嵌入结果缓存
- `langchain.enabled`：是否启用 LangChain Agent

## 📝 开发 API

### 多组结构

`apis/` 目录支持多组结构，每个子目录是一个独立的 API 组：

```
apis/
  langchain/       # LangChain服务
    langchain_service.py
    agent.py
  vector/          # 向量服务
    vector_service.py
```

### 创建 API

在任意 API 组目录下创建 Python 文件：

```python
from fastapi import Request
from core.base_api import create_api_from_dict

async def handler(request: Request):
    return {"success": True}

default = {
    "name": "my-api",
    "description": "我的 API",
    "priority": 100,
    "routes": [
        {"method": "GET", "path": "/api/my", "handler": handler}
    ]
}
```
