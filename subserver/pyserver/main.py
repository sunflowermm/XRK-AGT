"""XRK-AGT Python 子服务端

提供 AI 生态相关服务，包括 LangChain 集成、向量服务、工具服务等。

主要服务：
- LangChain 服务：支持 Agent 和 MCP 工具调用
- 向量服务：文本向量化、向量检索和入库
- 工具服务：MCP 工具集成

启动流程：
1. 设置代理环境（HuggingFace 模型下载）
2. 加载所有 API 模块
3. 预热嵌入模型和 MCP 工具
4. 启动 FastAPI 服务
"""
import asyncio
import logging
import os

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from contextlib import asynccontextmanager

from core.loader import ApiLoader
from core.config import Config
from core.logger import setup_logger
from core.main_server_client import close_http_client

config = Config()
logger = setup_logger(__name__)


def _ensure_protocol(url: str, default: str = "http") -> str:
    """确保 URL 包含协议前缀"""
    if not url or not (url := url.strip()):
        return ""
    if url.startswith(("http://", "https://", "socks5://")):
        return url
    return f"{default}://{url}"


def _setup_proxy_environment():
    """设置 HuggingFace 缓存目录和代理配置，禁用冗余日志"""
    # 禁用 huggingface_hub 和 transformers 的 HTTP 请求日志
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("huggingface_hub").setLevel(logging.WARNING)
    logging.getLogger("transformers").setLevel(logging.WARNING)
    logging.getLogger("sentence_transformers").setLevel(logging.WARNING)
    
    from core.config import get_model_cache_dir
    cache_dir = get_model_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_dir_str = str(cache_dir)
    os.environ["HF_HOME"] = cache_dir_str
    os.environ["HF_HUB_CACHE"] = cache_dir_str
    
    if os.getenv("HF_HUB_OFFLINE") != "1":
        # 优先使用环境变量，其次使用配置文件
        http_proxy = os.getenv("HTTP_PROXY") or config.get("proxy.http_proxy", "")
        https_proxy = os.getenv("HTTPS_PROXY") or config.get("proxy.https_proxy", "")
        hf_endpoint = os.getenv("HF_ENDPOINT") or config.get("proxy.hf_endpoint", "")
        
        # 设置代理环境变量（大小写版本）
        for key, value in [
            ("HTTP_PROXY", _ensure_protocol(http_proxy)),
            ("HTTPS_PROXY", _ensure_protocol(https_proxy)),
            ("http_proxy", _ensure_protocol(http_proxy)),
            ("https_proxy", _ensure_protocol(https_proxy)),
            ("HF_ENDPOINT", _ensure_protocol(hf_endpoint, "https")),
        ]:
            if value:
                os.environ[key] = value
            else:
                os.environ.pop(key, None)
        
        # 设置 NO_PROXY
        no_proxy = os.getenv("NO_PROXY") or "127.0.0.1,localhost,xrk-agt,redis,mongodb"
        os.environ["NO_PROXY"] = no_proxy
        os.environ["no_proxy"] = no_proxy


async def _warmup_vector():
    """预热嵌入模型"""
    try:
        from apis.vector.vector_service import vector_service
        if await vector_service.load_embedding_model():
            logger.info("  └ 📦 嵌入模型已预热")
        # 错误已在 load_embedding_model 中记录，这里不再重复
    except Exception as e:
        logger.warning("  └ ⚠️ 嵌入模型预热异常: %s", str(e)[:100])


async def _warmup_mcp():
    """预热 MCP 工具列表"""
    await asyncio.sleep(1)
    try:
        from apis.langchain.langchain_service import get_mcp_tools
        tools = await get_mcp_tools()
        logger.info("  └ 🔧 MCP 工具已预热 · %d 个", len(tools))
    except Exception as e:
        logger.warning("  └ ⚠️ MCP 工具预热失败: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    _setup_proxy_environment()
    logger.info("🚀 启动 XRK-AGT Python 子服务端")
    try:
        await ApiLoader.load_all(app)
        logger.info("🔄 预热嵌入模型与 MCP 工具...")
        await asyncio.gather(_warmup_vector(), _warmup_mcp())
        logger.info("──────────────────────────────────────")
        logger.info("✅ 启动就绪 · 模型与 MCP 工具已就绪")
        logger.info("──────────────────────────────────────")
    except Exception as e:
        logger.error("❌ 启动失败: %s", e, exc_info=True)
        raise

    yield

    logger.info("🛑 关闭服务...")
    await close_http_client()


app = FastAPI(
    title="XRK-AGT Python 子服务端",
    description="提供 RAG、ML 模型、向量化等服务",
    version="1.0.5",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

cors_origins = config.get("cors.origins", ["*"])
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.get("/", tags=["系统"])
async def root():
    """根路径"""
    return {
        "name": "XRK-AGT Python 子服务端",
        "version": "1.0.5",
        "status": "running"
    }


@app.get("/health", tags=["系统"])
@app.head("/health", tags=["系统"])
async def health():
    """健康检查"""
    return {"status": "healthy"}


@app.get("/api/list", tags=["系统"])
async def api_list():
    """获取 API 列表"""
    apis = ApiLoader.get_api_list()
    return {
        "apis": apis,
        "count": len(apis)
    }


def main():
    """主入口函数"""
    from core.main_server_client import get_main_server_url
    
    host = os.getenv("HOST") or config.get("server.host", "0.0.0.0")
    port = int(os.getenv("PORT") or config.get("server.port", 8000))
    reload = os.getenv("RELOAD", "").lower() in ("true", "1") or config.get("server.reload", False)
    log_level = os.getenv("LOG_LEVEL") or config.get("server.log_level", "info")
    main_server_url = get_main_server_url()

    logger.info("──────────────────────────────────────")
    logger.info("🌐 子服务端  http://%s:%s", host, port)
    logger.info("📁 配置     %s", config.get_file_path())
    logger.info("🔗 主服务端 %s", main_server_url)
    logger.info("──────────────────────────────────────")
    
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=reload,
        log_level=log_level,
        access_log=True,
        use_colors=True
    )


if __name__ == "__main__":
    main()
