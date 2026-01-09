"""Tests for the serial connection module."""

import pytest
import sys
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.connection.port_scanner import list_available_ports, SERIAL_AVAILABLE
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

