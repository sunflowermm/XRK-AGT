FROM node:18-alpine

# 安装系统依赖 + Chromium + 基本字体（Puppeteer运行所需）
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
  && npm install -g pnpm pm2

WORKDIR /app

# 仅复制包管理文件以利用缓存
COPY package*.json ./
COPY pnpm-lock.yaml* ./

# 禁止 Puppeteer 在安装时下载浏览器；指定系统 Chromium 路径
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# 安装依赖（若锁文件不一致则回退普通安装）
RUN pnpm install --frozen-lockfile || pnpm install

# 复制项目源码
COPY . .

# 预创建常用目录
RUN mkdir -p logs data data/bots data/backups config config/default_config data/server_bots config/pm2 resources

# 运行时环境
ENV NODE_ENV=production \
    DISABLE_CONSOLE=true \
    USE_FILE_LOG=true \
    DEBUG=false \
    NODE_OPTIONS="--no-warnings --no-deprecation"

# 暴露端口段
EXPOSE 3000-3100

# 健康检查（可按需替换为HTTP探针）
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

# 启动命令
CMD ["node", "--no-warnings", "--no-deprecation", "app.js"]