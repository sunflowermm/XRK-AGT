"""配置管理模块，支持 YAML 配置文件
参考主服务端配置系统，实现default配置和data目录复制机制
"""
import yaml
import shutil
from pathlib import Path
from typing import Any, Dict, Optional


def get_project_root() -> Path:
    """
    获取项目根目录（subserver/pyserver）
    
    Returns:
        项目根目录Path对象
    """
    return Path(__file__).parent.parent


def get_data_root() -> Path:
    """
    获取数据目录（data/subserver，相对于项目根目录的父目录）
    
    Returns:
        数据目录Path对象
    """
    return get_project_root().parent.parent / "data" / "subserver"


def resolve_path(path_str: str, base: Optional[Path] = None) -> Path:
    """
    解析路径（相对路径转换为绝对路径）
    
    Args:
        path_str: 路径字符串（相对或绝对）
        base: 基础路径（如果为None，使用项目根目录）
    
    Returns:
        解析后的绝对路径
    """
    path = Path(path_str)
    if path.is_absolute():
        return path
    base = base or get_project_root()
    return base / path_str


class Config:
    """配置管理器
    
    配置加载流程：
    1. 优先从 data/subserver/config.yaml 读取（用户配置）
    2. 如果不存在，从 config/default_config.yaml 复制并创建
    3. 如果默认配置也不存在，使用内置默认配置
    """
    
    def __init__(self, config_file: str = "config.yaml"):
        # 项目根目录（subserver/pyserver）
        self.project_root = get_project_root()
        # 默认配置路径（config/default_config.yaml）
        self.default_config_file = self.project_root / "config" / "default_config.yaml"
        # 数据目录配置路径（data/subserver/config.yaml，相对于项目根目录的父目录）
        self.data_root = get_data_root()
        self.config_file = self.data_root / config_file
        
        self._config: Dict[str, Any] = {}
        self._cache: Dict[str, Any] = {}
        self._ensure_config_exists()
        self.load()
    
    def _ensure_config_exists(self):
        """确保配置文件存在，从默认配置复制"""
        # 确保数据目录存在
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        
        # 如果配置文件不存在，尝试从默认配置复制
        if not self.config_file.exists():
            if self.default_config_file.exists():
                # 从默认配置复制
                shutil.copy2(self.default_config_file, self.config_file)
            else:
                # 默认配置也不存在，使用内置默认配置
                self._config = self._get_builtin_default_config()
                self.save()
    
    def load(self):
        """加载配置文件"""
        try:
            if self.config_file.exists():
                with open(self.config_file, "r", encoding="utf-8") as f:
                    self._config = yaml.safe_load(f) or {}
            else:
                # 配置文件不存在，使用默认配置
                self._config = self._get_builtin_default_config()
                self.save()
        except Exception:
            # 配置文件损坏或读取失败，使用默认配置
            self._config = self._get_builtin_default_config()
            self.save()
        
        # 合并默认配置，确保所有字段都存在
        default_config = self._get_builtin_default_config()
        self._config = self._merge_config(default_config, self._config)
        
        self._cache.clear()
    
    def _merge_config(self, default: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
        """深度合并配置（用户配置优先）"""
        result = default.copy()
        for key, value in user.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._merge_config(result[key], value)
            else:
                result[key] = value
        return result
    
    def save(self):
        """保存配置文件"""
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.config_file, "w", encoding="utf-8") as f:
            yaml.dump(self._config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    
    def _get_builtin_default_config(self) -> Dict[str, Any]:
        """获取内置默认配置（当文件不存在时使用）"""
        return {
            "server": {
                "host": "0.0.0.0",
                "port": 8000,
                "reload": False,
                "log_level": "info"
            },
            "cors": {
                "origins": ["*"]
            },
            "api": {
                "auto_load": True,
                "api_dir": "apis"
            },
            "main_server": {
                "host": "127.0.0.1",
                "port": 1234,
                "timeout": 300
            },
            "langchain": {
                "enabled": True,
                "max_steps": 6,
                "verbose": False
            },
            "vector": {
                "model": "paraphrase-multilingual-MiniLM-L12-v2",
                "dimension": 384,
                "persist_dir": "data/subserver/vector_db"
            },
            "logging": {
                "level": "info",
                "file": "logs/app.log",
                "max_bytes": 10485760,
                "backup_count": 5
            }
        }
    
    def get(self, key: str, default: Any = None) -> Any:
        """
        获取配置值，支持点号分隔的嵌套键
        例如: config.get("server.port") -> 8000
        
        Args:
            key: 配置键，支持点号分隔的嵌套键
            default: 默认值（如果键不存在）
        
        Returns:
            配置值或默认值
        """
        if key in self._cache:
            return self._cache[key]
        
        keys = key.split(".")
        value = self._config
        
        for k in keys:
            if isinstance(value, dict) and k in value:
                value = value[k]
            else:
                self._cache[key] = default
                return default
        
        self._cache[key] = value
        return value
    
    def set(self, key: str, value: Any, save: bool = False):
        """
        设置配置值
        
        Args:
            key: 配置键，支持点号分隔的嵌套键
            value: 配置值
            save: 是否立即保存到文件（默认False）
        """
        keys = key.split(".")
        config = self._config
        
        for k in keys[:-1]:
            if k not in config:
                config[k] = {}
            config = config[k]
        
        config[keys[-1]] = value
        self._cache.clear()
        
        if save:
            self.save()
    
    def to_dict(self) -> Dict[str, Any]:
        """获取完整配置字典"""
        return self._config.copy()
    
    def get_file_path(self) -> Path:
        """获取配置文件路径"""
        return self.config_file
    
    def exists(self) -> bool:
        """检查配置文件是否存在"""
        return self.config_file.exists()
    
    def reset_to_default(self):
        """重置为默认配置"""
        if self.default_config_file.exists():
            shutil.copy2(self.default_config_file, self.config_file)
        else:
            self._config = self._get_builtin_default_config()
            self.save()
        self.load()