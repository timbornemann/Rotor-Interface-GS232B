"""Tests for WebSocket server helpers."""

import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.api.websocket import WebSocketClient, WebSocketManager


class TestWebSocketManager:
    """Tests for WebSocket manager error handling."""

    def test_detects_windows_port_in_use_error(self):
        """Windows address-in-use errors should be recognized."""
        manager = WebSocketManager()
        error = OSError(10048, "Only one usage of each socket address is normally permitted")

        assert manager._is_address_in_use_error(error) is True

    def test_detects_linux_port_in_use_error(self):
        """Linux address-in-use errors should be recognized."""
        manager = WebSocketManager()
        error = OSError(98, "Address already in use")

        assert manager._is_address_in_use_error(error) is True

    def test_ignores_other_socket_errors(self):
        """Unrelated socket errors should not be treated as port conflicts."""
        manager = WebSocketManager()
        error = OSError(111, "Connection refused")

        assert manager._is_address_in_use_error(error) is False

    def test_detach_keeps_shared_session_until_last_socket_closes(self):
        """A shared localStorage session should survive until its last tab disconnects."""
        manager = WebSocketManager()
        first_socket = object()
        second_socket = object()

        manager.clients[first_socket] = WebSocketClient(
            websocket=first_socket,
            session_id="shared-session"
        )
        manager.clients[second_socket] = WebSocketClient(
            websocket=second_socket,
            session_id="shared-session"
        )

        assert manager._detach_client(first_socket) is None
        assert first_socket not in manager.clients
        assert second_socket in manager.clients

        assert manager._detach_client(second_socket) == "shared-session"
        assert second_socket not in manager.clients
