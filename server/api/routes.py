"""API route handlers for the rotor interface.

Contains all route handler functions for the REST API endpoints.
"""

import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import TYPE_CHECKING, Optional, Any, Dict

from server.api.middleware import InvalidJsonError, send_json, read_json_body
from server.api.openapi import build_openapi_spec, build_swagger_ui_html, build_redoc_html
from server.connection.port_scanner import list_available_ports
from server.control.rotor_logic import RotorLogic
from server.utils.logging import log, get_current_logging_level, set_logging_level

if TYPE_CHECKING:
    from server.core.state import ServerState

DOCS_ASSET_DIR = Path(__file__).resolve().parent / "static" / "docs"
DOCS_ASSETS = {
    "swagger-ui.css": ("text/css; charset=utf-8", DOCS_ASSET_DIR / "swagger-ui.css"),
    "swagger-ui-bundle.js": ("application/javascript; charset=utf-8", DOCS_ASSET_DIR / "swagger-ui-bundle.js"),
    "redoc.standalone.js": ("application/javascript; charset=utf-8", DOCS_ASSET_DIR / "redoc.standalone.js"),
}
ROTOR_DISCONNECTED_CODE = "ROTOR_DISCONNECTED"


# --- Settings Routes ---

def _parse_number(value: object) -> Optional[float]:
    """Parse a numeric value from payload input."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _is_valid_direction(direction: object) -> bool:
    """Validate manual direction payload."""
    if not isinstance(direction, str):
        return False
    return direction in RotorLogic.DIRECTION_MAP


def _is_enabled(value: object) -> bool:
    """Interpret common truthy payload values for configuration flags."""
    return value in [True, "true", "True", 1]


def _positive_number(value: object, fallback: float) -> float:
    """Parse a positive numeric value with fallback."""
    parsed = _parse_number(value)
    if parsed is None or parsed <= 0:
        return fallback
    return parsed


def _build_status_payload(status: Optional[Dict[str, Any]], config: Dict[str, Any]) -> Dict[str, Any]:
    """Build status payload with adapter raw, corrected raw, and calibrated values."""
    azimuth_raw = status.get("azimuthRaw") if status else None
    elevation_raw = status.get("elevationRaw") if status else None

    correction_enabled = _is_enabled(config.get("feedbackCorrectionEnabled", False))
    az_feedback_factor = _positive_number(config.get("azimuthFeedbackFactor", 1.0), 1.0)
    el_feedback_factor = _positive_number(config.get("elevationFeedbackFactor", 1.0), 1.0)

    az_corrected = _parse_number(azimuth_raw)
    el_corrected = _parse_number(elevation_raw)
    if correction_enabled:
        if az_corrected is not None:
            az_corrected *= az_feedback_factor
        if el_corrected is not None:
            el_corrected *= el_feedback_factor

    az_scale = _positive_number(config.get("azimuthScaleFactor", 1.0), 1.0)
    el_scale = _positive_number(config.get("elevationScaleFactor", 1.0), 1.0)
    az_offset = _parse_number(config.get("azimuthOffset", 0.0))
    el_offset = _parse_number(config.get("elevationOffset", 0.0))
    az_offset = az_offset if az_offset is not None else 0.0
    el_offset = el_offset if el_offset is not None else 0.0

    calibrated = {"azimuth": None, "elevation": None}
    if az_corrected is not None:
        calibrated["azimuth"] = (az_corrected + az_offset) / az_scale
    if el_corrected is not None:
        calibrated["elevation"] = (el_corrected + el_offset) / el_scale

    return {
        "rawLine": status.get("raw") if status else None,
        "timestamp": status.get("timestamp") if status else None,
        "rph": {
            "azimuth": azimuth_raw,
            "elevation": elevation_raw
        },
        "correctedRaw": {
            "azimuth": az_corrected,
            "elevation": el_corrected
        },
        "calibrated": calibrated
    }


def _read_request_payload(handler: BaseHTTPRequestHandler) -> Optional[Dict[str, Any]]:
    """Read a JSON request payload and send a 400 response on malformed input."""
    try:
        return read_json_body(handler)
    except InvalidJsonError as e:
        send_json(
            handler,
            {"error": "Invalid JSON", "message": str(e)},
            HTTPStatus.BAD_REQUEST
        )
        return None


def _send_rotor_disconnected(
    handler: BaseHTTPRequestHandler,
    message: str = "Not connected to rotor"
) -> None:
    """Send normalized disconnected response payload for control endpoints."""
    send_json(
        handler,
        {"error": message, "code": ROTOR_DISCONNECTED_CODE},
        HTTPStatus.BAD_REQUEST
    )


def _is_rotor_disconnected_exception(error: Exception) -> bool:
    """Return True for runtime errors that indicate a lost/disconnected rotor link."""
    text = str(error).strip().lower()
    if not text:
        return False
    disconnected_markers = (
        "not connected",
        "connection lost",
        "write failed",
        "read failed",
        "failed to send command",
    )
    return any(marker in text for marker in disconnected_markers)


def _send_html(handler: BaseHTTPRequestHandler, html: str, status: HTTPStatus = HTTPStatus.OK) -> None:
    """Send a HTML response with CORS headers."""
    data = html.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(data)


def handle_get_openapi_json(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle GET /api/openapi.json - Return OpenAPI specification."""
    spec = build_openapi_spec(handler, state)
    send_json(handler, spec)


