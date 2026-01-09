"""Client session management for tracking connected clients.

Provides session tracking, suspension, and cleanup functionality.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Dict, List, Optional

from server.utils.logging import log

if TYPE_CHECKING:
    from server.api.websocket import WebSocketManager


class SessionStatus(Enum):
    """Possible session states."""
    ACTIVE = "active"
    SUSPENDED = "suspended"


@dataclass
class ClientSession:
    """Represents a client session.
    
    Attributes:
        id: Unique session identifier (UUID).
        ip: Client's IP address.
        user_agent: Client's User-Agent string (browser info).
        connected_at: Timestamp when session was created.
        last_seen: Timestamp of last activity.
        status: Current session status (active/suspended).
    """
    id: str
    ip: str
    user_agent: str
    connected_at: datetime = field(default_factory=datetime.now)
    last_seen: datetime = field(default_factory=datetime.now)
    status: SessionStatus = SessionStatus.ACTIVE
    
    def to_dict(self) -> dict:
        """Convert session to dictionary for JSON serialization.
        
        Returns:
            Dictionary representation of the session.
        """
        return {
            "id": self.id,
            "ip": self.ip,
            "userAgent": self.user_agent,
            "connectedAt": self.connected_at.isoformat(),
            "lastSeen": self.last_seen.isoformat(),
            "status": self.status.value
        }
    
    def update_last_seen(self) -> None:
        """Update the last_seen timestamp to now."""
        self.last_seen = datetime.now()
        
    def is_suspended(self) -> bool:
        """Check if the session is suspended.
        
        Returns:
            True if suspended, False otherwise.
        """
        return self.status == SessionStatus.SUSPENDED


class SessionManager:
    """Manages all client sessions.
    
    Thread-safe session tracking with automatic cleanup of stale sessions.
    """
    
    # Session timeout in seconds (5 minutes of inactivity)
    SESSION_TIMEOUT = 300
    
    # Cleanup interval in seconds
    CLEANUP_INTERVAL = 60
    
    def __init__(self) -> None:
        """Initialize the session manager."""
        self._sessions: Dict[str, ClientSession] = {}
        self._lock = threading.Lock()
        self._websocket_manager: Optional["WebSocketManager"] = None
        self._cleanup_thread: Optional[threading.Thread] = None
        self._running = False
        
    def set_websocket_manager(self, ws_manager: "WebSocketManager") -> None:
        """Set the WebSocket manager reference for broadcasting.
        
        Args:
            ws_manager: The WebSocket manager instance.
        """
        self._websocket_manager = ws_manager
        
    def start(self) -> None:
        """Start the session cleanup background thread."""
        self._running = True
        self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self._cleanup_thread.start()
        log("[SessionManager] Started with cleanup interval of 60s")
        
    def stop(self) -> None:
        """Stop the session cleanup thread."""
        self._running = False
        if self._cleanup_thread:
            self._cleanup_thread.join(timeout=2)
            
    def _cleanup_loop(self) -> None:
        """Background loop to clean up stale sessions."""
        while self._running:
            time.sleep(self.CLEANUP_INTERVAL)
            self._cleanup_stale_sessions()
            
    def _cleanup_stale_sessions(self) -> None:
        """Remove sessions that have been inactive too long."""
        now = datetime.now()
        stale_ids = []
        
        with self._lock:
            for session_id, session in self._sessions.items():
                # Calculate seconds since last activity
                elapsed = (now - session.last_seen).total_seconds()
                if elapsed > self.SESSION_TIMEOUT:
                    stale_ids.append(session_id)
            
            for session_id in stale_ids:
                del self._sessions[session_id]
                
        if stale_ids:
            log(f"[SessionManager] Cleaned up {len(stale_ids)} stale sessions")
            self._broadcast_client_list()
    
    def get_or_create_session(
        self, 
        session_id: Optional[str], 
        ip: str, 
        user_agent: str
    ) -> ClientSession:
        """Get an existing session or create a new one.
        
        Args:
            session_id: Existing session ID (if any).
            ip: Client's IP address.
            user_agent: Client's User-Agent string.
            
        Returns:
            The existing or new ClientSession.
        """
        with self._lock:
            # Try to find existing session
            if session_id and session_id in self._sessions:
                session = self._sessions[session_id]
                session.update_last_seen()
                return session
            
            # Create new session
            new_id = str(uuid.uuid4())
            session = ClientSession(
                id=new_id,
                ip=ip,
                user_agent=self._parse_user_agent(user_agent)
            )
            self._sessions[new_id] = session
            log(f"[SessionManager] New session created: {new_id[:8]}... from {ip}")
            
        # Broadcast updated client list
        self._broadcast_client_list()
        
        return session
    
    def _parse_user_agent(self, user_agent: str) -> str:
        """Parse User-Agent string to extract browser name.
        
        Args:
            user_agent: Full User-Agent string.
            
        Returns:
            Simplified browser name/version.
        """
        if not user_agent:
            return "Unknown"
            
        # Common browser patterns
        if "Edg/" in user_agent:
            # Microsoft Edge
            try:
                version = user_agent.split("Edg/")[1].split(" ")[0].split(".")[0]
                return f"Edge/{version}"
            except (IndexError, ValueError):
                return "Edge"
        elif "Chrome/" in user_agent:
            try:
                version = user_agent.split("Chrome/")[1].split(" ")[0].split(".")[0]
                return f"Chrome/{version}"
            except (IndexError, ValueError):
                return "Chrome"
        elif "Firefox/" in user_agent:
            try:
                version = user_agent.split("Firefox/")[1].split(" ")[0].split(".")[0]
                return f"Firefox/{version}"
            except (IndexError, ValueError):
                return "Firefox"
        elif "Safari/" in user_agent and "Chrome" not in user_agent:
            try:
                version = user_agent.split("Version/")[1].split(" ")[0].split(".")[0]
                return f"Safari/{version}"
            except (IndexError, ValueError):
                return "Safari"
        
        # Truncate to reasonable length if nothing matches
        return user_agent[:30] + "..." if len(user_agent) > 30 else user_agent
    
    def get_session(self, session_id: str) -> Optional[ClientSession]:
        """Get a session by ID.
        
        Args:
            session_id: The session ID.
            
        Returns:
            The ClientSession if found, None otherwise.
        """
        with self._lock:
            return self._sessions.get(session_id)
    
    def update_session_activity(self, session_id: str) -> None:
        """Update a session's last_seen timestamp.
        
        Args:
            session_id: The session ID.
        """
        with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id].update_last_seen()
    
    def remove_session(self, session_id: str) -> bool:
        """Remove a session.
        
        Args:
            session_id: The session ID to remove.
            
        Returns:
            True if session was removed, False if not found.
        """
        with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]
                log(f"[SessionManager] Session removed: {session_id[:8]}...")
                return True
            return False
    
    def suspend_session(self, session_id: str) -> bool:
        """Suspend a client session.
        
        Args:
            session_id: The session ID to suspend.
            
        Returns:
            True if session was suspended, False if not found.
        """
        with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id].status = SessionStatus.SUSPENDED
                log(f"[SessionManager] Session suspended: {session_id[:8]}...")
                
        # Notify the suspended client via WebSocket
        if self._websocket_manager:
            self._websocket_manager.send_suspension_notice(
                session_id, 
                "Your session has been suspended. Reload the page to reconnect."
            )
            
        self._broadcast_client_list()
        return True
    
    def resume_session(self, session_id: str) -> bool:
        """Resume a suspended session.
        
        Args:
            session_id: The session ID to resume.
            
        Returns:
            True if session was resumed, False if not found.
        """
        with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id].status = SessionStatus.ACTIVE
                log(f"[SessionManager] Session resumed: {session_id[:8]}...")
                
        self._broadcast_client_list()
        return True
    
    def is_session_suspended(self, session_id: str) -> bool:
        """Check if a session is suspended.
        
        Args:
            session_id: The session ID to check.
            
        Returns:
            True if suspended, False otherwise (including if not found).
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if session:
                return session.is_suspended()
            return False
    
    def get_all_sessions(self) -> Dict[str, ClientSession]:
        """Get all sessions.
        
        Returns:
            Dictionary of session ID to ClientSession.
        """
        with self._lock:
            return dict(self._sessions)
    
    def get_all_sessions_as_list(self) -> List[dict]:
        """Get all sessions as a list of dictionaries.
        
        Returns:
            List of session dictionaries suitable for JSON.
        """
        with self._lock:
            return [session.to_dict() for session in self._sessions.values()]
    
    def get_session_count(self) -> int:
        """Get the number of active sessions.
        
        Returns:
            Number of sessions.
        """
        with self._lock:
            return len(self._sessions)
    
    def _broadcast_client_list(self) -> None:
        """Broadcast the current client list to all WebSocket clients."""
        if self._websocket_manager:
            clients = self.get_all_sessions_as_list()
            self._websocket_manager.broadcast_client_list(clients)
