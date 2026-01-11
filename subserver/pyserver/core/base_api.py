"""HTTP API 基类"""
from typing import List, Dict, Callable, Any
from fastapi import FastAPI, Request, HTTPException
import logging
import inspect

logger = logging.getLogger(__name__)


class BaseAPI:
    """HTTP API 基类，提供统一的 API 接口结构"""
    
    def __init__(
        self,
        name: str,
        description: str = "",
        priority: int = 100,
        enabled: bool = True
    ):
        """
        Args:
            name: API 名称
            description: API 描述
            priority: 优先级（数字越大优先级越高）
            enabled: 是否启用
        """
        self.name = name
        self.description = description or "暂无描述"
        self.priority = priority
        self.enabled = enabled
        self.routes: List[Dict[str, Any]] = []
        self.middleware: List[Callable] = []
        self._registered = False
    
    def register_routes(self, app: FastAPI):
        """注册路由到 FastAPI 应用，子类应重写此方法"""
        logger.warning(f"[BaseAPI] {self.name} 未实现 register_routes 方法")
    
    def register_middleware(self, app: FastAPI):
        """注册中间件到 FastAPI 应用"""
        for middleware in self.middleware:
            app.middleware("http")(middleware)
    
    async def init(self, app: FastAPI):
        """初始化钩子，子类可重写此方法实现自定义初始化逻辑"""
        pass
    
    async def startup(self, app: FastAPI):
        """启动时调用"""
        if not self.enabled:
            logger.info(f"[BaseAPI] {self.name} 已禁用，跳过注册")
            return
        
        try:
            if self.middleware:
                self.register_middleware(app)
            self.register_routes(app)
            await self.init(app)
            self._registered = True
            logger.info(f"[BaseAPI] {self.name} 注册成功 ({len(self.routes)} 个路由)")
        except Exception as e:
            logger.error(f"[BaseAPI] {self.name} 注册失败: {e}", exc_info=True)
            raise
    
    def get_info(self) -> Dict[str, Any]:
        """获取 API 信息"""
        return {
            "name": self.name,
            "description": self.description,
            "priority": self.priority,
            "enabled": self.enabled,
            "routes_count": len(self.routes),
            "registered": self._registered
        }


def create_api_from_dict(data: Dict[str, Any]) -> BaseAPI:
    """从字典创建 API 实例"""
    class DictAPI(BaseAPI):
        def __init__(self, data: Dict[str, Any]):
            super().__init__(
                name=data.get("name", "unnamed-api"),
                description=data.get("description", ""),
                priority=data.get("priority", 100),
                enabled=data.get("enabled", True)
            )
            self._data = data
            self.middleware = data.get("middleware", [])
        
        def register_routes(self, app: FastAPI):
            """从字典配置注册路由"""
            routes = self._data.get("routes", [])
            route_methods = {
                "GET": app.get,
                "POST": app.post,
                "PUT": app.put,
                "DELETE": app.delete,
                "PATCH": app.patch,
            }
            
            for route_config in routes:
                method = route_config.get("method", "GET").upper()
                path = route_config.get("path")
                handler = route_config.get("handler")
                
                if not path or not handler or method not in route_methods:
                    continue
                
                wrapped_handler = self._wrap_handler(handler)
                route_methods[method](path)(wrapped_handler)
                self.routes.append(route_config)
        
        async def init(self, app: FastAPI):
            """执行自定义初始化钩子"""
            init_hook = self._data.get("init")
            if init_hook and callable(init_hook):
                if inspect.iscoroutinefunction(init_hook):
                    await init_hook(app)
                else:
                    result = init_hook(app)
                    if inspect.isawaitable(result):
                        await result
        
        def _wrap_handler(self, handler: Callable) -> Callable:
            """包装处理器以支持错误处理"""
            is_async = inspect.iscoroutinefunction(handler)
            
            async def wrapped(request: Request):
                try:
                    return await handler(request) if is_async else handler(request)
                except HTTPException:
                    raise
                except Exception as e:
                    logger.error(f"[DictAPI] {self.name} 处理请求失败: {e}", exc_info=True)
                    raise HTTPException(status_code=500, detail=str(e))
            
            return wrapped
    
    return DictAPI(data)
