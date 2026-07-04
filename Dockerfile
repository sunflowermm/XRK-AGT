# ============================================
# 构建阶段 - 包含所有构建工具
# ============================================
FROM node:26-slim AS builder

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY NO_PROXY=$NO_PROXY

RUN set -eux; \
    if [ -n "${HTTP_PROXY:-}" ]; then \
      printf 'Acquire::http::Proxy "%s";\nAcquire::https::Proxy "%s";\n' \
        "$HTTP_PROXY" "${HTTPS_PROXY:-$HTTP_PROXY}" > /etc/apt/apt.conf.d/01proxy; \
    fi; \
    apt-get update -o Acquire::http::Timeout=30 && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      python3 python3-dev python3-venv python3-pip python3-setuptools \
      build-essential git wget curl libsqlite3-dev && \
    rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    npm_config_build_from_source=false \
    PNPM_FETCH_RETRIES=5 \
    PNPM_NETWORK_CONCURRENCY=8

RUN pnpm install --frozen-lockfile || pnpm install

COPY . .

WORKDIR /app/subserver/pyserver
RUN /usr/local/bin/uv venv .venv && \
    /usr/local/bin/uv pip install --no-cache fastapi "uvicorn[standard]" pyyaml && \
    find .venv -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true && \
    find .venv -type f \( -name "*.pyc" -o -name "*.pyo" \) -delete 2>/dev/null || true

WORKDIR /app

# ============================================
# 运行阶段 - 仅包含运行时依赖
# ============================================
FROM node:26-slim AS runtime

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY NO_PROXY=$NO_PROXY

RUN set -eux; \
    if [ -n "${HTTP_PROXY:-}" ]; then \
      printf 'Acquire::http::Proxy "%s";\nAcquire::https::Proxy "%s";\n' \
        "$HTTP_PROXY" "${HTTPS_PROXY:-$HTTP_PROXY}" > /etc/apt/apt.conf.d/01proxy; \
    fi; \
    apt-get update -o Acquire::http::Timeout=30 && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      python3 python3-venv wget curl chromium chromium-sandbox fonts-liberation \
      libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 \
      libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 xdg-utils && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    groupadd -g 10000 xrk && \
    useradd -u 10000 -g xrk -m -s /bin/bash xrk

WORKDIR /app

COPY --from=builder --chown=xrk:xrk /app/node_modules ./node_modules
COPY --from=builder --chown=xrk:xrk /app/package.json ./package.json
COPY --from=builder --chown=xrk:xrk /app/pnpm-lock.yaml* ./
COPY --from=builder --chown=xrk:xrk /app/pnpm-workspace.yaml* ./
COPY --chown=xrk:xrk . .
COPY --from=builder --chown=xrk:xrk /app/subserver/pyserver/.venv ./subserver/pyserver/.venv
COPY --chown=xrk:xrk --chmod=755 docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p \
    logs data data/bots data/backups data/server_bots data/configs \
    data/uploads data/media data/subserver \
    config config/default_config config/server_config \
    resources www trash && \
    chown xrk:xrk logs data config resources www trash

ENV NODE_ENV=production \
    NODE_OPTIONS="--no-warnings --no-deprecation"

USER xrk

EXPOSE 8080 8000

ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
CMD ["server"]
