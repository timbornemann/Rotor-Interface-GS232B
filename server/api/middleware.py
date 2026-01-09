"""HTTP middleware utilities for the API.

Provides helper functions for JSON handling, CORS support, and session management.
"""

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, Optional, Tuple

from server.core.session_manager import ClientSession


def send_json(
    handler: BaseHTTPRequestHandler,
    payload: Dict[str, Any],
    status: HTTPStatus = HTTPStatus.OK
) -> None:
    """Send a JSON response.
    
    Args:
        handler: The HTTP request handler instance.
        payload: The dictionary to serialize as JSON.
        status: HTTP status code (default: 200 OK).
    """
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(data)))
    # Add CORS headers to all JSON responses
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(data)


def read_json_body(handler: BaseHTTPRequestHandler) -> Dict[str, Any]:
    """Read and parse JSON from request body.
    
    Args:
        handler: The HTTP request handler instance.
        
    Returns:
        Parsed JSON as dictionary, or empty dict if parsing fails.
    """
    length = int(handler.headers.get("Content-Length", 0))
    raw = handler.rfile.read(length) if length else b"{}"
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return {}


def send_cors_headers(handler: BaseHTTPRequestHandler) -> None:
    """Send CORS preflight response headers.
    
    Args:
        handler: The HTTP request handler instance.
    """
    handler.send_response(HTTPStatus.NO_CONTENT)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, X-Session-ID")
    handler.end_headers()


def extract_session_id(handler: BaseHTTPRequestHandler) -> Optional[str]:
    """Extract session ID from request headers or cookies.
    
    Looks for session ID in:
    1. X-Session-ID header
    2. session_id cookie
    
    Args:
        handler: The HTTP request handler instance.
        
    Returns:
        Session ID if found, None otherwise.
    """
    # Try header first
    session_id = handler.headers.get("X-Session-ID")
    if session_id:
        return session_id
    
    # Try cookie
    cookies = handler.headers.get("Cookie", "")
    for cookie in cookies.split(";"):
        cookie = cookie.strip()
        if cookie.startswith("session_id="):
            return cookie.split("=", 1)[1]
    
    return None


def get_client_ip(handler: BaseHTTPRequestHandler) -> str:
    """Extract client IP address from request.
    
    Handles X-Forwarded-For header for proxied requests.
    
    Args:
        handler: The HTTP request handler instance.
        
    Returns:
        Client IP address.
    """
    # Check for proxy header
    forwarded_for = handler.headers.get("X-Forwarded-For")
    if forwarded_for:
        # Take the first IP in the chain
        return forwarded_for.split(",")[0].strip()
    
    # Use direct connection IP
    return handler.client_address[0]


def get_user_agent(handler: BaseHTTPRequestHandler) -> str:
    """Extract User-Agent from request headers.
    
    Args:
        handler: The HTTP request handler instance.
        
    Returns:
        User-Agent string or "Unknown".
    """
    return handler.headers.get("User-Agent", "Unknown")


def process_session(handler: BaseHTTPRequestHandler, state: Any, create_if_missing: bool = False) -> Tuple[Optional[ClientSession], bool]:
    """Process session for a request.
    
    Extracts session from the request and checks if it's suspended.
    Does NOT create a new session unless explicitly requested.
    
    Args:
        handler: The HTTP request handler instance.
        state: The ServerState instance.
        create_if_missing: If True, create a new session if none exists.
        
    Returns:
        Tuple of (session, is_blocked). If is_blocked is True, the request should be rejected.
    """
    if not state.session_manager:
        return None, False
    
    session_id = extract_session_id(handler)
    
    # If no session ID provided and we shouldn't create one, just return None
    if not session_id and not create_if_missing:
        return None, False
    
    ip = get_client_ip(handler)
    user_agent = get_user_agent(handler)
    
    if session_id:
        # Try to get existing session
        session = state.session_manager.get_session(session_id)
        if session:
            # Check if session is suspended
            if session.is_suspended():
                return session, True
            # Update last seen
            state.session_manager.update_session_activity(session.id)
            return session, False
    
    # Create new session only if explicitly requested
    if create_if_missing:
        session = state.session_manager.get_or_create_session(None, ip, user_agent)
        return session, False
    
    return None, False


def send_suspended_response(handler: BaseHTTPRequestHandler) -> None:
    """Send a 403 Forbidden response for suspended sessions.
    
    Args:
        handler: The HTTP request handler instance.
    """
    send_json(
        handler,
        {
            "error": "Session suspended",
            "message": "Your session has been suspended. Please reload the page to reconnect."
        },
        HTTPStatus.FORBIDDEN
    )


def add_session_cookie(handler: BaseHTTPRequestHandler, session_id: str) -> None:
    """Add session cookie to response headers.
    
    Note: This should be called before send_response/end_headers.
    
    Args:
        handler: The HTTP request handler instance.
        session_id: The session ID to set.
    """
    # Set cookie with HttpOnly flag for security
    cookie = f"session_id={session_id}; Path=/; HttpOnly; SameSite=Lax"
    handler.send_header("Set-Cookie", cookie)
