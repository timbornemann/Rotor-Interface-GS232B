"""WebSocket handler and broadcast manager.

Provides real-time communication between server and clients for
connection state synchronization and client management.
"""

from __future__ import annotations

import asyncio
import json
import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, Optional, Set

try:
    import websockets
    from websockets.server import WebSocketServerProtocol
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    WebSocketServerProtocol = Any

from server.utils.logging import log

if TYPE_CHECKING:
    from server.core.session_manager import SessionManager


@dataclass
class WebSocketClient:
    """Represents a connected WebSocket client."""
    websocket: WebSocketServerProtocol
    session_id: Optional[str] = None
    connected_at: datetime = field(default_factory=datetime.now)


class WebSocketManager:
    """Manages WebSocket connections and broadcasts.
    
    Handles:
    - Client connection/disconnection
    - Broadcasting messages to all/specific clients
    - Session ID association with WebSocket connections
    """
    
    def __init__(self) -> None:
        """Initialize the WebSocket manager."""
        self.clients: Dict[WebSocketServerProtocol, WebSocketClient] = {}
        self.session_manager: Optional["SessionManager"] = None
        self._lock = threading.Lock()
        self._server: Optional[Any] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
        
    def set_session_manager(self, session_manager: "SessionManager") -> None:
        """Set the session manager reference.
        
        Args:
            session_manager: The session manager instance.
        """
        self.session_manager = session_manager
        
    async def _handle_client(self, websocket: WebSocketServerProtocol) -> None:
        """Handle a new WebSocket client connection.
        
        Args:
            websocket: The WebSocket connection.
        """
        client = WebSocketClient(websocket=websocket)
        
        with self._lock:
            self.clients[websocket] = client
            
        log(f"[WebSocket] Client connected. Total clients: {len(self.clients)}")
        
        try:
            # Send initial connection state
            await self._send_initial_state(websocket)
            
            # Handle incoming messages
            async for message in websocket:
                await self._handle_message(websocket, message)
                
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            with self._lock:
                if websocket in self.clients:
                    client = self.clients.pop(websocket)
                    # Remove session from manager if it exists
                    if client.session_id and self.session_manager:
                        self.session_manager.remove_session(client.session_id)
                        # Broadcast updated client list
                        self._schedule_broadcast_client_list()
                        
            log(f"[WebSocket] Client disconnected. Total clients: {len(self.clients)}")
    
    async def _send_initial_state(self, websocket: WebSocketServerProtocol) -> None:
        """Send initial state to a newly connected client.
        
        Args:
            websocket: The WebSocket connection.
        """
        # Import here to avoid circular imports
        from server.core.state import ServerState
        
        state = ServerState.get_instance()
        
        # Send connection state
        connection_data = {
            "type": "connection_state_changed",
            "data": self._get_connection_state_data(state)
        }
        
        try:
            await websocket.send(json.dumps(connection_data))
        except Exception as e:
            log(f"[WebSocket] Error sending initial state: {e}")
    
    def _get_connection_state_data(self, state: Any) -> Dict[str, Any]:
        """Get current connection state data.
        
        Args:
            state: The ServerState instance.
            
        Returns:
            Dictionary with connection state information.
        """
        if state.rotor_connection and state.rotor_connection.is_connected():
            return {
                "connected": True,
                "port": state.rotor_connection.port,
                "baudRate": state.rotor_connection.baud_rate
            }
        return {"connected": False, "port": None, "baudRate": None}
    
    async def _handle_message(
        self, 
        websocket: WebSocketServerProtocol, 
        message: str
    ) -> None:
        """Handle an incoming WebSocket message.
        
        Args:
            websocket: The WebSocket connection.
            message: The received message.
        """
        try:
            data = json.loads(message)
            msg_type = data.get("type")
            
            if msg_type == "register_session":
                # Client registering their session ID
                session_id = data.get("sessionId")
                if session_id:
                    with self._lock:
                        if websocket in self.clients:
                            self.clients[websocket].session_id = session_id
                    log(f"[WebSocket] Client registered session: {session_id[:8]}...")
                    
                    # Send current client list to all
                    self._schedule_broadcast_client_list()
                    
            elif msg_type == "ping":
                # Respond to ping
                await websocket.send(json.dumps({"type": "pong"}))
                
        except json.JSONDecodeError:
            log(f"[WebSocket] Invalid JSON received: {message[:50]}")
        except Exception as e:
            log(f"[WebSocket] Error handling message: {e}")
    
    def broadcast_connection_state(self, connected: bool, port: Optional[str], baud_rate: Optional[int]) -> None:
        """Broadcast connection state change to all clients.
        
        Args:
            connected: Whether connected to a COM port.
            port: The COM port name (if connected).
            baud_rate: The baud rate (if connected).
        """
        message = {
            "type": "connection_state_changed",
            "data": {
                "connected": connected,
                "port": port,
                "baudRate": baud_rate
            }
        }
        self._schedule_broadcast(json.dumps(message))
    
    def broadcast_client_list(self, clients: list) -> None:
        """Broadcast updated client list to all clients.
        
        Args:
            clients: List of client session dictionaries.
        """
        message = {
            "type": "client_list_updated",
            "data": {
                "clients": clients
            }
        }
        self._schedule_broadcast(json.dumps(message))
    
    def broadcast_settings_updated(self, settings: Dict[str, Any]) -> None:
        """Broadcast settings update to all clients.
        
        Args:
            settings: Dictionary containing all current settings.
        """
        message = {
            "type": "settings_updated",
            "data": settings
        }
        self._schedule_broadcast(json.dumps(message))
    
    def broadcast_route_list_updated(self, routes: list) -> None:
        """Broadcast updated route list to all clients.
        
        Args:
            routes: List of route dictionaries.
        """
        message = {
            "type": "route_list_updated",
            "data": {
                "routes": routes
            }
        }
        self._schedule_broadcast(json.dumps(message))
    
    def broadcast_route_execution_started(self, route_id: str, route_name: str) -> None:
        """Broadcast that route execution has started.
        
        Args:
            route_id: ID of the route being executed.
            route_name: Name of the route being executed.
        """
        message = {
            "type": "route_execution_started",
            "data": {
                "routeId": route_id,
                "routeName": route_name
            }
        }
        self._schedule_broadcast(json.dumps(message))
    
    def broadcast_route_execution_progress(self, progress_data: Dict[str, Any]) -> None:
        """Broadcast route execution progress update.
        
        Args:
            progress_data: Progress data dictionary.
        """
        message = {
            "type": "route_execution_progress",
            "data": progress_data
        }
        self._schedule_broadcast(json.dumps(message))
    
    def broadcast_route_execution_stopped(self) -> None:
        """Broadcast that route execution was stopped."""
        message = {
            "type": "route_execution_stopped",
            "data": {}
        }
        self._schedule_broadcast(json.dumps(message))
    
    def broadcast_route_execution_completed(
        self,
        success: bool,
        route_id: Optional[str] = None,
        error: Optional[str] = None
    ) -> None:
        """Broadcast that route execution has completed.
        
        Args:
            success: Whether execution completed successfully.
            route_id: ID of the completed route.
            error: Optional error message.
        """
        message = {
            "type": "route_execution_completed",
            "data": {
                "success": success,
                "routeId": route_id,
                "error": error
            }
        }
        self._schedule_broadcast(json.dumps(message))
    
    def send_suspension_notice(self, session_id: str, message_text: str = "Your session has been suspended") -> None:
        """Send suspension notice to a specific client.
        
        Args:
            session_id: The session ID of the client to notify.
            message_text: The suspension message.
        """
        message = {
            "type": "client_suspended",
            "data": {
                "clientId": session_id,
                "message": message_text
            }
        }
        
        # Find the websocket for this session
        with self._lock:
            for ws, client in self.clients.items():
                if client.session_id == session_id:
                    self._schedule_send(ws, json.dumps(message))
                    break
    
    def _schedule_broadcast(self, message: str) -> None:
        """Schedule a broadcast on the event loop.
        
        Args:
            message: The message to broadcast.
        """
        if self._loop and self._running:
            asyncio.run_coroutine_threadsafe(
                self._broadcast(message),
                self._loop
            )
    
    def _schedule_send(self, websocket: WebSocketServerProtocol, message: str) -> None:
        """Schedule a send to a specific client.
        
        Args:
            websocket: The WebSocket connection.
            message: The message to send.
        """
        if self._loop and self._running:
            asyncio.run_coroutine_threadsafe(
                self._send(websocket, message),
                self._loop
            )
    
    def _schedule_broadcast_client_list(self) -> None:
        """Schedule broadcasting the current client list."""
        if self.session_manager:
            clients = self.session_manager.get_all_sessions_as_list()
            self.broadcast_client_list(clients)
    
    async def _broadcast(self, message: str) -> None:
        """Broadcast a message to all connected clients.
        
        Args:
            message: The message to broadcast.
        """
        with self._lock:
            clients = list(self.clients.keys())
        
        for websocket in clients:
            try:
                await websocket.send(message)
            except Exception:
                pass  # Client may have disconnected
    
    async def _send(self, websocket: WebSocketServerProtocol, message: str) -> None:
        """Send a message to a specific client.
        
        Args:
            websocket: The WebSocket connection.
            message: The message to send.
        """
        try:
            await websocket.send(message)
        except Exception:
            pass
    
    async def _run_server(self, host: str, port: int) -> None:
        """Run the WebSocket server.
        
        Args:
            host: The host to bind to.
            port: The port to listen on.
        """
        if not WEBSOCKETS_AVAILABLE:
            log("[WebSocket] websockets library not available, WebSocket server disabled")
            return
            
        self._running = True
        server = None
        
        try:
            async with websockets.serve(self._handle_client, host, port) as server:
                log(f"[WebSocket] Server started on ws://{host}:{port}")
                try:
                    while self._running:
                        await asyncio.sleep(0.5)
                except asyncio.CancelledError:
                    log("[WebSocket] Server shutdown requested")
                    self._running = False
        except OSError as e:
            if e.errno == 10048 or "Address already in use" in str(e):
                log(f"[WebSocket] ERROR: Port {port} is already in use. WebSocket server disabled.")
                log("[WebSocket] Please stop any other instances of the server or change the port.")
            else:
                log(f"[WebSocket] ERROR: Failed to start server: {e}")
            self._running = False
        except asyncio.CancelledError:
            log("[WebSocket] Server cancelled")
            self._running = False
        except Exception as e:
            log(f"[WebSocket] ERROR: Unexpected error starting server: {e}")
            self._running = False
    
    def start(self, host: str = "0.0.0.0", port: int = 8082) -> None:
        """Start the WebSocket server in a background thread.
        
        Args:
            host: The host to bind to.
            port: The port to listen on.
        """
        if not WEBSOCKETS_AVAILABLE:
            log("[WebSocket] websockets library not available, WebSocket server disabled")
            return
            
        def run_loop():
            try:
                self._loop = asyncio.new_event_loop()
                asyncio.set_event_loop(self._loop)
                self._loop.run_until_complete(self._run_server(host, port))
            except Exception as e:
                log(f"[WebSocket] Error in event loop: {e}")
            finally:
                # Clean shutdown of event loop
                try:
                    # Cancel all pending tasks
                    pending = asyncio.all_tasks(self._loop)
                    for task in pending:
                        task.cancel()
                    # Wait for tasks to complete cancellation
                    if pending:
                        self._loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
                except Exception:
                    pass
                finally:
                    if self._loop and not self._loop.is_closed():
                        self._loop.close()
        
        self._thread = threading.Thread(target=run_loop, daemon=True)
        self._thread.start()
    
    def stop(self) -> None:
        """Stop the WebSocket server gracefully."""
        if not self._running:
            return
            
        log("[WebSocket] Stopping WebSocket server...")
        self._running = False
        
        # Close all client connections
        with self._lock:
            clients_to_close = list(self.clients.values())
            self.clients.clear()
        
        # Stop the event loop gracefully
        if self._loop and self._loop.is_running():
            try:
                # Cancel the main server task
                for task in asyncio.all_tasks(self._loop):
                    if not task.done():
                        task.cancel()
                # Stop the loop
                self._loop.call_soon_threadsafe(self._loop.stop)
            except Exception as e:
                log(f"[WebSocket] Error stopping event loop: {e}")
        
        # Wait for thread to finish (with timeout)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
            if self._thread.is_alive():
                log("[WebSocket] Warning: WebSocket thread did not stop within timeout")
        
        log("[WebSocket] Server stopped")
            
    def get_client_count(self) -> int:
        """Get the number of connected WebSocket clients.
        
        Returns:
            Number of connected clients.
        """
        with self._lock:
            return len(self.clients)
