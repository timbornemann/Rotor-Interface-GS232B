"""Simple threaded HTTP server to host the Rotor interface and expose a minimal API.

The server serves the static files from ``src/renderer`` and exposes a
``/api/commands`` endpoint to send and fetch rotor commands. All API
requests require the correct API key via ``X-API-Key`` header or a
``key`` query parameter. The key is configurable but may also be left
hard-coded for quick local use.
"""

from __future__ import annotations

import argparse
import json
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import parse_qs, urlparse

SERVER_ROOT = Path(__file__).parent / "src" / "renderer"
DEFAULT_API_KEY = "rotor-secret-key"
DEFAULT_PORT = 8081

# In-memory store for received commands.
COMMAND_LOG: List[Dict[str, Any]] = []
COMMAND_LOCK = threading.Lock()


def iso_timestamp() -> str:
    """Return a simple UTC ISO timestamp."""

    return datetime.now(tz=timezone.utc).isoformat()


class RotorHandler(SimpleHTTPRequestHandler):
    """Serve static files and a minimal authenticated API."""

    server_version = "RotorHTTP/0.1"

    def __init__(self, *args: Any, directory: str | None = None, api_key: str, **kwargs: Any) -> None:
        self.api_key = api_key
        super().__init__(*args, directory=directory or str(SERVER_ROOT), **kwargs)

    # --- helpers ---------------------------------------------------------
    def _send_json(self, payload: Dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorized(self) -> bool:
        parsed = urlparse(self.path)
        query_key = parse_qs(parsed.query).get("key", [None])[0]
        header_key = self.headers.get("X-API-Key")
        return query_key == self.api_key or header_key == self.api_key

    def _require_auth(self) -> bool:
        if self._authorized():
            return True
        self._send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
        return False

    def _read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    # --- routing ---------------------------------------------------------
    def do_OPTIONS(self) -> None:
        # Minimal CORS support for API usage from the frontend.
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/commands":
            if not self._require_auth():
                return
            with COMMAND_LOCK:
                commands = list(COMMAND_LOG)
            self._send_json({"commands": commands})
            return

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/commands":
            if not self._require_auth():
                return

            payload = self._read_json_body()
            command = payload.get("command")
            meta = payload.get("meta", {})
            if not isinstance(command, str) or not command.strip():
                self._send_json({"error": "command must be a non-empty string"}, HTTPStatus.BAD_REQUEST)
                return

            entry = {
                "received_at": iso_timestamp(),
                "command": command.strip(),
                "meta": meta if isinstance(meta, dict) else {},
            }
            with COMMAND_LOCK:
                COMMAND_LOG.append(entry)
            self._send_json({"status": "ok", "entry": entry}, HTTPStatus.CREATED)
            return

        self._send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    # --- logging ---------------------------------------------------------
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003 - matching base signature
        # Include client address and API awareness in logs.
        message = f"{self.client_address[0]} - {format % args}"
        print(message)


def run_server(port: int, api_key: str) -> None:
    handler = lambda *args, **kwargs: RotorHandler(*args, api_key=api_key, **kwargs)  # type: ignore[call-arg]
    with ThreadingHTTPServer(("0.0.0.0", port), handler) as httpd:
        print(f"Serving Rotor UI from {SERVER_ROOT} at http://localhost:{port}")
        print("API endpoint: /api/commands (use X-API-Key header or ?key=...)")
        print(f"Configured API key: {api_key}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("Shutting down server...")


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Rotor UI with a tiny authenticated API")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port for the HTTP server (default: 8081)")
    parser.add_argument(
        "--key",
        default=DEFAULT_API_KEY,
        help="API key for authentication (default is a hard-coded demo key)",
    )
    args = parser.parse_args()

    run_server(port=args.port, api_key=args.key)


if __name__ == "__main__":
    main()
