"""Main entry point for the Rotor Interface Server.

This module provides the command-line interface for starting the server.

Usage:
    python -m server.main [--port PORT]
    
Example:
    python -m server.main --port 8081
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from server.core.server import run_server, DEFAULT_PORT


def parse_args(args: list[str] | None = None) -> argparse.Namespace:
    """Parse command line arguments.
    
    Args:
        args: Command line arguments (default: sys.argv[1:]).
        
    Returns:
        Parsed arguments namespace.
    """
    parser = argparse.ArgumentParser(
        prog="rotor-server",
        description="Rotor Interface HTTP Server with REST API"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port to listen on (default: {DEFAULT_PORT})"
    )
    parser.add_argument(
        "--config-dir",
        type=Path,
        default=None,
        help="Directory for configuration files"
    )
    parser.add_argument(
        "--server-root",
        type=Path,
        default=None,
        help="Directory to serve static files from"
    )
    
    return parser.parse_args(args)


def main(args: list[str] | None = None) -> int:
    """Main entry point.
    
    Args:
        args: Command line arguments (default: sys.argv[1:]).
        
    Returns:
        Exit code (0 for success).
    """
    parsed = parse_args(args)
    
    try:
        run_server(
            port=parsed.port,
            config_dir=parsed.config_dir,
            server_root=parsed.server_root
        )
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

