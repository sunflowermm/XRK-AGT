#!/bin/bash

# XRK-AGT Docker 启动脚本
# 用于在Docker容器中启动应用

set -e

# 设置环境变量
export NODE_ENV=production
export DISABLE_CONSOLE=true
export USE_FILE_LOG=true
export DEBUG=false
export NODE_OPTIONS="--no-warnings --no-deprecation"

# 获取端口，优先级：命令行参数 > 环境变量 > 默认值
PORT=${XRK_SERVER_PORT:-8080}
if [ $# -ge 2 ] && [ "$1" = "server" ]; then
    PORT=$2
    shift 2
fi

# 创建必要的目录
mkdir -p \
  logs \
  data \
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

# 启动应用
exec node --no-warnings --no-deprecation start.js server "$PORT" "$@"