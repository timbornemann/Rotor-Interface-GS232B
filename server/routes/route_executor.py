"""Route Executor - Executes routes in a background thread.

Manages route execution with position steps, wait steps, and loops.
Broadcasts progress updates via WebSocket.
"""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from server.utils.logging import log

if TYPE_CHECKING:
    from server.routes.route_manager import RouteManager
    from server.control.rotor_logic import RotorLogic
    from server.api.websocket import WebSocketManager


class RouteExecutor:
    """Executes routes in a background thread with progress updates.
    
    Handles:
    - Route execution in separate thread
    - Position steps (move to Az/El and wait for arrival)
    - Wait steps (time-based or manual)
    - Loop steps (repeat nested steps N times)
    - Progress broadcasting via WebSocket
    - Stop/interrupt functionality
    """
    
    def __init__(
        self,
        route_manager: "RouteManager",
        rotor_logic: "RotorLogic",
        websocket_manager: Optional["WebSocketManager"] = None
    ) -> None:
        """Initialize the route executor.
        
        Args:
            route_manager: Route manager for loading routes.
            rotor_logic: Rotor logic for controlling hardware.
            websocket_manager: WebSocket manager for broadcasting updates.
        """
        self.route_manager = route_manager
        self.rotor_logic = rotor_logic
        self.websocket_manager = websocket_manager
        
        # Execution state
        self._lock = threading.Lock()
        self._executing = False
        self._should_stop = False
        self._current_route_id: Optional[str] = None
        self._current_route_name: Optional[str] = None
        self._current_step_index = 0
        self._total_steps = 0
        self._execution_thread: Optional[threading.Thread] = None
        self._manual_continue_event: Optional[threading.Event] = None
        
        # Position arrival settings
        self.position_tolerance = 2.0  # degrees
        self.position_timeout = 60.0  # seconds
        self.position_check_interval = 0.2  # seconds
    
    def start_route(self, route_id: str) -> bool:
        """Start executing a route.
        
        Args:
            route_id: ID of the route to execute.
            
        Returns:
            True if started successfully, False otherwise.
        """
        with self._lock:
            if self._executing:
                log(f"[RouteExecutor] Cannot start route {route_id}: another route is already executing", level="WARNING")
                return False
            
            # Load route
            route = self.route_manager.get_route(route_id)
            if not route:
                log(f"[RouteExecutor] Route not found: {route_id}", level="ERROR")
                return False
            
            # Reset state
            self._executing = True
            self._should_stop = False
            self._current_route_id = route_id
            self._current_route_name = route.get("name", "Unnamed")
            self._current_step_index = 0
            self._total_steps = self._count_total_steps(route.get("steps", []))
            
            # Start execution thread
            self._execution_thread = threading.Thread(
                target=self._execute_route,
                args=(route,),
                daemon=True,
                name=f"RouteExecutor-{route_id}"
            )
            self._execution_thread.start()
            
            log(f"[RouteExecutor] Started route: {self._current_route_name} ({route_id})")
            return True
    
    def stop_route(self) -> None:
        """Stop the currently executing route."""
        with self._lock:
            if not self._executing:
                log("[RouteExecutor] No route is currently executing", level="WARNING")
                return
            
            log(f"[RouteExecutor] Stopping route: {self._current_route_name}")
            self._should_stop = True
            
            # Wake up manual wait if active
            if self._manual_continue_event:
                self._manual_continue_event.set()
    
    def continue_from_manual_wait(self) -> bool:
        """Continue from a manual wait step.
        
        Returns:
            True if a manual wait was active and continued, False otherwise.
        """
        with self._lock:
            if not self._executing or not self._manual_continue_event:
                return False
            
            log("[RouteExecutor] Manual continue triggered")
            self._manual_continue_event.set()
            return True
    
    def get_execution_state(self) -> Dict[str, Any]:
        """Get current execution state.
        
        Returns:
            Dictionary with execution state information.
        """
        with self._lock:
            return {
                "executing": self._executing,
                "routeId": self._current_route_id,
                "routeName": self._current_route_name,
                "currentStepIndex": self._current_step_index,
                "totalSteps": self._total_steps,
            }
    
    def is_executing(self) -> bool:
        """Check if a route is currently executing.
        
        Returns:
            True if executing, False otherwise.
        """
        with self._lock:
            return self._executing
    
    def _execute_route(self, route: Dict[str, Any]) -> None:
        """Execute a route (runs in background thread).
        
        Args:
            route: Route dictionary with steps.
        """
        try:
            # Broadcast start
            self._broadcast_execution_started()
            
            # Execute steps
            steps = route.get("steps", [])
            self._execute_steps(steps, route_level=True)
            
            # Check if stopped or completed
            if self._should_stop:
                log(f"[RouteExecutor] Route stopped: {self._current_route_name}")
                self._broadcast_execution_stopped()
            else:
                log(f"[RouteExecutor] Route completed: {self._current_route_name}")
                self._broadcast_execution_completed(success=True)
        
        except Exception as e:
            log(f"[RouteExecutor] Route execution error: {e}", level="ERROR")
            self._broadcast_execution_completed(success=False, error=str(e))
        
        finally:
            with self._lock:
                self._executing = False
                self._current_route_id = None
                self._current_route_name = None
                self._current_step_index = 0
                self._total_steps = 0
                self._manual_continue_event = None
    
    def _execute_steps(self, steps: List[Dict[str, Any]], route_level: bool = False) -> None:
        """Execute a list of steps.
        
        Args:
            steps: List of step dictionaries.
            route_level: True if these are top-level route steps.
        """
        for i, step in enumerate(steps):
            if self._should_stop:
                return
            
            if route_level:
                with self._lock:
                    self._current_step_index = i
            
            self._execute_step(step)
    
    def _execute_step(self, step: Dict[str, Any]) -> None:
        """Execute a single step.
        
        Args:
            step: Step dictionary.
        """
        step_type = step.get("type")
        
        log(f"[RouteExecutor] Executing step: {step_type}")
        
        # Broadcast step started
        self._broadcast_progress({
            "type": "step_started",
            "stepType": step_type,
            "step": step,
            "stepIndex": self._current_step_index,
        })
        
        try:
            if step_type == "position":
                self._execute_position_step(step)
            elif step_type == "wait":
                self._execute_wait_step(step)
            elif step_type == "loop":
                self._execute_loop_step(step)
            else:
                log(f"[RouteExecutor] Unknown step type: {step_type}", level="WARNING")
            
            # Broadcast step completed
            self._broadcast_progress({
                "type": "step_completed",
                "stepType": step_type,
                "step": step,
                "stepIndex": self._current_step_index,
            })
        
        except Exception as e:
            log(f"[RouteExecutor] Step execution error: {e}", level="ERROR")
            raise
    
    def _execute_position_step(self, step: Dict[str, Any]) -> None:
        """Execute a position step - move to Az/El and wait for arrival.
        
        Args:
            step: Position step dictionary with 'azimuth' and 'elevation'.
        """
        azimuth = step.get("azimuth")
        elevation = step.get("elevation")
        name = step.get("name", "Unnamed")
        
        log(f"[RouteExecutor] Moving to position: {name} (Az: {azimuth}°, El: {elevation}°)")
        
        # Broadcast position moving
        self._broadcast_progress({
            "type": "position_moving",
            "step": step,
            "target": {"azimuth": azimuth, "elevation": elevation}
        })
        
        # Send movement command
        try:
            self.rotor_logic.set_target_raw(azimuth, elevation)
        except Exception as e:
            log(f"[RouteExecutor] Failed to send position command: {e}", level="ERROR")
            raise
        
        # Wait for arrival
        self._wait_for_arrival(azimuth, elevation)
        
        if not self._should_stop:
            log(f"[RouteExecutor] Position reached: {name}")
            self._broadcast_progress({
                "type": "position_reached",
                "step": step
            })
    
    def _wait_for_arrival(self, target_az: Optional[float], target_el: Optional[float]) -> None:
        """Wait for rotor to reach target position.
        
        Args:
            target_az: Target azimuth (or None).
            target_el: Target elevation (or None).
        """
        start_time = time.time()
        
        while not self._should_stop:
            # Get current position from rotor logic
            current_status = self.rotor_logic.get_current_status()
            
            if not current_status:
                # No status yet, keep waiting
                time.sleep(self.position_check_interval)
                continue
            
            current_az = current_status.get("azimuthRaw")
            current_el = current_status.get("elevationRaw")
            
            # Check if within tolerance
            az_ok = target_az is None or (
                current_az is not None and abs(current_az - target_az) <= self.position_tolerance
            )
            el_ok = target_el is None or (
                current_el is not None and abs(current_el - target_el) <= self.position_tolerance
            )
            
            if az_ok and el_ok:
                log("[RouteExecutor] Position reached within tolerance")
                return
            
            # Check timeout
            if time.time() - start_time > self.position_timeout:
                log("[RouteExecutor] Position arrival timeout - continuing anyway", level="WARNING")
                return
            
            # Wait before checking again
            time.sleep(self.position_check_interval)
    
    def _execute_wait_step(self, step: Dict[str, Any]) -> None:
        """Execute a wait step - time-based or manual.
        
        Args:
            step: Wait step dictionary with optional 'duration' and 'message'.
        """
        duration = step.get("duration")
        message = step.get("message", "")
        
        if duration is None or duration == 0:
            # Manual wait
            log(f"[RouteExecutor] Waiting for manual continue: {message}")
            
            self._broadcast_progress({
                "type": "wait_manual",
                "step": step,
                "message": message
            })
            
            # Create event for manual continue
            with self._lock:
                self._manual_continue_event = threading.Event()
            
            # Wait for manual continue or stop
            self._manual_continue_event.wait()
            
            with self._lock:
                self._manual_continue_event = None
            
            if self._should_stop:
                log("[RouteExecutor] Manual wait aborted by stop")
        else:
            # Time-based wait
            duration_ms = int(duration)
            duration_s = duration_ms / 1000.0
            log(f"[RouteExecutor] Waiting {duration_s}s: {message}")
            
            self._wait_with_progress(duration_ms, step)
    
    def _wait_with_progress(self, duration_ms: int, step: Dict[str, Any]) -> None:
        """Wait with progress updates.
        
        Args:
            duration_ms: Duration in milliseconds.
            step: Wait step dictionary.
        """
        start_time = time.time()
        duration_s = duration_ms / 1000.0
        update_interval = 0.1  # Update every 100ms
        
        while not self._should_stop:
            elapsed_s = time.time() - start_time
            remaining_s = max(0, duration_s - elapsed_s)
            
            # Broadcast progress (less frequently to avoid spam)
            if int(elapsed_s * 10) % 5 == 0:  # Every 500ms
                self._broadcast_progress({
                    "type": "wait_progress",
                    "step": step,
                    "elapsed": int(elapsed_s * 1000),
                    "remaining": int(remaining_s * 1000),
                    "total": duration_ms
                })
            
            if elapsed_s >= duration_s:
                break
            
            time.sleep(update_interval)
    
    def _execute_loop_step(self, step: Dict[str, Any]) -> None:
        """Execute a loop step - repeat nested steps N times.
        
        Args:
            step: Loop step dictionary with 'iterations' and 'steps'.
        """
        iterations = step.get("iterations")
        
        # Handle infinite loops
        if iterations is None or iterations == 0 or iterations == float('inf'):
            iterations = float('inf')
            log("[RouteExecutor] Starting infinite loop")
        else:
            iterations = int(iterations)
            log(f"[RouteExecutor] Starting loop: {iterations} iterations")
        
        current_iteration = 0
        max_iterations = 100000  # Safety limit for infinite loops
        
        while current_iteration < iterations and current_iteration < max_iterations:
            if self._should_stop:
                break
            
            self._broadcast_progress({
                "type": "loop_iteration",
                "step": step,
                "iteration": current_iteration + 1,
                "total": iterations if iterations != float('inf') else None
            })
            
            # Execute nested steps
            nested_steps = step.get("steps", [])
            self._execute_steps(nested_steps, route_level=False)
            
            current_iteration += 1
        
        if current_iteration >= max_iterations:
            log("[RouteExecutor] Infinite loop safety limit reached", level="WARNING")
        
        log(f"[RouteExecutor] Loop completed: {current_iteration} iterations")
    
    def _count_total_steps(self, steps: List[Dict[str, Any]]) -> int:
        """Count total number of steps (including nested).
        
        Args:
            steps: List of step dictionaries.
            
        Returns:
            Total step count.
        """
        count = 0
        for step in steps:
            count += 1
            if step.get("type") == "loop":
                nested_steps = step.get("steps", [])
                count += self._count_total_steps(nested_steps)
        return count
    
    def _broadcast_execution_started(self) -> None:
        """Broadcast that route execution has started."""
        if not self.websocket_manager:
            return
        
        self.websocket_manager.broadcast_route_execution_started(
            self._current_route_id,
            self._current_route_name
        )
    
    def _broadcast_execution_stopped(self) -> None:
        """Broadcast that route execution was stopped."""
        if not self.websocket_manager:
            return
        
        self.websocket_manager.broadcast_route_execution_stopped()
    
    def _broadcast_execution_completed(self, success: bool, error: Optional[str] = None) -> None:
        """Broadcast that route execution has completed.
        
        Args:
            success: Whether execution completed successfully.
            error: Optional error message.
        """
        if not self.websocket_manager:
            return
        
        self.websocket_manager.broadcast_route_execution_completed(
            success=success,
            route_id=self._current_route_id,
            error=error
        )
    
    def _broadcast_progress(self, progress_data: Dict[str, Any]) -> None:
        """Broadcast execution progress.
        
        Args:
            progress_data: Progress data dictionary.
        """
        if not self.websocket_manager:
            return
        
        self.websocket_manager.broadcast_route_execution_progress(progress_data)
