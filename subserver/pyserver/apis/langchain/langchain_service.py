"""LangChain 集成服务模块

提供 LangChain Agent 集成，支持 MCP 工具调用和流式/非流式聊天。

主要功能：
- LangChain Agent 聊天：支持工具调用和流式响应
- MCP 工具集成：自动获取和调用主服务端的 MCP 工具
- 模型列表：从主服务端获取可用模型列表

特性：
- 支持流式和非流式响应
- MCP 工具列表缓存（60秒）
- 自动回退机制：Agent 失败时回退到直接调用
"""

from fastapi import Request, HTTPException
from fastapi.responses import StreamingResponse
from core.config import Config
from core.main_server_client import get_main_server_url, call_main_server_json, get_timeout, get_http_client
import httpx
import logging
import time

from .agent import run_agent, AgentDeps

logger = logging.getLogger(__name__)
config = Config()

# MCP工具列表缓存（60秒）
_mcp_tools_cache = {"tools": [], "timestamp": 0}
_mcp_tools_cache_ttl = 60


async def get_mcp_tools():
    """获取主服务端MCP工具列表（带缓存）"""
    global _mcp_tools_cache
    
    if time.time() - _mcp_tools_cache["timestamp"] < _mcp_tools_cache_ttl:
        return _mcp_tools_cache["tools"]
    
    try:
        result = await call_main_server_json("GET", "/api/mcp/tools", timeout=10)
        tools = result.get("tools", []) if isinstance(result, dict) else []
        _mcp_tools_cache = {"tools": tools, "timestamp": time.time()}
        return tools
    except Exception as e:
        logger.warning(f"获取MCP工具列表失败: {e}")
        return _mcp_tools_cache["tools"]


async def call_mcp_tool(tool_name: str, arguments: dict):
    """调用主服务端MCP工具"""
    try:
        return await call_main_server_json(
            "POST", "/api/mcp/tools/call",
            json_data={"name": tool_name, "arguments": arguments},
            timeout=300
        )
    except Exception as e:
        return {"success": False, "error": str(e)}


def _v3_payload(messages, model: str, temperature: float, max_tokens: int, stream: bool, api_key: str):
    """构建 v3 chat 请求体（与主服务端 /api/v3/chat/completions 约定一致）。"""
    p = {
        "messages": messages,
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": stream,
    }
    if api_key:
        p["apiKey"] = api_key
    return p


async def _call_v3_chat(prompt: str, model: str, temperature: float, max_tokens: int, api_key: str, timeout: float) -> str:
    """调用主服务端 v3 chat（非流式），body 传 apiKey。参见 docs/subserver-api.md。"""
    payload = _v3_payload([{"role": "user", "content": prompt}], model, temperature, max_tokens, False, api_key)
    try:
        r = await call_main_server_json("POST", "/api/v3/chat/completions", json_data=payload, timeout=timeout)
    except Exception as e:
        raise RuntimeError(f"v3 调用失败: {e}") from e
    choices = r.get("choices") or []
    if not choices:
        raise RuntimeError("v3 返回无 choices")
    msg = choices[0].get("message") or {}
    content = (msg.get("content") or "").strip()
    if not content:
        raise RuntimeError("v3 返回无有效 content")
    return content


async def chat_handler(request: Request):
    """LangChain聊天接口"""
    data = await request.json()
    messages = data.get("messages", [])
    # 约定：model 字段传"运营商/provider"（如 volcengine/xiaomimimo/openai），以适配主服务端 v3 伪造接口
    model = data.get("model", "volcengine")
    temperature = data.get("temperature", 0.8)
    max_tokens = data.get("max_tokens", 2000)
    stream = data.get("stream", False)
    use_tools = data.get("use_tools", True)
    
    if not messages or not isinstance(messages, list):
        raise HTTPException(status_code=400, detail="messages参数无效")

    main_url = get_main_server_url()
    timeout = get_timeout()
    main_api_key = (data.get("apiKey") or config.get("main_server.api_key", "")).strip()

    if stream:
        payload = _v3_payload(messages, model, temperature, max_tokens, True, main_api_key)
        client = await get_http_client()
        v3_url = f"{main_url}/api/v3/chat/completions"
        try:
            async with client.stream("POST", v3_url, json=payload, timeout=timeout) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    raise HTTPException(status_code=response.status_code, detail=f"主服务调用失败: {error_text.decode()}")
                
                async def generate():
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:]
                            if data_str.strip() == "[DONE]":
                                yield "data: [DONE]\n\n"
                                break
                            yield f"data: {data_str}\n\n"
                
                return StreamingResponse(generate(), media_type="text/event-stream")
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="调用主服务超时")
        except httpx.ConnectError:
            raise HTTPException(status_code=502, detail=f"无法连接到主服务端: {main_url}")

    # 非流式 - 优先使用 Agent
    if use_tools and config.get("langchain.enabled", True):
        try:
            deps = AgentDeps(
                provider_or_model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                max_steps=config.get("langchain.max_steps", 6),
                verbose=config.get("langchain.verbose", False),
                use_tools=True,
                get_mcp_tools=get_mcp_tools,
                call_mcp_tool=call_mcp_tool,
                call_v3_chat=lambda p: _call_v3_chat(p, model, temperature, max_tokens, main_api_key, timeout),
                max_tools=config.get("langchain.max_tools", 40),
            )
            final_text = await run_agent(messages=messages, deps=deps)
            return {"choices": [{"message": {"content": final_text}}], "usage": {"total_tokens": 0}, "model": model}
        except Exception as e:
            logger.warning(f"[langchain] Agent失败，回退: {e}")

    payload = _v3_payload(messages, model, temperature, max_tokens, False, main_api_key)
    try:
        return await call_main_server_json("POST", "/api/v3/chat/completions", json_data=payload, timeout=60)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="调用主服务超时")
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail=f"无法连接到主服务端: {main_url}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"主服务调用失败: {e.response.text[:500]}")


async def models_handler(request: Request):
    """获取可用模型列表（从主服务端获取）"""
    return await call_main_server_json("GET", "/api/v3/models", timeout=10)


async def tools_handler(request: Request):
    """获取MCP工具列表"""
    tools = await get_mcp_tools()
    return {"tools": tools, "count": len(tools)}


async def tool_call_handler(request: Request):
    """调用MCP工具"""
    data = await request.json()
    if not data.get("name"):
        raise HTTPException(status_code=400, detail="工具名称不能为空")
    return await call_mcp_tool(data["name"], data.get("arguments", {}))


default = {
    "name": "langchain-service",
    "description": "LangChain集成服务，通过主服务v1接口实现，支持MCP工具调用",
    "priority": 90,
    "routes": [
        {
            "method": "POST",
            "path": "/api/langchain/chat",
            "handler": chat_handler
        },
        {
            "method": "GET",
            "path": "/api/langchain/models",
            "handler": models_handler
        },
        {
            "method": "GET",
            "path": "/api/langchain/tools",
            "handler": tools_handler
        },
        {
            "method": "POST",
            "path": "/api/langchain/tools/call",
            "handler": tool_call_handler
        }
    ]
}
