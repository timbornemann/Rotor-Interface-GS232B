"""API route handlers for the rotor interface.

Contains all route handler functions for the REST API endpoints.
"""

from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from typing import TYPE_CHECKING

from server.api.middleware import send_json, read_json_body
from server.connection.port_scanner import list_available_ports

if TYPE_CHECKING:
    from server.core.state import ServerState


# --- Settings Routes ---

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
    
    if not port:
        send_json(handler, {"error": "port required"}, HTTPStatus.BAD_REQUEST)
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
            
            state.rotor_connection.connect(port, int(baud_rate))
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
        az = payload.get("az")
        el = payload.get("el")
        
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


def handle_manual(handler: BaseHTTPRequestHandler, state: "ServerState") -> None:
    """Handle POST /api/rotor/manual - Start manual movement.
    
    Args:
        handler: The HTTP request handler instance.
        state: The server state singleton.
    """
    try:
        payload = read_json_body(handler)
        direction = payload.get("direction")
        
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
