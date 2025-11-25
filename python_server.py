"""Simple threaded HTTP server to host the Rotor interface and expose a minimal API.

The server serves the static files from ``src/renderer`` and exposes a
``/api/commands`` endpoint to send and fetch rotor commands. All API
requests require the correct API key via ``X-API-Key`` header or a
``key`` query parameter. The key is configurable but may also be left
hard-coded for quick local use.

The server can also manage COM port connections to the rotor controller,
allowing remote clients to control the rotor via the API.
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

SERVER_ROOT = Path(__file__).parent / "src" / "renderer"
CONFIG_DIR = Path(__file__).parent
INI_FILE = CONFIG_DIR / "rotor-config.ini"
DEFAULT_API_KEY = "rotor-secret-key"
DEFAULT_PORT = 8081

# In-memory store for received commands.
COMMAND_LOG: List[Dict[str, Any]] = []
COMMAND_LOCK = threading.Lock()

# Rotor connection state
ROTOR_CONNECTION: Optional[Any] = None
ROTOR_LOCK = threading.Lock()
ROTOR_STATUS: Optional[Dict[str, Any]] = None
ROTOR_CLIENT_COUNT: int = 0  # Anzahl der verbundenen Clients

# Calibration cache (offsets + scale factors)
CALIBRATION_DEFAULTS = {
    "azimuthOffset": 0.0,
    "elevationOffset": 0.0,
    "azimuthScaleFactor": 1.0,
    "elevationScaleFactor": 1.0,
}
CALIBRATION_SETTINGS: Dict[str, float] = CALIBRATION_DEFAULTS.copy()
CALIBRATION_MTIME: Optional[float] = None
CALIBRATION_LOCK = threading.Lock()


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
        self.buffer = ""
        self.status: Optional[Dict[str, Any]] = None
        self.status_lock = threading.Lock()

    def is_connected(self) -> bool:
        """Check if connected to a port."""
        return self.serial is not None and self.serial.is_open

    def connect(self, port: str, baud_rate: int = 9600) -> None:
        """Connect to a COM port."""
        if not SERIAL_AVAILABLE:
            raise RuntimeError("pyserial is not installed. Install with: pip install pyserial")
        
        if self.is_connected():
            self.disconnect()
        
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
            self.read_thread = threading.Thread(target=self._read_loop, daemon=True)
            self.read_thread.start()
            print(f"[RotorConnection] Connected to {port} at {baud_rate} baud")
        except Exception as e:
            self.serial = None
            raise RuntimeError(f"Failed to connect to {port}: {e}")

    def disconnect(self) -> None:
        """Disconnect from the port."""
        self.read_active = False
        if self.read_thread and self.read_thread.is_alive():
            self.read_thread.join(timeout=2.0)
        self.read_thread = None
        
        if self.serial and self.serial.is_open:
            try:
                self.serial.close()
            except Exception as e:
                print(f"[RotorConnection] Error closing port: {e}")
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
            self.serial.write(command_with_cr.encode('utf-8'))
            print(f"[RotorConnection] Sent: {command_with_cr!r}")
        except Exception as e:
            raise RuntimeError(f"Failed to send command: {e}")

    def _read_loop(self) -> None:
        """Background thread to read data from the serial port."""
        while self.read_active and self.serial and self.serial.is_open:
            try:
                if self.serial.in_waiting > 0:
                    data = self.serial.read(self.serial.in_waiting).decode('utf-8', errors='ignore')
                    self.buffer += data
                    
                    # Process complete lines
                    while '\r' in self.buffer or '\n' in self.buffer:
                        delimiter = '\r' if '\r' in self.buffer else '\n'
                        line_end = self.buffer.find(delimiter)
                        if line_end >= 0:
                            line = self.buffer[:line_end].strip()
                            self.buffer = self.buffer[line_end + 1:]
                            if line:
                                self._process_status_line(line)
                else:
                    time.sleep(0.1)
            except Exception as e:
                if self.read_active:
                    print(f"[RotorConnection] Read error: {e}")
                break

    def _process_status_line(self, line: str) -> None:
        """Process a status line from the rotor."""
        print(f"[RotorConnection] Received: {line}")
        
        status = {
            "raw": line,
            "timestamp": int(time.time() * 1000)
        }
        
        # Parse AZ=xxx
        az_match = re.search(r'AZ\s*=\s*(\d+)', line, re.IGNORECASE)
        if az_match:
            status["azimuthRaw"] = int(az_match.group(1))
            status["azimuth"] = status["azimuthRaw"]
        
        # Parse EL=xxx
        el_match = re.search(r'EL\s*=\s*(\d+)', line, re.IGNORECASE)
        if el_match:
            status["elevationRaw"] = int(el_match.group(1))
            status["elevation"] = status["elevationRaw"]
        
        with self.status_lock:
            self.status = status

    def get_status(self) -> Optional[Dict[str, Any]]:
        """Get the current status."""
        with self.status_lock:
            return self.status.copy() if self.status else None


def _safe_float(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _calibrate_value(raw_value: Optional[float], offset: float, scale: float) -> Optional[float]:
    if raw_value is None:
        return None
    safe_scale = scale if abs(scale) > 1e-9 else 1.0
    return (raw_value + offset) / safe_scale


def get_calibration_settings() -> Dict[str, float]:
    """Load calibration settings (offset + scale factors) with simple caching."""

    global CALIBRATION_MTIME, CALIBRATION_SETTINGS

    with CALIBRATION_LOCK:
        try:
            mtime = INI_FILE.stat().st_mtime
        except FileNotFoundError:
            return CALIBRATION_SETTINGS.copy()

        if CALIBRATION_MTIME == mtime:
            return CALIBRATION_SETTINGS.copy()

        parser = configparser.ConfigParser()
        try:
            parser.read(INI_FILE, encoding="utf-8")
        except Exception as exc:  # pragma: no cover - defensive
            print(f"[Calibration] Failed to read {INI_FILE}: {exc}")
            return CALIBRATION_SETTINGS.copy()

        calibration = CALIBRATION_DEFAULTS.copy()
        if parser.has_section("Calibration"):
            section = parser["Calibration"]
            calibration["azimuthOffset"] = _safe_float(section.get("azimuthOffset"), calibration["azimuthOffset"])
            calibration["elevationOffset"] = _safe_float(section.get("elevationOffset"), calibration["elevationOffset"])
            calibration["azimuthScaleFactor"] = _safe_float(
                section.get("azimuthScaleFactor"), calibration["azimuthScaleFactor"]
            )
            calibration["elevationScaleFactor"] = _safe_float(
                section.get("elevationScaleFactor"), calibration["elevationScaleFactor"]
            )

        CALIBRATION_SETTINGS = calibration
        CALIBRATION_MTIME = mtime
        return calibration.copy()


def build_status_payload(status: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Return structured status data with raw (RPH) and factor-adjusted values."""

    if not status:
        return None

    calibration = get_calibration_settings()
    azimuth_raw = status.get("azimuthRaw") if isinstance(status, dict) else None
    elevation_raw = status.get("elevationRaw") if isinstance(status, dict) else None

    calibrated = {
        "azimuth": _calibrate_value(azimuth_raw, calibration["azimuthOffset"], calibration["azimuthScaleFactor"]),
        "elevation": _calibrate_value(elevation_raw, calibration["elevationOffset"], calibration["elevationScaleFactor"]),
    }

    return {
        "timestamp": status.get("timestamp"),
        "rawLine": status.get("raw"),
        "rph": {
            "azimuth": azimuth_raw,
            "elevation": elevation_raw,
        },
        "calibrated": calibrated,
        "calibration": calibration,
    }


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

    server_version = "RotorHTTP/0.1"

    def __init__(self, *args: Any, directory: str | None = None, **kwargs: Any) -> None:
        super().__init__(*args, directory=directory or str(SERVER_ROOT), **kwargs)

    def _get_default_ini_content(self) -> str:
        """Return default INI file content."""
        return """; Rotor Control Configuration
; This file is automatically generated
; Settings are organized by category

[Connection]
; Serial port connection settings
baudRate=9600
pollingIntervalMs=1000
simulation=false ; alternatives: true, false
connectionMode=local ; alternatives: local, server

[Coordinates]
; Map display coordinates
mapLatitude=null
mapLongitude=null
satelliteMapEnabled=false ; alternatives: true, false
mapZoomLevel=15
mapZoomMin=5
mapZoomMax=25

[Cone]
; Cone visualization settings
coneAngle=10
coneLength=1000
azimuthDisplayOffset=0
coneAngleMin=1
coneAngleMax=90
coneLengthMin=0
coneLengthMax=100000
azimuthDisplayOffsetMin=-180
azimuthDisplayOffsetMax=180

[Speed]
; Rotor movement speeds in degrees per second
azimuthSpeedDegPerSec=4
elevationSpeedDegPerSec=2
speedMinDegPerSec=0.5
speedMaxDegPerSec=20

[Ramp]
; Softstart/Softstop PI controller settings
rampEnabled=true ; alternatives: true, false
rampKp=0.4
rampKi=0.05
rampSampleTimeMs=400
rampMaxStepDeg=8
rampToleranceDeg=1.5
rampKpMin=0
rampKpMax=5
rampKiMin=0
rampKiMax=5
rampSampleTimeMsMin=100
rampSampleTimeMsMax=2000
rampMaxStepDegMin=0.1
rampMaxStepDegMax=45
rampToleranceDegMin=0.1
rampToleranceDegMax=10

[Mode]
; Azimuth rotation mode
azimuthMode=450 ; alternatives: 360, 450
elevationDisplayEnabled=true ; alternatives: true, false

[Limits]
; Soft limits for rotor movement
azimuthMinLimit=0
azimuthMaxLimit=450
elevationMinLimit=0
elevationMaxLimit=90

[Calibration]
; Calibration offsets
azimuthOffset=0
elevationOffset=0
; Scaling factors (affect how far the motor turns per degree)
azimuthScaleFactor=1.0
elevationScaleFactor=1.0
"""

    # --- helpers ---------------------------------------------------------
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
        # Minimal CORS support for API usage from the frontend.
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        global ROTOR_CONNECTION
        parsed = urlparse(self.path)
        
        # Legacy endpoint
        if parsed.path == "/api/commands":
            with COMMAND_LOCK:
                commands = list(COMMAND_LOG)
            self._send_json({"commands": commands})
            return
        
        # New rotor API endpoints
        if parsed.path == "/api/rotor/ports":
            ports = list_available_ports()
            self._send_json({"ports": ports})
            return
        
        if parsed.path == "/api/rotor/status":
            global ROTOR_CLIENT_COUNT
            with ROTOR_LOCK:
                if ROTOR_CONNECTION and ROTOR_CONNECTION.is_connected():
                    status = build_status_payload(ROTOR_CONNECTION.get_status())
                    self._send_json({
                        "connected": True,
                        "port": ROTOR_CONNECTION.port,
                        "baudRate": ROTOR_CONNECTION.baud_rate,
                        "status": status,
                        "clientCount": ROTOR_CLIENT_COUNT
                    })
                else:
                    self._send_json({"connected": False, "clientCount": 0})
            return
        
        if parsed.path == "/api/rotor/position":
            # Neuer Endpunkt: Gibt Positionen (C2-Status) mit Kegel-Einstellungen zurück
            with ROTOR_LOCK:
                if ROTOR_CONNECTION and ROTOR_CONNECTION.is_connected():
                    status = build_status_payload(ROTOR_CONNECTION.get_status())
                    
                    # Parse Query-Parameter für Kegel-Einstellungen (optional)
                    query_params = parse_qs(parsed.query)
                    try:
                        cone_angle = float(query_params.get("coneAngle", [10])[0]) if query_params.get("coneAngle") else 10
                    except (ValueError, IndexError):
                        cone_angle = 10
                    try:
                        cone_length = float(query_params.get("coneLength", [100])[0]) if query_params.get("coneLength") else 100
                    except (ValueError, IndexError):
                        cone_length = 100
                    
                    response = {
                        "connected": True,
                        "port": ROTOR_CONNECTION.port,
                        "baudRate": ROTOR_CONNECTION.baud_rate,
                        "position": status,
                        "cone": {
                            "angle": cone_angle,
                            "length": cone_length
                        }
                    }
                    self._send_json(response)
                else:
                    self._send_json({"connected": False})
            return

        if parsed.path == "/api/config/ini":
            # INI file endpoint
            try:
                if INI_FILE.exists():
                    with open(INI_FILE, 'r', encoding='utf-8') as f:
                        content = f.read()
                    self._send_json({"content": content})
                else:
                    # Create default INI file if it doesn't exist
                    default_ini = self._get_default_ini_content()
                    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
                    with open(INI_FILE, 'w', encoding='utf-8') as f:
                        f.write(default_ini)
                    self._send_json({"content": default_ini})
            except Exception as e:
                self._send_json({"error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        super().do_GET()

    def do_POST(self) -> None:
        global ROTOR_CONNECTION
        parsed = urlparse(self.path)
        
        # Legacy endpoint
        if parsed.path == "/api/commands":
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
        
        # New rotor API endpoints
        if parsed.path == "/api/rotor/connect":
            global ROTOR_CLIENT_COUNT
            payload = self._read_json_body()
            port = payload.get("port")
            baud_rate = payload.get("baudRate", 9600)
            
            if not isinstance(port, str) or not port.strip():
                self._send_json({"error": "port must be a non-empty string"}, HTTPStatus.BAD_REQUEST)
                return
            
            try:
                with ROTOR_LOCK:
                    port_str = port.strip()
                    baud_rate_int = int(baud_rate)
                    
                    # Wenn bereits eine Verbindung existiert
                    if ROTOR_CONNECTION and ROTOR_CONNECTION.is_connected():
                        # Prüfe, ob es derselbe Port ist
                        if ROTOR_CONNECTION.port == port_str and ROTOR_CONNECTION.baud_rate == baud_rate_int:
                            # Gleicher Port - erhöhe nur die Referenzzählung
                            ROTOR_CLIENT_COUNT += 1
                            self._send_json({
                                "status": "ok", 
                                "port": port_str, 
                                "baudRate": baud_rate_int,
                                "message": "Reusing existing connection"
                            })
                            return
                        else:
                            # Anderer Port - Fehler zurückgeben
                            self._send_json({
                                "error": f"Already connected to {ROTOR_CONNECTION.port} at {ROTOR_CONNECTION.baud_rate} baud. Disconnect first to change port."
                            }, HTTPStatus.BAD_REQUEST)
                            return
                    
                    # Keine bestehende Verbindung - erstelle neue
                    if ROTOR_CONNECTION is None:
                        ROTOR_CONNECTION = RotorConnection()
                    ROTOR_CONNECTION.connect(port_str, baud_rate_int)
                    ROTOR_CLIENT_COUNT = 1  # Erste Verbindung
                self._send_json({"status": "ok", "port": port_str, "baudRate": baud_rate_int})
            except Exception as e:
                self._send_json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        
        if parsed.path == "/api/rotor/disconnect":
            global ROTOR_CLIENT_COUNT
            try:
                with ROTOR_LOCK:
                    if ROTOR_CONNECTION and ROTOR_CONNECTION.is_connected():
                        # Verringere Referenzzählung
                        ROTOR_CLIENT_COUNT = max(0, ROTOR_CLIENT_COUNT - 1)
                        
                        # Trenne nur, wenn keine Clients mehr verbunden sind
                        if ROTOR_CLIENT_COUNT == 0:
                            ROTOR_CONNECTION.disconnect()
                            ROTOR_CONNECTION = None
                            self._send_json({"status": "ok", "message": "Disconnected"})
                        else:
                            self._send_json({
                                "status": "ok", 
                                "message": f"Client disconnected, {ROTOR_CLIENT_COUNT} client(s) still connected",
                                "remainingClients": ROTOR_CLIENT_COUNT
                            })
                    else:
                        # Nicht verbunden - setze Zählung auf 0
                        ROTOR_CLIENT_COUNT = 0
                        self._send_json({"status": "ok", "message": "Not connected"})
            except Exception as e:
                self._send_json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        
        if parsed.path == "/api/rotor/command":
            
            payload = self._read_json_body()
            command = payload.get("command")
            
            if not isinstance(command, str) or not command.strip():
                self._send_json({"error": "command must be a non-empty string"}, HTTPStatus.BAD_REQUEST)
                return
            
            try:
                with ROTOR_LOCK:
                    if not ROTOR_CONNECTION or not ROTOR_CONNECTION.is_connected():
                        self._send_json({"error": "not connected"}, HTTPStatus.BAD_REQUEST)
                        return
                    ROTOR_CONNECTION.send_command(command.strip())
                
                # Also log to command log
                entry = {
                    "received_at": iso_timestamp(),
                    "command": command.strip(),
                    "meta": {"source": "api"}
                }
                with COMMAND_LOCK:
                    COMMAND_LOG.append(entry)
                
                self._send_json({"status": "ok"})
            except Exception as e:
                self._send_json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
            return

        if parsed.path == "/api/config/ini":
            # INI file is read-only - do not allow saving via API
            # The INI file should be edited manually
            self._send_json({
                "error": "INI file is read-only. Please edit rotor-config.ini manually."
            }, HTTPStatus.METHOD_NOT_ALLOWED)
            return

        self._send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    # --- logging ---------------------------------------------------------
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003 - matching base signature
        # Include client address and API awareness in logs.
        message = f"{self.client_address[0]} - {format % args}"
        print(message)


def run_server(port: int) -> None:
    handler = lambda *args, **kwargs: RotorHandler(*args, **kwargs)  # type: ignore[call-arg]
    with ThreadingHTTPServer(("0.0.0.0", port), handler) as httpd:
        print(f"Serving Rotor UI from {SERVER_ROOT} at http://localhost:{port}")
        print("API endpoints (no authentication required):")
        print("  - /api/commands (legacy)")
        print("  - /api/rotor/ports - List available COM ports")
        print("  - /api/rotor/connect - Connect to a COM port")
        print("  - /api/rotor/disconnect - Disconnect from COM port")
        print("  - /api/rotor/command - Send command to rotor")
        print("  - /api/rotor/status - Get current status")
        print("  - /api/rotor/position - Get position with cone settings (C2 status)")
        print("  - /api/config/ini - Read INI configuration file (read-only)")
        if not SERIAL_AVAILABLE:
            print("WARNING: COM port functionality disabled (pyserial not installed)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("Shutting down server...")
            with ROTOR_LOCK:
                if ROTOR_CONNECTION:
                    ROTOR_CONNECTION.disconnect()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Rotor UI with a minimal API (no authentication)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port for the HTTP server (default: 8081)")
    args = parser.parse_args()

    run_server(port=args.port)


if __name__ == "__main__":
    main()
