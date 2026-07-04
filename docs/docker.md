# Docker 部署

> `docker-compose.yml` · `Dockerfile` · 栈管理 `src/utils/docker-stack.mjs`

![Docker Compose 服务栈](../resources/mdimg/docs/docker-compose-stack.png)

## 服务

| 服务 | 端口 | 说明 |
|------|------|------|
| `xrk-agt` | 8080 | 主 Bot（HTTP/WS/控制台） |
| `xrk-subserver` | 8000 | Python 子服（同镜像，`command: subserver`） |
| `xrk-subserver-go/php/java/net/rust` | 8001–8005 | 各语言子服 |
| `redis` | 6379（内部） | 缓存 |
| `mongodb` | 27017（内部） | 数据库（可选） |

主服通过 `SUBSERVER_*_HOST` 连接子服。镜像**不含** LLM/Whisper 等模型权重。

## 命令

```bash
pnpm docker:build    # 构建（默认本地缓存）
pnpm docker:up       # 启动全栈（构建完成后执行）
pnpm docker:status   # 容器状态 + HTTP 健康探测
pnpm docker:down     # 停止
pnpm docker:clean    # 删除全部容器/镜像/缓存
pnpm docker:fresh    # clean + --pull 构建 + 启动（从零重来）
node src/utils/docker-stack.mjs build --pull   # 强制拉 base 镜像
```

### 构建成功后

```bash
pnpm docker:up
pnpm docker:status
pnpm test:subservers    # 可选：子服 8000–8005 冒烟
```

浏览器打开 `http://127.0.0.1:8080`（Web 控制台 `/xrk/`）。日志：`docker compose logs -f xrk-agt`。

子服冒烟（本地 `tests/`，不入库）：`pnpm test:subservers`

## 环境变量

根目录 `.env` 或 `config/docker.env`（后者已在 `.gitignore`）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `XRK_SERVER_PORT` | 8080 | 主服端口 |
| `HTTP_PROXY` / `HTTPS_PROXY` | 空 | 容器出网（LLM API 等） |
| `BUILD_HTTP_PROXY` | 空 | 构建阶段代理（Docker VM 内用 `host.docker.internal`） |
| `MONGO_ROOT_USERNAME/PASSWORD` | 空 | Mongo 认证 |

## 持久化卷

`./data` · `./logs` · `./config` · `./resources` · `./core`

Docker 内 Redis/Mongo 地址自动从 `127.0.0.1` 映射为服务名。

## 故障排查

- **Docker 未运行** — 先启动 Docker Desktop。
- **端口占用** — 改 `XRK_SERVER_PORT` 或 compose 端口映射。
- **构建慢 / auth.docker.io 超时** — 检查代理、`config/docker.env`、镜像源；日常用 `docker:build`（本地缓存），仅 `docker:fresh` 或 `build --pull` 强制拉 base。
- **健康检查失败** — `pnpm docker:status` 或 `docker compose logs <服务名>`。主服会等 redis/mongo/全部子服 healthy 后再启动。

子服联调细节见 [subserver/SETUP.md](../subserver/SETUP.md)。

---

*最后更新：2026-07-04*
