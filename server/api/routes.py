"""API route handlers for the rotor interface.

Contains all route handler functions for the REST API endpoints.
"""

import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from typing import TYPE_CHECKING, Optional

from server.api.middleware import send_json, read_json_body
from server.connection.port_scanner import list_available_ports
from server.control.rotor_logic import RotorLogic
from server.utils.logging import log, get_current_logging_level, set_logging_level

if TYPE_CHECKING:
    from server.core.state import ServerState


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
    payload = read_json_body(handler)
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
            azimuth_raw = status.get("azimuthRaw") if status else None
            elevation_raw = status.get("elevationRaw") if status else None
            
            # Calculate calibrated values
            calibrated = {"azimuth": None, "elevation": None}
            if azimuth_raw is not None:
                scale = config.get("azimuthScaleFactor", 1.0) or 1.0
                offset = config.get("azimuthOffset", 0.0) or 0.0
                calibrated["azimuth"] = (azimuth_raw + offset) / scale
            
            if elevation_raw is not None:
                scale = config.get("elevationScaleFactor", 1.0) or 1.0
                offset = config.get("elevationOffset", 0.0) or 0.0
                calibrated["elevation"] = (elevation_raw + offset) / scale

            send_json(handler, {
                "connected": True,
                "port": state.rotor_connection.port,
                "baudRate": state.rotor_connection.baud_rate,
                "status": {
                    "rawLine": status.get("raw") if status else None,
                    "timestamp": status.get("timestamp") if status else None,
                    "rph": {
                        "azimuth": azimuth_raw,
                        "elevation": elevation_raw
                    },
                    "calibrated": calibrated
                },
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
    payload = read_json_body(handler)
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
    
    with state.rotor_lock:
        try:
            if state.rotor_connection.is_connected():
                if state.rotor_connection.port == port:
                    # Already connected to this port
                    send_json(handler, {"status": "ok", "message": "Already connected"})
                    # Still broadcast state so the requesting client gets updated
                    state.broadcast_connection_state()
                    return
                else:
                    send_json(
                        handler, 
                        {"error": "Already connected to another port"}, 
                        HTTPStatus.BAD_REQUEST
                    )
                    return
            
            state.rotor_connection.connect(port, baud_rate)
            send_json(handler, {"status": "ok"})
            
            # Broadcast connection state to all clients
            state.broadcast_connection_state()
            
        except Exception as e:
            send_json(handler, {"error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def handle_disconnect(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/disconnect - Disconnect from COM port.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
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
            state.broadcast_connection_state()
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
        payload = read_json_body(handler)
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
            send_json(handler, {"error": "Not connected to rotor"}, HTTPStatus.BAD_REQUEST)
            return
        
        state.rotor_logic.set_target(az, el)
        send_json(handler, {"status": "ok"})
    except Exception as e:
        from server.utils.logging import log
        log(f"[Routes] Error in handle_set_target: {e}")
        send_json(
            handler, 
            {"error": "Failed to set target", "message": str(e)}, 
            HTTPStatus.INTERNAL_SERVER_ERROR
        )


def handle_home(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/home - Move to home preset."""
    if not state.rotor_logic:
        send_json(handler, {"error": "Logic not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return
    if not state.rotor_connection or not state.rotor_connection.is_connected():
        send_json(handler, {"error": "Not connected to rotor"}, HTTPStatus.BAD_REQUEST)
        return
    if not state.settings.get("parkPositionsEnabled", False):
        send_json(handler, {"error": "Preset positions disabled"}, HTTPStatus.BAD_REQUEST)
        return
    if not state.rotor_logic.home():
        send_json(handler, {"error": "Failed to move to home preset"}, HTTPStatus.BAD_REQUEST)
        return
    send_json(handler, {"status": "ok"})


def handle_park(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/park - Move to park preset."""
    if not state.rotor_logic:
        send_json(handler, {"error": "Logic not initialized"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return
    if not state.rotor_connection or not state.rotor_connection.is_connected():
        send_json(handler, {"error": "Not connected to rotor"}, HTTPStatus.BAD_REQUEST)
        return
    if not state.settings.get("parkPositionsEnabled", False):
        send_json(handler, {"error": "Preset positions disabled"}, HTTPStatus.BAD_REQUEST)
        return
    if not state.rotor_logic.park():
        send_json(handler, {"error": "Failed to move to park preset"}, HTTPStatus.BAD_REQUEST)
        return
    send_json(handler, {"status": "ok"})


def handle_manual(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/manual - Start manual movement.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    try:
        payload = read_json_body(handler)
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
            send_json(handler, {"error": "Not connected to rotor"}, HTTPStatus.BAD_REQUEST)
            return
        
        state.rotor_logic.manual_move(direction)
        send_json(handler, {"status": "ok"})
    except Exception as e:
        from server.utils.logging import log
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
        payload = read_json_body(handler)
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
            send_json(handler, {"error": "Not connected to rotor"}, HTTPStatus.BAD_REQUEST)
            return
        
        state.rotor_logic.set_target_raw(az, el)
        send_json(handler, {"status": "ok"})
    except Exception as e:
        from server.utils.logging import log
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
        
        state.rotor_logic.stop_motion()
        send_json(handler, {"status": "ok"})
    except Exception as e:
        from server.utils.logging import log
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
        payload = read_json_body(handler)
        command = payload.get("command")
        
        if not command or not isinstance(command, str):
            send_json(handler, {"error": "command must be a non-empty string"}, HTTPStatus.BAD_REQUEST)
            return
        
        if not state.rotor_connection or not state.rotor_connection.is_connected():
            send_json(handler, {"error": "Not connected to rotor"}, HTTPStatus.BAD_REQUEST)
            return
        
        state.rotor_connection.send_command(command)
        send_json(handler, {"status": "ok"})
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
            azimuth_raw = status.get("azimuthRaw") if status else None
            elevation_raw = status.get("elevationRaw") if status else None
            
            # Calculate calibrated values
            calibrated = {"azimuth": None, "elevation": None}
            if azimuth_raw is not None:
                scale = config.get("azimuthScaleFactor", 1.0) or 1.0
                offset = config.get("azimuthOffset", 0.0) or 0.0
                calibrated["azimuth"] = (azimuth_raw + offset) / scale
            
            if elevation_raw is not None:
                scale = config.get("elevationScaleFactor", 1.0) or 1.0
                offset = config.get("elevationOffset", 0.0) or 0.0
                calibrated["elevation"] = (elevation_raw + offset) / scale
            
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
                    "rawLine": status.get("raw") if status else None,
                    "timestamp": status.get("timestamp") if status else None,
                    "rph": {
                        "azimuth": azimuth_raw,
                        "elevation": elevation_raw
                    },
                    "calibrated": calibrated,
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


def handle_get_config_ini(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle GET /api/config/ini - Get rotor-config.ini content (read-only).
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    try:
        # Try to read rotor-config.ini from the project root
        config_file = state.settings.config_dir / "rotor-config.ini"
        
        if config_file.exists():
            with open(config_file, 'r', encoding='utf-8') as f:
                content = f.read()
            send_json(handler, {"content": content})
        else:
            send_json(handler, {"error": "rotor-config.ini not found"}, HTTPStatus.NOT_FOUND)
    except Exception as e:
        log(f"[Routes] Error reading rotor-config.ini: {e}")
        send_json(
            handler, 
            {"error": "Failed to read configuration file", "message": str(e)}, 
            HTTPStatus.INTERNAL_SERVER_ERROR
        )


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
    payload = read_json_body(handler)
    
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
    
    if http_port and ws_port and http_port == ws_port:
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
