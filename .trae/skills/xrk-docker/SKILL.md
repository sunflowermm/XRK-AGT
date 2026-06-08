---
name: xrk-docker
description: 当你需要使用 Docker/Docker Compose 部署 XRK-AGT（含 Python 子服务端、Redis、MongoDB），或排查容器化环境问题时使用。
---

## 权威文档与入口

- 文档：`docs/docker.md`
- 配置：`docker-compose.yml`、`Dockerfile`
- 子服务端目录：`subserver/pyserver/`

## 你要掌握的要点

- Compose 启动的 4 个服务：`xrk-agt`（主服务）、`xrk-subserver`（Python 子服务）、`redis`、`mongodb`。
- `.env` 可选环境变量：`XRK_SERVER_PORT`、`HTTP_PROXY/HTTPS_PROXY/NO_PROXY`、`MONGO_ROOT_USERNAME/MONGO_ROOT_PASSWORD` 等。
- 子服务端为轻量 FastAPI 框架，无内置 AI 模型下载；外网访问扩展 API 时可配置 `HTTP_PROXY`（如 `host.docker.internal`）。
- 挂载卷：`./data`、`./logs`、`./config`、`./resources` 等，避免数据丢失。

## Node 26

- 镜像基线：`Dockerfile` 使用 **`node:26`**；容器内 `node -v` 应 ≥ 26.0。
- `package.json` engines 与 `app.js` 启动校验一致；**勿**在文档或示例中写 Node 24 / `node-fetch`。
- 可选：`NODE_COMPILE_CACHE` 缩短冷启动（见 `docs/node-26-runtime.md` §2.2）。

## 故障排查关键路径

- 查看服务状态：`docker-compose ps`。
- 查看日志：`docker-compose logs -f xrk-agt` / `xrk-subserver`。
- 健康检查：`curl http://localhost:8080/health`、`http://localhost:8000/health`。
- 子服务连不上主服务：检查 Compose 网络与 `MAIN_SERVER` 等环境变量（见 `docs/docker.md`）。
