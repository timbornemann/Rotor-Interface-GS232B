"""Logging utilities for the server package.

Provides a centralized logging function with timestamp prefix.
"""

import sys
from datetime import datetime


def log(message: str) -> None:
    """Print message with timestamp prefix.
    
    Args:
        message: The message to log.
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {message}", file=sys.stdout, flush=True)

