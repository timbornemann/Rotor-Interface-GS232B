"""HTTP request handler for the rotor interface.

Provides the main RotorHandler class that serves static files and API endpoints.
"""

from __future__ import annotations

from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any, TYPE_CHECKING
from urllib.parse import urlparse

from server.api.middleware import send_json, read_json_body, send_cors_headers
from server.api import routes

if TYPE_CHECKING:
    from server.core.state import ServerState


class RotorHandler(SimpleHTTPRequestHandler):
    """HTTP handler for serving static files and the REST API.
    
    Serves static files from the configured directory and routes
    API requests to the appropriate handlers.
    """

    server_version = "RotorHTTP/2.0"
    
    # Class-level state reference (set by server initialization)
    state: "ServerState" = None  # type: ignore

    def __init__(
        self, 
        *args: Any, 
        directory: str | None = None, 
        **kwargs: Any
    ) -> None:
        """Initialize the handler.
        
        Args:
            directory: The directory to serve static files from.
        """
        if directory is None and self.state:
            directory = str(self.state.server_root)
        super().__init__(*args, directory=directory, **kwargs)

    # --- Helper methods for subclasses/tests ---
    
    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        """Send a JSON response (convenience wrapper)."""
        send_json(self, payload, status)

    def _read_json_body(self) -> dict:
        """Read JSON from request body (convenience wrapper)."""
        return read_json_body(self)

    # --- HTTP Method Handlers ---

    def do_OPTIONS(self) -> None:
        """Handle OPTIONS requests for CORS preflight."""
        send_cors_headers(self)

    def do_GET(self) -> None:
        """Handle GET requests."""
        parsed = urlparse(self.path)
        
        # API Routes
        if parsed.path.startswith("/api/settings"):
            routes.handle_get_settings(self, self.state)
            return

        if parsed.path == "/api/rotor/ports":
            routes.handle_get_ports(self, self.state)
            return
        
        if parsed.path == "/api/rotor/status":
            routes.handle_get_status(self, self.state)
            return
        
        # Static file serving
        super().do_GET()

    def do_POST(self) -> None:
        """Handle POST requests."""
        parsed = urlparse(self.path)
        
        if parsed.path == "/api/settings":
            routes.handle_post_settings(self, self.state)
            return

        if parsed.path == "/api/rotor/connect":
            routes.handle_connect(self, self.state)
            return

        if parsed.path == "/api/rotor/disconnect":
            routes.handle_disconnect(self, self.state)
            return

        if parsed.path == "/api/rotor/set_target":
            routes.handle_set_target(self, self.state)
            return

        if parsed.path == "/api/rotor/manual":
            routes.handle_manual(self, self.state)
            return

        if parsed.path == "/api/rotor/stop":
            routes.handle_stop(self, self.state)
            return

        send_json(self, {"error": "Not Found"}, HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args: Any) -> None:
        """Override to suppress logging for status polls.
        
        Args:
            format: Log message format string.
            args: Format arguments.
        """
        try:
            # Filter out status poll logs to keep console clean
            if len(args) > 0 and isinstance(args[0], str) and "GET /api/rotor/status" in args[0]:
                return
        except Exception:
            pass
            
        super().log_message(format, *args)

