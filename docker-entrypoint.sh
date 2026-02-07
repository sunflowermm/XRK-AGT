#!/bin/sh
set -e

# XRK-AGT Docker 入口脚本
# 自动检测 Docker 环境并配置 Redis/MongoDB 连接

if [ -f /.dockerenv ] || [ -n "${DOCKER_CONTAINER:-}" ]; then
    # 自动配置 Redis 和 MongoDB 使用 Docker 服务名
    [ -f /app/data/server_bots/redis.yaml ] && \
        sed -i 's/host: "127.0.0.1"/host: "redis"/g; s/host: 127.0.0.1/host: "redis"/g' /app/data/server_bots/redis.yaml 2>/dev/null || true
    
    [ -f /app/data/server_bots/mongodb.yaml ] && \
        sed -i 's/host: "127.0.0.1"/host: "mongodb"/g; s/host: 127.0.0.1/host: "mongodb"/g' /app/data/server_bots/mongodb.yaml 2>/dev/null || true
fi

# 获取端口（环境变量优先，默认8080）
PORT=${XRK_SERVER_PORT:-8080}

# 处理启动参数
if [ $# -ge 1 ] && [ "$1" = "server" ]; then
    [ $# -ge 2 ] && PORT=$2
    shift
    exec node --no-warnings --no-deprecation start.js server "$PORT" "$@"
else
    exec node --no-warnings --no-deprecation start.js "$@"
fi
