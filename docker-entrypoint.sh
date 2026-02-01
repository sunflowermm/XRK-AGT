#!/bin/sh
set -e

# XRK-AGT Docker 入口脚本
# 支持通过环境变量 XRK_SERVER_PORT 指定端口

# 获取端口（环境变量优先，默认8080）
PORT=${XRK_SERVER_PORT:-8080}

# 如果提供了命令行参数且第一个参数是server，使用第二个参数作为端口
if [ $# -ge 2 ] && [ "$1" = "server" ]; then
    PORT=$2
    shift 2
fi

# 启动应用
exec node --no-warnings --no-deprecation start.js server "$PORT" "$@"
