# 子服联调踩坑

> [`SETUP.md`](SETUP.md)

## pyserver build 慢 / 卡住？

- **BuildKit `RUN` 在 Windows 易挂** → py Dockerfile **零 RUN**，依赖在 entrypoint 离线装。
- **缺 wheel（尤其 uvloop）** → `pnpm docker:fresh` 会重建 `.docker/wheels`。

镜像：`ghcr.io/astral-sh/uv:python3.12-bookworm-slim`。

## Docker 从零开始

```powershell
pnpm docker:clean    # 删 xrk 容器/镜像/build 缓存/py .docker
pnpm docker:fresh    # clean + 六子服 build + 全栈 build（拉 base 镜像）
pnpm docker:subservers
pnpm test:subservers
pnpm docker:up       # 全栈启动（需先 fresh 或 main-build）
```

代理：`config/docker.env` 中 `BUILD_HTTP_PROXY=http://host.docker.internal:<端口>`。
