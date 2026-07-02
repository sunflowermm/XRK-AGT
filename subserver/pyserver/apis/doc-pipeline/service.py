"""文档处理：HTML/文本提取、简易 Markdown 转换。"""

from __future__ import annotations

import html
import logging
import re
from pathlib import Path
from typing import List

from fastapi import HTTPException, Request

from core.plugin_kit import load_plugin_config

logger = logging.getLogger(__name__)

_PLUGIN_DIR = Path(__file__).resolve().parent
config = load_plugin_config(_PLUGIN_DIR, "doc-pipeline")

_TAG_RE = re.compile(r"<[^>]+>")


def _read_text_source(body: dict) -> str:
    text = str(body.get("text") or "")
    if text:
        return text
    rel = str(body.get("path") or "").strip()
    if not rel:
        raise HTTPException(status_code=400, detail="需要 text 或 path")
    src = config.repo_root / rel.replace("\\", "/")
    if not src.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    return src.read_text(encoding="utf-8", errors="replace")


def _html_to_text(raw: str) -> str:
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(raw, "html.parser")
        if config.get("strip_scripts", True):
            for tag in soup(["script", "style", "noscript"]):
                tag.decompose()
        text = soup.get_text("\n")
    except ImportError:
        text = _TAG_RE.sub(" ", raw)
        text = html.unescape(text)

    lines = [line.strip() for line in text.splitlines()]
    compact = "\n".join(line for line in lines if line)
    limit = int(config.get("max_chars", 500_000))
    return compact[:limit]


def _html_to_markdown(raw: str) -> str:
    try:
        import markdownify

        return markdownify.markdownify(raw, heading_style="ATX")
    except ImportError:
        return _html_to_text(raw)


async def cmd_status(_request, _args: List[str]):
    out = config.data_dir("output")
    return {
        "service": "doc-pipeline",
        "output_dir": out.relative_to(config.repo_root).as_posix(),
        "max_chars": config.get("max_chars"),
    }


async def extract_handler(request: Request):
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无效 JSON: {exc}") from exc

    raw = _read_text_source(body)
    fmt = str(body.get("format") or "auto").lower()
    if fmt == "auto":
        fmt = "html" if "<" in raw and ">" in raw else "text"

    if fmt == "html":
        content = _html_to_text(raw)
    else:
        content = raw[: int(config.get("max_chars", 500_000))]

    return {"ok": True, "format": fmt, "chars": len(content), "text": content}


async def markdown_handler(request: Request):
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无效 JSON: {exc}") from exc

    raw = _read_text_source(body)
    md = _html_to_markdown(raw)
    limit = int(config.get("max_chars", 500_000))
    md = md[:limit]

    save = bool(body.get("save", False))
    saved_path = ""
    if save:
        name = str(body.get("output") or "converted.md")
        dest = config.data_dir("output") / Path(name).name
        dest.write_text(md, encoding="utf-8")
        saved_path = dest.relative_to(config.repo_root).as_posix()

    return {"ok": True, "chars": len(md), "markdown": md, "path": saved_path}


default = {
    "name": "doc-pipeline",
    "description": "HTML/文本提取与 Markdown 转换",
    "group": "doc-pipeline",
    "plugin_dir": str(_PLUGIN_DIR),
    "plugin_config": config,
    "priority": 140,
    "commands": {"status": cmd_status},
    "routes": [
        {"method": "POST", "path": "/api/doc-pipeline/extract", "handler": extract_handler},
        {"method": "POST", "path": "/api/doc-pipeline/markdown", "handler": markdown_handler},
    ],
}
