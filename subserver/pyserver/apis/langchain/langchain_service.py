"""LangChain Service - LangChain集成服务"""
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
    """
    获取主服务端MCP工具列表（带缓存）
    
    Returns:
        MCP工具列表，格式：[{name, description, inputSchema, ...}, ...]
    """
    global _mcp_tools_cache
    
    current_time = time.time()
    # 检查缓存是否有效
    if current_time - _mcp_tools_cache["timestamp"] < _mcp_tools_cache_ttl and _mcp_tools_cache["tools"]:
        return _mcp_tools_cache["tools"]
    
    try:
        result = await call_main_server_json("GET", "/api/mcp/tools", timeout=30)
        # 主服务端返回格式: {success: true, message: "...", tools: [...], count: N}
        tools = result.get("tools", []) if isinstance(result, dict) else []
        _mcp_tools_cache = {"tools": tools, "timestamp": current_time}
        logger.info(f"[langchain] MCP工具列表获取成功: {len(tools)}个工具")
        return tools
    except httpx.TimeoutException:
        logger.warning(f"[langchain] 获取MCP工具列表超时")
    except httpx.ConnectError:
        logger.warning(f"[langchain] 无法连接到主服务端")
    except Exception as e:
        logger.warning(f"[langchain] 获取MCP工具列表异常: {e}")
    
    # 返回缓存的工具列表（如果有）
    return _mcp_tools_cache.get("tools", [])


async def call_mcp_tool(tool_name: str, arguments: dict):
    """
    调用主服务端MCP工具
    
    Args:
        tool_name: 工具名称（格式：category.name）
        arguments: 工具参数（字典格式）
    
    Returns:
        工具调用结果，格式：{success: bool, data: {...}, error: "..."}
    """
    try:
        result = await call_main_server_json(
            "POST",
            "/api/mcp/tools/call",
            json_data={"name": tool_name, "arguments": arguments},
            timeout=300
        )
        return result
    except httpx.TimeoutException:
        error_msg = f"调用超时: {tool_name}"
        logger.error(f"[langchain] {error_msg}")
        return {"success": False, "error": error_msg}
    except httpx.ConnectError:
        error_msg = f"无法连接到主服务端"
        logger.error(f"[langchain] {error_msg}")
        return {"success": False, "error": error_msg}
    except httpx.HTTPStatusError as e:
        error_msg = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
        logger.error(f"[langchain] MCP工具调用失败 [{tool_name}]: {error_msg}")
        return {"success": False, "error": error_msg}
    except Exception as e:
        error_msg = f"调用异常: {str(e)}"
        logger.error(f"[langchain] MCP工具调用异常 [{tool_name}]: {error_msg}", exc_info=True)
        return {"success": False, "error": error_msg}


async def chat_handler(request: Request):
    """LangChain聊天接口"""
    data = await request.json()
    messages = data.get("messages", [])
    # 约定：model 字段传“运营商/provider”（如 volcengine/xiaomimimo/gptgod），以适配主服务端 v3 伪造接口
    model = data.get("model", "gptgod")
    temperature = data.get("temperature", 0.8)
    max_tokens = data.get("max_tokens", 2000)
    stream = data.get("stream", False)
    use_tools = data.get("use_tools", True)
    
    if not messages or not isinstance(messages, list):
        raise HTTPException(status_code=400, detail="messages参数无效")
    
    main_url = get_main_server_url()
    timeout = get_timeout()
    main_api_key = config.get("main_server.api_key", "")
    
    payload = {"messages": messages, "model": model, "temperature": temperature, "max_tokens": max_tokens, "stream": stream}
    if main_api_key:
        payload["apiKey"] = main_api_key
    
    if stream:
        # 流式响应
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
    else:
        # 非流式响应
        # 如果启用LangChain Agent且use_tools为true，使用Agent模式
        if use_tools and config.get("langchain.enabled", True):
            try:
                deps = AgentDeps(
                    main_server_url=main_url,
                    provider_or_model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    max_steps=int(config.get("langchain.max_steps", 6) or 6),
                    verbose=bool(config.get("langchain.verbose", False)),
                    use_tools=True,
                    get_mcp_tools=get_mcp_tools,
                    call_mcp_tool=call_mcp_tool,
                    timeout=int(config.get("langchain.request_timeout", timeout) or timeout),
                    max_tools=int(config.get("langchain.max_tools", 40) or 40),
                )
                final_text = await run_agent(messages=messages, deps=deps)
                return {
                    "choices": [{"message": {"content": final_text}}],
                    "usage": {"total_tokens": 0},
                    "model": model
                }
            except Exception as e:
                logger.error(f"LangChain Agent执行失败，回退到直接调用: {e}", exc_info=True)
                # Agent失败时回退到直接调用
        
        try:
            result = await call_main_server_json("POST", "/api/v3/chat/completions", json_data=payload, timeout=60)
            return result
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="调用主服务超时")
        except httpx.ConnectError:
            raise HTTPException(status_code=502, detail=f"无法连接到主服务端: {main_url}")
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=f"主服务调用失败: {e.response.text[:500]}")


async def models_handler(request: Request):
    """获取可用模型列表（从主服务端获取）"""
    try:
        result = await call_main_server_json("GET", "/api/v3/models", timeout=30)
        return result
    except httpx.TimeoutException:
        logger.error(f"[langchain] 获取模型列表超时")
        raise HTTPException(status_code=504, detail="调用主服务超时")
    except httpx.ConnectError:
        main_url = get_main_server_url()
        logger.error(f"[langchain] 无法连接到主服务端: {main_url}")
        raise HTTPException(status_code=502, detail=f"无法连接到主服务端: {main_url}")
    except httpx.HTTPStatusError as e:
        error_detail = f"主服务调用失败 [{e.response.status_code}]: {e.response.text[:500]}"
        logger.error(f"[langchain] {error_detail}")
        raise HTTPException(status_code=e.response.status_code, detail=error_detail)


async def tools_handler(request: Request):
    """获取MCP工具列表"""
    tools = await get_mcp_tools()
    return {"tools": tools, "count": len(tools)}


async def tool_call_handler(request: Request):
    """调用MCP工具"""
    data = await request.json()
    tool_name = data.get("name")
    arguments = data.get("arguments", {})
    
    if not tool_name:
        raise HTTPException(status_code=400, detail="工具名称不能为空")
    
    return await call_mcp_tool(tool_name, arguments)


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
