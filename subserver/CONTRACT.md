# 子服务 HTTP 契约（各 runtime 必须实现）

主服务通过 `Bot.callSubserver(path, { runtime })` 调用；**LLM 仅在主服务 Node 侧**。

## 系统路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/list` | 已装载插件列表 |
| GET | `/api/system/ping` | 存活 |
| GET | `/api/system/config` | 只读配置 |
| GET | `/api/system/groups` | 插件组与命令 |
| POST | `/api/system/command` | body: `{ "line": "<组> <命令> [args...]" }` |

## 插件路由（每个 `apis/<group>/` 自动挂载）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/{group}/health` | 组健康 + 命令列表 |
| POST | `/api/{group}/command` | body: `{ "cmd": "update" }` 或 `{ "line": "..." }` |
| * | `/api/{group}/...` | 业务路由 |

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
on_update: optional
```

## update 命令默认行为

1. 存在 `requirements.txt` → pip install -U
2. 存在 `go.mod` → go mod download
3. 存在 `pom.xml` → mvn dependency:resolve
4. 存在 `composer.json` → composer install
5. 存在 `.git` → git pull（部分 runtime）
