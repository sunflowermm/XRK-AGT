"""日志配置模块
从配置文件读取日志配置，支持日志轮转
"""
import logging
import sys
from logging.handlers import RotatingFileHandler
from .config import Config, resolve_path

config = Config()


def setup_logger(name: str = __name__, level: str = None) -> logging.Logger:
    """
    设置日志记录器
    
    Args:
        name: 日志记录器名称
        level: 日志级别（如果为None，从配置读取）
    
    Returns:
        配置好的日志记录器
    """
    logger = logging.getLogger(name)
    
    # 从配置读取日志级别
    if level is None:
        level = config.get("logging.level", "info")
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    
    # 避免重复添加处理器
    if logger.handlers:
        return logger
    
    # 控制台处理器
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)
    
    # 文件处理器（支持日志轮转）
    log_file = config.get("logging.file", "logs/app.log")
    log_path = resolve_path(log_file)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    
    max_bytes = config.get("logging.max_bytes", 10485760)  # 10MB
    backup_count = config.get("logging.backup_count", 5)
    
    file_handler = RotatingFileHandler(
        log_path,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8"
    )
    file_handler.setLevel(logging.DEBUG)
    file_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    file_handler.setFormatter(file_formatter)
    logger.addHandler(file_handler)
    
    return logger
