"""Tests for the serial connection module."""

import pytest
import sys
import threading
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.connection.port_scanner import list_available_ports, SERIAL_AVAILABLE
import server.connection.serial_connection as serial_connection_module
from server.connection.serial_connection import RotorConnection


class TestPortScanner:
    """Tests for the port scanner module."""
    
    def test_list_ports_returns_list(self):
        """list_available_ports should return a list."""
        ports = list_available_ports()
        assert isinstance(ports, list)
    
    @pytest.mark.skipif(not SERIAL_AVAILABLE, reason="pyserial not installed")
    def test_list_ports_format(self):
        """Port entries should have expected fields."""
        ports = list_available_ports()
        # May be empty if no ports available
        for port in ports:
            assert "path" in port
            assert "friendlyName" in port
            assert "description" in port
            assert "hwid" in port


class TestRotorConnection:
    """Tests for the RotorConnection class."""
    
    @pytest.fixture
    def connection(self):
        """Create a RotorConnection instance."""
        return RotorConnection()
    
    def test_initial_state_disconnected(self, connection):
        """Initial state should be disconnected."""
        assert not connection.is_connected()
        assert connection.port is None
        assert connection.serial is None
    
    def test_get_status_returns_none_when_disconnected(self, connection):
        """get_status should return None when disconnected."""
        assert connection.get_status() is None
    
    def test_send_command_raises_when_disconnected(self, connection):
        """send_command should raise when not connected."""
        with pytest.raises(RuntimeError, match="Not connected"):
            connection.send_command("C2")
    
    @pytest.mark.skipif(not SERIAL_AVAILABLE, reason="pyserial not installed")
    def test_connect_invalid_port_raises(self, connection):
        """connect with invalid port should raise RuntimeError."""
        with pytest.raises(RuntimeError):
            connection.connect("INVALID_PORT_THAT_DOES_NOT_EXIST")
    
    def test_disconnect_when_not_connected(self, connection):
        """disconnect when not connected should not raise."""
        # Should not raise any exception
        connection.disconnect()
        assert not connection.is_connected()


