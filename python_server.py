"""Rotor Interface HTTP Server - Compatibility Wrapper.

This file provides backwards compatibility with the old monolithic server.
It delegates all functionality to the new modular server package.

The server serves static files from ``src/renderer`` and provides a REST API
for rotor control. All serial communication is handled server-side - the
frontend only calls API endpoints to control the rotor.

API Endpoints:
- GET  /api/settings         - Get all configuration
- POST /api/settings         - Update configuration
- GET  /api/rotor/ports      - List available COM ports
- GET  /api/rotor/status     - Get current rotor status (cached from C2 polling)
- POST /api/rotor/connect    - Connect to a COM port
- POST /api/rotor/disconnect - Disconnect from COM port
- POST /api/rotor/set_target - Set target azimuth/elevation
- POST /api/rotor/manual     - Start manual movement (R/L/U/D)
- POST /api/rotor/stop       - Stop all motion

Usage:
    python python_server.py [--port PORT]
    
For the new modular server, use:
    python -m server.main [--port PORT]
"""

from __future__ import annotations

# Re-export from new modular structure for backwards compatibility
from server.core.server import run_server, DEFAULT_PORT
from server.config.settings import SettingsManager
from server.connection.serial_connection import RotorConnection
from server.connection.port_scanner import list_available_ports, SERIAL_AVAILABLE
from server.control.rotor_logic import RotorLogic
from server.api.handler import RotorHandler
from server.utils.logging import log

# For test compatibility - expose these globals (but prefer using ServerState)
from server.core.state import ServerState

__all__ = [
    "run_server",
    "SettingsManager", 
    "RotorConnection",
    "RotorLogic",
    "RotorHandler",
    "list_available_ports",
    "SERIAL_AVAILABLE",
    "log",
    "DEFAULT_PORT",
]


def main() -> None:
    """Main entry point for backwards compatibility."""
    from server.main import main as server_main
    server_main()


if __name__ == "__main__":
    main()
