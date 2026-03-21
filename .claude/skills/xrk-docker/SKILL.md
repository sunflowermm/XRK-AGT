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

## 权威入口

- 项目概览：`PROJECT_OVERVIEW.md`
- 代码入口：`src/` 与 `core/` 对应子目录
- 相关文档：`docs/` 下对应主题文档

## 适用场景

- 需要定位该子系统的实现路径与配置入口。
- 需要快速给出改动落点与兼容性注意事项。

## 非适用场景

- 不用于替代其他子系统的实现说明。
- 不在缺少证据时臆造路径或字段。

## 执行步骤

1. 先确认需求属于该技能的职责边界。
2. 再给出代码路径、配置路径与关键字段。
3. 最后补充风险点、验证步骤与回归范围。

## 常见陷阱

- 只给概念，不给具体文件路径。
- 文档与代码冲突时未标注以代码为准。
- 忽略配置、Schema 与消费代码的一致性。
