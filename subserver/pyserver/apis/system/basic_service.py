"""子服务端底层系统 API。"""

from fastapi import HTTPException, Request

from core.command_registry import CommandRegistry
from core.config import Config
from core.plugin_config_api import commonconfig_list_handler

config = Config()


async def ping_handler(_request: Request):
    return {"ok": True, "service": "subserver-core"}


async def config_handler(_request: Request):
    return {
        "server": {
            "host": config.get("server.host", "0.0.0.0"),
            "port": config.get("server.port", 8000),
            "reload": config.get("server.reload", False),
            "stdin": config.get("server.stdin", {}),
        },
        "api": config.get("api", {}),
    }


async def groups_handler(_request: Request):
    return {"ok": True, **CommandRegistry.list_help()}


async def command_handler(request: Request):
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无效 JSON: {exc}") from exc

    line = str(body.get("line") or body.get("cmd") or "").strip()
    if not line:
        group = str(body.get("group") or "").strip()
        cmd = str(body.get("command") or "help").strip()
        args = body.get("args") or []
        if isinstance(args, str):
            args = args.split()
        if group:
            line = " ".join([group, cmd, *args])
        else:
            line = "help"

    return await CommandRegistry.run_line(line)


default = {
    "name": "system-basic",
    "description": "子服务端底层系统接口",
    "priority": 100,
    "routes": [
        {"method": "GET", "path": "/api/system/ping", "handler": ping_handler},
        {"method": "GET", "path": "/api/system/config", "handler": config_handler},
        {"method": "GET", "path": "/api/system/commonconfig/list", "handler": commonconfig_list_handler},
        {"method": "GET", "path": "/api/system/groups", "handler": groups_handler},
        {"method": "POST", "path": "/api/system/command", "handler": command_handler},
    ],
}

