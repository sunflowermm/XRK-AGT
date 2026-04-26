# XRK-AGT Python 子服务端（底层版）

基于 FastAPI 的独立子服务，仅保留底层框架能力（健康检查、系统 API、可扩展装载）。

## 功能特性

- **底层可用性**：`/health`、`/api/list`、`/api/system/*`
- **模块化扩展**：自动扫描 `apis/` 目录并装载 API 组
- **轻量依赖**：仅保留 FastAPI/uvicorn/pyyaml

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

- **系统接口**：`/api/system/ping`、`/api/system/config`

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
- `api.auto_load` / `api.api_dir`：自动加载 API 目录设置

## 📝 开发 API

### 多组结构

`apis/` 目录支持多组结构，每个子目录是一个独立的 API 组：

```
apis/
  system/          # 系统底层接口
    basic_service.py
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
