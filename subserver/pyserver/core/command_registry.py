"""子服务插件命令注册表（供 stdin 与 /api/system/command 使用）。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import Request

from .plugin_kit import (
    default_plugin_update,
    dispatch_plugin_command,
    find_plugin_dir,
    update_all_plugin_dirs,
)

from .cli_ui import strip_line

CommandHandler = Callable[..., Any]
UpdateHandler = Callable[..., Awaitable[Any]]

_GROUP_CMD_CN = {
    "状态": "status",
    "更新": "update",
    "同步": "update",
    "帮助": "help",
}


@dataclass
class PluginCommandSet:
    group: str
    description: str = ""
    plugin_dir: Optional[Path] = None
    commands: Dict[str, CommandHandler] = field(default_factory=dict)
    on_update: Optional[UpdateHandler] = None

    async def dispatch(self, cmd: str, args: Optional[List[str]] = None) -> Dict[str, Any]:
        request = Request({"type": "http", "method": "CLI"})
        return await dispatch_plugin_command(
            self.group,
            self.commands,
            request,
            cmd=cmd,
            args=args or [],
            plugin_dir=self.plugin_dir,
            on_update=self.on_update,
        )


class CommandRegistry:
    _groups: Dict[str, PluginCommandSet] = {}

    @classmethod
    def register(cls, entry: PluginCommandSet):
        cls._groups[entry.group] = entry

    @classmethod
    def get(cls, group: str) -> Optional[PluginCommandSet]:
        return cls._groups.get(group)

    @classmethod
    def groups(cls) -> List[str]:
        return sorted(cls._groups.keys())

    @classmethod
    def list_help(cls) -> Dict[str, Any]:
        items = []
        for name in cls.groups():
            entry = cls._groups[name]
            cmds = sorted(entry.commands.keys()) + ["update", "help"]
            items.append(
                {
                    "group": name,
                    "description": entry.description,
                    "commands": cmds,
                }
            )
        return {"groups": items, "count": len(items)}

    @classmethod
    async def _update_group(cls, name: str) -> Dict[str, Any]:
        entry = cls.get(name)
        if entry:
            res = await entry.dispatch("update", [])
            res["action"] = "update-one"
            return res
        plugin_dir = find_plugin_dir(name)
        if plugin_dir:
            result = await default_plugin_update(plugin_dir)
            return {
                "ok": bool(result.get("ok")),
                "action": "update-one",
                "group": name,
                "result": result,
            }
        return {
            "ok": False,
            "error": f"未知插件: {name}",
            "available": cls.groups(),
        }

    @classmethod
    async def run_line(cls, line: str) -> Dict[str, Any]:
        raw = strip_line(line)
        if not raw:
            return {"ok": False, "error": "空命令"}

        parts = raw.split()
        head = parts[0]
        head_lower = head.lower()

        if len(parts) == 1:
            if head_lower in ("help", "?", "h") or head == "帮助":
                return {
                    "ok": True,
                    **cls.list_help(),
                    "hint": "顶栏: 帮助 · 列表 · 更新 · 清屏 · 退出 | 单插件: <组名> 更新",
                }
            if head_lower in ("list", "groups", "ls") or head in ("列表", "组"):
                return {"ok": True, "groups": cls.groups()}
            if head_lower == "update" or head in ("更新", "同步"):
                return await update_all_plugin_dirs()

        if head in ("更新", "同步") or head_lower == "update":
            return await cls._update_group(parts[1]) if len(parts) >= 2 else await update_all_plugin_dirs()

        group = parts[0]
        cmd = parts[1] if len(parts) > 1 else "help"
        if cmd in _GROUP_CMD_CN:
            cmd = _GROUP_CMD_CN[cmd]
        args = parts[2:]

        entry = cls.get(group)
        if not entry:
            if cmd == "update":
                return await cls._update_group(group)
            return {
                "ok": False,
                "error": f"未知插件组: {group}",
                "available": cls.groups(),
            }

        return await entry.dispatch(cmd, args)
