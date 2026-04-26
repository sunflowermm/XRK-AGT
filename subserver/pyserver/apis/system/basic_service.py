"""子服务端底层系统 API。"""

from fastapi import Request
from core.config import Config

config = Config()


async def ping_handler(_request: Request):
    return {"ok": True, "service": "subserver-core"}


async def config_handler(_request: Request):
    return {
        "server": {
            "host": config.get("server.host", "0.0.0.0"),
            "port": config.get("server.port", 8000),
            "reload": config.get("server.reload", False),
        },
        "api": config.get("api", {}),
    }


default = {
    "name": "system-basic",
    "description": "子服务端底层系统接口",
    "priority": 100,
    "routes": [
        {"method": "GET", "path": "/api/system/ping", "handler": ping_handler},
        {"method": "GET", "path": "/api/system/config", "handler": config_handler},
    ],
}

