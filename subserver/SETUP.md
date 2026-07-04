# 子服务端环境准备与测试

> 注册表：[`registry.yaml`](registry.yaml) · 契约：[`CONTRACT.md`](CONTRACT.md)

## 快速测试

### 1. Python 子服（本机）

```powershell
cd subserver/pyserver
uv sync
uv run xrk
```

默认 `http://127.0.0.1:8000`。

### 2. 六 runtime（Docker）

**先启动 Docker Desktop**，仓库根目录：

```powershell
pnpm docker:fresh           # 从零：清镜像 + build 子服 + build 全栈
pnpm docker:subservers
pnpm test:subservers
```

首次会本机下载 pyserver Linux wheel；py build 仅 COPY，依赖在容器启动时装。

端口：8000 Python · 8001 Go · 8002 PHP · 8003 Java · 8004 .NET · 8005 Rust

停止：`pnpm docker:subservers:down`

### 3. 完整栈（主 Bot + Redis + Mongo + 全部子服）

```powershell
pnpm docker:fresh   # 若尚未 build
pnpm docker:up
```

主服默认 `http://127.0.0.1:8080`（`XRK_SERVER_PORT` 可改）。

### 4. 环境自检与冒烟

```powershell
pnpm subservers:check
pnpm test:subservers
# 只测部分 runtime
node scripts/test-subservers.mjs --runtime goserver,jserver
```

主服控制台：**AIStream → 子服务端**，各 runtime 默认 `127.0.0.1` + 上表端口。

---

## 本机工具（可选）

| Runtime | 端口 | 本机依赖 | 启动命令 |
|---------|------|----------|----------|
| pyserver | 8000 | Python 3.12+、[uv](https://docs.astral.sh/uv/) | `cd subserver/pyserver && uv run xrk` |
| goserver | 8001 | Go 1.23+ | `cd subserver/goserver && go run .` |
| phpserver | 8002 | PHP 8.2+ | `cd subserver/phpserver && php run.php` |
| jserver | 8003 | JDK 21+、Maven 3.9+ | `cd subserver/jserver && mvn -q spring-boot:run` |
| netserver | 8004 | .NET SDK 8+ | `cd subserver/netserver && dotnet run` |
| rustserver | 8005 | Rust stable | `cd subserver/rustserver && cargo run` |

未安装某语言时，用 **Docker** 即可。

---

## Compose 文件

| 文件 | 用途 |
|------|------|
| `docker-compose.subservers.yml` | 仅六语言子服（8000–8005），联调/冒烟 |
| `docker-compose.yml` | 完整栈：主 Bot + Redis + Mongo + 全部子服 |

---

## 代理（可选，仅本机）

**仓库内不预设任何代理地址。** 直连网络足够时无需配置。

需要代理拉镜像或容器出网时，在**本机**创建 `config/docker.env`（已在 `.gitignore`，勿提交）：

```bash
# 构建阶段（buildkit 在 Docker VM 内，宿主机代理须用 host.docker.internal）
BUILD_HTTP_PROXY=http://host.docker.internal:<你的代理端口>
BUILD_HTTPS_PROXY=http://host.docker.internal:<你的代理端口>
BUILD_NO_PROXY=localhost,127.0.0.1,host.docker.internal

# 容器运行时出网
CONTAINER_HTTP_PROXY=http://host.docker.internal:<你的代理端口>
CONTAINER_HTTPS_PROXY=http://host.docker.internal:<你的代理端口>
CONTAINER_NO_PROXY=localhost,127.0.0.1,host.docker.internal
```

使用：

```powershell
docker compose -f docker-compose.subservers.yml --env-file config/docker.env up -d --build
# 完整栈
docker compose --env-file config/docker.env up -d --build
```

本机 shell / `uv pip` 等：在终端自行 `set HTTP_PROXY=http://127.0.0.1:<端口>`，**不要**写进仓库配置文件。

踩坑见 **[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)**。

---

## 主服调用示例

```javascript
await Bot.callSubserver('/api/hash-tools/sha256', {
  runtime: 'goserver',
  method: 'POST',
  body: { text: 'hello' }
});
```

确保 `aistream.yaml` → `subserver.runtimes.<id>.host/port` 与实际上线地址一致。

---

## 常见问题

**端口被占用** — 改 compose 端口映射，并同步主服 `cfg.subserver`。

**pyserver 插件依赖** — `uv pip install -r apis/<group>/requirements.txt`。

**Docker 拉镜像 403** — 检查 `%USERPROFILE%\.docker\daemon.json` 的 `registry-mirrors`，移除失效源后重启 Docker Desktop。

**jserver 首次启动慢** — Maven 下载依赖；Docker 首次 build 同理。
