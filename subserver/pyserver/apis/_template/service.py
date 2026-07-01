"""复制本目录到 apis/<组名>/ 并修改 group、routes、commands。"""

from pathlib import Path

from fastapi import Request

_PLUGIN_DIR = Path(__file__).resolve().parent


async def cmd_status(_request, _args):
    return {"service": "my-plugin", "ready": True}


async def hello_handler(_request: Request):
    return {"ok": True, "message": "hello"}


default = {
    "name": "my-plugin",
    "description": "Python 插件模板",
    "group": "my-plugin",
    "plugin_dir": str(_PLUGIN_DIR),
    "priority": 50,
    "commands": {"status": cmd_status},
    "routes": [
        {"method": "GET", "path": "/api/my-plugin/hello", "handler": hello_handler},
    ],
}
