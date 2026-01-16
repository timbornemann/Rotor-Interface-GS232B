"""Route Manager - Persistent storage and CRUD operations for routes.

Manages routes stored in routes.json with thread-safe operations.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from server.utils.logging import log


class RouteManager:
    """Manages route storage and CRUD operations.
    
    Handles:
    - Loading routes from routes.json
    - Saving routes to routes.json
    - CRUD operations (Create, Read, Update, Delete)
    - Thread-safe access
    """
    
    def __init__(self, routes_file: Optional[Path] = None) -> None:
        """Initialize the route manager.
        
        Args:
            routes_file: Path to routes.json file. If None, uses default location.
        """
        self.routes_file = routes_file or Path(__file__).parent.parent.parent / "routes.json"
        self._lock = threading.Lock()
        self._routes: List[Dict[str, Any]] = []
        
        # Load existing routes
        self._load_routes()
    
    def _load_routes(self) -> None:
        """Load routes from JSON file."""
        try:
            if self.routes_file.exists():
                with open(self.routes_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self._routes = data.get("routes", [])
                    log(f"[RouteManager] Loaded {len(self._routes)} routes from {self.routes_file}")
            else:
                self._routes = []
                log(f"[RouteManager] No routes file found at {self.routes_file}, starting with empty list")
        except Exception as e:
            log(f"[RouteManager] Error loading routes: {e}", level="ERROR")
            self._routes = []
    
    def _save_routes(self) -> None:
        """Save routes to JSON file."""
        try:
            # Ensure directory exists
            self.routes_file.parent.mkdir(parents=True, exist_ok=True)
            
            # Write to file
            with open(self.routes_file, 'w', encoding='utf-8') as f:
                json.dump({"routes": self._routes}, f, indent=2, ensure_ascii=False)
            
            log(f"[RouteManager] Saved {len(self._routes)} routes to {self.routes_file}")
        except Exception as e:
            log(f"[RouteManager] Error saving routes: {e}", level="ERROR")
            raise
    
    def get_all_routes(self) -> List[Dict[str, Any]]:
        """Get all routes.
        
        Returns:
            List of route dictionaries.
        """
        with self._lock:
            return [route.copy() for route in self._routes]
    
    def get_route(self, route_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific route by ID.
        
        Args:
            route_id: The route ID to find.
            
        Returns:
            Route dictionary or None if not found.
        """
        with self._lock:
            for route in self._routes:
                if route.get("id") == route_id:
                    return route.copy()
            return None
    
    def add_route(self, route: Dict[str, Any]) -> Dict[str, Any]:
        """Add a new route.
        
        Args:
            route: Route dictionary with at least 'id', 'name', and 'steps'.
            
        Returns:
            The added route.
            
        Raises:
            ValueError: If route with same ID already exists.
        """
        with self._lock:
            route_id = route.get("id")
            if not route_id:
                raise ValueError("Route must have an 'id' field")
            
            # Check for duplicate ID
            if any(r.get("id") == route_id for r in self._routes):
                raise ValueError(f"Route with ID '{route_id}' already exists")
            
            # Add route
            self._routes.append(route.copy())
            
            # Save to disk
            self._save_routes()
            
            log(f"[RouteManager] Added route: {route.get('name', 'Unnamed')} ({route_id})")
            return route.copy()
    
    def update_route(self, route_id: str, route: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update an existing route.
        
        Args:
            route_id: ID of the route to update.
            route: New route data.
            
        Returns:
            Updated route or None if not found.
        """
        with self._lock:
            for i, r in enumerate(self._routes):
                if r.get("id") == route_id:
                    # Ensure ID doesn't change
                    route["id"] = route_id
                    self._routes[i] = route.copy()
                    
                    # Save to disk
                    self._save_routes()
                    
                    log(f"[RouteManager] Updated route: {route.get('name', 'Unnamed')} ({route_id})")
                    return route.copy()
            
            log(f"[RouteManager] Route not found for update: {route_id}", level="WARNING")
            return None
    
    def delete_route(self, route_id: str) -> bool:
        """Delete a route.
        
        Args:
            route_id: ID of the route to delete.
            
        Returns:
            True if deleted, False if not found.
        """
        with self._lock:
            initial_length = len(self._routes)
            self._routes = [r for r in self._routes if r.get("id") != route_id]
            
            if len(self._routes) < initial_length:
                # Save to disk
                self._save_routes()
                
                log(f"[RouteManager] Deleted route: {route_id}")
                return True
            
            log(f"[RouteManager] Route not found for deletion: {route_id}", level="WARNING")
            return False
    
    def reload(self) -> None:
        """Reload routes from disk."""
        with self._lock:
            self._load_routes()
