"""HTTP server initialization and lifecycle management.

Provides the main run_server function and server configuration.
"""

from __future__ import annotations

from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Optional

from server.utils.logging import log
from server.core.state import ServerState
from server.api.handler import RotorHandler


DEFAULT_PORT = 8081


def run_server(
    port: int = DEFAULT_PORT,
    config_dir: Optional[Path] = None,
    server_root: Optional[Path] = None
) -> None:
    """Start the HTTP server.
    
    Initializes all components and runs the server until interrupted.
    
    Args:
        port: The port to listen on (default: 8081).
        config_dir: Directory for configuration files (default: project root).
        server_root: Directory for static files (default: src/renderer).
    """
    # Get state singleton
    state = ServerState.get_instance()
    
    # Initialize with optional overrides
    state.initialize(config_dir=config_dir, server_root=server_root)
    
    # Set state reference on handler class
    RotorHandler.state = state
    
    # Start background processes
    state.start()
    
    # Create handler factory
    def handler_factory(*args, **kwargs):
        return RotorHandler(*args, directory=str(state.server_root), **kwargs)
    
    # Start HTTP server
    with ThreadingHTTPServer(("0.0.0.0", port), handler_factory) as httpd:
        log(f"Serving Rotor UI from {state.server_root} at http://localhost:{port}")
        log("API V2 enabled (Server-Side Logic)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            log("Shutting down...")
            state.stop()


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

