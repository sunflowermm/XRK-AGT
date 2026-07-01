FROM php:8.3-cli-alpine
RUN apk add --no-cache wget
WORKDIR /app
COPY . .
ENV PORT=8002
EXPOSE 8002
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8002/health || exit 1
CMD ["php", "-S", "0.0.0.0:8002", "server.php"]
