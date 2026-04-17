"""Server state management using Singleton pattern.

Provides centralized state management for all server components.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Optional, TYPE_CHECKING, Any, Dict

if TYPE_CHECKING:
    from server.config.settings import SettingsManager
    from server.connection.serial_connection import RotorConnection
    from server.control.rotor_logic import RotorLogic
    from server.api.websocket import WebSocketManager
    from server.core.session_manager import SessionManager
    from server.routes.route_manager import RouteManager
    from server.routes.route_executor import RouteExecutor


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
        self.route_manager: Optional["RouteManager"] = None
        self.route_executor: Optional["RouteExecutor"] = None
        self.http_server: Any = None  # ThreadingHTTPServer instance (set by core.server)
        
        # Server configuration
        self.http_port: int = 8081
        self.websocket_port: int = 8082
        self._restart_requested: bool = False
        
        # Thread safety
        self.rotor_lock = threading.Lock()
        self._auto_reconnect_lock = threading.Lock()
        self._auto_reconnect_thread: Optional[threading.Thread] = None
        self._auto_reconnect_stop_event: Optional[threading.Event] = None
        self._manual_disconnect_requested = False
        self._shutdown_requested = False
        self._last_connected_port: Optional[str] = None
        self._last_connected_baud_rate: int = 9600

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
        from server.routes.route_manager import RouteManager
        from server.routes.route_executor import RouteExecutor
        from server.utils.logging import log
        
        if config_dir:
            self.config_dir = Path(config_dir)
        if server_root:
            self.server_root = Path(server_root)
        
        # Initialize settings
        self.settings = SettingsManager(self.config_dir)
        config = self.settings.get_all()
        self._shutdown_requested = False
        self._manual_disconnect_requested = False
        self._last_connected_port = None
        try:
            self._last_connected_baud_rate = int(config.get("baudRate", 9600) or 9600)
        except (TypeError, ValueError):
            self._last_connected_baud_rate = 9600
        
        # Override ports from config if available
        self.http_port = config.get("serverHttpPort", http_port)
        self.websocket_port = config.get("serverWebSocketPort", websocket_port)
        
        # Get server settings from config
        polling_interval_ms = config.get("serverPollingIntervalMs", 500)
        session_timeout_s = config.get("serverSessionTimeoutS", 300)
        max_clients = config.get("serverMaxClients", 10)
        
        log(f"[ServerState] Initializing with HTTP port {self.http_port}, WebSocket port {self.websocket_port}")
        
        # Initialize rotor connection with polling interval
        self.rotor_connection = RotorConnection(
            polling_interval_ms=polling_interval_ms,
            on_unexpected_disconnect=self._handle_unexpected_rotor_disconnect
        )
        
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
        
        # Initialize route manager
        routes_file = self.config_dir / "routes.json"
        self.route_manager = RouteManager(routes_file=routes_file)
        
        # Initialize route executor
        self.route_executor = RouteExecutor(
            route_manager=self.route_manager,
            rotor_logic=self.rotor_logic,
            websocket_manager=self.websocket_manager
        )

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
        self._shutdown_requested = True
        self.cancel_auto_reconnect()
    
    def is_restart_requested(self) -> bool:
        """Check if a restart has been requested.
        
        Returns:
            True if restart was requested, False otherwise.
        """
        return self._restart_requested

    def stop(self) -> None:
        """Stop all background processes and cleanup."""
        self._shutdown_requested = True
        self.notify_manual_disconnect_requested()
        if self.route_executor:
            self.route_executor.stop_route()
        if self.rotor_logic:
            self.rotor_logic.stop()
        if self.rotor_connection:
            self.rotor_connection.disconnect()
        if self.websocket_manager:
            self.websocket_manager.stop()
        if self.session_manager:
            self.session_manager.stop()

    def set_http_server(self, server: Any) -> None:
        """Attach the running HTTP server instance so it can be shut down on restart."""
        self.http_server = server

    def shutdown_http_server(self) -> None:
        """Request the HTTP server to stop serving (causes serve_forever() to return)."""
        from server.utils.logging import log

        if not self.http_server:
            log("[ServerState] No HTTP server instance set; cannot shutdown HTTP server", level="WARNING")
            return
        try:
            log("[ServerState] Shutting down HTTP server...")
            # ThreadingHTTPServer.shutdown() is thread-safe and will unblock serve_forever()
            self.http_server.shutdown()
        except Exception as e:
            log(f"[ServerState] Error shutting down HTTP server: {e}", level="WARNING")

    def reset(self) -> None:
        """Reset state for testing purposes."""
        self.stop()
        self.settings = None
        self.rotor_connection = None
        self.rotor_logic = None
        self.websocket_manager = None
        self.session_manager = None
        self.route_manager = None
        self.route_executor = None
        self.http_server = None

    def broadcast_connection_state(self, reason: Optional[str] = None) -> None:
        """Broadcast current connection state to all WebSocket clients."""
        if not self.websocket_manager:
            return
             
        if self.rotor_connection and self.rotor_connection.is_connected():
            self.websocket_manager.broadcast_connection_state(
                connected=True,
                port=self.rotor_connection.port,
                baud_rate=self.rotor_connection.baud_rate,
                reason=reason
            )
        else:
            self.websocket_manager.broadcast_connection_state(
                connected=False,
                port=None,
                baud_rate=None,
                reason=reason
            )

    def notify_manual_connect_attempt(self) -> None:
        """Disable manual disconnect guard and stop pending auto reconnect attempts."""
        self._manual_disconnect_requested = False
        self.cancel_auto_reconnect()

    def notify_connection_established(self, port: str, baud_rate: int) -> None:
        """Persist latest successful connection information."""
        self._last_connected_port = port
        self._last_connected_baud_rate = int(baud_rate)
        self._manual_disconnect_requested = False
        self.cancel_auto_reconnect()

    def notify_manual_disconnect_requested(self) -> None:
        """Mark disconnect as user initiated and stop auto reconnect worker."""
        self._manual_disconnect_requested = True
        self.cancel_auto_reconnect()

    def cancel_auto_reconnect(self) -> None:
        """Cancel currently running auto reconnect worker if active."""
        with self._auto_reconnect_lock:
            thread = self._auto_reconnect_thread
            stop_event = self._auto_reconnect_stop_event
            self._auto_reconnect_thread = None
            self._auto_reconnect_stop_event = None

        if stop_event:
            stop_event.set()
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=0.5)

    def _start_auto_reconnect(self, port: Optional[str], baud_rate: int) -> None:
        """Start background worker that reconnects to the last known COM port."""
        from server.utils.logging import log

        if not port:
            log("[ServerState] Auto reconnect skipped: no target port available", level="WARNING")
            return
        if self._shutdown_requested or self._manual_disconnect_requested:
            return

        self.cancel_auto_reconnect()
        stop_event = threading.Event()

        def worker() -> None:
            from server.connection.port_scanner import list_available_ports

            backoff_s = 1.0
            log(f"[ServerState] Auto reconnect worker started for {port} @ {baud_rate}")
            try:
                while not stop_event.is_set():
                    if self._shutdown_requested or self._manual_disconnect_requested:
                        return

                    if self.rotor_connection and self.rotor_connection.is_connected():
                        return

                    try:
                        available_ports = {entry.get("path") for entry in list_available_ports()}
                    except Exception as e:
                        log(f"[ServerState] Auto reconnect port scan failed: {e}", level="WARNING")
                        available_ports = set()

                    if port in available_ports:
                        with self.rotor_lock:
                            if stop_event.is_set() or self._shutdown_requested or self._manual_disconnect_requested:
                                return
                            if not self.rotor_connection or self.rotor_connection.is_connected():
                                return
                            try:
                                self.rotor_connection.connect(port, baud_rate)
                            except Exception as e:
                                log(f"[ServerState] Auto reconnect attempt failed for {port}: {e}", level="WARNING")
                            else:
                                self.notify_connection_established(port, baud_rate)
                                self.broadcast_connection_state(reason="auto_reconnect_success")
                                log(f"[ServerState] Auto reconnect succeeded on {port}")
                                return

                    stop_event.wait(backoff_s)
                    backoff_s = min(backoff_s * 1.5, 5.0)
            finally:
                with self._auto_reconnect_lock:
                    if self._auto_reconnect_thread is threading.current_thread():
                        self._auto_reconnect_thread = None
                        self._auto_reconnect_stop_event = None

        thread = threading.Thread(target=worker, daemon=True, name="RotorAutoReconnect")
        with self._auto_reconnect_lock:
            self._auto_reconnect_thread = thread
            self._auto_reconnect_stop_event = stop_event
        thread.start()

    def _handle_unexpected_rotor_disconnect(self, event: Dict[str, Any]) -> None:
        """React to unexpected COM disconnect notifications from RotorConnection."""
        from server.utils.logging import log

        if self._shutdown_requested or self._manual_disconnect_requested:
            return

        lost_port = event.get("port") or self._last_connected_port
        baud_rate = int(event.get("baudRate") or self._last_connected_baud_rate or 9600)
        reason = event.get("reason") or "unexpected_disconnect"

        if lost_port:
            self._last_connected_port = lost_port
            self._last_connected_baud_rate = baud_rate

        log(f"[ServerState] Unexpected rotor disconnect detected: port={lost_port} reason={reason}", level="WARNING")

        if self.route_executor and self.route_executor.is_executing():
            self.route_executor.stop_route()

        self.broadcast_connection_state(reason="unexpected_disconnect")
        self._start_auto_reconnect(lost_port, baud_rate)

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
