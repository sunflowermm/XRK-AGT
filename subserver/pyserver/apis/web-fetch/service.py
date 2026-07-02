"""网页抓取与本地缓存。"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from pathlib import Path
from typing import List
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request as UrlRequest, urlopen

from fastapi import HTTPException, Request

from core.plugin_kit import load_plugin_config

logger = logging.getLogger(__name__)

_PLUGIN_DIR = Path(__file__).resolve().parent
config = load_plugin_config(_PLUGIN_DIR, "web-fetch")


def _cache_dir() -> Path:
    return config.data_dir("cache")


def _cache_key(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def _cache_path(url: str) -> Path:
    return _cache_dir() / f"{_cache_key(url)}.json"


def _load_cache(url: str):
    path = _cache_path(url)
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    ttl = int(config.get("cache_ttl_sec", 3600))
    if ttl > 0 and time.time() - float(payload.get("fetched_at", 0)) > ttl:
        return None
    return payload


def _save_cache(url: str, payload: dict):
    path = _cache_path(url)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _fetch_url(url: str) -> dict:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="仅支持 http/https")

    timeout = int(config.get("timeout_sec", 30))
    max_bytes = int(config.get("max_body_bytes", 2_000_000))
    req = UrlRequest(
        url,
        headers={"User-Agent": str(config.get("user_agent", "XRK-AGT-subserver/1.1"))},
    )
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read(max_bytes + 1)
            if len(raw) > max_bytes:
                raise HTTPException(status_code=413, detail="响应体过大")
            charset = resp.headers.get_content_charset() or "utf-8"
            text = raw.decode(charset, errors="replace")
            return {
                "url": url,
                "status": resp.status,
                "content_type": resp.headers.get("Content-Type", ""),
                "text": text,
                "bytes": len(raw),
                "fetched_at": time.time(),
            }
    except HTTPError as exc:
        raise HTTPException(status_code=exc.code, detail=f"HTTP {exc.code}") from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=str(exc.reason)) from exc


async def cmd_status(_request, _args: List[str]):
    cache = _cache_dir()
    files = list(cache.glob("*.json")) if cache.exists() else []
    return {
        "service": "web-fetch",
        "cache_entries": len(files),
        "cache_ttl_sec": config.get("cache_ttl_sec"),
    }


async def cmd_clear(_request, _args: List[str]):
    cache = _cache_dir()
    count = 0
    for path in cache.glob("*.json"):
        path.unlink(missing_ok=True)
        count += 1
    return {"cleared": count}


async def fetch_handler(request: Request):
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无效 JSON: {exc}") from exc

    url = str(body.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="需要 url")

    use_cache = body.get("cache", True)
    if use_cache:
        cached = _load_cache(url)
        if cached:
            cached = dict(cached)
            cached["ok"] = True
            cached["cached"] = True
            return cached

    payload = _fetch_url(url)
    payload["ok"] = True
    payload["cached"] = False
    if use_cache:
        _save_cache(url, payload)
    return payload


async def cache_get_handler(request: Request):
    url = request.query_params.get("url", "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="需要 url 参数")
    cached = _load_cache(url)
    if not cached:
        raise HTTPException(status_code=404, detail="无缓存或已过期")
    cached = dict(cached)
    cached["ok"] = True
    cached["cached"] = True
    return cached


default = {
    "name": "web-fetch",
    "description": "网页抓取与本地缓存",
    "group": "web-fetch",
    "plugin_dir": str(_PLUGIN_DIR),
    "priority": 130,
    "commands": {"status": cmd_status, "clear": cmd_clear},
    "routes": [
        {"method": "POST", "path": "/api/web-fetch/fetch", "handler": fetch_handler},
        {"method": "GET", "path": "/api/web-fetch/cache", "handler": cache_get_handler},
    ],
}
