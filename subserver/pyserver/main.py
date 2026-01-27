"""XRK-AGT Python 子服务端
提供AI生态相关服务，包括LangChain集成、向量服务、工具服务等
"""
import asyncio
import os

# 在导入任何模块前禁用网络请求，仅使用本地缓存
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

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


async def _warmup_vector():
    """预热嵌入模型"""
    try:
        from apis.vector.vector_service import _load_embedding_model_async, get_embedding_model
        await _load_embedding_model_async()
        if get_embedding_model():
            logger.info("  └ 📦 嵌入模型已预热")
        else:
            logger.warning("  └ ⚠️ 嵌入模型预热失败（可稍后按需加载）")
    except Exception as e:
        logger.warning("  └ ⚠️ 嵌入模型预热失败: %s", e)


async def _warmup_mcp():
    """预热 MCP 工具列表"""
    await asyncio.sleep(1)
    try:
        from apis.langchain.langchain_service import get_mcp_tools
        tools = await get_mcp_tools()
        n = len(tools) if isinstance(tools, list) else 0
        logger.info("  └ 🔧 MCP 工具已预热 · %d 个", n)
    except Exception as e:
        logger.warning("  └ ⚠️ MCP 工具预热失败: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
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
    version="1.0.0",
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
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/health", tags=["系统"])
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
    host = os.getenv("HOST") or config.get("server.host", "0.0.0.0")
    port = int(os.getenv("PORT") or config.get("server.port", 8000))
    reload = os.getenv("RELOAD", "").lower() in ("true", "1") or config.get("server.reload", False)
    log_level = os.getenv("LOG_LEVEL") or config.get("server.log_level", "info")
    main_host = config.get("main_server.host", "127.0.0.1")
    main_port = config.get("main_server.port", 1234)

    logger.info("──────────────────────────────────────")
    logger.info("🌐 子服务端  http://%s:%s", host, port)
    logger.info("📁 配置     %s", config.get_file_path())
    logger.info("🔗 主服务端 http://%s:%s", main_host, main_port)
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
