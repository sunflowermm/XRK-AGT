# XRK-AGT Python 子服务端（底层版）

基于 FastAPI 的独立子服务，仅保留底层框架能力（健康检查、系统 API、可扩展装载）。

## 功能特性

- **底层可用性**：`/health`、`/api/list`、`/api/system/*`
- **模块化扩展**：自动扫描 `apis/` 目录并装载 API 组
- **轻量依赖**：仅保留 FastAPI/uvicorn/pyyaml

## 🚀 快速开始

```bash
cd subserver/pyserver
uv sync
uv run xrk              # 或 uv run python main.py
```

## 📋 API 地址

- **API 文档**: http://localhost:8000/docs
- **健康检查**: http://localhost:8000/health
- **API 列表**: http://localhost:8000/api/list

## 🔌 主要 API

- **系统接口**：`/api/system/ping`、`/api/system/config`、`/api/system/groups`、`POST /api/system/command`
- **业务插件**（按需安装，见各 `apis/<组名>/`）：
  - `media-tools` — 图片缩放/转换
  - `doc-pipeline` — HTML 提取 / Markdown
  - `web-fetch` — 网页抓取缓存

## ⌨️ 终端命令（标准输入）

交互式启动且 `server.stdin.enabled: true` 时出现 `子服>` 提示符（与主服 `>` 分离，日志照常输出）。

```text
子服> 帮助
子服> media-tools 状态
子服> 退出
```

第三方插件按各自 README 在子服终端操作。

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

## 📝 开发插件

### 目录分工（对齐主仓 system-Core）

| 路径 | 用途 |
|------|------|
| `core/` | 加载器、配置、`plugin_kit` 等**底层** |
| `apis/system/` | 框架系统 API（`/api/system/*`） |
| `apis/<组名>/` | **示例或业务插件**，每组一个目录 |

勿在 `core/` 写业务；新建插件对照现有示例改组名与路由。

### 参考示例

完整写法见 **`apis/media-tools/service.py`**（`default` 字典、`commands`、`routes`、`load_plugin_config`）。

最小结构：

```
apis/my-tools/
  service.py
  default_config.yaml   # 可选
  requirements.txt      # 可选，需单独 uv pip install
```

```python
from pathlib import Path
from fastapi import Request

_PLUGIN_DIR = Path(__file__).resolve().parent

async def cmd_status(_request, _args):
    return {"service": "my-tools", "ready": True}

async def hello_handler(_request: Request):
    return {"ok": True}

default = {
    "name": "my-tools",
    "description": "我的插件",
    "group": "my-tools",
    "plugin_dir": str(_PLUGIN_DIR),
    "priority": 100,
    "commands": {"status": cmd_status},
    "routes": [
        {"method": "GET", "path": "/api/my-tools/hello", "handler": hello_handler},
    ],
}
```

Loader 自动扫描 `apis/` 并装载；插件作者只需 export `default`，无需调用 `create_api_from_dict`。
