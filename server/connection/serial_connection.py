"""Serial connection management for rotor controllers.

Provides the RotorConnection class for managing serial communication
with GS-232B compatible rotor controllers.
"""

from __future__ import annotations

import re
import time
import threading
from typing import Any, Callable, Dict, Optional

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

    def __init__(
        self,
        polling_interval_ms: int = 500,
        heartbeat_interval_s: float = 2.0,
        health_timeout_s: float = 6.0,
        reconnect_base_delay_s: float = 1.0,
        reconnect_max_delay_s: float = 30.0,
        max_reconnect_attempts: int = 0
    ) -> None:
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
        self.status_lock = threading.Lock()
        self.write_lock = threading.Lock()
        self.health_thread: Optional[threading.Thread] = None
        self.health_active = False
        self.heartbeat_interval_s = heartbeat_interval_s
        self.health_timeout_s = health_timeout_s
        self.last_read_time: Optional[float] = None
        self.last_heartbeat_time: float = 0.0
        self.health_status = {"healthy": False, "lastSeenMs": None}
        self.health_lock = threading.Lock()
        self._last_health_broadcast_ms = 0
        self.reconnect_thread: Optional[threading.Thread] = None
        self.reconnect_active = False
        self.reconnect_attempts = 0
        self.reconnect_base_delay_s = reconnect_base_delay_s
        self.reconnect_max_delay_s = reconnect_max_delay_s
        self.max_reconnect_attempts = max_reconnect_attempts
        self.reconnect_status = {
            "reconnecting": False,
            "attempt": 0,
            "maxAttempts": max_reconnect_attempts if max_reconnect_attempts > 0 else None,
            "nextRetryMs": None,
            "lastError": None
        }
        self.reconnect_lock = threading.Lock()
        self._reconnect_enabled = False
        self.on_disconnect_reason: Optional[Callable[[str], None]] = None
        self.on_reconnect_status: Optional[Callable[[Dict[str, Any]], None]] = None
        self.on_health_status: Optional[Callable[[Dict[str, Any]], None]] = None
        self.on_connection_state_change: Optional[Callable[[bool, Optional[str], Optional[int]], None]] = None

    def set_event_handlers(
        self,
        on_disconnect_reason: Optional[Callable[[str], None]] = None,
        on_reconnect_status: Optional[Callable[[Dict[str, Any]], None]] = None,
        on_health_status: Optional[Callable[[Dict[str, Any]], None]] = None,
        on_connection_state_change: Optional[Callable[[bool, Optional[str], Optional[int]], None]] = None
    ) -> None:
        """Attach event handlers for connection changes."""
        self.on_disconnect_reason = on_disconnect_reason
        self.on_reconnect_status = on_reconnect_status
        self.on_health_status = on_health_status
        self.on_connection_state_change = on_connection_state_change

    def is_connected(self) -> bool:
        """Check if connected to a port.
        
        Returns:
            True if connected and port is open, False otherwise.
        """
        return self.serial is not None and self.serial.is_open

    def connect(self, port: str, baud_rate: int = 9600) -> None:
        """Connect to a COM port.
        
        Args:
            port: The serial port to connect to (e.g., "COM3").
            baud_rate: The baud rate for communication (default: 9600).
            
        Raises:
            RuntimeError: If pyserial is not installed or connection fails.
        """
        if self.is_connected():
            self.disconnect(reason="Reconnecting to new port")
     
        if not SERIAL_AVAILABLE:
            raise RuntimeError("pyserial is not installed. Install with: pip install pyserial")
        
        try:
            self.serial = serial.Serial(
                port=port,
                baudrate=baud_rate,
                bytesize=8,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=1.0,
                write_timeout=1.0
            )
            self.port = port
            self.baud_rate = baud_rate
            self.read_active = True
            self.polling_active = True
            self.health_active = True
            self._reconnect_enabled = True
            self.reconnect_attempts = 0
            self.last_read_time = time.time()
            self.last_heartbeat_time = time.time()
            
            # Start background threads
            self.read_thread = threading.Thread(target=self._read_loop, daemon=True)
            self.read_thread.start()
            self.polling_thread = threading.Thread(target=self._polling_loop, daemon=True)
            self.polling_thread.start()
            self.health_thread = threading.Thread(target=self._health_loop, daemon=True)
            self.health_thread.start()
            self._update_reconnect_status(reconnecting=False, attempt=0, next_retry_ms=None, last_error=None)
            self._update_health_status(healthy=True, last_seen_ms=int(self.last_read_time * 1000))
            if self.on_connection_state_change:
                self.on_connection_state_change(True, self.port, self.baud_rate)
            
            log(f"[RotorConnection] Connected to {port} at {baud_rate} baud")
        except Exception as e:
            self.serial = None
            raise RuntimeError(f"Failed to connect to {port}: {e}")

    def disconnect(self, reason: Optional[str] = None) -> None:
        """Disconnect from the port."""
        self._close_connection(reason=reason, allow_reconnect=False)

    def get_health_status(self) -> Dict[str, Any]:
        """Get current health status snapshot."""
        with self.health_lock:
            return dict(self.health_status)

    def get_reconnect_status(self) -> Dict[str, Any]:
        """Get current reconnect status snapshot."""
        with self.reconnect_lock:
            return dict(self.reconnect_status)

    def _close_connection(self, reason: Optional[str], allow_reconnect: bool) -> None:
        if reason and self.on_disconnect_reason:
            self.on_disconnect_reason(reason)
        self.read_active = False
        self.polling_active = False
        self.health_active = False
        
        # Close serial connection
        if self.serial:
            if hasattr(self.serial, 'is_open') and self.serial.is_open:
                try:
                    self.serial.close()
                except Exception as e:
                    log(f"[RotorConnection] Error closing port: {e}")

        self._join_threads()
        if not allow_reconnect:
            self._reconnect_enabled = False
            self._update_reconnect_status(reconnecting=False, attempt=self.reconnect_attempts, next_retry_ms=None, last_error=None)
            self._stop_reconnect_thread()
        else:
            self._start_reconnect()
        
        # Reset state
        self.serial = None
        if not allow_reconnect:
            self.port = None
        self.buffer = ""
        with self.status_lock:
            self.status = None
        self._update_health_status(healthy=False, last_seen_ms=self.health_status.get("lastSeenMs"))
        if self.on_connection_state_change:
            self.on_connection_state_change(False, None, None)
        log("[RotorConnection] Disconnected")

    def _join_threads(self) -> None:
        current_thread = threading.current_thread()
        if self.read_thread and self.read_thread.is_alive() and self.read_thread is not current_thread:
            self.read_thread.join(timeout=2.0)
        self.read_thread = None

        if self.polling_thread and self.polling_thread.is_alive() and self.polling_thread is not current_thread:
            self.polling_thread.join(timeout=2.0)
        self.polling_thread = None

        if self.health_thread and self.health_thread.is_alive() and self.health_thread is not current_thread:
            self.health_thread.join(timeout=2.0)
        self.health_thread = None

    def _start_reconnect(self) -> None:
        if not self._reconnect_enabled or not self.port:
            return
        if self.reconnect_thread and self.reconnect_thread.is_alive():
            return
        self.reconnect_active = True
        self.reconnect_thread = threading.Thread(target=self._reconnect_loop, daemon=True)
        self.reconnect_thread.start()

    def _stop_reconnect_thread(self) -> None:
        self.reconnect_active = False
        current_thread = threading.current_thread()
        if self.reconnect_thread and self.reconnect_thread.is_alive() and self.reconnect_thread is not current_thread:
            self.reconnect_thread.join(timeout=2.0)
        self.reconnect_thread = None

    def _update_reconnect_status(
        self,
        reconnecting: bool,
        attempt: int,
        next_retry_ms: Optional[int],
        last_error: Optional[str]
    ) -> None:
        with self.reconnect_lock:
            self.reconnect_status = {
                "reconnecting": reconnecting,
                "attempt": attempt,
                "maxAttempts": self.max_reconnect_attempts if self.max_reconnect_attempts > 0 else None,
                "nextRetryMs": next_retry_ms,
                "lastError": last_error
            }
            status_snapshot = dict(self.reconnect_status)
        if self.on_reconnect_status:
            self.on_reconnect_status(status_snapshot)

    def _update_health_status(self, healthy: bool, last_seen_ms: Optional[int]) -> None:
        now_ms = int(time.time() * 1000)
        should_broadcast = False
        with self.health_lock:
            previous = dict(self.health_status)
            self.health_status = {
                "healthy": healthy,
                "lastSeenMs": last_seen_ms
            }
            if previous.get("healthy") != healthy:
                should_broadcast = True
            elif last_seen_ms and (now_ms - self._last_health_broadcast_ms >= 1000):
                should_broadcast = True
        if should_broadcast:
            self._last_health_broadcast_ms = now_ms
            if self.on_health_status:
                self.on_health_status(dict(self.health_status))

    def _handle_connection_error(self, reason: str) -> None:
        if self.on_disconnect_reason:
            self.on_disconnect_reason(reason)
        log(f"[RotorConnection] Connection error: {reason}")
        self._update_health_status(healthy=False, last_seen_ms=self.health_status.get("lastSeenMs"))
        self._close_connection(reason=None, allow_reconnect=True)

    def _reconnect_loop(self) -> None:
        while self.reconnect_active and self._reconnect_enabled:
            if self.max_reconnect_attempts > 0 and self.reconnect_attempts >= self.max_reconnect_attempts:
                self._update_reconnect_status(
                    reconnecting=False,
                    attempt=self.reconnect_attempts,
                    next_retry_ms=None,
                    last_error="Max reconnect attempts reached"
                )
                return
            self.reconnect_attempts += 1
            delay = min(
                self.reconnect_base_delay_s * (1.5 ** max(self.reconnect_attempts - 1, 0)),
                self.reconnect_max_delay_s
            )
            next_retry_ms = int((time.time() + delay) * 1000)
            self._update_reconnect_status(
                reconnecting=True,
                attempt=self.reconnect_attempts,
                next_retry_ms=next_retry_ms,
                last_error=self.reconnect_status.get("lastError")
            )
            log(f"[RotorConnection] Reconnect attempt {self.reconnect_attempts} in {delay:.1f}s")
            time.sleep(delay)
            if not self.reconnect_active or not self._reconnect_enabled:
                return
            try:
                if not SERIAL_AVAILABLE:
                    raise RuntimeError("pyserial is not installed. Install with: pip install pyserial")
                self.serial = serial.Serial(
                    port=self.port,
                    baudrate=self.baud_rate,
                    bytesize=8,
                    parity=serial.PARITY_NONE,
                    stopbits=serial.STOPBITS_ONE,
                    timeout=1.0,
                    write_timeout=1.0
                )
                self.read_active = True
                self.polling_active = True
                self.health_active = True
                self.last_read_time = time.time()
                self.last_heartbeat_time = time.time()
                self.read_thread = threading.Thread(target=self._read_loop, daemon=True)
                self.read_thread.start()
                self.polling_thread = threading.Thread(target=self._polling_loop, daemon=True)
                self.polling_thread.start()
                self.health_thread = threading.Thread(target=self._health_loop, daemon=True)
                self.health_thread.start()
                self._update_reconnect_status(
                    reconnecting=False,
                    attempt=self.reconnect_attempts,
                    next_retry_ms=None,
                    last_error=None
                )
                self._update_health_status(healthy=True, last_seen_ms=int(self.last_read_time * 1000))
                if self.on_connection_state_change:
                    self.on_connection_state_change(True, self.port, self.baud_rate)
                log(f"[RotorConnection] Reconnected to {self.port} at {self.baud_rate} baud")
                return
            except Exception as e:
                self._update_reconnect_status(
                    reconnecting=True,
                    attempt=self.reconnect_attempts,
                    next_retry_ms=None,
                    last_error=str(e)
                )
                log(f"[RotorConnection] Reconnect failed: {e}")
                continue

    def send_command(self, command: str) -> None:
        """Send a command to the rotor.
        
        Args:
            command: The GS-232B command to send (CR will be appended if needed).
            
        Raises:
            RuntimeError: If not connected or send fails.
        """
        if not self.is_connected():
            raise RuntimeError("Not connected to rotor")
        
        command_with_cr = command if command.endswith('\r') else f"{command}\r"
        try:
            with self.write_lock:
                self.serial.write(command_with_cr.encode('utf-8'))
            log(f"[RotorConnection] Sent: {command_with_cr!r}")
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

    def _polling_loop(self) -> None:
        """Background thread to poll the rotor for status."""
        while self.polling_active and self.serial and self.serial.is_open:
            try:
                # Send C2 with configured interval
                self.send_command("C2")
                
                # Sleep in small chunks to allow interval changes to take effect quickly
                # This ensures that if the interval is changed, it will be applied within
                # at most 0.1 seconds instead of waiting for the full sleep duration
                sleep_chunk = 0.1  # Sleep in 100ms chunks
                
                elapsed = 0.0
                while self.polling_active and self.serial and self.serial.is_open:
                    # Get current target sleep time (re-read each iteration to catch changes)
                    with self.polling_interval_lock:
                        target_sleep = self.polling_interval_s
                    
                    # If we've already slept for the target duration, break
                    if elapsed >= target_sleep:
                        break
                    
                    # Sleep in small chunk
                    remaining = target_sleep - elapsed
                    chunk = min(sleep_chunk, remaining)
                    time.sleep(chunk)
                    elapsed += chunk
                        
            except Exception as e:
                self._handle_connection_error(f"Polling error: {e}")
                time.sleep(1.0)

    def _health_loop(self) -> None:
        """Background thread to monitor connection health and heartbeat."""
        while self.health_active:
            if not self.serial or not self.serial.is_open:
                time.sleep(0.5)
                continue
            now = time.time()
            last_read = self.last_read_time or now
            if self.health_timeout_s > 0 and (now - last_read) > self.health_timeout_s:
                self._handle_connection_error(
                    f"No data received for {now - last_read:.1f}s (health timeout)"
                )
                time.sleep(1.0)
                continue
            if self.heartbeat_interval_s > 0 and (now - self.last_heartbeat_time) >= self.heartbeat_interval_s:
                try:
                    self.send_command("C2")
                    self.last_heartbeat_time = now
                except Exception as e:
                    self._handle_connection_error(f"Heartbeat failed: {e}")
                    time.sleep(1.0)
                    continue
            time.sleep(0.5)

    def _read_loop(self) -> None:
        """Background thread to read data from the serial port."""
        while self.read_active and self.serial and self.serial.is_open:
            try:
                if self.serial.in_waiting > 0:
                    try:
                        data = self.serial.read(self.serial.in_waiting)
                        decoded = data.decode('utf-8', errors='ignore')
                        self.buffer += decoded
                        
                        # Process complete lines
                        while '\r' in self.buffer or '\n' in self.buffer:
                            delimiter = '\r' if '\r' in self.buffer else '\n'
                            line_end = self.buffer.find(delimiter)
                            if line_end >= 0:
                                line = self.buffer[:line_end].strip()
                                self.buffer = self.buffer[line_end + 1:]
                                if line:
                                    self._process_status_line(line)
                    except Exception as e:
                        log(f"[RotorConnection] Decode error: {e}")
                else:
                    time.sleep(0.1)
            except Exception:
                # Don't spam log on repetitive errors, just break if fatal
                if not self.serial or not self.serial.is_open:
                    self._handle_connection_error("Serial connection closed")
                    break
                time.sleep(1)

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
        az_match = re.search(r'AZ\s*=\s*(\d+)', line, re.IGNORECASE)
        if az_match:
            status["azimuthRaw"] = int(az_match.group(1))
            status["azimuth"] = status["azimuthRaw"]  # Legacy field
        
        # Parse EL=xxx
        el_match = re.search(r'EL\s*=\s*(\d+)', line, re.IGNORECASE)
        if el_match:
            status["elevationRaw"] = int(el_match.group(1))
            status["elevation"] = status["elevationRaw"]  # Legacy field
        
        with self.status_lock:
            self.status = status
        now_ms = int(time.time() * 1000)
        self.last_read_time = time.time()
        self._update_health_status(healthy=True, last_seen_ms=now_ms)
