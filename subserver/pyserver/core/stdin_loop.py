"""子服务端终端（readline REPL，对齐主服 stdin tasker 体验）。"""

from __future__ import annotations

import asyncio
import importlib
import logging
import sys
import threading
from pathlib import Path
from typing import Any, Optional

from .cli_ui import (
    CLEAR_WORDS,
    EXIT_WORDS,
    clear_screen,
    completion_words,
    format_result,
    strip_line,
)
from .command_registry import CommandRegistry
from .config import get_data_root

logger = logging.getLogger(__name__)

_stop_event = threading.Event()
_thread: Optional[threading.Thread] = None
_io_lock = threading.Lock()
_readline_mod: Any = None
_readline_checked = False


def _is_usable_readline(mod: Any) -> bool:
    """GNU readline 绑定须含 readline()；PyPI 同名包会遮蔽标准库且无此属性。"""
    if mod is None:
        return False
    return callable(getattr(mod, "readline", None)) and callable(
        getattr(mod, "parse_and_bind", None)
    )


def _load_readline() -> Any:
    global _readline_mod, _readline_checked
    if _readline_checked:
        return _readline_mod if _is_usable_readline(_readline_mod) else None
    _readline_checked = True

    for name in ("readline", "pyreadline3"):
        try:
            mod = importlib.import_module(name)
        except ImportError:
            continue
        if _is_usable_readline(mod):
            _readline_mod = mod
            logger.debug("stdin 使用 %s", name)
            return mod
        logger.warning("跳过不可用模块 %s（非 GNU readline 绑定）", name)

    _readline_mod = None
    logger.warning(
        "readline 不可用，stdin 降级为基础输入（无历史/Tab）。"
        "若 venv 装有 PyPI readline 包请执行: uv pip uninstall readline"
    )
    return None


def _history_path() -> Path:
    return get_data_root() / "stdin_history"


def _setup_readline() -> None:
    rl = _load_readline()
    if rl is None:
        return

    history = _history_path()
    history.parent.mkdir(parents=True, exist_ok=True)
    if history.is_file() and hasattr(rl, "read_history_file"):
        try:
            rl.read_history_file(str(history))
        except OSError:
            pass
    if hasattr(rl, "set_history_length"):
        rl.set_history_length(500)

    cache: dict[str, list[str]] = {"words": []}

    def _completer(text: str, state: int) -> Optional[str]:
        if state == 0:
            cache["words"] = [
                w for w in completion_words(CommandRegistry.groups) if w.startswith(text)
            ]
        idx = state
        return cache["words"][idx] if idx < len(cache["words"]) else None

    rl.parse_and_bind("tab: complete")
    rl.set_completer(_completer)
    rl.set_completer_delims(" \t\n;")
    rl.parse_and_bind("set editing-mode emacs")


def _save_history() -> None:
    rl = _load_readline()
    if rl is None or not hasattr(rl, "write_history_file"):
        return
    try:
        rl.write_history_file(str(_history_path()))
    except OSError:
        pass


def _read_line(prompt: str) -> str:
    rl = _load_readline()
    with _io_lock:
        if rl is not None:
            return rl.readline(prompt)
        print(prompt, end="", flush=True)
        return sys.stdin.readline()


def _stdin_reader_loop(prompt: str) -> None:
    _setup_readline()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    rl_ok = _load_readline() is not None
    with _io_lock:
        hint = "Tab 补全" if rl_ok else "基础输入"
        print(f"\n[子服] 帮助 · 列表 · 更新 · 清屏 · 退出（{hint}）", flush=True)

    try:
        while not _stop_event.is_set():
            try:
                line = _read_line(prompt)
            except KeyboardInterrupt:
                with _io_lock:
                    print("\n(已取消，HTTP 继续运行)", flush=True)
                continue
            except EOFError:
                with _io_lock:
                    print("\n终端已关闭（HTTP 继续运行）", flush=True)
                break
            except Exception as exc:
                logger.error("stdin 读行失败: %s", exc, exc_info=True)
                with _io_lock:
                    print(f"✗ 终端读行失败: {exc}", flush=True)
                break

            if not line:
                break

            text = strip_line(line)
            if not text:
                continue

            lower = text.lower()
            if lower in EXIT_WORDS or text in EXIT_WORDS:
                with _io_lock:
                    print("终端已关闭（HTTP 继续运行）", flush=True)
                break

            if lower in CLEAR_WORDS or text in CLEAR_WORDS:
                clear_screen()
                continue

            try:
                if text in ("更新", "update", "同步"):
                    with _io_lock:
                        print("正在更新 apis/ 下全部插件…", flush=True)
                result = loop.run_until_complete(CommandRegistry.run_line(text))
                with _io_lock:
                    print(format_result(result), flush=True)
            except Exception as exc:
                logger.error("命令执行失败: %s", exc, exc_info=True)
                with _io_lock:
                    print(f"✗ {exc}", flush=True)
    finally:
        _save_history()
        loop.close()


def start_stdin_loop(*, enabled: bool = True, prompt: str = "子服> "):
    global _thread
    if not enabled:
        return
    if not sys.stdin.isatty():
        logger.debug("非交互终端，跳过 stdin 命令行")
        return
    if _thread and _thread.is_alive():
        return

    _stop_event.clear()
    _thread = threading.Thread(
        target=_stdin_reader_loop,
        args=(prompt,),
        name="subserver-stdin",
        daemon=True,
    )
    _thread.start()


def stop_stdin_loop() -> None:
    _stop_event.set()
