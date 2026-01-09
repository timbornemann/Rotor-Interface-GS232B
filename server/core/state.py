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
    from server.api.websocket import WebSocketManager
    from server.core.session_manager import SessionManager


class ServerState:
    """Singleton class managing all server state.
    
    Centralizes access to:
    - Settings manager
    - Rotor connection
    - Rotor logic controller
    - WebSocket manager
    - Session manager
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
        self.websocket_manager: Optional["WebSocketManager"] = None
        self.session_manager: Optional["SessionManager"] = None
        
        # Server configuration
        self.http_port: int = 8081
        self.websocket_port: int = 8082
        self._restart_requested: bool = False
        
        # Thread safety
        self.rotor_lock = threading.Lock()

    def initialize(
        self,
        config_dir: Optional[Path] = None,
        server_root: Optional[Path] = None,
        http_port: int = 8081,
        websocket_port: int = 8082
    ) -> None:
        """Initialize all server components.
        
        Args:
            config_dir: Directory for configuration files.
            server_root: Directory for static file serving.
            http_port: Port for HTTP server (default: 8081).
            websocket_port: Port for WebSocket server (default: 8082).
        """
        # Import here to avoid circular imports
        from server.config.settings import SettingsManager
        from server.connection.serial_connection import RotorConnection
        from server.control.rotor_logic import RotorLogic
        from server.api.websocket import WebSocketManager
        from server.core.session_manager import SessionManager
        from server.utils.logging import log
        
        if config_dir:
            self.config_dir = Path(config_dir)
        if server_root:
            self.server_root = Path(server_root)
        
        # Initialize settings
        self.settings = SettingsManager(self.config_dir)
        config = self.settings.get_all()
        
        # Override ports from config if available
        self.http_port = config.get("serverHttpPort", http_port)
        self.websocket_port = config.get("serverWebSocketPort", websocket_port)
        
        # Get server settings from config
        polling_interval_ms = config.get("serverPollingIntervalMs", 500)
        session_timeout_s = config.get("serverSessionTimeoutS", 300)
        max_clients = config.get("serverMaxClients", 10)
        
        log(f"[ServerState] Initializing with HTTP port {self.http_port}, WebSocket port {self.websocket_port}")
        
        # Initialize rotor connection with polling interval
        self.rotor_connection = RotorConnection(polling_interval_ms=polling_interval_ms)
        
        # Initialize rotor logic with connection
        self.rotor_logic = RotorLogic(self.rotor_connection)
        self.rotor_logic.update_config(config)
        
        # Initialize WebSocket manager
        self.websocket_manager = WebSocketManager()
        
        # Initialize session manager with config
        self.session_manager = SessionManager(
            session_timeout_s=session_timeout_s,
            max_clients=max_clients
        )
        
        # Cross-reference managers
        self.websocket_manager.set_session_manager(self.session_manager)
        self.session_manager.set_websocket_manager(self.websocket_manager)

    def start(self) -> None:
        """Start all background processes."""
        if self.rotor_logic:
            self.rotor_logic.start()
        if self.websocket_manager:
            self.websocket_manager.start(port=self.websocket_port)
        if self.session_manager:
            self.session_manager.start()
    
    def request_restart(self) -> None:
        """Request a server restart.
        
        Sets a flag that will be checked by the main loop to trigger
        a restart with exit code 42.
        """
        from server.utils.logging import log
        log("[ServerState] Server restart requested")
        self._restart_requested = True
    
    def is_restart_requested(self) -> bool:
        """Check if a restart has been requested.
        
        Returns:
            True if restart was requested, False otherwise.
        """
        return self._restart_requested

    def stop(self) -> None:
        """Stop all background processes and cleanup."""
        if self.rotor_logic:
            self.rotor_logic.stop()
        if self.rotor_connection:
            self.rotor_connection.disconnect()
        if self.websocket_manager:
            self.websocket_manager.stop()
        if self.session_manager:
            self.session_manager.stop()

    def reset(self) -> None:
        """Reset state for testing purposes."""
        self.stop()
        self.settings = None
        self.rotor_connection = None
        self.rotor_logic = None
        self.websocket_manager = None
        self.session_manager = None

    def broadcast_connection_state(self) -> None:
        """Broadcast current connection state to all WebSocket clients."""
        if not self.websocket_manager:
            return
            
        if self.rotor_connection and self.rotor_connection.is_connected():
            self.websocket_manager.broadcast_connection_state(
                connected=True,
                port=self.rotor_connection.port,
                baud_rate=self.rotor_connection.baud_rate
            )
        else:
            self.websocket_manager.broadcast_connection_state(
                connected=False,
                port=None,
                baud_rate=None
            )

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
