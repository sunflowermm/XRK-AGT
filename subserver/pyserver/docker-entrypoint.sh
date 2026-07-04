#!/bin/sh
set -e
# 构建阶段不 RUN pip（Windows BuildKit 易挂）；启动时离线装依赖
if ! python -c "import fastapi" 2>/dev/null; then
  echo ">>> uv pip install (offline)"
  uv pip install --no-index --find-links .docker/wheels -r .docker/requirements.txt
fi
exec python main.py
