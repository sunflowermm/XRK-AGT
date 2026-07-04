# uv 官方镜像；零 RUN（Windows BuildKit 对 RUN 易挂）；依赖 entrypoint 离线装
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_SYSTEM_PYTHON=1 \
    UV_NO_CACHE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8000

WORKDIR /workspace/subserver/pyserver

COPY .docker/requirements.txt .docker/requirements.txt
COPY .docker/wheels/ .docker/wheels/
COPY --chmod=755 docker-entrypoint.sh /entrypoint.sh
COPY . .

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
