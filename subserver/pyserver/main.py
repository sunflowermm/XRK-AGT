"""XRK-AGT Python 子服务端（底层精简版）"""
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

config = Config()
logger = setup_logger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logger.info("🚀 启动 XRK-AGT Python 子服务端")
    try:
        await ApiLoader.load_all(app)
        logger.info("──────────────────────────────────────")
        logger.info("✅ 启动就绪 · 底层服务已加载")
        logger.info("──────────────────────────────────────")
    except Exception as e:
        logger.error("❌ 启动失败: %s", e, exc_info=True)
        raise

    yield

    logger.info("🛑 关闭服务...")


app = FastAPI(
    title="XRK-AGT Python 子服务端",
    description="提供子服务端底层能力（健康检查、扩展 API 装载）",
    version="1.1.0",
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
        "version": "1.1.0",
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
    host = os.getenv("HOST") or config.get("server.host", "0.0.0.0")
    port = int(os.getenv("PORT") or config.get("server.port", 8000))
    reload = os.getenv("RELOAD", "").lower() in ("true", "1") or config.get("server.reload", False)
    log_level = os.getenv("LOG_LEVEL") or config.get("server.log_level", "info")

    logger.info("──────────────────────────────────────")
    logger.info("🌐 子服务端  http://%s:%s", host, port)
    logger.info("📁 配置     %s", config.get_file_path())
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
