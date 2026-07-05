# 子服务端环境准备

> 运行时目录 [`src/utils/subserver-runtimes.js`](../src/utils/subserver-runtimes.js) · 契约 [`CONTRACT.md`](CONTRACT.md)

## Docker 全栈（推荐）

先启动 Docker Desktop，仓库根目录：

```powershell
pnpm docker:up         # 启动全栈（等待 healthcheck）
pnpm docker:status     # 确认各端口 OK
pnpm test:subservers   # 可选冒烟
```

从零重来：`pnpm docker:fresh` · 停止：`pnpm docker:down`

## 本机单 runtime

端口与启动命令以 [`src/utils/subserver-runtimes.js`](../src/utils/subserver-runtimes.js) 中 `SUBSERVER_RUNTIME_CATALOG` 为准：

| Runtime | 依赖 |
|---------|------|
| pyserver | Python 3.12+、[uv](https://docs.astral.sh/uv/) |
| goserver | Go 1.23+ |
| phpserver | PHP 8.2+ |
| jserver | JDK 21+、Maven |
| netserver | .NET SDK 8+ |
| rustserver | Rust stable（Windows 无 MSVC 时需 MinGW gcc，见 `rustserver/run.mjs`） |

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
