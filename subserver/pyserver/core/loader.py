"""API 加载器，自动加载 apis 目录下的所有 API 模块"""
import importlib
import importlib.util
import inspect
from pathlib import Path
from typing import List, Dict, Any, Optional
from fastapi import FastAPI
import logging
from functools import lru_cache

from .base_api import BaseAPI, create_api_from_dict

logger = logging.getLogger(__name__)


class ApiLoader:
    """API 加载器（单例模式）"""
    
    _instance: Optional['ApiLoader'] = None
    _apis: List[BaseAPI] = []
    _loaded = False
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._apis = []
            cls._instance._loaded = False
        return cls._instance
    
    @staticmethod
    @lru_cache(maxsize=1)
    def _get_apis_dir() -> Path:
        """获取 apis 目录（缓存）"""
        apis_dir = Path(__file__).parent.parent / "apis"
        apis_dir.mkdir(exist_ok=True)
        return apis_dir
    
    @property
    def apis_dir(self) -> Path:
        """获取 apis 目录"""
        return self._get_apis_dir()
    
    @classmethod
    async def load_all(cls, app: FastAPI):
        """加载所有 API"""
        if cls._loaded:
            logger.warning("API 已加载，跳过")
            return
        
        instance = cls()
        await instance._load_apis(app)
        cls._loaded = True
    
    async def _load_apis(self, app: FastAPI):
        """加载所有 API 模块"""
        logger.info(f"📂 扫描 API 目录: {self.apis_dir}")
        
        api_files = [f for f in self.apis_dir.glob("*.py") if not f.name.startswith("_")]
        
        if not api_files:
            logger.warning("未找到 API 文件")
            return
        
        logger.info(f"发现 {len(api_files)} 个 API 文件")
        
        loaded_count = 0
        for api_file in api_files:
            try:
                await self._load_api_file(api_file, app)
                loaded_count += 1
            except Exception as e:
                logger.error(f"加载 API 文件失败: {api_file.name} - {e}", exc_info=True)
        
        self._apis.sort(key=lambda x: x.priority, reverse=True)
        logger.info(f"✅ 共加载 {loaded_count}/{len(api_files)} 个 API")
    
    async def _load_api_file(self, api_file: Path, app: FastAPI):
        """加载单个 API 文件"""
        module_name = f"apis.{api_file.stem}"
        
        spec = importlib.util.spec_from_file_location(module_name, api_file)
        if spec is None or spec.loader is None:
            raise ImportError(f"无法加载模块: {module_name}")
        
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        
        api_export = getattr(module, "default", None)
        if not api_export:
            return
        
        if isinstance(api_export, dict):
            api = create_api_from_dict(api_export)
        elif inspect.isclass(api_export) and issubclass(api_export, BaseAPI):
            api = api_export()
        else:
            return
        
        await api.startup(app)
        self._apis.append(api)
        logger.debug(f"✅ 加载 API: {api.name} (优先级: {api.priority})")
    
    @classmethod
    def get_api_list(cls) -> List[Dict[str, Any]]:
        """获取所有 API 信息列表"""
        instance = cls()
        return [api.get_info() for api in instance._apis]
    
    @classmethod
    def get_api(cls, name: str) -> Optional[BaseAPI]:
        """根据名称获取 API"""
        instance = cls()
        for api in instance._apis:
            if api.name == name:
                return api
        return None
