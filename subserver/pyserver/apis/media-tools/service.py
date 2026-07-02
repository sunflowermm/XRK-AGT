"""媒体处理：缩放、格式转换、缩略图。"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse

from core.plugin_kit import load_plugin_config

logger = logging.getLogger(__name__)

_PLUGIN_DIR = Path(__file__).resolve().parent
config = load_plugin_config(_PLUGIN_DIR, "media-tools")


def _output_dir() -> Path:
    return config.data_dir("output")


def _safe_name(name: str) -> str:
    cleaned = Path(name).name
    if not cleaned or cleaned in (".", ".."):
        raise HTTPException(status_code=400, detail="非法文件名")
    return cleaned


async def cmd_status(_request, _args: List[str]):
    out = _output_dir()
    files = list(out.glob("*")) if out.exists() else []
    return {
        "service": "media-tools",
        "output_dir": str(out.relative_to(config.repo_root)).replace("\\", "/"),
        "files": len(files),
        "formats": config.get("allowed_formats", []),
    }


async def resize_handler(request: Request):
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无效 JSON: {exc}") from exc

    rel = str(body.get("path") or "").strip()
    width = int(body.get("width") or 0)
    height = int(body.get("height") or 0)
    if not rel or width <= 0:
        raise HTTPException(status_code=400, detail="需要 path 与 width>0")

    src = config.repo_root / rel.replace("\\", "/")
    if not src.is_file():
        raise HTTPException(status_code=404, detail="源文件不存在")

    from PIL import Image

    out_name = _safe_name(body.get("output") or f"resized_{src.name}")
    dest = _output_dir() / out_name

    with Image.open(src) as img:
        if height <= 0:
            ratio = width / img.width
            height = max(1, int(img.height * ratio))
        resized = img.convert("RGB") if img.mode not in ("RGB", "RGBA") else img
        resized = resized.resize((width, height), Image.Resampling.LANCZOS)
        save_kwargs: Dict[str, Any] = {}
        if dest.suffix.lower() in (".jpg", ".jpeg"):
            save_kwargs["quality"] = int(config.get("jpeg_quality", 85))
        resized.save(dest, **save_kwargs)

    rel_out = dest.relative_to(config.repo_root).as_posix()
    return {
        "ok": True,
        "path": rel_out,
        "size": dest.stat().st_size,
        "file_url": f"/api/media-tools/file?path={rel_out}",
    }


async def convert_handler(request: Request):
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无效 JSON: {exc}") from exc

    rel = str(body.get("path") or "").strip()
    fmt = str(body.get("format") or "jpeg").lower().lstrip(".")
    allowed = {x.lower().lstrip(".") for x in config.get("allowed_formats", [])}
    if fmt not in allowed:
        raise HTTPException(status_code=400, detail=f"不支持格式: {fmt}")

    src = config.repo_root / rel.replace("\\", "/")
    if not src.is_file():
        raise HTTPException(status_code=404, detail="源文件不存在")

    from PIL import Image

    out_name = _safe_name(body.get("output") or f"{src.stem}.{fmt}")
    dest = _output_dir() / out_name

    with Image.open(src) as img:
        if fmt in ("jpeg", "jpg") and img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        save_kwargs: Dict[str, Any] = {}
        if fmt in ("jpeg", "jpg"):
            save_kwargs["quality"] = int(config.get("jpeg_quality", 85))
        img.save(dest, format="JPEG" if fmt in ("jpeg", "jpg") else fmt.upper(), **save_kwargs)

    rel_out = dest.relative_to(config.repo_root).as_posix()
    return {"ok": True, "path": rel_out, "format": fmt}


async def thumbnail_handler(request: Request):
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无效 JSON: {exc}") from exc

    rel = str(body.get("path") or "").strip()
    size = int(body.get("size") or config.get("thumbnail_size", 320))
    if not rel:
        raise HTTPException(status_code=400, detail="需要 path")

    src = config.repo_root / rel.replace("\\", "/")
    if not src.is_file():
        raise HTTPException(status_code=404, detail="源文件不存在")

    from PIL import Image

    out_name = _safe_name(body.get("output") or f"thumb_{src.name}")
    dest = _output_dir() / out_name

    with Image.open(src) as img:
        img = img.convert("RGB") if img.mode not in ("RGB", "RGBA") else img
        img.thumbnail((size, size), Image.Resampling.LANCZOS)
        save_kwargs: Dict[str, Any] = {}
        if dest.suffix.lower() in (".jpg", ".jpeg"):
            save_kwargs["quality"] = int(config.get("jpeg_quality", 85))
        img.save(dest, **save_kwargs)

    rel_out = dest.relative_to(config.repo_root).as_posix()
    return {
        "ok": True,
        "path": rel_out,
        "size": dest.stat().st_size,
        "file_url": f"/api/media-tools/file?path={rel_out}",
    }


async def file_handler(request: Request):
    rel = request.query_params.get("path", "").strip()
    if not rel or ".." in rel.replace("\\", "/"):
        raise HTTPException(status_code=400, detail="非法路径")

    path = (config.repo_root / rel).resolve()
    root = _output_dir().resolve()
    if root not in path.parents and path != root:
        raise HTTPException(status_code=403, detail="禁止访问")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(path, filename=path.name)


default = {
    "name": "media-tools",
    "description": "图片缩放、格式转换与缩略图",
    "group": "media-tools",
    "plugin_dir": str(_PLUGIN_DIR),
    "plugin_config": config,
    "priority": 150,
    "commands": {"status": cmd_status},
    "routes": [
        {"method": "POST", "path": "/api/media-tools/resize", "handler": resize_handler},
        {"method": "POST", "path": "/api/media-tools/convert", "handler": convert_handler},
        {"method": "POST", "path": "/api/media-tools/thumbnail", "handler": thumbnail_handler},
        {"method": "GET", "path": "/api/media-tools/file", "handler": file_handler},
    ],
}
