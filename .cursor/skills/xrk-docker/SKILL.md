---
name: xrk-docker
description: 当你需要使用 Docker/Docker Compose 部署 XRK-AGT（含 Python 子服务端、Redis、MongoDB），或排查容器化环境问题时使用。
---

## 权威文档与入口

- 文档：`docs/docker.md`
- 配置：`docker-compose.yml`、`Dockerfile`
- 子服务端目录：`subserver/pyserver/`

## 你要掌握的要点

- Compose 全栈：`xrk-agt` + `xrk-subserver`（Python）+ 五语言子服 + `redis` + `mongodb`（见 `docker-compose.yml`）。
- 命令：`pnpm docker:fresh` / `docker:build` / `docker:up` / `docker:down`（实现 `src/utils/docker-stack.mjs`）。
- 代理：本机 `config/docker.env` 或根 `.env`；构建阶段用 `host.docker.internal`。
- 挂载：`./data`、`./logs`、`./config`、`./resources`、`./core`。

## Node 26

- 镜像基线：`Dockerfile` 使用 **`node:26`**；容器内 `node -v` 应 ≥ 26.0。
- `package.json` engines 与 `app.js` 启动校验一致；**勿**在文档或示例中写 Node 24 / `node-fetch`。
- 可选：`NODE_COMPILE_CACHE` 缩短冷启动（见 `docs/node-26-runtime.md` §2.2）。

## 故障排查关键路径

- 查看服务状态：`docker-compose ps`。
- 查看日志：`docker-compose logs -f xrk-agt` / `xrk-subserver`。
- 健康检查：`curl http://localhost:8080/health`、`http://localhost:8000/health`。
- 子服务连不上主服务：检查 Compose 网络与 `MAIN_SERVER` 等环境变量（见 `docs/docker.md`）。
