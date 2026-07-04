# 子服务端环境准备

> 注册表 [`registry.yaml`](registry.yaml) · 契约 [`CONTRACT.md`](CONTRACT.md)

## Docker 全栈（推荐）

先启动 Docker Desktop，仓库根目录：

```powershell
pnpm docker:fresh
pnpm test:subservers
```

| 服务 | 端口 |
|------|------|
| 主 Bot | 8080 |
| py / go / php / java / net / rust | 8000–8005 |

停止 `pnpm docker:down` · 状态 `pnpm docker:status` · 重建 `pnpm docker:build` · 启动 `pnpm docker:up`

## 本机单 runtime

| Runtime | 端口 | 依赖 | 启动 |
|---------|------|------|------|
| pyserver | 8000 | Python 3.12+、[uv](https://docs.astral.sh/uv/) | `cd subserver/pyserver && uv run xrk` |
| goserver | 8001 | Go 1.23+ | `cd subserver/goserver && go run .` |
| phpserver | 8002 | PHP 8.2+ | `cd subserver/phpserver && php run.php` |
| jserver | 8003 | JDK 21+、Maven | `cd subserver/jserver && mvn -q spring-boot:run` |
| netserver | 8004 | .NET SDK 8+ | `cd subserver/netserver && dotnet run` |
| rustserver | 8005 | Rust stable | `cd subserver/rustserver && cargo run` |

自检：`pnpm subservers:check`（本地 `tests/`，不入库）

## 代理（可选）

本机创建 `config/docker.env`（已 gitignore）：

```bash
BUILD_HTTP_PROXY=http://host.docker.internal:<端口>
BUILD_HTTPS_PROXY=http://host.docker.internal:<端口>
CONTAINER_HTTP_PROXY=http://host.docker.internal:<端口>
CONTAINER_HTTPS_PROXY=http://host.docker.internal:<端口>
```

## 常见问题

- **端口占用** — 改 compose 映射并同步主服 `cfg.subserver`
- **Docker 拉镜像 403** — 检查 `%USERPROFILE%\.docker\daemon.json` 镜像源
- **jserver 首次慢** — Maven 下载依赖

主服调用：`Bot.callSubserver('/api/...', { runtime: 'goserver', method: 'POST', body })`
