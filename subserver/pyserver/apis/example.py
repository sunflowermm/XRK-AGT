"""示例 API，演示基类流写法"""
from fastapi import Request
from core.base_api import create_api_from_dict


async def ping_handler(request: Request):
    """Ping 处理函数"""
    return {
        "success": True,
        "message": "pong",
        "api": "example-api"
    }


async def info_handler(request: Request):
    """信息处理函数"""
    return {
        "success": True,
        "message": "这是一个异步处理函数示例",
        "method": request.method,
        "url": str(request.url)
    }


async def echo_handler(request: Request):
    """Echo 处理函数"""
    body = await request.json() if request.method == "POST" else {}
    return {
        "success": True,
        "echo": body.get("message", ""),
        "received": body
    }


async def init_hook(app):
    """初始化钩子"""
    print(f"[ExampleAPI] 初始化完成，应用: {app.title}")


default = {
    "name": "example-api",
    "description": "示例 API，演示基类流写法",
    "priority": 100,
    "routes": [
        {
            "method": "GET",
            "path": "/api/example/ping",
            "handler": ping_handler
        },
        {
            "method": "GET",
            "path": "/api/example/info",
            "handler": info_handler
        },
        {
            "method": "POST",
            "path": "/api/example/echo",
            "handler": echo_handler
        }
    ],
    "init": init_hook
}
