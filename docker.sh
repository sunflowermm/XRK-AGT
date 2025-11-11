#!/bin/bash

# 设置环境变量
export NODE_ENV=production
export DISABLE_CONSOLE=true
export USE_FILE_LOG=true
export DEBUG=false
export NODE_OPTIONS="--no-warnings --no-deprecation"

# 创建必要的目录
mkdir -p logs data config

# 启动应用
exec node --no-warnings --no-deprecation app.js "$@"