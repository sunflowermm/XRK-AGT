#!/bin/sh

# XRK-AGT Docker 入口脚本
# 支持启动主服务端或子服务端

PORT=${XRK_SERVER_PORT:-8080}

# 启动子服务端
if [ "$1" = "subserver" ]; then
    cd /app/subserver/pyserver || {
        echo "错误: 无法切换到 /app/subserver/pyserver 目录" >&2
        exit 1
    }
    
    # 确保配置文件存在
    mkdir -p /app/data/subserver
    [ ! -f /app/data/subserver/config.yaml ] && \
        cp /app/subserver/pyserver/config/default_config.yaml /app/data/subserver/config.yaml 2>/dev/null || true
    
    # 启动子服务端（优先使用 .venv，其次 uv，最后 python3）
    if [ -d ".venv" ] && [ -f ".venv/bin/python" ]; then
        exec .venv/bin/python main.py
    elif command -v /usr/local/bin/uv >/dev/null 2>&1; then
        exec /usr/local/bin/uv run python main.py 2>&1 || {
            echo "错误: uv 启动失败，尝试使用 .venv" >&2
            [ -d ".venv" ] && [ -f ".venv/bin/python" ] && exec .venv/bin/python main.py || exit 1
        }
    elif command -v python3 >/dev/null 2>&1; then
        exec python3 main.py
    else
        echo "错误: 未找到 Python 解释器" >&2
        exit 1
    fi
fi

# 启动主服务端
if [ "$1" = "server" ]; then
    # Docker 环境自动配置（仅主服务端需要）
    if [ -f /.dockerenv ] || [ -n "${DOCKER_CONTAINER:-}" ]; then
        [ -f /app/data/server_bots/redis.yaml ] && \
            sed -i 's/host: "127.0.0.1"/host: "redis"/g; s/host: 127.0.0.1/host: "redis"/g' /app/data/server_bots/redis.yaml 2>/dev/null || true
        
        [ -f /app/data/server_bots/mongodb.yaml ] && \
            sed -i 's/host: "127.0.0.1"/host: "mongodb"/g; s/host: 127.0.0.1/host: "mongodb"/g' /app/data/server_bots/mongodb.yaml 2>/dev/null || true
    fi
    
    exec node --no-warnings --no-deprecation start.js server "$PORT"
fi

# 未知命令，显示错误并退出
echo "错误: 未知命令 '$1'，请使用 'server' 或 'subserver'" >&2
exit 1
