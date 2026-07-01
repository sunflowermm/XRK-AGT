"""子服务插件命令注册表（供 stdin 与 /api/system/command 使用）。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import Request

from .plugin_kit import dispatch_plugin_command

CommandHandler = Callable[..., Any]
UpdateHandler = Callable[..., Awaitable[Any]]


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
    async def run_line(cls, line: str) -> Dict[str, Any]:
        text = (line or "").strip()
        if not text:
            return {"ok": False, "error": "空命令"}

        lower = text.lower()
        if lower in ("help", "?", "h"):
            return {"ok": True, **cls.list_help(), "hint": "用法: <组名> <命令> [参数...]"}

        if lower in ("list", "groups", "ls"):
            return {"ok": True, "groups": cls.groups()}

        parts = text.split()
        group = parts[0]
        entry = cls.get(group)
        if not entry:
            return {
                "ok": False,
                "error": f"未知插件组: {group}",
                "available": cls.groups(),
            }

        cmd = parts[1] if len(parts) > 1 else "help"
        args = parts[2:]
        return await entry.dispatch(cmd, args)

    @classmethod
    def clear(cls):
        cls._groups.clear()
