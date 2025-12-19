"""HTTP middleware utilities for the API.

Provides helper functions for JSON handling and CORS support.
"""

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict


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
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()

