"""HTTP request handler for the rotor interface.

Provides the main RotorHandler class that serves static files and API endpoints.
"""

from __future__ import annotations

import re
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any, Optional, TYPE_CHECKING
from urllib.parse import urlparse

from server.api.middleware import (
    send_json, 
    read_json_body, 
    send_cors_headers,
    process_session,
    send_suspended_response,
    extract_session_id
)
from server.api import routes

if TYPE_CHECKING:
    from server.core.state import ServerState
    from server.core.session_manager import ClientSession


class RotorHandler(SimpleHTTPRequestHandler):
    """HTTP handler for serving static files and the REST API.
    
    Serves static files from the configured directory and routes
    API requests to the appropriate handlers.
    """

    server_version = "RotorHTTP/2.0"
    
    # Class-level state reference (set by server initialization)
    state: "ServerState" = None  # type: ignore
    
    # Paths that don't require session check (for initial page load)
    NO_SESSION_PATHS = {
        "/",
        "/index.html",
        "/styles.css",
        "/main.js",
        "/manifest.webmanifest",
    }
    
    # Regex patterns for client management routes
    SUSPEND_PATTERN = re.compile(r"^/api/clients/([^/]+)/suspend$")
    RESUME_PATTERN = re.compile(r"^/api/clients/([^/]+)/resume$")

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
        self._current_session: Optional["ClientSession"] = None
        super().__init__(*args, directory=directory, **kwargs)

    # --- Helper methods for subclasses/tests ---
    
    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        """Send a JSON response (convenience wrapper)."""
        send_json(self, payload, status)

    def _read_json_body(self) -> dict:
        """Read JSON from request body (convenience wrapper)."""
        return read_json_body(self)
    
    def _is_api_path(self, path: str) -> bool:
        """Check if the path is an API endpoint.
        
        Args:
            path: The request path.
            
        Returns:
            True if this is an API path.
        """
        return path.startswith("/api/")
    
    def _check_session(self) -> bool:
        """Check session for API requests.
        
        Returns:
            True if request should proceed, False if blocked.
        """
        parsed = urlparse(self.path)
        
        # Skip session check for non-API paths and static files
        if not self._is_api_path(parsed.path):
            return True
        
        # Don't check session for the session endpoint itself
        if parsed.path == "/api/session":
            return True
        
        # Process session (don't create if missing)
        session, is_blocked = process_session(self, self.state, create_if_missing=False)
        self._current_session = session
        
        if is_blocked:
            send_suspended_response(self)
            return False
        
        return True

    # --- HTTP Method Handlers ---

    def do_OPTIONS(self) -> None:
        """Handle OPTIONS requests for CORS preflight."""
        send_cors_headers(self)

    def do_GET(self) -> None:
        """Handle GET requests."""
        parsed = urlparse(self.path)
        
        # Check session for API requests
        if self._is_api_path(parsed.path):
            if not self._check_session():
                return
        
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
        
        if parsed.path == "/api/rotor/position":
            routes.handle_get_position(self, self.state)
            return
        
        if parsed.path == "/api/config/ini":
            routes.handle_get_config_ini(self, self.state)
            return
        
        if parsed.path == "/api/clients":
            routes.handle_get_clients(self, self.state)
            return
        
        if parsed.path == "/api/server/settings":
            routes.handle_get_server_settings(self, self.state)
            return
        
        # API endpoint for getting own session ID
        if parsed.path == "/api/session":
            # This endpoint creates a session if one doesn't exist
            session, _ = process_session(self, self.state, create_if_missing=True)
            if session:
                send_json(self, {
                    "sessionId": session.id,
                    "status": session.status.value
                })
            else:
                send_json(self, {"error": "Could not create session"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        
        # Static file serving
        super().do_GET()

    def do_POST(self) -> None:
        """Handle POST requests."""
        parsed = urlparse(self.path)
        
        # Check session for API requests
        if not self._check_session():
            return
        
        try:
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
            elif parsed.path == "/api/rotor/set_target_raw":
                routes.handle_set_target_raw(self, self.state)
                return

            if parsed.path == "/api/rotor/manual":
                routes.handle_manual(self, self.state)
                return

            if parsed.path == "/api/rotor/stop":
                routes.handle_stop(self, self.state)
                return
            
            if parsed.path == "/api/rotor/command":
                routes.handle_send_command(self, self.state)
                return
            
            # Client management routes
            suspend_match = self.SUSPEND_PATTERN.match(parsed.path)
            if suspend_match:
                client_id = suspend_match.group(1)
                routes.handle_suspend_client(self, self.state, client_id)
                return
            
            resume_match = self.RESUME_PATTERN.match(parsed.path)
            if resume_match:
                client_id = resume_match.group(1)
                routes.handle_resume_client(self, self.state, client_id)
                return
            
            # Server management routes
            if parsed.path == "/api/server/settings":
                routes.handle_post_server_settings(self, self.state)
                return
            
            if parsed.path == "/api/server/restart":
                routes.handle_server_restart(self, self.state)
                return

            send_json(self, {"error": "Not Found"}, HTTPStatus.NOT_FOUND)
        except Exception as e:
            # Log the error and send a proper error response
            import traceback
            from server.utils.logging import log
            log(f"[Handler] Error handling POST {parsed.path}: {e}")
            log(f"[Handler] Traceback: {traceback.format_exc()}")
            send_json(
                self, 
                {"error": "Internal server error", "message": str(e)}, 
                HTTPStatus.INTERNAL_SERVER_ERROR
            )

    def log_message(self, format: str, *args: Any) -> None:
        """Override to suppress logging for status polls.
        
        Args:
            format: Log message format string.
            args: Format arguments.
        """
        try:
            # Filter out status poll logs to keep console clean
            if len(args) > 0 and isinstance(args[0], str):
                if "GET /api/rotor/status" in args[0]:
                    return
                # Also filter WebSocket upgrade attempts
                if "GET /ws" in args[0]:
                    return
        except Exception:
            pass
            
        super().log_message(format, *args)
