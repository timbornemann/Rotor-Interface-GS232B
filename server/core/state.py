"""Server state management using Singleton pattern.

Provides centralized state management for all server components.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from server.config.settings import SettingsManager
    from server.connection.serial_connection import RotorConnection
    from server.control.rotor_logic import RotorLogic


class ServerState:
    """Singleton class managing all server state.
    
    Centralizes access to:
    - Settings manager
    - Rotor connection
    - Rotor logic controller
    - Client count
    - Thread locks
    """
    
    _instance: Optional["ServerState"] = None
    _lock = threading.Lock()

    def __new__(cls) -> "ServerState":
        """Create or return the singleton instance."""
        if cls._instance is None:
            with cls._lock:
                # Double-check locking pattern
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        """Initialize the state (only runs once)."""
        if self._initialized:
            return
        
        self._initialized = True
        
        # Configuration
        self.config_dir: Path = Path(__file__).parent.parent.parent
        self.server_root: Path = self.config_dir / "src" / "renderer"
        
        # Components (initialized lazily or by server)
        self.settings: Optional["SettingsManager"] = None
        self.rotor_connection: Optional["RotorConnection"] = None
        self.rotor_logic: Optional["RotorLogic"] = None
        
        # State
        self.client_count: int = 0
        
        # Thread safety
        self.rotor_lock = threading.Lock()

    def initialize(
        self,
        config_dir: Optional[Path] = None,
        server_root: Optional[Path] = None
    ) -> None:
        """Initialize all server components.
        
        Args:
            config_dir: Directory for configuration files.
            server_root: Directory for static file serving.
        """
        # Import here to avoid circular imports
        from server.config.settings import SettingsManager
        from server.connection.serial_connection import RotorConnection
        from server.control.rotor_logic import RotorLogic
        
        if config_dir:
            self.config_dir = Path(config_dir)
        if server_root:
            self.server_root = Path(server_root)
        
        # Initialize settings
        self.settings = SettingsManager(self.config_dir)
        
        # Initialize rotor connection
        self.rotor_connection = RotorConnection()
        
        # Initialize rotor logic with connection
        self.rotor_logic = RotorLogic(self.rotor_connection)
        self.rotor_logic.update_config(self.settings.get_all())

    def start(self) -> None:
        """Start all background processes."""
        if self.rotor_logic:
            self.rotor_logic.start()

    def stop(self) -> None:
        """Stop all background processes and cleanup."""
        if self.rotor_logic:
            self.rotor_logic.stop()
        if self.rotor_connection:
            self.rotor_connection.disconnect()

    def reset(self) -> None:
        """Reset state for testing purposes."""
        self.stop()
        self.settings = None
        self.rotor_connection = None
        self.rotor_logic = None
        self.client_count = 0

    @classmethod
    def get_instance(cls) -> "ServerState":
        """Get the singleton instance.
        
        Returns:
            The ServerState singleton instance.
        """
        return cls()

    @classmethod
    def reset_instance(cls) -> None:
        """Reset the singleton instance (for testing)."""
        with cls._lock:
            if cls._instance:
                cls._instance.reset()
            cls._instance = None

