# 子服务端 API 文档

> **文件位置**：`subserver/pyserver/`  
> **说明**：XRK-AGT Python 子服务端当前仅保留底层系统接口与扩展装载框架。  
> **底层基线**：主/子服务端职责边界以 **[底层架构设计](底层架构设计.md)** 为准。

子服务端当前提供：
- **基础健康接口**：`GET /health`
- **系统接口**：`GET /api/system/ping`、`GET /api/system/config`
- **API 自动装载**：`apis/<group>/*.py`（通过 `default` 元数据注册路由）

---

## 📚 目录

- [架构设计](#架构设计)
- [现有 API](#现有-api)
- [扩展开发](#扩展开发)
- [配置](#配置)
- [依赖安装与运行](#依赖安装与运行推荐使用-uv)
- [相关文档](#相关文档)

---

## 架构设计

```
主服务端 (Node.js)
    ↓ 可选 HTTP 调用
子服务端 (Python FastAPI)
    ├─ /health
    ├─ /api/system/ping
    ├─ /api/system/config
    └─ apis/<group>/*.py 自动装载的扩展接口
```

> 历史上的 AI 业务接口已下线，不再属于当前子服务端官方能力。

## 现有 API

### GET /health

服务健康检查，返回 FastAPI 服务在线状态。

### GET /api/system/ping

返回底层服务存活信息。

**示例响应**：
```json
{
  "ok": true,
  "service": "subserver-core"
}
```

### GET /api/system/config

返回子服务端当前生效的基础配置（只读视图）。

**示例响应**：
```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 8000,
    "reload": false
  },
  "api": {
    "prefix": "/api",
    "title": "XRK-AGT Python Subserver",
    "version": "1.0.0"
  }
}
```

## 扩展开发

子服务端通过 `ApiLoader` 自动加载 `apis/` 目录下的模块。每个模块导出 `default` 元数据。

最小示例：
```python
from fastapi import Request

async def hello(_request: Request):
    return {"ok": True, "message": "hello"}

default = {
    "name": "demo-api",
    "description": "示例 API",
    "priority": 100,
    "routes": [
        {"method": "GET", "path": "/api/demo/hello", "handler": hello},
    ],
}
```

建议约定：
- 按业务分组目录：`apis/<group>/xxx.py`
- 在扩展层实现业务逻辑，不改动 `core/` 与加载器底层
- 接口前缀统一走 `/api/*`

## 配置

### 配置文件位置

- **默认配置**：`subserver/pyserver/config/default_config.yaml`（模板）
- **用户配置**：`data/subserver/config.yaml`（运行时）

### 当前配置结构（精简版）

```yaml
server:
  host: "0.0.0.0"
  port: 8000
  reload: false
  log_level: "info"

cors:
  origins: ["*"]

api:
  prefix: "/api"
  title: "XRK-AGT Python Subserver"
  version: "1.0.0"

logging:
  level: "info"
  file: "logs/subserver.log"
  max_bytes: 10485760
  backup_count: 5
```

## 依赖安装与运行（推荐使用 uv）

```bash
cd subserver/pyserver
uv sync
uv run xrk
```

按需覆盖启动参数：
```bash
HOST=0.0.0.0 PORT=8000 RELOAD=true uv run xrk
```

## 相关文档

- **[AIStream 文档](aistream.md)** - Node 侧工作流与 LLM/MCP 调用说明
- **[Docker 部署指南](docker.md)** - 容器化部署说明
- **[框架可扩展性指南](框架可扩展性指南.md)** - 扩展开发完整指南

---

*最后更新：2026-04-26*
