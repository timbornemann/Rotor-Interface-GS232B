"""Threaded HTTP server for the Rotor Interface.

The server serves static files from ``src/renderer`` and provides a REST API
for rotor control. All serial communication is handled server-side - the
frontend only calls API endpoints to control the rotor.

API Endpoints:
- GET  /api/settings         - Get all configuration
- POST /api/settings         - Update configuration
- GET  /api/rotor/ports      - List available COM ports
- GET  /api/rotor/status     - Get current rotor status (cached from C2 polling)
- POST /api/rotor/connect    - Connect to a COM port
- POST /api/rotor/disconnect - Disconnect from COM port
- POST /api/rotor/set_target - Set target azimuth/elevation
- POST /api/rotor/manual     - Start manual movement (R/L/U/D)
- POST /api/rotor/stop       - Stop all motion
"""

from __future__ import annotations

import argparse
import configparser
import json
import re
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False
    print("WARNING: pyserial not installed. COM port functionality will be disabled.")
    print("Install with: pip install pyserial")

from rotor_logic import RotorLogic
from settings_manager import SettingsManager

SERVER_ROOT = Path(__file__).parent / "src" / "renderer"
CONFIG_DIR = Path(__file__).parent
DEFAULT_PORT = 8081

# Globals
SETTINGS = SettingsManager(CONFIG_DIR)
COMMAND_LOG: List[Dict[str, Any]] = []
COMMAND_LOCK = threading.Lock()

ROTOR_CONNECTION: Optional[RotorConnection] = None
ROTOR_LOGIC: Optional[RotorLogic] = None
ROTOR_LOCK = threading.Lock()
ROTOR_CLIENT_COUNT: int = 0

def iso_timestamp() -> str:
    """Return a simple UTC ISO timestamp."""
    return datetime.now(tz=timezone.utc).isoformat()




class RotorConnection:
    """Manages a serial connection to the rotor controller."""

    def __init__(self) -> None:
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
        self.status_lock = threading.Lock()
        self.write_lock = threading.Lock()

    def is_connected(self) -> bool:
        """Check if connected to a port."""
    def is_connected(self) -> bool:
        """Check if connected to a port."""
        return self.serial is not None and self.serial.is_open

    def connect(self, port: str, baud_rate: int = 9600) -> None:
        """Connect to a COM port."""
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
            self.read_thread = threading.Thread(target=self._read_loop, daemon=True)
            self.read_thread.start()
            self.polling_thread = threading.Thread(target=self._polling_loop, daemon=True)
            self.polling_thread.start()
            print(f"[RotorConnection] Connected to {port} at {baud_rate} baud")
        except Exception as e:
            self.serial = None
            raise RuntimeError(f"Failed to connect to {port}: {e}")

    def disconnect(self) -> None:
        """Disconnect from the port."""
        self.read_active = False
        self.polling_active = False
        
        if self.read_thread and self.read_thread.is_alive():
            self.read_thread.join(timeout=2.0)
        self.read_thread = None

        if self.polling_thread and self.polling_thread.is_alive():
            self.polling_thread.join(timeout=2.0)
        self.polling_thread = None
        self.read_thread = None
        
        if self.serial:
            if hasattr(self.serial, 'is_open') and self.serial.is_open:
                try:
                    self.serial.close()
                except Exception as e:
                    print(f"[RotorConnection] Error closing port: {e}")
        self.serial = None
        self.port = None
        self.buffer = ""
        self.serial = None
        self.port = None
        self.buffer = ""
        with self.status_lock:
            self.status = None
        print("[RotorConnection] Disconnected")

    def send_command(self, command: str) -> None:
        """Send a command to the rotor."""
        if not self.is_connected():
            raise RuntimeError("Not connected to rotor")
        
        command_with_cr = command if command.endswith('\r') else f"{command}\r"
        try:
            with self.write_lock:
                 self.serial.write(command_with_cr.encode('utf-8'))
            print(f"[RotorConnection] Sent: {command_with_cr!r}")
        except Exception as e:
            raise RuntimeError(f"Failed to send command: {e}")



    def _polling_loop(self) -> None:
        """Background thread to poll the rotor for status."""
        while self.polling_active and self.serial and self.serial.is_open:
            try:
                # Send C2 every 1 second
                self.send_command("C2")
                time.sleep(1.0)
            except Exception as e:
                print(f"[RotorConnection] Polling error: {e}")
                time.sleep(2.0)

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
                        print(f"[RotorConnection] Decode error: {e}")
                else:
                    time.sleep(0.1)
            except Exception as e:
                # if self.read_active:
                #    print(f"[RotorConnection] Read error: {e}")
                # Don't spam log on repetitive errors, just break if fatal
                if not self.serial or not self.serial.is_open:
                    break
                time.sleep(1)

    def _process_status_line(self, line: str) -> None:
        """Process a status line from the rotor."""
        # Simple parsing logic
        status = {
            "raw": line,
            "timestamp": int(time.time() * 1000)
        }
        
        # Parse AZ=xxx
        # Expected format: AZ=123 EL=045
        az_match = re.search(r'AZ\s*=\s*(\d+)', line, re.IGNORECASE)
        if az_match:
            status["azimuthRaw"] = int(az_match.group(1))
            status["azimuth"] = status["azimuthRaw"] # Legacy field
        
        # Parse EL=xxx
        el_match = re.search(r'EL\s*=\s*(\d+)', line, re.IGNORECASE)
        if el_match:
            status["elevationRaw"] = int(el_match.group(1))
            status["elevation"] = status["elevationRaw"] # Legacy field
        
        with self.status_lock:
            self.status = status

    def get_status(self) -> Optional[Dict[str, Any]]:
        """Get the current status."""
        with self.status_lock:
            return self.status


