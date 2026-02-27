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
- 子服务端首次启动需要下载向量模型，强烈建议通过代理加速（host.docker.internal）。
- 挂载卷：`./data`、`./logs`、`./config`、`./resources` 等，避免数据丢失。

## 故障排查关键路径

- 查看服务状态：`docker-compose ps`。
- 查看日志：`docker-compose logs -f xrk-agt` / `xrk-subserver`。
- 健康检查：`curl http://localhost:8080/health`、`http://localhost:8000/health`。
- 模型下载问题：检查子服务容器中的代理环境变量与 HuggingFace 镜像配置。
