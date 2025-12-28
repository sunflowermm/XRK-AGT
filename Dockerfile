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
  && npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

RUN pnpm install --frozen-lockfile || pnpm install

COPY . .

RUN mkdir -p logs data data/bots data/backups config config/default_config data/server_bots resources www

ENV NODE_ENV=production \
    NODE_OPTIONS="--no-warnings --no-deprecation"

EXPOSE 2537 2538 80 443

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:2537/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["node", "--no-warnings", "--no-deprecation", "app.js"]