def list_available_ports() -> List[Dict[str, Any]]:
    """List all available COM ports."""
    if not SERIAL_AVAILABLE:
        return []
    
    ports = []
    try:
        for port_info in serial.tools.list_ports.comports():
            ports.append({
                "path": port_info.device,
                "friendlyName": f"{port_info.device} - {port_info.description}",
                "description": port_info.description,
                "hwid": port_info.hwid
            })
    except Exception as e:
        print(f"[list_available_ports] Error: {e}")
    
    return ports


class RotorHandler(SimpleHTTPRequestHandler):
    """Serve static files and a minimal authenticated API."""

    server_version = "RotorHTTP/0.2"

    def __init__(self, *args: Any, directory: str | None = None, **kwargs: Any) -> None:
        super().__init__(*args, directory=directory or str(SERVER_ROOT), **kwargs)

    def _send_json(self, payload: Dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    # --- routing ---------------------------------------------------------
    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        global ROTOR_CONNECTION, ROTOR_CLIENT_COUNT
        parsed = urlparse(self.path)
        
        if parsed.path.startswith("/api/settings"):
             self._send_json(SETTINGS.get_all())
             return

        if parsed.path == "/api/rotor/ports":
            ports = list_available_ports()
            self._send_json({"ports": ports})
            return
        
        if parsed.path == "/api/rotor/status":
            with ROTOR_LOCK:
                if ROTOR_CONNECTION and ROTOR_CONNECTION.is_connected():
                    # Get raw status from connection
                    status = ROTOR_CONNECTION.get_status()
                    
                    # Logic: RotorLogic calculates calibrated values
                    # We can use RotorLogic's internal helper method or duplicate logic here.
                    # Or we update RotorLogic to expose a "get_current_state" method.
                    # For now we reuse the connection status + calibration from settings.
                    
                    config = SETTINGS.get_all()
                    azimuth_raw = status.get("azimuthRaw") if status else None
                    elevation_raw = status.get("elevationRaw") if status else None
                    
                    calibrated = { "azimuth": None, "elevation": None }
                    if azimuth_raw is not None:
                         scale = config.get("azimuthScaleFactor", 1.0) or 1.0
                         offset = config.get("azimuthOffset", 0.0) or 0.0
                         calibrated["azimuth"] = (azimuth_raw + offset) / scale
                    
                    if elevation_raw is not None:
                         scale = config.get("elevationScaleFactor", 1.0) or 1.0
                         offset = config.get("elevationOffset", 0.0) or 0.0
                         calibrated["elevation"] = (elevation_raw + offset) / scale

                    self._send_json({
                        "connected": True,
                        "port": ROTOR_CONNECTION.port,
                        "baudRate": ROTOR_CONNECTION.baud_rate,
                        "status": {
                             "rawLine": status.get("raw") if status else None,
                             "timestamp": status.get("timestamp") if status else None,
                             "rph": {
                                 "azimuth": azimuth_raw,
                                 "elevation": elevation_raw
                             },
                             "calibrated": calibrated
                        },
                        "clientCount": ROTOR_CLIENT_COUNT
                    })
                else:
                    self._send_json({"connected": False, "clientCount": 0})
            return
        
        super().do_GET()

    def do_POST(self) -> None:
        global ROTOR_CONNECTION, ROTOR_CLIENT_COUNT
        parsed = urlparse(self.path)
        
        if parsed.path == "/api/settings":
             payload = self._read_json_body()
             SETTINGS.update(payload)
             # Update RotorLogic config too
             if ROTOR_LOGIC:
                 ROTOR_LOGIC.update_config(SETTINGS.get_all())
             self._send_json({"status": "ok", "settings": SETTINGS.get_all()})
             return

        if parsed.path == "/api/rotor/connect":
            payload = self._read_json_body()
            port = payload.get("port")
            baud_rate = payload.get("baudRate", 9600)
            
            if not port:
                self._send_json({"error": "port required"}, HTTPStatus.BAD_REQUEST)
                return
            
            with ROTOR_LOCK:
                if ROTOR_CONNECTION is None:
                     # This should not happen if initialized in main, but safe check
                     pass # handled below
                
                try:
                    if ROTOR_CONNECTION.is_connected():
                         if ROTOR_CONNECTION.port == port:
                             ROTOR_CLIENT_COUNT += 1
                             self._send_json({"status": "ok", "message": "Already connected"})
                             return
                         else:
                             self._send_json({"error": "Already connected to another port"}, HTTPStatus.BAD_REQUEST)
                             return
                    
                    ROTOR_CONNECTION.connect(port, int(baud_rate))
                    ROTOR_CLIENT_COUNT = 1
                    self._send_json({"status": "ok"})
                except Exception as e:
                    self._send_json({"error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/api/rotor/disconnect":
            with ROTOR_LOCK:
                 if ROTOR_CONNECTION and ROTOR_CONNECTION.is_connected():
                      ROTOR_CLIENT_COUNT = max(0, ROTOR_CLIENT_COUNT - 1)
                      if ROTOR_CLIENT_COUNT == 0:
                           ROTOR_CONNECTION.disconnect()
                           self._send_json({"status": "ok", "message": "Disconnected"})
                      else:
                           self._send_json({"status": "ok", "message": "Client disconnected", "remaining": ROTOR_CLIENT_COUNT})
                 else:
                      self._send_json({"status": "ok", "message": "Not connected"})
            return

        # CONTROL ENDPOINTS
        if parsed.path == "/api/rotor/set_target":
             payload = self._read_json_body()
             az = payload.get("az")
             el = payload.get("el")
             
             if ROTOR_LOGIC:
                 ROTOR_LOGIC.set_target(az, el)
                 self._send_json({"status": "ok"})
             else:
                 self._send_json({"error": "Logic not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
             return

        if parsed.path == "/api/rotor/manual":
             payload = self._read_json_body()
             direction = payload.get("direction")
             if ROTOR_LOGIC:
                 ROTOR_LOGIC.manual_move(direction)
                 self._send_json({"status": "ok"})
             else:
                  self._send_json({"error": "Logic not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
             return

        if parsed.path == "/api/rotor/stop":
             if ROTOR_LOGIC:
                 ROTOR_LOGIC.stop_motion()
                 self._send_json({"status": "ok"})
             else:
                  self._send_json({"error": "Logic not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
             return

        self._send_json({"error": "Not Found"}, HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args: Any) -> None:
        # Suppress logging for status polls to keep console clean
        try:
            # args[0] is usually the request string like "GET /api/rotor/status HTTP/1.1" 
            # OR the status code if this is log_error -> log_message path
            # But standard log_message args are (code, message) ONLY when coming from send_error -> log_error ??
            # Actually BaseHTTPRequestHandler.log_message receives "format" and "args". 
            # If log_request calls it: log_message('"%s" %s %s', request_line, code, size) -> args=(req, code, size)
            # If log_error calls it: log_message(format, *args) -> args matches format
            
            # The error happened in send_error -> log_error("code %d, message %s", code, message)
            # So args is (code, message). code is HTTPStatus (IntEnum).
            
            # We only want to filter access logs for polls.
            # Access logs usually come from log_request -> log_message
            # Format is usually '"%s" %s %s'
            # So args[0] is the request line.
            
            if len(args) > 0 and isinstance(args[0], str) and "GET /api/rotor/status" in args[0]:
                return
        except Exception:
            pass
            
        super().log_message(format, *args)


def run_server(port: int) -> None:
    global ROTOR_CONNECTION, ROTOR_LOGIC
    
    # Initialize components
    ROTOR_CONNECTION = RotorConnection()
    ROTOR_LOGIC = RotorLogic(ROTOR_CONNECTION)
    
    # Init logic with settings
    ROTOR_LOGIC.update_config(SETTINGS.get_all())
    ROTOR_LOGIC.start()
    
    handler = lambda *args, **kwargs: RotorHandler(*args, **kwargs)
    
    with ThreadingHTTPServer(("0.0.0.0", port), handler) as httpd:
        print(f"Serving Rotor UI from {SERVER_ROOT} at http://localhost:{port}")
        print("API V2 enabled (Server-Side Logic)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("Shutting down...")
            if ROTOR_LOGIC:
                ROTOR_LOGIC.stop()
            if ROTOR_CONNECTION:
                ROTOR_CONNECTION.disconnect()

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    run_server(args.port)

if __name__ == "__main__":
    main()
