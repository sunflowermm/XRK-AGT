#!/bin/sh
set -e

# XRK-AGT Linux/macOS 启动脚本（经 app.js 做依赖检查与引导，再进入 start.js）
exec node --no-warnings --no-deprecation app.js "$@"
