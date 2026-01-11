"""XRK-AGT Python 子服务端"""
import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from contextlib import asynccontextmanager

from core.loader import ApiLoader
from core.config import Config
from core.logger import setup_logger

logger = setup_logger(__name__)
config = Config()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logger.info("🚀 启动 XRK-AGT Python 子服务端...")
    try:
        await ApiLoader.load_all(app)
        logger.info("✅ API 加载完成")
    except Exception as e:
        logger.error(f"❌ API 加载失败: {e}", exc_info=True)
        raise
    
    yield
    
    logger.info("🛑 关闭服务...")


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
    
    logger.info(f"🌐 服务启动在 http://{host}:{port}")
    
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
