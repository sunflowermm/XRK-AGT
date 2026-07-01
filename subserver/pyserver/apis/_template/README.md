# 插件模板 — 复制到 apis/<组名>/ 并实现自己的 service.py

```python
from fastapi import Request

async def cmd_status(_request, _args):
    return {"service": "my-plugin", "ready": True}

async def hello_handler(_request: Request):
    return {"ok": True, "message": "hello"}

default = {
    "name": "my-plugin",
    "description": "我的 Python 插件",
    "group": "my-plugin",
    "plugin_dir": str(Path(__file__).resolve().parent),
    "priority": 100,
    "commands": {"status": cmd_status},
    "routes": [
        {"method": "GET", "path": "/api/my-plugin/hello", "handler": hello_handler},
    ],
}
```

可选：`requirements.txt`、`default_config.yaml`、终端命令 `sub> my-plugin update`
