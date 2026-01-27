"""
日志配置模块

该模块提供了统一的日志配置接口，支持以下功能：
- 控制台和文件日志输出
- 日志文件轮转
- 从配置文件读取日志级别和文件路径
- 统一的日志格式

配置示例 (config.yaml):
    logging:
        level: "DEBUG"  # 可选: DEBUG, INFO, WARNING, ERROR, CRITICAL
        file: "logs/app.log"  # 日志文件路径
        max_bytes: 10485760  # 日志文件最大大小 (10MB)
        backup_count: 5  # 保留的备份文件数量
"""

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

from .config import Config, resolve_path

# 模块级日志记录器
logger = logging.getLogger(__name__)

# 全局配置
config = Config()
_root_configured = False


def setup_logger(name: str = __name__, level: Optional[str] = None) -> logging.Logger:
    """
    配置并返回一个日志记录器

    Args:
        name: 日志记录器名称，通常使用 __name__
        level: 日志级别 (DEBUG, INFO, WARNING, ERROR, CRITICAL)，如果为 None 则从配置中读取

    Returns:
        logging.Logger: 配置好的日志记录器

    Example:
        >>> logger = setup_logger(__name__)
        >>> logger.info("This is an info message")
    """
    global _root_configured
    root = logging.getLogger()

    try:
        # 设置日志级别
        log_level = level or config.get("logging.level", "info")
        root.setLevel(getattr(logging, log_level.upper(), logging.INFO))

        # 如果根日志记录器已经配置过，直接返回指定名称的记录器
        if _root_configured:
            return logging.getLogger(name)

        _root_configured = True

        # 控制台处理器
        console_formatter = logging.Formatter(
            "%(asctime)s │ %(levelname)-7s │ %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(console_formatter)
        root.addHandler(console_handler)

        # 文件处理器
        log_file = config.get("logging.file", "logs/app.log")
        try:
            log_path = resolve_path(log_file)
            log_path.parent.mkdir(parents=True, exist_ok=True)

            file_formatter = logging.Formatter(
                "%(asctime)s │ %(name)-20s │ %(levelname)-8s │ %(funcName)s:%(lineno)-4d │ %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
            file_handler = RotatingFileHandler(
                log_path,
                maxBytes=config.get("logging.max_bytes", 10 * 1024 * 1024),  # 10MB
                backupCount=config.get("logging.backup_count", 5),
                encoding="utf-8",
            )
            file_handler.setLevel(logging.DEBUG)
            file_handler.setFormatter(file_formatter)
            root.addHandler(file_handler)

            logger.info("Logging to file: %s", log_path)
        except (IOError, OSError) as e:
            logger.error("Failed to configure file logging: %s", e, exc_info=True)

        return logging.getLogger(name)

    except Exception as e:
        logger.error("Error setting up logger: %s", e, exc_info=True)
        # 返回一个基本的日志记录器作为后备
        logging.basicConfig(level=logging.INFO)
        return logging.getLogger(name)