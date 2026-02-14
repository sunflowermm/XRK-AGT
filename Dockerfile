# ============================================
# 构建阶段 - 包含所有构建工具
# ============================================
FROM node:24.13-slim AS builder

# 安装构建依赖（仅在构建阶段需要，带重试机制和超时设置）
RUN apt-get clean && \
    for i in 1 2 3 4; do \
        apt-get update -o Acquire::http::Timeout=30 -o Acquire::ftp::Timeout=30 && \
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
            python3 \
            python3-dev \
            python3-venv \
            python3-pip \
            build-essential \
            git \
            wget \
            curl \
        && break || (echo "尝试 $i/4 失败，5秒后重试..." && sleep 5); \
    done && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean

# 安装 pnpm
RUN npm install -g npm@latest pnpm

# 安装 uv（带重试机制和超时设置）
RUN for i in 1 2 3; do \
        curl --connect-timeout 10 --max-time 60 -LsSf https://astral.sh/uv/install.sh | sh && break || sleep 3; \
    done && \
    (mv /root/.cargo/bin/uv /usr/local/bin/uv 2>/dev/null || \
     mv /root/.local/bin/uv /usr/local/bin/uv 2>/dev/null || true) || \
    pip3 install --no-cache-dir uv && \
    rm -rf /root/.cargo /root/.local

WORKDIR /app

# 复制依赖文件
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    npm_config_build_from_source=false

# 安装 Node.js 依赖
RUN pnpm install --frozen-lockfile || pnpm install

# 复制源代码
COPY . .

# 安装 Python 子服务端依赖
WORKDIR /app/subserver/pyserver
RUN if command -v /usr/local/bin/uv >/dev/null 2>&1; then \
        /usr/local/bin/uv venv .venv && \
        /usr/local/bin/uv pip install --no-cache fastapi "uvicorn[standard]" httpx pyyaml sentence-transformers chromadb langchain langchain-openai langgraph; \
    else \
        python3 -m venv .venv && \
        .venv/bin/pip install --no-cache-dir fastapi "uvicorn[standard]" httpx pyyaml sentence-transformers chromadb langchain langchain-openai langgraph && \
        .venv/bin/pip cache purge; \
    fi && \
    find .venv -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true && \
    find .venv -type f \( -name "*.pyc" -o -name "*.pyo" \) -delete 2>/dev/null || true

WORKDIR /app

# ============================================
# 运行阶段 - 仅包含运行时依赖
# ============================================
FROM node:24.13-slim AS runtime

# 安装运行时依赖（移除构建工具，带重试机制和超时设置）
RUN apt-get clean && \
    for i in 1 2 3 4; do \
        apt-get update -o Acquire::http::Timeout=30 -o Acquire::ftp::Timeout=30 && \
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
            python3 \
            python3-venv \
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
        && break || (echo "尝试 $i/4 失败，5秒后重试..." && sleep 5); \
    done && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean && \
    rm -rf /tmp/* /var/tmp/*

# 安装 uv（仅运行时需要，使用更轻量的方式）
RUN curl --connect-timeout 10 --max-time 60 -LsSf https://astral.sh/uv/install.sh | sh && \
    (mv /root/.cargo/bin/uv /usr/local/bin/uv 2>/dev/null || \
     mv /root/.local/bin/uv /usr/local/bin/uv 2>/dev/null || true) || \
    (pip3 install --no-cache-dir uv && pip3 cache purge) || true && \
    rm -rf /root/.cargo /root/.local

WORKDIR /app

# 从构建阶段复制已安装的依赖
COPY --from=builder --chown=10000:10000 /app/node_modules ./node_modules
COPY --from=builder --chown=10000:10000 /app/package.json ./package.json
COPY --from=builder --chown=10000:10000 /app/pnpm-lock.yaml* ./
COPY --from=builder --chown=10000:10000 /app/pnpm-workspace.yaml* ./

# 复制源代码（排除 node_modules，已从构建阶段复制）
COPY --chown=10000:10000 . .

# 从构建阶段复制 Python 虚拟环境
COPY --from=builder --chown=10000:10000 /app/subserver/pyserver/.venv /app/subserver/pyserver/.venv

# 创建必要的目录并清理不必要的文件
RUN mkdir -p \
    logs data data/bots data/backups data/server_bots data/configs \
    data/uploads data/media data/subserver \
    config config/default_config config/server_config \
    resources www trash && \
    find . \( \
        -type d \( -name ".git" -o -name "__pycache__" -o -name ".pytest_cache" -o -name ".mypy_cache" \) -o \
        -type f \( -name "*.pyc" -o -name "*.pyo" -o -name "*.log" -o -name ".DS_Store" -o -name "Thumbs.db" \) \
    \) -delete 2>/dev/null || true

ENV NODE_ENV=production \
    NODE_OPTIONS="--no-warnings --no-deprecation" \
    HF_HOME=/app/data/subserver/model_cache \
    HF_HUB_CACHE=/app/data/subserver/model_cache

# 创建非 root 用户并设置权限
RUN groupadd -g 10000 xrk && \
    useradd -u 10000 -g xrk -m -s /bin/bash xrk && \
    sed -i 's/\r$//' /app/docker-entrypoint.sh && \
    chmod +x /app/docker-entrypoint.sh && \
    chown -R xrk:xrk /app

# 切换到非 root 用户
USER xrk

EXPOSE 80 443 8080 3000 5000 8000

ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
CMD ["server"]
