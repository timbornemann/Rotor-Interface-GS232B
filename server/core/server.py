"""HTTP server initialization and lifecycle management.

Provides the main run_server function and server configuration.
"""

from __future__ import annotations

from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Optional
import socket

from server.utils.logging import log
from server.core.state import ServerState
from server.api.handler import RotorHandler


DEFAULT_PORT = 8081
DEFAULT_WEBSOCKET_PORT = 8082


def get_local_ip_addresses():
    """Get all local IP addresses of the machine.
    
    Returns:
        List of IP addresses (IPv4) available on the machine.
    """
    ip_addresses = []
    
    try:
        # Get hostname
        hostname = socket.gethostname()
        
        # Get all addresses for this hostname
        addr_info = socket.getaddrinfo(hostname, None)
        
        for info in addr_info:
            # Filter IPv4 addresses (AF_INET)
            if info[0] == socket.AF_INET:
                ip = info[4][0]
                # Skip localhost
                if ip != '127.0.0.1' and not ip.startswith('127.'):
                    if ip not in ip_addresses:
                        ip_addresses.append(ip)
        
        # Fallback: Try to get IP by connecting to external host (doesn't actually connect)
        if not ip_addresses:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                # Connect to Google DNS (doesn't send any data)
                s.connect(("8.8.8.8", 80))
                ip = s.getsockname()[0]
                if ip not in ip_addresses and ip != '127.0.0.1':
                    ip_addresses.append(ip)
            except Exception:
                pass
            finally:
                s.close()
    except Exception:
        pass
    
    return ip_addresses


def run_server(
    http_port: int = DEFAULT_PORT,
    websocket_port: int = DEFAULT_WEBSOCKET_PORT,
    config_dir: Optional[Path] = None,
    server_root: Optional[Path] = None
) -> None:
    """Start the HTTP server.
    
    Initializes all components and runs the server until interrupted.
    
    Args:
        http_port: The HTTP port to listen on (default: 8081).
        websocket_port: The port for WebSocket server (default: 8082).
        config_dir: Directory for configuration files (default: project root).
        server_root: Directory for static files (default: src/renderer).
    """
    # Get state singleton
    state = ServerState.get_instance()
    
    # Initialize with optional overrides (config can override ports)
    state.initialize(
        config_dir=config_dir, 
        server_root=server_root,
        http_port=http_port,
        websocket_port=websocket_port
    )
    
    # Set state reference on handler class
    RotorHandler.state = state
    
    # Start background processes
    state.start()
    
    # Create handler factory
    def handler_factory(*args, **kwargs):
        return RotorHandler(*args, directory=str(state.server_root), **kwargs)
    
    # Start HTTP server with configured port
    restart_requested = False
    with ThreadingHTTPServer(("0.0.0.0", state.http_port), handler_factory) as httpd:
        # Allow other components (e.g. restart endpoint) to shut down the HTTP server
        state.set_http_server(httpd)
        
        # Get all local IP addresses
        local_ips = get_local_ip_addresses()
        
        # Print server information
        log("=" * 60)
        log("Server erfolgreich gestartet!")
        log("=" * 60)
        log("")
        log("Web-Interface erreichbar unter:")
        log(f"  - http://localhost:{state.http_port}")
        for ip in local_ips:
            log(f"  - http://{ip}:{state.http_port}")
        log("")
        log("REST API erreichbar unter:")
        log(f"  - http://localhost:{state.http_port}/api/")
        for ip in local_ips:
            log(f"  - http://{ip}:{state.http_port}/api/")
        log("")
        log("WebSocket API erreichbar unter:")
        log(f"  - ws://localhost:{state.websocket_port}")
        for ip in local_ips:
            log(f"  - ws://{ip}:{state.websocket_port}")
        log("")
        log("Features:")
        log("  - API V2 (Server-Side Logic)")
        log("  - Multi-Client-Synchronisation")
        log("  - Echtzeit-Updates über WebSocket")
        log("")
        log("Zum Beenden: Strg+C drücken")
        log("=" * 60)
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            log("")
            log("=" * 60)
            log("Server wird heruntergefahren...")
            log("=" * 60)
            try:
                state.stop()
            except Exception as e:
                log(f"Fehler beim Herunterfahren: {e}")
            log("Server gestoppt")
        finally:
            restart_requested = state.is_restart_requested()
            # Detach server reference (avoid stale references across restarts/tests)
            state.set_http_server(None)

    # If a restart was requested (e.g. via /api/server/restart), exit with special code 42
    if restart_requested:
        raise SystemExit(42)


def create_test_server(
    port: int = 0,
    config_dir: Optional[Path] = None,
    server_root: Optional[Path] = None
) -> tuple:
    """Create a test server instance without starting it.
    
    Useful for integration tests that need a real server.
    
    Args:
        port: The port to listen on (0 = auto-assign).
        config_dir: Directory for configuration files.
        server_root: Directory for static files.
        
    Returns:
        Tuple of (server, state, base_url).
    """
    # Reset state for clean test
    ServerState.reset_instance()
    state = ServerState.get_instance()
    
    # Initialize with test directories
    state.initialize(config_dir=config_dir, server_root=server_root)
    
    # Set state reference on handler class
    RotorHandler.state = state
    
    # Create handler factory
    def handler_factory(*args, **kwargs):
        kwargs.setdefault('directory', str(state.server_root) if state.server_root else None)
        return RotorHandler(*args, **kwargs)
    
    # Create server with auto-assigned port
    server = ThreadingHTTPServer(("localhost", port), handler_factory)
    
    base_url = f"http://{server.server_address[0]}:{server.server_address[1]}"
    
    return server, state, base_url
