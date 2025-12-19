"""Serial connection management for rotor controllers.

Provides the RotorConnection class for managing serial communication
with GS-232B compatible rotor controllers.
"""

from __future__ import annotations

import re
import time
import threading
from typing import Any, Dict, Optional

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

    def __init__(self) -> None:
        """Initialize the rotor connection."""
        self.serial: Optional[Any] = None
        self.port: Optional[str] = None
        self.baud_rate: int = 9600
        self.read_thread: Optional[threading.Thread] = None
        self.read_active = False
        self.polling_active = False
        self.polling_thread: Optional[threading.Thread] = None
        self.buffer = ""
        self.status: Optional[Dict[str, Any]] = None
        self.status_lock = threading.Lock()
        self.write_lock = threading.Lock()

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
            self.disconnect()
     
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
            
            # Start background threads
            self.read_thread = threading.Thread(target=self._read_loop, daemon=True)
            self.read_thread.start()
            self.polling_thread = threading.Thread(target=self._polling_loop, daemon=True)
            self.polling_thread.start()
            
            log(f"[RotorConnection] Connected to {port} at {baud_rate} baud")
        except Exception as e:
            self.serial = None
            raise RuntimeError(f"Failed to connect to {port}: {e}")

    def disconnect(self) -> None:
        """Disconnect from the port."""
        self.read_active = False
        self.polling_active = False
        
        # Wait for threads to finish
        if self.read_thread and self.read_thread.is_alive():
            self.read_thread.join(timeout=2.0)
        self.read_thread = None

        if self.polling_thread and self.polling_thread.is_alive():
            self.polling_thread.join(timeout=2.0)
        self.polling_thread = None
        
        # Close serial connection
        if self.serial:
            if hasattr(self.serial, 'is_open') and self.serial.is_open:
                try:
                    self.serial.close()
                except Exception as e:
                    log(f"[RotorConnection] Error closing port: {e}")
        
        # Reset state
        self.serial = None
        self.port = None
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

    def _polling_loop(self) -> None:
        """Background thread to poll the rotor for status."""
        while self.polling_active and self.serial and self.serial.is_open:
            try:
                # Send C2 every 500ms (2x per second)
                self.send_command("C2")
                time.sleep(0.5)
            except Exception as e:
                log(f"[RotorConnection] Polling error: {e}")
                time.sleep(1.0)

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

