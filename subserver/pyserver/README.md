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
- **示例 API**: http://localhost:8000/api/example/ping

## 🔧 配置

编辑 `config.yaml` 或使用环境变量：

```bash
HOST=0.0.0.0 PORT=8000 RELOAD=true uv run xrk
```

## 📝 开发 API

在 `apis/` 目录下创建文件：

```python
from fastapi import Request
from core.base_api import create_api_from_dict

async def handler(request: Request):
    return {"success": True}

default = {
    "name": "my-api",
    "routes": [{"method": "GET", "path": "/api/my", "handler": handler}]
}
```
