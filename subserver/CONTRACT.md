# 子服务 HTTP 契约（各 runtime 必须实现）

主服务通过 `Bot.callSubserver(path, { runtime })` 调用；**LLM 仅在主服务 Node 侧**。

## 系统路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/list` | 已装载插件列表 |
| GET | `/api/system/ping` | 存活 |
| GET | `/api/system/config` | 只读配置 |
| GET | `/api/system/commonconfig/list` | 已注册插件 CommonConfig 列表（供主服控制台） |
| GET | `/api/system/groups` | 插件组与命令 |
| POST | `/api/system/command` | body: `{ "line": "<组> <命令> [args...]" }` |

## 插件路由（每个 `apis/<group>/` 自动挂载）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/{group}/health` | 组健康 + 命令列表 |
| POST | `/api/{group}/command` | body: `{ "cmd": "update" }` 或 `{ "line": "..." }` |
| GET | `/api/{group}/config/structure` | CommonConfig schema（声明 `plugin_config` 时自动挂载） |
| GET | `/api/{group}/config/read` | 读取运行时配置 |
| POST | `/api/{group}/config/write` | 写入运行时配置 |
| * | `/api/{group}/...` | 业务路由 |

## 目录分工

| 路径 | 用途 |
|------|------|
| `core/`（runtime 根） | 加载器、配置、命令注册 — **子服底层** |
| `apis/system/` 或 `Web/SystemEndpoints` | 框架系统路由 |
| `apis/<group>/` | 业务插件（Python/Go/… 的 `service` 入口） |
| `apis/<group>/core/` | **主服扩展**（`plugin/`、`http/` 等；**不含**业务 commonconfig） |

主服扫描 `subserver/<runtime>/apis/<group>/core/{plugin,http,stream,tasker,events}`。业务配置：`config_schema.yaml` + `plugin_config`，经 HTTP 供主服控制台代理（[docs/subserver-commonconfig.md](../docs/subserver-commonconfig.md)）。子服 host/port 在 `aistream.yaml` → `cfg.subserver`。

新建插件：复制 pyserver 示例（**完整融合**见本地 `jmcomic`；**HTTP+控制台**见 `media-tools`）。开发指南：[docs/subserver-plugin-development.md](../docs/subserver-plugin-development.md)。

> **CommonConfig 路由**：`/api/system/commonconfig/list` 与 `/api/{group}/config/*` 当前 **仅 pyserver 实现**；其它 runtime 须先对齐 [`CONTRACT.md`](CONTRACT.md) 后再被主服控制台代理。

## 插件元数据（对齐 pyserver `default` 字典）

```yaml
name: string
description: string
group: string          # 必填，URL 前缀
plugin_dir: string     # 用于 update（pip/go mod/mvn/composer）
priority: int
commands:              # 终端/QQ 子命令
  status: handler
  # update、help 由框架提供
routes:                # HTTP 业务
  - method: POST
    path: /api/{group}/action
    handler: ...
init: optional
plugin_config: optional  # PluginConfig → 自动 /config/* 与 commonconfig/list
on_update: optional
```

## update 命令默认行为

1. 存在 `requirements.txt` → pip install -U
2. 存在 `go.mod` → go mod download
3. 存在 `pom.xml` → mvn dependency:resolve
4. 存在 `composer.json` → composer install
5. 存在 `.git` → git pull（部分 runtime）
