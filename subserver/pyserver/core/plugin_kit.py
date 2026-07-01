"""子服务插件通用工具：配置、依赖更新、命令路由。"""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

import yaml

logger = logging.getLogger(__name__)

CommandHandler = Callable[..., Any]


def repo_root_from_plugin(plugin_dir: Path) -> Path:
    """apis/<group>/ -> 项目根目录。"""
    return plugin_dir.resolve().parents[3]


def load_plugin_config(
    plugin_dir: Path,
    data_subdir: str,
    *,
    default_file: str = "default_config.yaml",
    builtin: Optional[Dict[str, Any]] = None,
) -> "PluginConfig":
    return PluginConfig(plugin_dir, data_subdir, default_file=default_file, builtin=builtin)


class PluginConfig:
    """插件独立配置：default_config.yaml -> data/<name>/config.yaml。"""

    def __init__(
        self,
        plugin_dir: Path,
        data_subdir: str,
        *,
        default_file: str = "default_config.yaml",
        builtin: Optional[Dict[str, Any]] = None,
    ):
        self.plugin_dir = plugin_dir.resolve()
        self.data_subdir = data_subdir
        self._default_file = self.plugin_dir / default_file
        self._builtin = builtin or {}
        self._config: Dict[str, Any] = {}
        self._load()

    @property
    def repo_root(self) -> Path:
        return repo_root_from_plugin(self.plugin_dir)

    @property
    def runtime_file(self) -> Path:
        return self.repo_root / "data" / self.data_subdir / "config.yaml"

    def _merge(self, default: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
        result = default.copy()
        for key, value in user.items():
            if (
                key in result
                and isinstance(result[key], dict)
                and isinstance(value, dict)
            ):
                result[key] = self._merge(result[key], value)
            else:
                result[key] = value
        return result

    def _ensure_runtime_file(self):
        runtime = self.runtime_file
        runtime.parent.mkdir(parents=True, exist_ok=True)
        if runtime.exists():
            return
        if self._default_file.is_file():
            shutil.copy2(self._default_file, runtime)
            return
        with open(runtime, "w", encoding="utf-8") as f:
            yaml.dump(
                self._builtin,
                f,
                allow_unicode=True,
                default_flow_style=False,
                sort_keys=False,
            )

    def _load(self):
        self._ensure_runtime_file()
        with open(self.runtime_file, "r", encoding="utf-8") as f:
            user = yaml.safe_load(f) or {}
        base = self._builtin
        if self._default_file.is_file():
            with open(self._default_file, "r", encoding="utf-8") as f:
                base = self._merge(base, yaml.safe_load(f) or {})
        self._config = self._merge(base, user)

    def reload(self):
        self._load()

    def get(self, key: str, default: Any = None) -> Any:
        value: Any = self._config
        for part in key.split("."):
            if isinstance(value, dict) and part in value:
                value = value[part]
            else:
                return default
        return value

    def data_dir(self, *parts: str) -> Path:
        path = self.repo_root / "data" / self.data_subdir
        for part in parts:
            path = path / part
        path.mkdir(parents=True, exist_ok=True)
        return path


def _run_subprocess(cmd: List[str], *, cwd: Optional[Path] = None) -> Dict[str, Any]:
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            check=False,
        )
        return {
            "ok": proc.returncode == 0,
            "cmd": cmd,
            "stdout": (proc.stdout or "").strip(),
            "stderr": (proc.stderr or "").strip(),
            "code": proc.returncode,
        }
    except Exception as exc:
        return {"ok": False, "cmd": cmd, "error": str(exc)}


def upgrade_plugin_deps(plugin_dir: Path, *, use_uv: bool = True) -> Dict[str, Any]:
    req = plugin_dir / "requirements.txt"
    if not req.is_file():
        return {"ok": True, "skipped": "no requirements.txt"}

    uv = shutil.which("uv")
    if use_uv and uv:
        cmd = [uv, "pip", "install", "-r", str(req), "--upgrade"]
    else:
        cmd = [sys.executable, "-m", "pip", "install", "-r", str(req), "--upgrade"]

    result = _run_subprocess(cmd, cwd=plugin_dir)
    result["action"] = "pip_upgrade"
    return result


def git_pull_plugin(plugin_dir: Path) -> Dict[str, Any]:
    git_dir = plugin_dir / ".git"
    if not git_dir.exists():
        return {"ok": True, "skipped": "not a git repo"}

    result = _run_subprocess(["git", "pull", "--ff-only"], cwd=plugin_dir)
    result["action"] = "git_pull"
    return result


async def default_plugin_update(
    plugin_dir: Path,
    *,
    pip: bool = True,
    git: bool = True,
) -> Dict[str, Any]:
    plugin_dir = plugin_dir.resolve()
    steps: List[Dict[str, Any]] = []

    if git:
        steps.append(await asyncio.to_thread(git_pull_plugin, plugin_dir))
    if pip:
        steps.append(await asyncio.to_thread(upgrade_plugin_deps, plugin_dir))

    ok = all(step.get("ok", False) or step.get("skipped") for step in steps)
    return {"ok": ok, "plugin": plugin_dir.name, "steps": steps}


async def run_command_handler(handler: CommandHandler, request, args: List[str]) -> Any:
    import inspect

    if inspect.iscoroutinefunction(handler):
        try:
            return await handler(request, args)
        except TypeError:
            return await handler(request)
    try:
        return handler(request, args)
    except TypeError:
        return handler(request)


async def dispatch_plugin_command(
    group: str,
    commands: Dict[str, CommandHandler],
    request,
    *,
    cmd: str,
    args: Optional[List[str]] = None,
    plugin_dir: Optional[Path] = None,
    on_update: Optional[Callable[..., Awaitable[Any]]] = None,
) -> Dict[str, Any]:
    name = (cmd or "").strip().lower()
    args = args or []

    if name in ("help", "?"):
        return {
            "ok": True,
            "group": group,
            "commands": sorted(commands.keys()) + ["update", "help"],
        }

    if name == "update":
        if on_update:
            result = await on_update(request, args)
        elif plugin_dir:
            force_git = "force" in args or "--force" in args
            result = await default_plugin_update(
                plugin_dir,
                pip=True,
                git=force_git or (plugin_dir / ".git").exists(),
            )
        else:
            return {"ok": False, "error": "未配置更新逻辑"}
        return {"ok": bool(result.get("ok", True)), "group": group, "result": result}

    handler = commands.get(name)
    if not handler:
        return {
            "ok": False,
            "error": f"未知命令: {cmd}",
            "group": group,
            "available": sorted(commands.keys()) + ["update", "help"],
        }

    data = await run_command_handler(handler, request, args)
    if isinstance(data, dict):
        data.setdefault("ok", True)
        data.setdefault("group", group)
        return data
    return {"ok": True, "group": group, "data": data}


def parse_command_line(line: str) -> tuple[str, str, List[str]]:
    """解析 'group cmd arg1 arg2'。"""
    parts = line.strip().split()
    if not parts:
        return "", "", []
    group = parts[0]
    if len(parts) == 1:
        return group, "help", []
    return group, parts[1], parts[2:]
