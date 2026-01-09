"""Logging utilities for the server package.

Provides a centralized logging function with timestamp prefix and configurable log level.
"""

import sys
from datetime import datetime
from enum import Enum
from typing import Optional


class LogLevel(Enum):
    """Logging levels in ascending order of severity."""
    DEBUG = 0
    INFO = 1
    WARNING = 2
    ERROR = 3


# Global log level (default: INFO)
_current_log_level = LogLevel.INFO


def set_logging_level(level: str) -> None:
    """Set the logging level dynamically.
    
    Args:
        level: One of "DEBUG", "INFO", "WARNING", "ERROR".
        
    Raises:
        ValueError: If level is not a valid log level name.
    """
    global _current_log_level
    
    level_upper = level.upper()
    if level_upper not in LogLevel.__members__:
        raise ValueError(f"Invalid log level: {level}. Must be one of: DEBUG, INFO, WARNING, ERROR")
    
    _current_log_level = LogLevel[level_upper]
    log(f"[Logging] Log level set to {level_upper}", force=True)


def get_current_logging_level() -> str:
    """Get the current logging level.
    
    Returns:
        The current log level as a string.
    """
    return _current_log_level.name


def log(message: str, level: str = "INFO", force: bool = False) -> None:
    """Print message with timestamp prefix if level is sufficient.
    
    Args:
        message: The message to log.
        level: Log level for this message (DEBUG, INFO, WARNING, ERROR).
        force: If True, log regardless of current level (for system messages).
    """
    # Parse the message level
    try:
        msg_level = LogLevel[level.upper()]
    except KeyError:
        msg_level = LogLevel.INFO
    
    # Check if we should log this message
    if not force and msg_level.value < _current_log_level.value:
        return
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {message}", file=sys.stdout, flush=True)

