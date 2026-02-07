"""主服务端客户端工具模块
统一管理主服务端连接、URL获取、HTTP请求等
支持连接池优化、重试机制
"""

import httpx
import logging
import os
from typing import Optional, Dict, Any
from .config import Config

logger = logging.getLogger(__name__)
config = Config()

# HTTP客户端单例（全局复用）
_http_client: Optional[httpx.AsyncClient] = None


def _is_docker_environment() -> bool:
    """检测是否为 Docker 环境"""
    return os.getenv("DOCKER_CONTAINER") == "1" or os.path.exists("/.dockerenv")


def _normalize_host(host: str) -> str:
    """规范化主机地址（移除引号，处理 Docker 服务名）"""
    host = str(host).strip().strip('"\'')
    if not _is_docker_environment() and host in ("xrk-agt", "redis", "mongodb"):
        return "127.0.0.1"
    return host


def get_main_server_url() -> str:
    """获取主服务端URL（自动处理 Docker 服务名）"""
    if _is_docker_environment():
        host = os.getenv("XRK_MAIN_SERVER_HOST") or config.get("main_server.host", "xrk-agt")
        port = int(os.getenv("XRK_MAIN_SERVER_PORT") or config.get("main_server.port", 8080))
    else:
        host = os.getenv("XRK_MAIN_SERVER_HOST") or config.get("main_server.host", "127.0.0.1")
        port = int(os.getenv("XRK_MAIN_SERVER_PORT") or config.get("main_server.port", 1234))
    return f"http://{_normalize_host(host)}:{port}"


def get_timeout() -> float:
    """获取请求超时时间（秒）"""
    return float(config.get("main_server.timeout", 300))


async def get_http_client() -> httpx.AsyncClient:
    """获取HTTP客户端实例（单例模式，禁用代理）"""
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            timeout=get_timeout(),
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
            headers={"User-Agent": "XRK-AGT-Subserver/1.0"},
        )
    return _http_client


async def close_http_client():
    """关闭HTTP客户端"""
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


async def call_main_server(
    method: str,
    path: str,
    json_data: Optional[Dict[str, Any]] = None,
    params: Optional[Dict[str, Any]] = None,
    timeout: Optional[float] = None,
) -> httpx.Response:
    """调用主服务端API"""
    base_url = get_main_server_url()
    url = f"{base_url}{path}"

    client = await get_http_client()
    request_timeout = timeout if timeout is not None else get_timeout()

    try:
        # 主服务端连接不使用代理（临时清除代理环境变量）
        old_http_proxy = os.environ.pop("HTTP_PROXY", None)
        old_https_proxy = os.environ.pop("HTTPS_PROXY", None)
        old_http_proxy_lower = os.environ.pop("http_proxy", None)
        old_https_proxy_lower = os.environ.pop("https_proxy", None)
        try:
            response = await client.request(
                method=method,
                url=url,
                json=json_data,
                params=params,
                timeout=request_timeout,
                follow_redirects=True,
            )
        finally:
            # 恢复代理环境变量（用于模型下载）
            if old_http_proxy:
                os.environ["HTTP_PROXY"] = old_http_proxy
            if old_https_proxy:
                os.environ["HTTPS_PROXY"] = old_https_proxy
            if old_http_proxy_lower:
                os.environ["http_proxy"] = old_http_proxy_lower
            if old_https_proxy_lower:
                os.environ["https_proxy"] = old_https_proxy_lower
        if response.status_code >= 400:
            logger.error(f"主服务端响应错误 [{method} {path}]: {response.status_code} - {response.text[:500]}")
        return response
    except httpx.TimeoutException as e:
        logger.error(f"调用主服务端超时 [{method} {path}]: {e}")
        raise
    except httpx.ConnectError as e:
        logger.error(f"无法连接到主服务端 [{base_url}]: {e}")
        raise
    except httpx.HTTPStatusError as e:
        logger.error(f"主服务端HTTP错误 [{method} {path}]: {e.response.status_code} - {e.response.text[:200]}")
        raise
    except Exception as e:
        logger.error(f"调用主服务端异常 [{method} {path}]: {e}", exc_info=True)
        raise


async def call_main_server_json(
    method: str,
    path: str,
    json_data: Optional[Dict[str, Any]] = None,
    params: Optional[Dict[str, Any]] = None,
    timeout: Optional[float] = None,
) -> Dict[str, Any]:
    """调用主服务端API并返回JSON响应"""
    response = await call_main_server(method, path, json_data, params, timeout)
    response.raise_for_status()
    try:
        return response.json()
    except Exception as e:
        logger.error(f"主服务端响应不是有效的JSON [{method} {path}]: {response.text[:500]}")
        raise ValueError(f"主服务端响应不是有效的JSON: {e}") from e
