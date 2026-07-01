"""子服务端终端命令行（标准输入 REPL）。"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import threading
from typing import Optional

from .command_registry import CommandRegistry

logger = logging.getLogger(__name__)

_stop_event = threading.Event()
_thread: Optional[threading.Thread] = None


def _format_result(payload: dict) -> str:
    if not isinstance(payload, dict):
        return str(payload)
    if payload.get("ok") is False:
        err = payload.get("error") or payload.get("detail") or "失败"
        extra = payload.get("available") or payload.get("commands")
        if extra:
            return f"✗ {err}\n  可用: {', '.join(extra)}"
        return f"✗ {err}"
    if "groups" in payload and "count" in payload:
        lines = ["插件组:"]
        for item in payload.get("groups", []):
            cmds = ", ".join(item.get("commands", []))
            lines.append(f"  · {item['group']} — {item.get('description', '')} [{cmds}]")
        hint = payload.get("hint")
        if hint:
            lines.append(hint)
        return "\n".join(lines)
    if "groups" in payload and isinstance(payload["groups"], list):
        return "已注册: " + ", ".join(payload["groups"])
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _stdin_reader_loop(prompt: str):
    logger.info("终端命令已启用 · 输入 help 查看插件组")
    print("\n[子服务] 终端命令已就绪 · 输入 help 或 list", flush=True)
    while not _stop_event.is_set():
        try:
            print(prompt, end="", flush=True)
            line = sys.stdin.readline()
        except (EOFError, KeyboardInterrupt):
            print("\n[子服务] 终端命令已退出", flush=True)
            break
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        if line.lower() in ("exit", "quit", "q"):
            print("[子服务] 终端命令已退出（HTTP 服务继续运行）", flush=True)
            break

        try:
            result = asyncio.run(CommandRegistry.run_line(line))
            print(_format_result(result), flush=True)
        except Exception as exc:
            logger.error("命令执行失败: %s", exc, exc_info=True)
            print(f"✗ {exc}", flush=True)


def start_stdin_loop(*, enabled: bool = True, prompt: str = "sub> "):
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


def stop_stdin_loop():
    _stop_event.set()
