"""Rotor Interface Server Package.

This package provides a modular HTTP server for rotor control with REST API.
"""

from server.core.server import run_server
from server.config.settings import SettingsManager
from server.control.rotor_logic import RotorLogic
from server.connection.serial_connection import RotorConnection

__all__ = [
    "run_server",
    "SettingsManager",
    "RotorLogic",
    "RotorConnection",
]

__version__ = "2.0.0"

