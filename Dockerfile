FROM node:24.12-alpine

RUN apk add --no-cache \
    python3 \
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

# 设置Puppeteer环境变量
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# 安装依赖（利用Docker层缓存）
RUN pnpm install --frozen-lockfile || pnpm install

# 复制源代码
COPY . .

# 创建必要的目录
RUN mkdir -p \
    logs \
    data \
    data/bots \
    data/backups \
    data/server_bots \
    data/configs \
    data/uploads \
    data/media \
    config \
    config/default_config \
    config/server_config \
    resources \
    www \
    trash

ENV NODE_ENV=production \
    NODE_OPTIONS="--no-warnings --no-deprecation"

# 创建非 root 用户（安全建议）
# 注意：使用 volume 挂载时，确保宿主机目录权限允许容器用户访问
RUN addgroup -g 1000 xrk && \
    adduser -D -u 1000 -G xrk xrk && \
    chown -R xrk:xrk /app

# 切换到非 root 用户
USER xrk

# 暴露常用端口（实际使用端口由环境变量 XRK_SERVER_PORT 控制）
EXPOSE 80 443 8080 3000 5000

# 健康检查（端口由运行时环境变量决定，entrypoint脚本会处理）
# 注意：HEALTHCHECK在构建时无法使用环境变量，需要在运行时通过entrypoint脚本处理
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD sh -c "wget --no-verbose --tries=1 --spider http://localhost:${XRK_SERVER_PORT:-8080}/health || exit 1"

# 使用entrypoint脚本支持动态端口
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
# 默认以 server 模式启动，具体端口由 XRK_SERVER_PORT 或入口脚本决定
CMD ["server"]
