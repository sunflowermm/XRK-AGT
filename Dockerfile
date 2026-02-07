FROM node:24.12-slim

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-dev \
    python3-venv \
    python3-pip \
    build-essential \
    git \
    wget \
    curl \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm

# 安装 uv（带重试机制）
RUN for i in 1 2 3; do \
        curl -LsSf https://astral.sh/uv/install.sh | sh && break || sleep 2; \
    done && \
    (mv /root/.cargo/bin/uv /usr/local/bin/uv 2>/dev/null || \
     mv /root/.local/bin/uv /usr/local/bin/uv 2>/dev/null || true) || \
    pip3 install --no-cache-dir uv

WORKDIR /app

# 复制依赖文件
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    npm_config_build_from_source=false

# 安装 Node.js 依赖
RUN pnpm install --frozen-lockfile || pnpm install

# 复制所有源代码
COPY . .

# 安装 Python 子服务端依赖
WORKDIR /app/subserver/pyserver
RUN if command -v /usr/local/bin/uv >/dev/null 2>&1; then \
        /usr/local/bin/uv venv .venv && \
        /usr/local/bin/uv pip install fastapi "uvicorn[standard]" httpx pyyaml sentence-transformers chromadb langchain langchain-openai langgraph; \
    else \
        python3 -m venv .venv && \
        .venv/bin/pip install --no-cache-dir fastapi "uvicorn[standard]" httpx pyyaml sentence-transformers chromadb langchain langchain-openai langgraph; \
    fi
WORKDIR /app

# 创建必要的目录并设置权限
RUN mkdir -p \
    logs data data/bots data/backups data/server_bots data/configs \
    data/uploads data/media data/subserver \
    config config/default_config config/server_config \
    resources www trash

ENV NODE_ENV=production \
    NODE_OPTIONS="--no-warnings --no-deprecation"

# 创建非 root 用户并设置权限
RUN groupadd -g 10000 xrk && \
    useradd -u 10000 -g xrk -m -s /bin/bash xrk && \
    sed -i 's/\r$//' /app/docker-entrypoint.sh && \
    chmod +x /app/docker-entrypoint.sh && \
    chown -R xrk:xrk /app && \
    chown -R xrk:xrk /app/subserver/pyserver/.venv 2>/dev/null || true

# 切换到非 root 用户
USER xrk

EXPOSE 80 443 8080 3000 5000 8000

ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
CMD ["server"]
