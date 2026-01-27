"""主服务端客户端工具模块
统一管理主服务端连接、URL获取、HTTP请求等
支持连接池优化、重试机制和性能监控
"""

import httpx
import logging
import time
from typing import Optional, Dict, Any
from .config import Config

logger = logging.getLogger(__name__)
config = Config()

# HTTP客户端单例（全局复用）
_http_client: Optional[httpx.AsyncClient] = None

# 性能监控指标
_request_metrics = {
    "total_requests": 0,
    "failed_requests": 0,
    "total_duration": 0.0,
    "last_request_time": None,
}


def get_main_server_url() -> str:
    """
    获取主服务端URL（从配置读取）

    Returns:
        主服务端URL，格式：http://host:port
    """
    host = config.get("main_server.host", "127.0.0.1")
    port = config.get("main_server.port", 1234)
    return f"http://{host}:{port}"


def get_timeout() -> float:
    """
    获取请求超时时间（秒）

    Returns:
        超时时间（秒）
    """
    return float(config.get("main_server.timeout", 300))


async def get_http_client() -> httpx.AsyncClient:
    """
    获取HTTP客户端实例（单例模式）

    Returns:
        httpx.AsyncClient实例
    """
    global _http_client
    if _http_client is None:
        timeout = get_timeout()
        _http_client = httpx.AsyncClient(
            timeout=timeout,
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
    """
    调用主服务端API

    Args:
        method: HTTP方法（GET, POST等）
        path: API路径（如 /api/v3/chat/completions）
        json_data: JSON请求体（可选）
        params: URL参数（可选）
        timeout: 超时时间（秒，可选，默认使用配置值）

    Returns:
        httpx.Response对象

    Raises:
        httpx.HTTPError: HTTP请求错误
    """
    base_url = get_main_server_url()
    url = f"{base_url}{path}"

    client = await get_http_client()
    request_timeout = timeout if timeout is not None else get_timeout()

    try:
        logger.debug(f"请求主服务端: {method} {url}")
        response = await client.request(
            method=method,
            url=url,
            json=json_data,
            params=params,
            timeout=request_timeout,
            follow_redirects=True,
        )
        if response.status_code >= 400:
            logger.warning(
                f"主服务端响应错误 [{method} {path}]: {response.status_code} - {response.text[:500]}"
            )
        return response
    except httpx.TimeoutException as e:
        logger.error(f"调用主服务端超时 [{method} {path}]: {e}")
        raise
    except httpx.ConnectError as e:
        logger.error(f"无法连接到主服务端 [{base_url}]: {e}")
        raise
    except httpx.HTTPStatusError as e:
        logger.error(
            f"主服务端HTTP错误 [{method} {path}]: {e.response.status_code} - {e.response.text[:200]}"
        )
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
    """
    调用主服务端API并返回JSON响应

    Args:
        method: HTTP方法（GET, POST等）
        path: API路径
        json_data: JSON请求体（可选）
        params: URL参数（可选）
        timeout: 超时时间（秒，可选）

    Returns:
        JSON响应数据（字典）

    Raises:
        httpx.HTTPError: HTTP请求错误
        ValueError: 响应不是有效的JSON
    """
    response = await call_main_server(method, path, json_data, params, timeout)
    response.raise_for_status()
    return response.json()
