"""API 加载器模块

自动扫描并加载 apis 目录下的所有 API 组。

功能：
- 自动发现 apis 目录下的 API 组
- 支持字典配置和类继承两种 API 定义方式
- 按优先级排序注册 API
- 单例模式，确保只加载一次

API 组结构：
apis/
  group_name/
    api_file.py  # 导出 default 字典或 BaseAPI 子类
"""

import importlib
import importlib.util
import inspect
from pathlib import Path
from typing import List, Dict, Any, Optional
from fastapi import FastAPI
import logging

from .base_api import BaseAPI, create_api_from_dict

logger = logging.getLogger(__name__)


class ApiLoader:
    """API 加载器（单例模式），支持多组结构"""
    
    _instance: Optional['ApiLoader'] = None
    _apis: List[BaseAPI] = []
    _loaded = False
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._apis = []
            cls._instance._loaded = False
        return cls._instance
    
    @property
    def apis_dir(self) -> Path:
        """获取 apis 目录"""
        apis_dir = Path(__file__).parent.parent / "apis"
        apis_dir.mkdir(exist_ok=True)
        return apis_dir
    
    @classmethod
    async def load_all(cls, app: FastAPI):
        """加载所有 API"""
        if cls._loaded:
            logger.debug("API 已加载，跳过")
            return
        
        instance = cls()
        await instance._load_apis(app)
        cls._loaded = True
    
    async def _load_apis(self, app: FastAPI):
        """加载所有 API 组"""
        api_groups = [
            d for d in self.apis_dir.iterdir()
            if d.is_dir() and not d.name.startswith("_")
        ]
        if not api_groups:
            logger.warning("未找到 API 组目录")
            return

        loaded_count = 0
        failed_count = 0
        for group_dir in api_groups:
            group_name = group_dir.name
            api_files = [f for f in group_dir.glob("*.py") if not f.name.startswith("_")]
            if not api_files:
                continue
            for api_file in api_files:
                try:
                    await self._load_api_file(api_file, group_name, app)
                    loaded_count += 1
                except Exception as e:
                    failed_count += 1
                    logger.error("加载失败 %s/%s: %s", group_name, api_file.name, e, exc_info=True)

        self._apis.sort(key=lambda x: x.priority, reverse=True)
        logger.info("📂 API 已加载 · %d 个（失败 %d）", loaded_count, failed_count)
    
    async def _load_api_file(self, api_file: Path, group_name: str, app: FastAPI):
        """加载单个 API 文件"""
        module_name = f"apis.{group_name}.{api_file.stem}"
        
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
        logger.debug("加载 API: %s [%s]", api.name, group_name)
    
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
