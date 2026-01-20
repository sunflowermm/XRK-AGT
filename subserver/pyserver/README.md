# XRK-AGT Python 子服务端

基于 FastAPI 的高性能独立服务。

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

## 🔧 配置

编辑 `config.yaml` 或使用环境变量：

```bash
HOST=0.0.0.0 PORT=8000 RELOAD=true uv run xrk
```

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
