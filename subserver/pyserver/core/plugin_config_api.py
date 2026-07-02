"""子服插件 CommonConfig HTTP 扩展（供主服控制台代理读写）。"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, Request

from .plugin_kit import PluginConfig, get_plugin_config_entry, list_plugin_config_entries

logger = logging.getLogger(__name__)


def attach_plugin_config_routes(app, group: str, plugin_config: PluginConfig) -> None:
    """为已声明 plugin_config 的插件挂载 /api/{group}/config/*。"""
    prefix = f"/api/{group}/config"

    async def structure_handler(_request: Request):
        entry = get_plugin_config_entry(group)
        if not entry:
            raise HTTPException(status_code=404, detail="插件配置未注册")
        return {"ok": True, "structure": entry["structure"]}

    async def read_handler(_request: Request):
        entry = get_plugin_config_entry(group)
        if not entry:
            raise HTTPException(status_code=404, detail="插件配置未注册")
        cfg: PluginConfig = entry["config"]
        return {"ok": True, "data": cfg.read_dict()}

    async def write_handler(request: Request):
        entry = get_plugin_config_entry(group)
        if not entry:
            raise HTTPException(status_code=404, detail="插件配置未注册")
        try:
            body = await request.json()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"无效 JSON: {exc}") from exc

        data = body.get("data")
        if not isinstance(data, dict):
            raise HTTPException(status_code=400, detail="缺少 data 对象")

        cfg: PluginConfig = entry["config"]
        cfg.write_dict(data)
        return {"ok": True, "message": "配置已保存"}

    app.get(f"{prefix}/structure")(structure_handler)
    app.get(f"{prefix}/read")(read_handler)
    app.post(f"{prefix}/write")(write_handler)
    logger.debug("已挂载插件 CommonConfig: %s", prefix)


async def commonconfig_list_handler(_request: Request):
    return {"ok": True, "configs": list_plugin_config_entries()}
