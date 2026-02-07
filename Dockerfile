FROM node:24.12-alpine

RUN apk add --no-cache \
    python3 \
    python3-dev \
    py3-setuptools \
    make \
    g++ \
    git \
    bash \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont \
    wget \
    curl \
  && npm install -g pnpm

WORKDIR /app

# 复制依赖文件
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# 安装依赖
RUN pnpm install --frozen-lockfile || pnpm install

# 复制源代码
COPY . .

# 创建必要的目录并设置权限
RUN mkdir -p \
    logs data data/bots data/backups data/server_bots data/configs \
    data/uploads data/media config config/default_config config/server_config \
    resources www trash

ENV NODE_ENV=production \
    NODE_OPTIONS="--no-warnings --no-deprecation"

# 创建非 root 用户并设置权限
RUN addgroup -g 10000 xrk && \
    adduser -D -u 10000 -G xrk xrk && \
    sed -i 's/\r$//' /app/docker-entrypoint.sh && \
    chmod +x /app/docker-entrypoint.sh && \
    chown -R xrk:xrk /app

# 切换到非 root 用户
USER xrk

EXPOSE 80 443 8080 3000 5000

ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
CMD ["server"]
