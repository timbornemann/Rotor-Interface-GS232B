"""Tests for ServerState unexpected disconnect handling and auto reconnect."""

import sys
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.core.state import ServerState


class TestStateAutoReconnect:
    """Auto reconnect behavior tests."""

    def setup_method(self):
        ServerState.reset_instance()

    def teardown_method(self):
        ServerState.reset_instance()

    def test_unexpected_disconnect_reconnects_same_port(self, tmp_path):
        """Unexpected disconnect should trigger reconnect on the same COM port."""
        state = ServerState.get_instance()
        state.initialize(config_dir=tmp_path, server_root=tmp_path)

        connect_called = threading.Event()
        connect_calls = []

        mock_connection = MagicMock()
        mock_connection.is_connected.return_value = False
        mock_connection.port = None
        mock_connection.baud_rate = 9600

        def fake_connect(port, baud_rate):
            connect_calls.append((port, baud_rate))
            mock_connection.port = port
            mock_connection.baud_rate = baud_rate
            mock_connection.is_connected.return_value = True
            connect_called.set()

        mock_connection.connect.side_effect = fake_connect
        state.rotor_connection = mock_connection
        state.route_executor = MagicMock()
        state.route_executor.is_executing.return_value = False

        with patch(
            "server.connection.port_scanner.list_available_ports",
            return_value=[{"path": "COM77"}]
        ):
            state._handle_unexpected_rotor_disconnect({
                "port": "COM77",
                "baudRate": 9600,
                "reason": "test_disconnect"
            })
            assert connect_called.wait(timeout=2.0)

        assert connect_calls == [("COM77", 9600)]
        state.cancel_auto_reconnect()

    def test_manual_disconnect_disables_auto_reconnect(self, tmp_path):
        """Manual disconnect mode should suppress auto reconnect attempts."""
        state = ServerState.get_instance()
        state.initialize(config_dir=tmp_path, server_root=tmp_path)

        mock_connection = MagicMock()
        mock_connection.is_connected.return_value = False
        state.rotor_connection = mock_connection
        state.route_executor = MagicMock()
        state.route_executor.is_executing.return_value = False
        state.notify_manual_disconnect_requested()

        with patch(
            "server.connection.port_scanner.list_available_ports",
            return_value=[{"path": "COM77"}]
        ):
            state._handle_unexpected_rotor_disconnect({
                "port": "COM77",
                "baudRate": 9600,
                "reason": "test_disconnect"
            })
            time.sleep(0.2)

        mock_connection.connect.assert_not_called()
        state.cancel_auto_reconnect()
