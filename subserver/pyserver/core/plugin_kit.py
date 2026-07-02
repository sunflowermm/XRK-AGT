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

_SKIP_PLUGIN_DIRS = frozenset({"system"})


def apis_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "apis"


def iter_plugin_dirs() -> List[Path]:
    root = apis_dir()
    if not root.is_dir():
        return []
    return sorted(
        d
        for d in root.iterdir()
        if d.is_dir() and not d.name.startswith("_") and d.name not in _SKIP_PLUGIN_DIRS
    )


def find_plugin_dir(name: str) -> Optional[Path]:
    path = apis_dir() / name
    return path if path.is_dir() else None


def repo_root_from_plugin(plugin_dir: Path) -> Path:
    """apis/<group>/ -> 项目根目录。"""
    return plugin_dir.resolve().parents[3]


def plugin_core_dir(plugin_dir: Path, segment: str = "plugin") -> Path:
    """apis/<group>/core/<segment>/ — 主服 Loader 扫描（plugin/http 等，不含 commonconfig）。"""
    return plugin_dir / "core" / segment


def default_config_template(plugin_dir: Path, default_file: str = "default_config.yaml") -> Path:
    """插件 default 模板路径（CommonConfig defaultTemplatePath 应对齐此文件）。"""
    return plugin_dir / default_file


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

    def read_dict(self) -> Dict[str, Any]:
        return dict(self._config)

    def write_dict(self, data: Dict[str, Any]) -> None:
        if not isinstance(data, dict):
            raise TypeError("配置必须为 dict")
        merged = self._merge(self._default_layer(), data)
        self.runtime_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.runtime_file, "w", encoding="utf-8") as f:
            yaml.dump(
                merged,
                f,
                allow_unicode=True,
                default_flow_style=False,
                sort_keys=False,
            )
        self._config = merged

    def _default_layer(self) -> Dict[str, Any]:
        base = dict(self._builtin)
        if self._default_file.is_file():
            with open(self._default_file, "r", encoding="utf-8") as f:
                base = self._merge(base, yaml.safe_load(f) or {})
        return base

    def data_dir(self, *parts: str) -> Path:
        path = self.repo_root / "data" / self.data_subdir
        for part in parts:
            path = path / part
        path.mkdir(parents=True, exist_ok=True)
        return path


_PLUGIN_CONFIG_REGISTRY: Dict[str, Dict[str, Any]] = {}


def load_config_schema(plugin_dir: Path) -> Dict[str, Any]:
    """读取 apis/<group>/config_schema.yaml（CommonConfig 面板 schema）。"""
    path = plugin_dir / "config_schema.yaml"
    if not path.is_file():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data if isinstance(data, dict) else {}


def register_plugin_config(
    group: str,
    plugin_config: PluginConfig,
    *,
    runtime: str = "pyserver",
) -> None:
    """登记插件配置，供 /api/system/commonconfig 与 /api/{group}/config/* 使用。"""
    schema_doc = load_config_schema(plugin_config.plugin_dir)
    name = str(schema_doc.get("name") or plugin_config.data_subdir)
    structure = {
        "name": name,
        "displayName": schema_doc.get("displayName") or name,
        "description": schema_doc.get("description") or "",
        "filePath": str(plugin_config.runtime_file.relative_to(plugin_config.repo_root)).replace("\\", "/"),
        "source": "subserver",
        "runtime": runtime,
        "group": group,
        "schema": schema_doc.get("schema") or {"fields": {}},
    }
    _PLUGIN_CONFIG_REGISTRY[group] = {
        "name": name,
        "group": group,
        "runtime": runtime,
        "config": plugin_config,
        "structure": structure,
    }


def get_plugin_config_entry(group: str) -> Optional[Dict[str, Any]]:
    return _PLUGIN_CONFIG_REGISTRY.get(group)


def list_plugin_config_entries() -> List[Dict[str, Any]]:
    return [
        {
            "name": entry["name"],
            "group": entry["group"],
            "runtime": entry["runtime"],
            "displayName": entry["structure"].get("displayName"),
            "description": entry["structure"].get("description"),
            "filePath": entry["structure"].get("filePath"),
            "source": "subserver",
        }
        for entry in _PLUGIN_CONFIG_REGISTRY.values()
    ]


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


async def update_all_plugin_dirs() -> Dict[str, Any]:
    dirs = iter_plugin_dirs()
    if not dirs:
        return {"ok": False, "error": "apis/ 下无插件目录"}

    results: Dict[str, Any] = {}
    all_ok = True
    for plugin_dir in dirs:
        result = await default_plugin_update(plugin_dir)
        results[plugin_dir.name] = result
        if not result.get("ok"):
            all_ok = False

    return {
        "ok": all_ok,
        "action": "update-all",
        "groups": [d.name for d in dirs],
        "results": results,
        "hint": "完成后重启子服以重新装载插件（含 git clone 的新目录）",
    }


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
            result = await default_plugin_update(
                plugin_dir,
                pip=True,
                git=True,
            )
        else:
            return {"ok": False, "error": "未配置 plugin_dir"}
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
