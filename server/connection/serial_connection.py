"""Serial connection management for rotor controllers.

Provides the RotorConnection class for managing serial communication
with GS-232B compatible rotor controllers.
"""

from __future__ import annotations

import re
import time
import threading
from typing import Any, Dict, Optional, Tuple

from server.utils.logging import log
from server.connection.port_scanner import SERIAL_AVAILABLE

# Conditional import of serial
if SERIAL_AVAILABLE:
    import serial


class RotorConnection:
    """Manages a serial connection to the rotor controller.
    
    Handles:
    - Serial port connection/disconnection
    - Command sending with thread-safe write lock
    - Background reading of serial data
    - Background polling (C2 command) for status updates
    - Parsing of status responses (AZ=xxx EL=xxx format)
    """

    def __init__(self, polling_interval_ms: int = 500) -> None:
        """Initialize the rotor connection.
        
        Args:
            polling_interval_ms: Interval in milliseconds for C2 status polling (default: 500ms).
        """
        self.serial: Optional[Any] = None
        self.port: Optional[str] = None
        self.baud_rate: int = 9600
        self.read_thread: Optional[threading.Thread] = None
        self.read_active = False
        self.polling_active = False
        self.polling_thread: Optional[threading.Thread] = None
        self.polling_interval_s: float = polling_interval_ms / 1000.0
        self.polling_interval_lock = threading.Lock()  # Lock for thread-safe interval updates
        self.buffer = ""
        self.status: Optional[Dict[str, Any]] = None
        self.serial_lock = threading.RLock()
        self._connection_token = 0
        self._stop_event: Optional[threading.Event] = None
        self.status_lock = threading.Lock()
        self.write_lock = threading.Lock()

    def is_connected(self) -> bool:
        """Check if connected to a port.
        
        Returns:
            True if connected and port is open, False otherwise.
        """
        return self._get_serial_connection() is not None

    def _get_connection_context(self) -> Tuple[Optional[Any], int, Optional[threading.Event]]:
        """Get the current serial connection, token, and stop event."""
        with self.serial_lock:
            serial_connection = self.serial
            stop_event = self._stop_event
            connection_token = self._connection_token
            if serial_connection is None or stop_event is None:
                return None, connection_token, stop_event
            if not getattr(serial_connection, "is_open", False):
                return None, connection_token, stop_event
            return serial_connection, connection_token, stop_event

    def _get_serial_connection(self) -> Optional[Any]:
        """Get the current open serial connection, if any."""
        serial_connection, _, _ = self._get_connection_context()
        return serial_connection

    def _is_thread_current(
        self,
        serial_connection: Any,
        connection_token: int,
        stop_event: threading.Event
    ) -> bool:
        """Check whether a worker thread still belongs to the active connection."""
        if stop_event.is_set() or not getattr(serial_connection, "is_open", False):
            return False

        with self.serial_lock:
            return (
                self.serial is serial_connection
                and self._connection_token == connection_token
                and self._stop_event is stop_event
            )

    def _close_serial_connection(self, serial_connection: Optional[Any]) -> None:
        """Close a serial connection safely."""
        if not serial_connection or not getattr(serial_connection, "is_open", False):
            return

        try:
            serial_connection.close()
        except Exception as e:
            log(f"[RotorConnection] Error closing port: {e}")

    def _write_to_connection(
        self,
        serial_connection: Any,
        connection_token: int,
        stop_event: threading.Event,
        command: str
    ) -> None:
        """Write a command to a specific active serial connection."""
        command_with_cr = command if command.endswith('\r') else f"{command}\r"
        with self.write_lock:
            if not self._is_thread_current(serial_connection, connection_token, stop_event):
                raise RuntimeError("Not connected to rotor")
            serial_connection.write(command_with_cr.encode('utf-8'))
        log(f"[RotorConnection] Sent: {command_with_cr!r}")

    def _start_background_threads(
        self,
        serial_connection: Any,
        connection_token: int,
        stop_event: threading.Event
    ) -> None:
        """Start the background read and polling threads."""
        self.read_thread = threading.Thread(
            target=self._read_loop,
            args=(serial_connection, connection_token, stop_event),
            daemon=True
        )
        self.read_thread.start()
        self.polling_thread = threading.Thread(
            target=self._polling_loop,
            args=(serial_connection, connection_token, stop_event),
            daemon=True
        )
        self.polling_thread.start()

    def _join_background_threads(self) -> None:
        """Wait for background threads to finish and clear references."""
        current_thread = threading.current_thread()

        if self.read_thread and self.read_thread.is_alive() and self.read_thread is not current_thread:
            self.read_thread.join(timeout=2.0)
            if self.read_thread.is_alive():
                log("[RotorConnection] Warning: read thread did not stop within timeout")
        self.read_thread = None

        if self.polling_thread and self.polling_thread.is_alive() and self.polling_thread is not current_thread:
            self.polling_thread.join(timeout=2.0)
            if self.polling_thread.is_alive():
                log("[RotorConnection] Warning: polling thread did not stop within timeout")
        self.polling_thread = None

    def connect(self, port: str, baud_rate: int = 9600) -> None:
        """Connect to a COM port.
        
        Args:
            port: The serial port to connect to (e.g., "COM3").
            baud_rate: The baud rate for communication (default: 9600).
            
        Raises:
            RuntimeError: If pyserial is not installed or connection fails.
        """
        if self.is_connected():
            self.disconnect()
     
        if not SERIAL_AVAILABLE:
            raise RuntimeError("pyserial is not installed. Install with: pip install pyserial")
        
        serial_connection = None
        stop_event: Optional[threading.Event] = None
        try:
            serial_connection = serial.Serial(
                port=port,
                baudrate=baud_rate,
                bytesize=8,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=1.0,
                write_timeout=1.0
            )
            stop_event = threading.Event()

            with self.serial_lock:
                self._connection_token += 1
                connection_token = self._connection_token
                self.serial = serial_connection
                self.port = port
                self._stop_event = stop_event
            self.baud_rate = baud_rate
            self.read_active = True
            self.polling_active = True
            self.buffer = ""
            
            self._start_background_threads(serial_connection, connection_token, stop_event)
            
            log(f"[RotorConnection] Connected to {port} at {baud_rate} baud")
        except Exception as e:
            self.read_active = False
            self.polling_active = False
            with self.serial_lock:
                if self.serial is serial_connection or self._stop_event is stop_event:
                    self._connection_token += 1
                    self.serial = None
                    self.port = None
                    self._stop_event = None
            if stop_event:
                stop_event.set()
            self._close_serial_connection(serial_connection)
            self._join_background_threads()
            self.buffer = ""
            with self.status_lock:
                self.status = None
            raise RuntimeError(f"Failed to connect to {port}: {e}")

    def disconnect(self) -> None:
        """Disconnect from the port."""
        self.read_active = False
        self.polling_active = False

        with self.serial_lock:
            serial_connection = self.serial
            stop_event = self._stop_event
            if serial_connection is not None or stop_event is not None:
                self._connection_token += 1
            self.serial = None
            self.port = None
            self._stop_event = None

        if stop_event:
            stop_event.set()
        self._close_serial_connection(serial_connection)
        self._join_background_threads()
        
        # Reset state
        self.buffer = ""
        with self.status_lock:
            self.status = None
        log("[RotorConnection] Disconnected")

    def send_command(self, command: str) -> None:
        """Send a command to the rotor.
        
        Args:
            command: The GS-232B command to send (CR will be appended if needed).
            
        Raises:
            RuntimeError: If not connected or send fails.
        """
        try:
            serial_connection, connection_token, stop_event = self._get_connection_context()
            if serial_connection is None or stop_event is None:
                raise RuntimeError("Not connected to rotor")
            self._write_to_connection(serial_connection, connection_token, stop_event, command)
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"Failed to send command: {e}")

    def get_status(self) -> Optional[Dict[str, Any]]:
        """Get the current status.
        
        Returns:
            The current status dictionary or None if no status available.
        """
        with self.status_lock:
            return self.status

    def set_polling_interval(self, polling_interval_ms: int) -> None:
        """Update the polling interval dynamically.
        
        Args:
            polling_interval_ms: New interval in milliseconds for C2 status polling.
        """
        old_interval = self.polling_interval_s
        with self.polling_interval_lock:
            self.polling_interval_s = polling_interval_ms / 1000.0
            new_interval = self.polling_interval_s
        log(f"[RotorConnection] Polling interval changed from {old_interval*1000:.0f}ms to {polling_interval_ms}ms ({new_interval:.3f}s)")

    def _polling_loop(
        self,
        serial_connection: Any,
        connection_token: int,
        stop_event: threading.Event
    ) -> None:
        """Background thread to poll the rotor for status."""
        while not stop_event.is_set():
            if not self._is_thread_current(serial_connection, connection_token, stop_event):
                break

            try:
                # Send C2 with configured interval
                self._write_to_connection(serial_connection, connection_token, stop_event, "C2")
                
                # Sleep in small chunks to allow interval changes to take effect quickly
                # This ensures that if the interval is changed, it will be applied within
                # at most 0.1 seconds instead of waiting for the full sleep duration
                sleep_chunk = 0.1  # Sleep in 100ms chunks
                
                elapsed = 0.0
                while not stop_event.is_set():
                    if not self._is_thread_current(serial_connection, connection_token, stop_event):
                        break

                    # Get current target sleep time (re-read each iteration to catch changes)
                    with self.polling_interval_lock:
                        target_sleep = self.polling_interval_s
                    
                    # If we've already slept for the target duration, break
                    if elapsed >= target_sleep:
                        break
                    
                    # Sleep in small chunk
                    remaining = target_sleep - elapsed
                    chunk = min(sleep_chunk, remaining)
                    stop_event.wait(chunk)
                    elapsed += chunk
                        
            except Exception as e:
                if stop_event.is_set() or not self._is_thread_current(serial_connection, connection_token, stop_event):
                    break
                log(f"[RotorConnection] Polling error: {e}")
                stop_event.wait(1.0)

    def _read_loop(
        self,
        serial_connection: Any,
        connection_token: int,
        stop_event: threading.Event
    ) -> None:
        """Background thread to read data from the serial port."""
        buffer = ""
        while not stop_event.is_set():
            if not self._is_thread_current(serial_connection, connection_token, stop_event):
                break

            try:
                in_waiting = serial_connection.in_waiting
                if in_waiting > 0:
                    try:
                        data = serial_connection.read(in_waiting)
                        decoded = data.decode('utf-8', errors='ignore')
                        buffer += decoded
                        
                        # Process complete lines
                        while '\r' in buffer or '\n' in buffer:
                            delimiter = '\r' if '\r' in buffer else '\n'
                            line_end = buffer.find(delimiter)
                            if line_end >= 0:
                                line = buffer[:line_end].strip()
                                buffer = buffer[line_end + 1:]
                                if line:
                                    self._process_status_line(line)
                    except Exception as e:
                        log(f"[RotorConnection] Decode error: {e}")
                else:
                    stop_event.wait(0.1)
            except Exception:
                # Don't spam log on repetitive errors, just break if fatal
                if stop_event.is_set() or not self._is_thread_current(serial_connection, connection_token, stop_event):
                    break
                stop_event.wait(1)

    def _parse_status_value(self, raw_value: str, field_name: str) -> Optional[int]:
        """Parse a numeric field from a status response."""
        try:
            return int(raw_value)
        except (TypeError, ValueError) as e:
            log(f"[RotorConnection] Invalid {field_name} value {raw_value!r}: {e}")
            return None

    def _process_status_line(self, line: str) -> None:
        """Process a status line from the rotor.
        
        Args:
            line: The raw status line from the rotor.
        """
        status = {
            "raw": line,
            "timestamp": int(time.time() * 1000)
        }
        
        # Parse AZ=xxx
        # Expected format: AZ=123 EL=045
        az_match = re.search(r'AZ\s*=\s*([^\s]+)', line, re.IGNORECASE)
        if az_match:
            azimuth_raw = self._parse_status_value(az_match.group(1), "AZ")
            if azimuth_raw is not None:
                status["azimuthRaw"] = azimuth_raw
                status["azimuth"] = azimuth_raw  # Legacy field
        
        # Parse EL=xxx
        el_match = re.search(r'EL\s*=\s*([^\s]+)', line, re.IGNORECASE)
        if el_match:
            elevation_raw = self._parse_status_value(el_match.group(1), "EL")
            if elevation_raw is not None:
                status["elevationRaw"] = elevation_raw
                status["elevation"] = elevation_raw  # Legacy field
        
        with self.status_lock:
            self.status = status

