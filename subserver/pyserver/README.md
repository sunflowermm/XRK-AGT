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
子服> 帮助              # 插件与命令（Tab 补全 · ↑↓ 历史）
子服> 列表
子服> 更新              # 全部 apis/* git pull + pip
子服> jmcomic 更新
子服> 清屏
子服> 退出
```

与主服 `>` 相同：readline 编辑、历史记录在 `data/subserver/stdin_history`。

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

> **完整指南**：[docs/subserver-plugin-development.md](../../docs/subserver-plugin-development.md)

### 标准结构（与主仓 Core 对齐）

```
apis/my-tools/
  service.py
  default_config.yaml
  core/
    commonconfig/my-tools.js   # 主服控制台 ConfigBase
    plugin/                    # 可选 QQ 插件
```

```python
config = load_plugin_config(_PLUGIN_DIR, "my-tools")

default = {
    "group": "my-tools",
    "plugin_dir": str(_PLUGIN_DIR),
    "routes": [...],
}
```

参考：`apis/media-tools/`、`apis/jmcomic/`（本地）。
