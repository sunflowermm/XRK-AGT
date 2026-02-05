#!/bin/sh
set -e

# XRK-AGT Linux/macOS 启动脚本
# 支持通过环境变量 XRK_SERVER_PORT 指定端口

# 获取端口（环境变量优先，默认8080）
PORT=${XRK_SERVER_PORT:-8080}

# 如果提供了命令行参数，第一个参数应该是"server"，第二个参数是端口
if [ $# -ge 1 ] && [ "$1" = "server" ]; then
    # 如果提供了第二个参数，使用它作为端口
    if [ $# -ge 2 ]; then
        PORT=$2
        shift 2
        exec node --no-warnings --no-deprecation start.js server "$PORT" "$@"
    else
        # 只有"server"参数，使用环境变量中的端口
        shift
        exec node --no-warnings --no-deprecation start.js server "$PORT" "$@"
    fi
else
    # 没有"server"参数，直接传递所有参数（兼容其他启动方式）
    exec node --no-warnings --no-deprecation start.js "$@"
fi
