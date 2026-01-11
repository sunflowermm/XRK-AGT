"""配置管理模块，支持 YAML 配置文件"""
import yaml
from pathlib import Path
from typing import Any, Dict


class Config:
    """配置管理器"""
    
    def __init__(self, config_file: str = "config.yaml"):
        self.config_file = Path(__file__).parent.parent / config_file
        self._config: Dict[str, Any] = {}
        self._cache: Dict[str, Any] = {}
        self.load()
    
    def load(self):
        """加载配置文件"""
        if self.config_file.exists():
            with open(self.config_file, "r", encoding="utf-8") as f:
                self._config = yaml.safe_load(f) or {}
        else:
            self._config = self._get_default_config()
            self.save()
        
        self._cache.clear()
    
    def save(self):
        """保存配置文件"""
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.config_file, "w", encoding="utf-8") as f:
            yaml.dump(self._config, f, allow_unicode=True, default_flow_style=False)
    
    def _get_default_config(self) -> Dict[str, Any]:
        """获取默认配置"""
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
            }
        }
    
    def get(self, key: str, default: Any = None) -> Any:
        """
        获取配置值，支持点号分隔的嵌套键
        例如: config.get("server.port") -> 8000
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
    
    def set(self, key: str, value: Any):
        """设置配置值"""
        keys = key.split(".")
        config = self._config
        
        for k in keys[:-1]:
            if k not in config:
                config[k] = {}
            config = config[k]
        
        config[keys[-1]] = value
        self._cache.clear()
    
    def to_dict(self) -> Dict[str, Any]:
        """获取完整配置字典"""
        return self._config.copy()