def handle_get_api_docs(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle GET /api/docs - Return Swagger UI page."""
    _send_html(handler, build_swagger_ui_html("/api/openapi.json", "/api/docs/assets"))


def handle_get_api_redoc(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle GET /api/redoc - Return ReDoc page."""
    _send_html(handler, build_redoc_html("/api/openapi.json"))


def handle_get_api_docs_asset(handler: BaseHTTPRequestHandler, state: "ServerState", asset_name: str) -> None:
    """Handle GET /api/docs/assets/<asset_name> - Return local docs asset."""
    asset_info = DOCS_ASSETS.get(asset_name)
    if not asset_info:
        send_json(handler, {"error": "Asset not found"}, HTTPStatus.NOT_FOUND)
        return

    content_type, asset_path = asset_info
    if not asset_path.exists():
        send_json(handler, {"error": "Asset unavailable"}, HTTPStatus.NOT_FOUND)
        return

    data = asset_path.read_bytes()
    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "public, max-age=86400")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(data)

def handle_get_settings(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle GET /api/settings - Get all configuration.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    send_json(handler, state.settings.get_all())


def handle_post_settings(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/settings - Update configuration.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    payload = _read_request_payload(handler)
    if payload is None:
        return
    state.settings.update(payload)
    
    # Update RotorLogic config too
    if state.rotor_logic:
        state.rotor_logic.update_config(state.settings.get_all())
    
    # Broadcast settings update to all clients
    if state.websocket_manager:
        state.websocket_manager.broadcast_settings_updated(state.settings.get_all())
    
    send_json(handler, {"status": "ok", "settings": state.settings.get_all()})


# --- Port Routes ---

def handle_get_ports(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle GET /api/rotor/ports - List available COM ports.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    ports = list_available_ports()
    send_json(handler, {"ports": ports})


# --- Status Routes ---

def handle_get_status(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle GET /api/rotor/status - Get current rotor status.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    with state.rotor_lock:
        # Get client count from session manager
        client_count = 0
        if state.session_manager:
            client_count = state.session_manager.get_session_count()
            
        if state.rotor_connection and state.rotor_connection.is_connected():
            # Get raw status from connection
            status = state.rotor_connection.get_status()
            
            config = state.settings.get_all()
            status_payload = _build_status_payload(status, config)

            send_json(handler, {
                "connected": True,
                "port": state.rotor_connection.port,
                "baudRate": state.rotor_connection.baud_rate,
                "status": status_payload,
                "clientCount": client_count
            })
        else:
            send_json(handler, {"connected": False, "clientCount": client_count})


# --- Connection Routes ---

def handle_connect(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/connect - Connect to a COM port.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    payload = _read_request_payload(handler)
    if payload is None:
        return
    port = payload.get("port")
    baud_rate = payload.get("baudRate", 9600)

    if not isinstance(port, str) or not port.strip():
        send_json(handler, {"error": "port must be a non-empty string"}, HTTPStatus.BAD_REQUEST)
        return

    try:
        baud_rate = int(baud_rate)
    except (TypeError, ValueError):
        send_json(handler, {"error": "baudRate must be an integer"}, HTTPStatus.BAD_REQUEST)
        return

    if baud_rate <= 0:
        send_json(handler, {"error": "baudRate must be a positive integer"}, HTTPStatus.BAD_REQUEST)
        return

    state.notify_manual_connect_attempt()
    with state.rotor_lock:
        if not state.rotor_connection:
            send_json(
                handler,
                {"error": "Rotor connection not initialized"},
                HTTPStatus.INTERNAL_SERVER_ERROR
            )
            return

        try:
            if state.rotor_connection.is_connected():
                if state.rotor_connection.port == port:
                    # Already connected to this port
                    send_json(handler, {"status": "ok", "message": "Already connected"})
                    # Still broadcast state so the requesting client gets updated
                    state.broadcast_connection_state(reason="manual_connect")
                    return
                else:
                    send_json(
                        handler, 
                        {"error": "Already connected to another port"}, 
                        HTTPStatus.BAD_REQUEST
                    )
                    return
            
            state.rotor_connection.connect(port, baud_rate)
            state.notify_connection_established(port, baud_rate)
            send_json(handler, {"status": "ok"})
            
            # Broadcast connection state to all clients
            state.broadcast_connection_state(reason="manual_connect")
            
        except Exception as e:
            send_json(handler, {"error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def handle_disconnect(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/disconnect - Disconnect from COM port.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    state.notify_manual_disconnect_requested()
    with state.rotor_lock:
        if state.rotor_connection and state.rotor_connection.is_connected():
            settings = state.settings.get_all()
            auto_park = settings.get("autoParkOnDisconnect", False)
            presets_enabled = settings.get("parkPositionsEnabled", False)
            if auto_park and presets_enabled and state.rotor_logic:
                if not state.rotor_logic.park():
                    log("[Routes] Auto-park on disconnect failed")
            state.rotor_connection.disconnect()
            send_json(handler, {"status": "ok", "message": "Disconnected"})
            
            # Broadcast disconnection to all clients
            state.broadcast_connection_state(reason="manual_disconnect")
        else:
            send_json(handler, {"status": "ok", "message": "Not connected"})


# --- Control Routes ---

def handle_set_target(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/set_target - Set target azimuth/elevation.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    try:
        payload = _read_request_payload(handler)
        if payload is None:
            return
        az = _parse_number(payload.get("az"))
        el = _parse_number(payload.get("el"))

        if az is None or el is None:
            send_json(
                handler,
                {"error": "az and el must be numeric values"},
                HTTPStatus.BAD_REQUEST
            )
            return
        
        if not state.rotor_logic:
            send_json(handler, {"error": "Logic not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        
        if not state.rotor_connection or not state.rotor_connection.is_connected():
            _send_rotor_disconnected(handler)
            return
        
        state.rotor_logic.set_target(az, el)
        send_json(handler, {"status": "ok"})
    except RuntimeError as e:
        if _is_rotor_disconnected_exception(e):
            _send_rotor_disconnected(handler, str(e))
            return
        log(f"[Routes] Runtime error in handle_set_target: {e}")
        send_json(
            handler,
            {"error": "Failed to set target", "message": str(e)},
            HTTPStatus.INTERNAL_SERVER_ERROR
        )
    except Exception as e:
        log(f"[Routes] Error in handle_set_target: {e}")
        send_json(
            handler, 
            {"error": "Failed to set target", "message": str(e)}, 
            HTTPStatus.INTERNAL_SERVER_ERROR
        )


def handle_home(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/home - Move to home preset."""
    try:
        if not state.rotor_logic:
            send_json(handler, {"error": "Logic not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        if not state.rotor_connection or not state.rotor_connection.is_connected():
            _send_rotor_disconnected(handler)
            return
        if not state.settings.get("parkPositionsEnabled", False):
            send_json(handler, {"error": "Preset positions disabled"}, HTTPStatus.BAD_REQUEST)
            return
        if not state.rotor_logic.home():
            send_json(handler, {"error": "Failed to move to home preset"}, HTTPStatus.BAD_REQUEST)
            return
        send_json(handler, {"status": "ok"})
    except RuntimeError as e:
        if _is_rotor_disconnected_exception(e):
            _send_rotor_disconnected(handler, str(e))
            return
        log(f"[Routes] Runtime error in handle_home: {e}")
        send_json(
            handler,
            {"error": "Failed to move home", "message": str(e)},
            HTTPStatus.INTERNAL_SERVER_ERROR
        )
    except Exception as e:
        log(f"[Routes] Error in handle_home: {e}")
        send_json(
            handler,
            {"error": "Failed to move home", "message": str(e)},
            HTTPStatus.INTERNAL_SERVER_ERROR
        )


def handle_park(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/park - Move to park preset."""
    try:
        if not state.rotor_logic:
            send_json(handler, {"error": "Logic not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        if not state.rotor_connection or not state.rotor_connection.is_connected():
            _send_rotor_disconnected(handler)
            return
        if not state.settings.get("parkPositionsEnabled", False):
            send_json(handler, {"error": "Preset positions disabled"}, HTTPStatus.BAD_REQUEST)
            return
        if not state.rotor_logic.park():
            send_json(handler, {"error": "Failed to move to park preset"}, HTTPStatus.BAD_REQUEST)
            return
        send_json(handler, {"status": "ok"})
    except RuntimeError as e:
        if _is_rotor_disconnected_exception(e):
            _send_rotor_disconnected(handler, str(e))
            return
        log(f"[Routes] Runtime error in handle_park: {e}")
        send_json(
            handler,
            {"error": "Failed to move park", "message": str(e)},
            HTTPStatus.INTERNAL_SERVER_ERROR
        )
    except Exception as e:
        log(f"[Routes] Error in handle_park: {e}")
        send_json(
            handler,
            {"error": "Failed to move park", "message": str(e)},
            HTTPStatus.INTERNAL_SERVER_ERROR
        )


def handle_manual(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/manual - Start manual movement.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    try:
        payload = _read_request_payload(handler)
        if payload is None:
            return
        direction = payload.get("direction")

        if not _is_valid_direction(direction):
            send_json(
                handler,
                {"error": "direction must be one of: left, right, up, down, L, R, U, D"},
                HTTPStatus.BAD_REQUEST
            )
            return
        
        if not state.rotor_logic:
            send_json(handler, {"error": "Logic not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        
        if not state.rotor_connection or not state.rotor_connection.is_connected():
            _send_rotor_disconnected(handler)
            return
        
        state.rotor_logic.manual_move(direction)
        send_json(handler, {"status": "ok"})
    except RuntimeError as e:
        if _is_rotor_disconnected_exception(e):
            _send_rotor_disconnected(handler, str(e))
            return
        log(f"[Routes] Runtime error in handle_manual: {e}")
        send_json(
            handler,
            {"error": "Failed to start manual movement", "message": str(e)},
            HTTPStatus.INTERNAL_SERVER_ERROR
        )
    except Exception as e:
        log(f"[Routes] Error in handle_manual: {e}")
        send_json(
            handler, 
            {"error": "Failed to start manual movement", "message": str(e)}, 
            HTTPStatus.INTERNAL_SERVER_ERROR
        )


def handle_set_target_raw(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/set_target_raw - Set target using raw hardware values.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    try:
        payload = _read_request_payload(handler)
        if payload is None:
            return
        az = _parse_number(payload.get("az")) if "az" in payload else None
        el = _parse_number(payload.get("el")) if "el" in payload else None

        # At least one value must be provided
        if az is None and el is None:
            send_json(
                handler,
                {"error": "At least one of 'az' or 'el' must be provided as a numeric value"},
                HTTPStatus.BAD_REQUEST
            )
            return
        
        if not state.rotor_logic:
            send_json(handler, {"error": "Logic not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        
        if not state.rotor_connection or not state.rotor_connection.is_connected():
            _send_rotor_disconnected(handler)
            return
        
        state.rotor_logic.set_target_raw(az, el)
        send_json(handler, {"status": "ok"})
    except RuntimeError as e:
        if _is_rotor_disconnected_exception(e):
            _send_rotor_disconnected(handler, str(e))
            return
        log(f"[Routes] Runtime error in handle_set_target_raw: {e}")
        send_json(
            handler,
            {"error": "Failed to set raw target", "message": str(e)},
            HTTPStatus.INTERNAL_SERVER_ERROR
        )
    except Exception as e:
        log(f"[Routes] Error in handle_set_target_raw: {e}")
        send_json(
            handler, 
            {"error": "Failed to set raw target", "message": str(e)}, 
            HTTPStatus.INTERNAL_SERVER_ERROR
        )


def handle_stop(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/stop - Stop all motion.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    try:
        if not state.rotor_logic:
            send_json(handler, {"error": "Logic not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        if not state.rotor_connection or not state.rotor_connection.is_connected():
            _send_rotor_disconnected(handler)
            return
        
        state.rotor_logic.stop_motion()
        send_json(handler, {"status": "ok"})
    except RuntimeError as e:
        if _is_rotor_disconnected_exception(e):
            _send_rotor_disconnected(handler, str(e))
            return
        log(f"[Routes] Runtime error in handle_stop: {e}")
        send_json(
            handler,
            {"error": "Failed to stop motion", "message": str(e)},
            HTTPStatus.INTERNAL_SERVER_ERROR
        )
    except Exception as e:
        log(f"[Routes] Error in handle_stop: {e}")
        send_json(
            handler, 
            {"error": "Failed to stop motion", "message": str(e)}, 
            HTTPStatus.INTERNAL_SERVER_ERROR
        )


def handle_send_command(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/command - Send direct GS-232B command.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    try:
        payload = _read_request_payload(handler)
        if payload is None:
            return
        command = payload.get("command")
        
        if not command or not isinstance(command, str):
            send_json(handler, {"error": "command must be a non-empty string"}, HTTPStatus.BAD_REQUEST)
            return
        
        if not state.rotor_connection or not state.rotor_connection.is_connected():
            _send_rotor_disconnected(handler)
            return
        
        state.rotor_connection.send_command(command)
        send_json(handler, {"status": "ok"})
    except RuntimeError as e:
        if _is_rotor_disconnected_exception(e):
            _send_rotor_disconnected(handler, str(e))
            return
        log(f"[Routes] Runtime error in handle_send_command: {e}")
        send_json(
            handler,
            {"error": "Failed to send command", "message": str(e)},
            HTTPStatus.INTERNAL_SERVER_ERROR
        )
    except Exception as e:
        log(f"[Routes] Error in handle_send_command: {e}")
        send_json(
            handler, 
            {"error": "Failed to send command", "message": str(e)}, 
            HTTPStatus.INTERNAL_SERVER_ERROR
        )


def handle_get_position(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle GET /api/rotor/position - Get position with cone visualization.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    from urllib.parse import urlparse, parse_qs
    
    # Parse query parameters
    parsed = urlparse(handler.path)
    params = parse_qs(parsed.query)
    
    try:
        cone_angle = float(params.get("coneAngle", ["10"])[0])
        cone_length = float(params.get("coneLength", ["1000"])[0])
    except (ValueError, IndexError):
        cone_angle = 10.0
        cone_length = 1000.0
    
    with state.rotor_lock:
        client_count = 0
        if state.session_manager:
            client_count = state.session_manager.get_session_count()
            
        if state.rotor_connection and state.rotor_connection.is_connected():
            status = state.rotor_connection.get_status()
            
            config = state.settings.get_all()
            status_payload = _build_status_payload(status, config)
            
            # Build calibration info
            calibration = {
                "azimuthOffset": config.get("azimuthOffset", 0.0),
                "elevationOffset": config.get("elevationOffset", 0.0),
                "azimuthScaleFactor": config.get("azimuthScaleFactor", 1.0),
                "elevationScaleFactor": config.get("elevationScaleFactor", 1.0)
            }

            send_json(handler, {
                "connected": True,
                "port": state.rotor_connection.port,
                "baudRate": state.rotor_connection.baud_rate,
                "position": {
                    **status_payload,
                    "calibration": calibration
                },
                "cone": {
                    "angle": cone_angle,
                    "length": cone_length
                },
                "clientCount": client_count
            })
        else:
            send_json(handler, {"connected": False, "clientCount": client_count})


# --- Client Management Routes ---

def handle_get_clients(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle GET /api/clients - List all connected client sessions.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    if not state.session_manager:
        send_json(handler, {"clients": []})
        return
    
    clients = state.session_manager.get_all_sessions_as_list()
    send_json(handler, {"clients": clients})


def handle_suspend_client(
    handler: BaseHTTPRequestHandler, 
    state: "ServerState", 
    client_id: str
) -> None:
    """Handle POST /api/clients/{client_id}/suspend - Suspend a client session.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
        client_id: The client session ID to suspend.
    """
    if not state.session_manager:
        send_json(handler, {"error": "Session manager not available"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return
    
    # Check if session exists
    session = state.session_manager.get_session(client_id)
    if not session:
        send_json(handler, {"error": "Client not found"}, HTTPStatus.NOT_FOUND)
        return
    
    # Suspend the session
    state.session_manager.suspend_session(client_id)
    send_json(handler, {"status": "ok", "message": f"Client {client_id[:8]}... suspended"})


def handle_resume_client(
    handler: BaseHTTPRequestHandler, 
    state: "ServerState", 
    client_id: str
) -> None:
    """Handle POST /api/clients/{client_id}/resume - Resume a suspended client session.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
        client_id: The client session ID to resume.
    """
    if not state.session_manager:
        send_json(handler, {"error": "Session manager not available"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return
    
    # Check if session exists
    session = state.session_manager.get_session(client_id)
    if not session:
        send_json(handler, {"error": "Client not found"}, HTTPStatus.NOT_FOUND)
        return
    
    # Resume the session
    state.session_manager.resume_session(client_id)
    send_json(handler, {"status": "ok", "message": f"Client {client_id[:8]}... resumed"})


# --- Server Management Routes ---

def handle_get_server_settings(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle GET /api/server/settings - Get server configuration.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    settings = {
        "httpPort": state.http_port,
        "webSocketPort": state.websocket_port,
        "pollingIntervalMs": int(state.rotor_connection.polling_interval_s * 1000) if state.rotor_connection else 500,
        "sessionTimeoutS": state.session_manager.session_timeout_s if state.session_manager else 300,
        "maxClients": state.session_manager.max_clients if state.session_manager else 10,
        "loggingLevel": get_current_logging_level(),
        "requireSession": bool(state.settings.get("serverRequireSession", False))
    }
    send_json(handler, settings)


def handle_post_server_settings(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/server/settings - Update server configuration.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    payload = _read_request_payload(handler)
    if payload is None:
        return
    
    # Validate settings
    errors = []
    
    # Validate ports
    http_port = payload.get("serverHttpPort")
    ws_port = payload.get("serverWebSocketPort")
    
    if http_port is not None:
        if not isinstance(http_port, int) or http_port < 1024 or http_port > 65535:
            errors.append("HTTP port must be between 1024 and 65535")
    
    if ws_port is not None:
        if not isinstance(ws_port, int) or ws_port < 1024 or ws_port > 65535:
            errors.append("WebSocket port must be between 1024 and 65535")
    
    if http_port is not None and ws_port is not None and http_port == ws_port:
        errors.append("HTTP and WebSocket ports must be different")
    
    # Validate polling interval
    polling_ms = payload.get("serverPollingIntervalMs")
    if polling_ms is not None:
        if not isinstance(polling_ms, int) or polling_ms < 250 or polling_ms > 2000:
            errors.append("Polling interval must be between 250 and 2000 ms")
    
    # Validate session timeout
    timeout_s = payload.get("serverSessionTimeoutS")
    if timeout_s is not None:
        if not isinstance(timeout_s, int) or timeout_s < 60 or timeout_s > 3600:
            errors.append("Session timeout must be between 60 and 3600 seconds")
    
    # Validate max clients
    max_clients = payload.get("serverMaxClients")
    if max_clients is not None:
        if not isinstance(max_clients, int) or max_clients < 1 or max_clients > 100:
            errors.append("Max clients must be between 1 and 100")
    
    # Validate logging level
    log_level = payload.get("serverLoggingLevel")
    if log_level is not None:
        if log_level not in ["DEBUG", "INFO", "WARNING", "ERROR"]:
            errors.append("Logging level must be one of: DEBUG, INFO, WARNING, ERROR")

    require_session = payload.get("serverRequireSession")
    if require_session is not None and not isinstance(require_session, bool):
        errors.append("serverRequireSession must be a boolean")
    
    if errors:
        send_json(handler, {"error": "Validation failed", "details": errors}, HTTPStatus.BAD_REQUEST)
        return
    
    # Save to config
    update_dict = {}
    for key in ["serverHttpPort", "serverWebSocketPort", "serverPollingIntervalMs", 
                "serverSessionTimeoutS", "serverMaxClients", "serverLoggingLevel",
                "serverRequireSession"]:
        if key in payload:
            update_dict[key] = payload[key]
    
    # Check if ports actually changed (before updating)
    # Compare with current config values, not the state ports (which might be different)
    restart_required = False
    if "serverHttpPort" in update_dict:
        current_http_port = state.settings.get("serverHttpPort")
        if current_http_port is None:
            current_http_port = state.http_port
        if update_dict["serverHttpPort"] != current_http_port:
            restart_required = True
            log(f"[API] HTTP port change detected: {current_http_port} -> {update_dict['serverHttpPort']}")
    if "serverWebSocketPort" in update_dict:
        current_ws_port = state.settings.get("serverWebSocketPort")
        if current_ws_port is None:
            current_ws_port = state.websocket_port
        if update_dict["serverWebSocketPort"] != current_ws_port:
            restart_required = True
            log(f"[API] WebSocket port change detected: {current_ws_port} -> {update_dict['serverWebSocketPort']}")
    
    if update_dict:
        state.settings.update(update_dict)
        
        # Apply logging level immediately
        if "serverLoggingLevel" in update_dict:
            try:
                set_logging_level(update_dict["serverLoggingLevel"])
            except ValueError as e:
                log(f"[API] Error setting log level: {e}", level="WARNING")
        
        # Apply polling interval immediately (no restart needed)
        if "serverPollingIntervalMs" in update_dict:
            polling_ms = update_dict["serverPollingIntervalMs"]
            log(f"[API] Attempting to update polling interval to {polling_ms}ms")
            if state.rotor_connection:
                if state.rotor_connection.is_connected():
                    try:
                        log(f"[API] Rotor is connected, calling set_polling_interval({polling_ms})")
                        state.rotor_connection.set_polling_interval(polling_ms)
                        log(f"[API] Polling interval successfully updated to {polling_ms}ms")
                    except Exception as e:
                        log(f"[API] Error updating polling interval: {e}", level="WARNING")
                        import traceback
                        log(f"[API] Traceback: {traceback.format_exc()}", level="WARNING")
                else:
                    log(f"[API] Rotor connection exists but is not connected. Interval saved to config ({polling_ms}ms) but not applied.")
            else:
                log(f"[API] Rotor connection is None. Interval saved to config ({polling_ms}ms) but not applied.")
        
        # Apply session timeout immediately
        if "serverSessionTimeoutS" in update_dict and state.session_manager:
            state.session_manager.session_timeout_s = update_dict["serverSessionTimeoutS"]
            log(f"[API] Session timeout updated to {update_dict['serverSessionTimeoutS']}s")
        
        # Apply max clients immediately
        if "serverMaxClients" in update_dict and state.session_manager:
            state.session_manager.max_clients = update_dict["serverMaxClients"]
            log(f"[API] Max clients updated to {update_dict['serverMaxClients']}")
    
    # Broadcast settings update to all clients
    if state.websocket_manager:
        state.websocket_manager.broadcast_settings_updated(state.settings.get_all())
    
    send_json(handler, {
        "status": "ok",
        "message": "Server settings saved." + (" Restart required for port changes to take effect." if restart_required else ""),
        "restartRequired": restart_required
    })


# --- Route Management Routes ---

def handle_get_routes(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle GET /api/routes - Get all routes.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    if not state.route_manager:
        send_json(handler, {"error": "Route manager not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return
    
    routes = state.route_manager.get_all_routes()
    send_json(handler, {"routes": routes})


def handle_create_route(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/routes - Create a new route.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    if not state.route_manager:
        send_json(handler, {"error": "Route manager not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return
    
    try:
        payload = _read_request_payload(handler)
        if payload is None:
            return
        route = state.route_manager.add_route(payload)
        
        # Broadcast update to all clients
        if state.websocket_manager:
            all_routes = state.route_manager.get_all_routes()
            state.websocket_manager.broadcast_route_list_updated(all_routes)
        
        send_json(handler, {"status": "ok", "route": route})
    except ValueError as e:
        send_json(handler, {"error": str(e)}, HTTPStatus.BAD_REQUEST)
    except Exception as e:
        log(f"[Routes] Error creating route: {e}", level="ERROR")
        send_json(handler, {"error": "Failed to create route"}, HTTPStatus.INTERNAL_SERVER_ERROR)


def handle_update_route(handler: BaseHTTPRequestHandler, state: "ServerState", route_id: str) -> None:
    """Handle PUT /api/routes/<id> - Update a route.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
        route_id: ID of the route to update.
    """
    if not state.route_manager:
        send_json(handler, {"error": "Route manager not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return
    
    try:
        payload = _read_request_payload(handler)
        if payload is None:
            return
        route = state.route_manager.update_route(route_id, payload)
        
        if not route:
            send_json(handler, {"error": "Route not found"}, HTTPStatus.NOT_FOUND)
            return
        
        # Broadcast update to all clients
        if state.websocket_manager:
            all_routes = state.route_manager.get_all_routes()
            state.websocket_manager.broadcast_route_list_updated(all_routes)
        
        send_json(handler, {"status": "ok", "route": route})
    except Exception as e:
        log(f"[Routes] Error updating route: {e}", level="ERROR")
        send_json(handler, {"error": "Failed to update route"}, HTTPStatus.INTERNAL_SERVER_ERROR)


def handle_delete_route(handler: BaseHTTPRequestHandler, state: "ServerState", route_id: str) -> None:
    """Handle DELETE /api/routes/<id> - Delete a route.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
        route_id: ID of the route to delete.
    """
    if not state.route_manager:
        send_json(handler, {"error": "Route manager not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return
    
    try:
        success = state.route_manager.delete_route(route_id)
        
        if not success:
            send_json(handler, {"error": "Route not found"}, HTTPStatus.NOT_FOUND)
            return
        
        # Broadcast update to all clients
        if state.websocket_manager:
            all_routes = state.route_manager.get_all_routes()
            state.websocket_manager.broadcast_route_list_updated(all_routes)
        
        send_json(handler, {"status": "ok"})
    except Exception as e:
        log(f"[Routes] Error deleting route: {e}", level="ERROR")
        send_json(handler, {"error": "Failed to delete route"}, HTTPStatus.INTERNAL_SERVER_ERROR)


def handle_start_route(handler: BaseHTTPRequestHandler, state: "ServerState", route_id: str) -> None:
    """Handle POST /api/routes/<id>/start - Start executing a route.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
        route_id: ID of the route to start.
    """
    if not state.route_executor:
        send_json(handler, {"error": "Route executor not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return
    
    if not state.rotor_connection or not state.rotor_connection.is_connected():
        _send_rotor_disconnected(handler)
        return
    
    try:
        success = state.route_executor.start_route(route_id)
        
        if not success:
            send_json(handler, {"error": "Failed to start route (already executing or not found)"}, HTTPStatus.BAD_REQUEST)
            return
        
        send_json(handler, {"status": "ok"})
    except Exception as e:
        log(f"[Routes] Error starting route: {e}", level="ERROR")
        send_json(handler, {"error": "Failed to start route"}, HTTPStatus.INTERNAL_SERVER_ERROR)


def handle_stop_route(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/routes/stop - Stop the currently executing route.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    if not state.route_executor:
        send_json(handler, {"error": "Route executor not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return
    
    try:
        state.route_executor.stop_route()
        send_json(handler, {"status": "ok"})
    except Exception as e:
        log(f"[Routes] Error stopping route: {e}", level="ERROR")
        send_json(handler, {"error": "Failed to stop route"}, HTTPStatus.INTERNAL_SERVER_ERROR)


def handle_continue_route(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/routes/continue - Continue from manual wait.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    if not state.route_executor:
        send_json(handler, {"error": "Route executor not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return
    
    try:
        success = state.route_executor.continue_from_manual_wait()
        
        if not success:
            send_json(handler, {"error": "No manual wait is active"}, HTTPStatus.BAD_REQUEST)
            return
        
        send_json(handler, {"status": "ok"})
    except Exception as e:
        log(f"[Routes] Error continuing route: {e}", level="ERROR")
        send_json(handler, {"error": "Failed to continue route"}, HTTPStatus.INTERNAL_SERVER_ERROR)


def handle_get_route_execution(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle GET /api/routes/execution - Get current route execution state.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    if not state.route_executor:
        send_json(handler, {"error": "Route executor not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return
    
    try:
        execution_state = state.route_executor.get_execution_state()
        send_json(handler, execution_state)
    except Exception as e:
        log(f"[Routes] Error getting execution state: {e}", level="ERROR")
        send_json(handler, {"error": "Failed to get execution state"}, HTTPStatus.INTERNAL_SERVER_ERROR)


def handle_server_restart(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/server/restart - Restart server.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    log("[API] Server restart requested")
    
    # Send response before restarting
    send_json(handler, {"status": "restarting", "message": "Server is restarting..."})
    
    # Delayed restart to allow response to be sent
    def delayed_restart():
        time.sleep(0.75)  # Give time for response to be sent
        log("[API] Initiating server restart (requesting exit code 42)")
        # Mark restart so core.server can exit with the special code after HTTP loop stops
        state.request_restart()
        # Stop background components first (WebSocket, rotor loop, etc.)
        state.stop()
        # Stop the HTTP server loop (serve_forever), then core.server will exit with code 42
        state.shutdown_http_server()
    
    restart_thread = threading.Thread(target=delayed_restart, daemon=True)
    restart_thread.start()