class TestRotorConnectionMocked:
    """Tests for RotorConnection with mocked serial."""
    
    @pytest.fixture
    def mock_serial(self):
        """Create a mock serial connection."""
        mock = MagicMock()
        mock.is_open = True
        mock.in_waiting = 0
        return mock
    
    @pytest.fixture
    def connected_connection(self, mock_serial):
        """Create a RotorConnection with mocked serial."""
        connection = RotorConnection()
        connection.serial = mock_serial
        connection.port = "COM1"
        connection.baud_rate = 9600
        connection._connection_token = 1
        connection._stop_event = threading.Event()
        return connection
    
    def test_is_connected_with_mock(self, connected_connection):
        """is_connected should return True with mock serial."""
        assert connected_connection.is_connected()
    
    def test_send_command_with_mock(self, connected_connection, mock_serial):
        """send_command should write to serial."""
        connected_connection.send_command("C2")
        mock_serial.write.assert_called_once()
        call_args = mock_serial.write.call_args[0][0]
        assert b"C2\r" == call_args
    
    def test_send_command_appends_cr(self, connected_connection, mock_serial):
        """send_command should append CR if missing."""
        connected_connection.send_command("TEST")
        call_args = mock_serial.write.call_args[0][0]
        assert call_args.endswith(b"\r")
    
    def test_send_command_no_double_cr(self, connected_connection, mock_serial):
        """send_command should not add CR if already present."""
        connected_connection.send_command("TEST\r")
        call_args = mock_serial.write.call_args[0][0]
        assert call_args == b"TEST\r"
        assert not call_args.endswith(b"\r\r")
    
    def test_process_status_line_az_only(self, connected_connection):
        """_process_status_line should parse AZ value."""
        connected_connection._process_status_line("AZ=180")
        status = connected_connection.get_status()
        assert status is not None
        assert status["azimuthRaw"] == 180
    
    def test_process_status_line_az_el(self, connected_connection):
        """_process_status_line should parse AZ and EL values."""
        connected_connection._process_status_line("AZ=090 EL=045")
        status = connected_connection.get_status()
        assert status is not None
        assert status["azimuthRaw"] == 90
        assert status["elevationRaw"] == 45
        # Legacy fields should also be set
        assert status["azimuth"] == 90
        assert status["elevation"] == 45
    
    def test_process_status_line_preserves_raw(self, connected_connection):
        """_process_status_line should preserve raw line."""
        raw_line = "AZ=123 EL=045"
        connected_connection._process_status_line(raw_line)
        status = connected_connection.get_status()
        assert status["raw"] == raw_line
        assert "timestamp" in status
    
    def test_process_status_line_includes_timestamp(self, connected_connection):
        """_process_status_line should include timestamp."""
        connected_connection._process_status_line("AZ=180 EL=045")
        status = connected_connection.get_status()
        assert status is not None
        assert "timestamp" in status
        assert isinstance(status["timestamp"], int)

    def test_process_status_line_ignores_invalid_numeric_values(self, connected_connection):
        """Invalid AZ/EL values should not abort status parsing."""
        connected_connection._process_status_line("AZ=abc EL=045")

        status = connected_connection.get_status()
        assert status is not None
        assert status["raw"] == "AZ=abc EL=045"
        assert "azimuthRaw" not in status
        assert status["elevationRaw"] == 45

    def test_connect_closes_port_when_startup_fails(self):
        """connect should close an opened port if setup fails after Serial() succeeds."""
        connection = RotorConnection()
        mock_serial = MagicMock()
        mock_serial.is_open = True

        serial_mock = MagicMock()
        serial_mock.Serial.return_value = mock_serial
        serial_mock.PARITY_NONE = object()
        serial_mock.STOPBITS_ONE = object()

        with patch.object(serial_connection_module, "SERIAL_AVAILABLE", True):
            with patch.object(serial_connection_module, "serial", serial_mock, create=True):
                with patch.object(connection, "_start_background_threads", side_effect=RuntimeError("thread failure")):
                    with pytest.raises(RuntimeError, match="thread failure"):
                        connection.connect("COM1")

        mock_serial.close.assert_called_once()
        assert connection.serial is None
        assert connection.port is None
        assert not connection.read_active
        assert not connection.polling_active

    def test_old_thread_context_is_invalidated_after_disconnect(self):
        """Worker threads from an old connection must not remain valid after disconnect."""
        connection = RotorConnection()
        mock_serial = MagicMock()
        mock_serial.is_open = True
        stop_event = threading.Event()

        with connection.serial_lock:
            connection.serial = mock_serial
            connection.port = "COM1"
            connection._connection_token = 1
            connection._stop_event = stop_event

        assert connection._is_thread_current(mock_serial, 1, stop_event)

        connection.disconnect()

        assert stop_event.is_set()
        assert not connection._is_thread_current(mock_serial, 1, stop_event)

    def test_send_command_io_error_disconnects_and_notifies_once(self, connected_connection, mock_serial):
        """Write failures should mark connection as lost and trigger callback exactly once."""
        callback = Mock()
        connected_connection.set_unexpected_disconnect_callback(callback)
        mock_serial.write.side_effect = OSError("USB disconnected")

        with pytest.raises(RuntimeError, match="Not connected to rotor"):
            connected_connection.send_command("C2")

        assert not connected_connection.is_connected()
        assert connected_connection.port is None
        callback.assert_called_once()
        event_payload = callback.call_args[0][0]
        assert event_payload["port"] == "COM1"
        assert event_payload["baudRate"] == 9600
        assert "Write failed" in event_payload["reason"]

    def test_polling_loop_io_error_disconnects_and_notifies_once(self, connected_connection, mock_serial):
        """Polling write errors should disconnect and notify once."""
        callback = Mock()
        connected_connection.set_unexpected_disconnect_callback(callback)
        mock_serial.write.side_effect = OSError("Cable pulled")

        stop_event = connected_connection._stop_event
        assert stop_event is not None
        connected_connection._polling_loop(mock_serial, connected_connection._connection_token, stop_event)

        assert not connected_connection.is_connected()
        callback.assert_called_once()
        event_payload = callback.call_args[0][0]
        assert event_payload["port"] == "COM1"
        assert "Polling error" in event_payload["reason"] or "Write failed" in event_payload["reason"]

    def test_read_loop_io_error_disconnects_and_notifies_once(self, connected_connection, mock_serial):
        """Read errors should disconnect and notify once."""
        callback = Mock()
        connected_connection.set_unexpected_disconnect_callback(callback)
        mock_serial.in_waiting = 1
        mock_serial.read.side_effect = OSError("Read timeout")

        stop_event = connected_connection._stop_event
        assert stop_event is not None
        connected_connection._read_loop(mock_serial, connected_connection._connection_token, stop_event)

        assert not connected_connection.is_connected()
        callback.assert_called_once()
        event_payload = callback.call_args[0][0]
        assert event_payload["port"] == "COM1"
        assert "Read failed" in event_payload["reason"]

    def test_unexpected_disconnect_callback_is_emitted_once(self, connected_connection, mock_serial):
        """Concurrent handlers should not emit duplicate disconnect callbacks."""
        callback = Mock()
        connected_connection.set_unexpected_disconnect_callback(callback)
        token = connected_connection._connection_token
        stop_event = connected_connection._stop_event
        assert stop_event is not None

        first = connected_connection._handle_unexpected_disconnect(
            mock_serial, token, stop_event, "test-disconnect"
        )
        second = connected_connection._handle_unexpected_disconnect(
            mock_serial, token, stop_event, "duplicate-disconnect"
        )

        assert first is True
        assert second is False
        callback.assert_called_once()

