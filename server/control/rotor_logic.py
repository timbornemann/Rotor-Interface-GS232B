"""High-level rotor control logic.

Handles path planning, ramp generation, speed control, and soft limits.
Translates abstract direction commands to GS-232B protocol commands.
"""

import time
import threading
import logging
from typing import Optional, Dict, Any

from server.control.math_utils import clamp, shortest_angular_delta

# Configure logging
logger = logging.getLogger("RotorLogic")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - [RotorLogic] - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)


class RotorLogic:
    """Handles high-level rotor control logic.
    
    Features:
    - Path planning (shortest route, 360 vs 450 mode)
    - Ramp generation (Soft Start/Stop)
    - Speed control
    - Soft limits
    
    This class translates abstract direction commands to protocol-specific commands.
    The frontend sends abstract directions ('left', 'right', 'up', 'down'),
    and this class converts them to GS-232B protocol commands ('L', 'R', 'U', 'D').
    """
    
    # Mapping from abstract directions to protocol commands
    DIRECTION_MAP = {
        'left': 'L',
        'right': 'R',
        'up': 'U',
        'down': 'D',
        # Also accept protocol commands directly for backwards compatibility
        'L': 'L',
        'R': 'R',
        'U': 'U',
        'D': 'D',
    }
    
    def __init__(self, connection_manager) -> None:
        """Initialize the rotor logic controller.
        
        Args:
            connection_manager: The RotorConnection instance for serial communication.
        """
        self.connection = connection_manager
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.state_lock = threading.RLock()
        
        # State
        self.target_az: Optional[float] = None
        self.target_el: Optional[float] = None
        self.manual_direction: Optional[str] = None  # Protocol command: 'R', 'L', 'U', 'D'
        self.stopping = False
        self.stop_phase_start = 0
        self.stop_initial_pos: Optional[Dict[str, float]] = None
        self.ramp_start_time = 0
        
        # Configuration (defaults, should be updated via update_config)
        self.config = {
            "azimuthMin": 0,
            "azimuthMax": 360,
            "elevationMin": 0,
            "elevationMax": 90,
            "azimuthMode": 360,
            "azimuthSpeedDegPerSec": 4.0,
            "elevationSpeedDegPerSec": 2.0,
            "rampEnabled": False,
            "rampKp": 0.4,
            "rampSampleTimeMs": 400,
            "azimuthOffset": 0.0,
            "elevationOffset": 0.0,
            "azimuthScaleFactor": 1.0,
            "elevationScaleFactor": 1.0,
            "feedbackCorrectionEnabled": False,
            "azimuthFeedbackFactor": 1.0,
            "elevationFeedbackFactor": 1.0,
            "azimuthFeedbackFactorMin": 0.1,
            "azimuthFeedbackFactorMax": 10.0,
            "elevationFeedbackFactorMin": 0.1,
            "elevationFeedbackFactorMax": 10.0,
            "parkPositionsEnabled": False,
            "homeAzimuth": 0.0,
            "homeElevation": 0.0,
            "parkAzimuth": 0.0,
            "parkElevation": 0.0
        }

    def _get_motion_state_snapshot(self) -> Dict[str, Any]:
        """Return a consistent snapshot of the motion state."""
        with self.state_lock:
            return {
                "target_az": self.target_az,
                "target_el": self.target_el,
                "manual_direction": self.manual_direction,
                "stopping": self.stopping,
                "stop_phase_start": self.stop_phase_start,
                "stop_initial_pos": self.stop_initial_pos,
                "ramp_start_time": self.ramp_start_time,
            }

    def start(self) -> None:
        """Start the control loop thread."""
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._control_loop, daemon=True)
        self.thread.start()
        logger.info("RotorLogic control loop started")

    def stop(self) -> None:
        """Stop the control loop thread."""
        self.running = False
        if self.thread:
            self.thread.join(timeout=1.0)
        logger.info("RotorLogic control loop stopped")

    def update_config(self, new_config: Dict[str, Any]) -> None:
        """Update configuration on the fly.
        
        Args:
            new_config: Dictionary of configuration values to update.
        """
        def safe_float(key: str, default: float) -> float:
            try:
                if key in new_config:
                    return float(new_config[key])
                return self.config.get(key, default)
            except (ValueError, TypeError):
                return default

        def safe_int(key: str, default: int) -> int:
            try:
                if key in new_config:
                    return int(float(new_config[key]))
                return int(self.config.get(key, default))
            except (ValueError, TypeError):
                return default

        self.config["azimuthMin"] = safe_float("azimuthMinLimit", 0)
        self.config["azimuthMax"] = safe_float("azimuthMaxLimit", 360)
        self.config["elevationMin"] = safe_float("elevationMinLimit", 0)
        self.config["elevationMax"] = safe_float("elevationMaxLimit", 90)
        self.config["azimuthMode"] = 450 if safe_int("azimuthMode", 360) == 450 else 360
        self.config["azimuthSpeedDegPerSec"] = safe_float("azimuthSpeedDegPerSec", 4.0)
        self.config["elevationSpeedDegPerSec"] = safe_float("elevationSpeedDegPerSec", 2.0)
        self.config["rampEnabled"] = new_config.get("rampEnabled", False) in [True, "true", "True", 1]
        self.config["rampSampleTimeMs"] = safe_float("rampSampleTimeMs", 400)
        
        # Calibration
        self.config["azimuthOffset"] = safe_float("azimuthOffset", 0.0)
        self.config["elevationOffset"] = safe_float("elevationOffset", 0.0)
        self.config["azimuthScaleFactor"] = safe_float("azimuthScaleFactor", 1.0)
        self.config["elevationScaleFactor"] = safe_float("elevationScaleFactor", 1.0)
        self.config["feedbackCorrectionEnabled"] = new_config.get("feedbackCorrectionEnabled", False) in [True, "true", "True", 1]
        az_feedback_min = safe_float("azimuthFeedbackFactorMin", 0.1)
        az_feedback_max = safe_float("azimuthFeedbackFactorMax", 10.0)
        if az_feedback_max < az_feedback_min:
            az_feedback_max = az_feedback_min
        self.config["azimuthFeedbackFactorMin"] = az_feedback_min
        self.config["azimuthFeedbackFactorMax"] = az_feedback_max

        el_feedback_min = safe_float("elevationFeedbackFactorMin", 0.1)
        el_feedback_max = safe_float("elevationFeedbackFactorMax", 10.0)
        if el_feedback_max < el_feedback_min:
            el_feedback_max = el_feedback_min
        self.config["elevationFeedbackFactorMin"] = el_feedback_min
        self.config["elevationFeedbackFactorMax"] = el_feedback_max

        self.config["azimuthFeedbackFactor"] = clamp(
            safe_float("azimuthFeedbackFactor", 1.0),
            self.config["azimuthFeedbackFactorMin"],
            self.config["azimuthFeedbackFactorMax"],
        )
        self.config["elevationFeedbackFactor"] = clamp(
            safe_float("elevationFeedbackFactor", 1.0),
            self.config["elevationFeedbackFactorMin"],
            self.config["elevationFeedbackFactorMax"],
        )
        self.config["parkPositionsEnabled"] = new_config.get("parkPositionsEnabled", False) in [True, "true", "True", 1]
        self.config["homeAzimuth"] = safe_float("homeAzimuth", 0.0)
        self.config["homeElevation"] = safe_float("homeElevation", 0.0)
        self.config["parkAzimuth"] = safe_float("parkAzimuth", 0.0)
        self.config["parkElevation"] = safe_float("parkElevation", 0.0)
        
        logger.info("Config updated: %s", self.config)

    def _move_to_preset(self, preset: str) -> bool:
        """Move rotor to a preset position (home or park).
        
        Args:
            preset: Preset name, either "home" or "park".
        
        Returns:
            True if the command was sent, False otherwise.
        """
        if not self.connection.is_connected():
            logger.warning("Cannot move to %s: Not connected", preset)
            return False

        if not self.config.get("parkPositionsEnabled", False):
            logger.warning("Cannot move to %s: presets disabled", preset)
            return False

        az_key = f"{preset}Azimuth"
        el_key = f"{preset}Elevation"
        az = self.config.get(az_key)
        el = self.config.get(el_key)
        if az is None or el is None:
            logger.warning("Cannot move to %s: preset values missing", preset)
            return False

        try:
            az_value = float(az)
            el_value = float(el)
        except (TypeError, ValueError):
            logger.warning("Cannot move to %s: invalid preset values", preset)
            return False

        self.set_target_raw(az_value, el_value)
        logger.info("Preset move issued: %s -> az=%s el=%s", preset, az_value, el_value)
        return True

    def home(self) -> bool:
        """Move rotor to the Home preset."""
        return self._move_to_preset("home")

    def park(self) -> bool:
        """Move rotor to the Park preset."""
        return self._move_to_preset("park")

    def set_target(self, az: Optional[float], el: Optional[float]) -> None:
        """Set a target position (Move Command).
        
        Args:
            az: Target azimuth in degrees (or None to keep current).
            el: Target elevation in degrees (or None to keep current).
        """
        # Smart target selection for overlapping azimuth modes (e.g., 450 degrees)
        # If we are in 450 mode, a request for "10 degrees" could mean 10 or 370.
        # We should choose the one closest to our current position to avoid unnecessary rotation.
        if az is not None and self.config["azimuthMode"] > 360:
            status = self._get_calibrated_status()
            if status and status.get("azimuth") is not None:
                current_az = status["azimuth"]
                # Candidates: The requested azimuth (normalized 0-360) and the overlapped version
                # e.g., if az=10, mode=450: candidates are 10 and 370 (10+360)
                candidates = [az]
                if az + 360 <= self.config["azimuthMode"]:
                    candidates.append(az + 360)
                
                # Also check if input might be > 360 (unlikely from map, but possible via API)
                if az > 360 and az - 360 >= 0:
                     candidates.append(az - 360)

                # Select candidate with shortest linear distance to current position
                # We use simple abs difference because we can't "wrap" physically across the stop.
                best_az = min(candidates, key=lambda x: abs(x - current_az))
                logger.info(f"Smart Azimuth: Input={az}, Current={current_az}, Candidates={candidates} -> Selected={best_az}")
                az = best_az

        target_az = float(az) if az is not None else None
        target_el = float(el) if el is not None else None
        ramp_start_time = time.time()
        with self.state_lock:
            self.target_az = target_az
            self.target_el = target_el
            self.manual_direction = None
            self.stopping = False
            self.ramp_start_time = ramp_start_time
        logger.info(f"Target set: Az={target_az}, El={target_el}")
        
        # Immediate kickoff if ramp disabled
        if not self.config["rampEnabled"]:
            self._send_direct_target(target_az, target_el)

    def manual_move(self, direction: str) -> None:
        """Start manual movement.
        
        Accepts abstract directions ('left', 'right', 'up', 'down') or
        protocol commands ('L', 'R', 'U', 'D') for backwards compatibility.
        
        Args:
            direction: Abstract direction or protocol command.
        """
        # Map abstract direction to protocol command
        protocol_cmd = self.DIRECTION_MAP.get(direction)
        if protocol_cmd is None:
            logger.warning(f"Unknown direction: {direction}")
            return
        
        ramp_start_time = time.time()
        with self.state_lock:
            self.manual_direction = protocol_cmd
            self.target_az = None
            self.target_el = None
            self.stopping = False
            self.ramp_start_time = ramp_start_time
        logger.info(f"Manual move started: {direction} -> {protocol_cmd}")
        
        if not self.config["rampEnabled"]:
            self.connection.send_command(protocol_cmd)

    def stop_motion(self) -> None:
        """Stop all motion."""
        logger.info("Stopping motion")
        with self.state_lock:
            self.manual_direction = None
            self.target_az = None
            self.target_el = None
        
        # Only send stop command if connected
        if not self.connection.is_connected():
            return
        
        if self.config["rampEnabled"]:
            # Initiate soft stop
            status = self._get_calibrated_status()
            if status:
                with self.state_lock:
                    self.stopping = True
                    self.stop_phase_start = time.time()
                    self.stop_initial_pos = status
            else:
                with self.state_lock:
                    self.stopping = False
                    self.stop_initial_pos = None
                self.connection.send_command("S")
        else:
            with self.state_lock:
                self.stopping = False
                self.stop_initial_pos = None
            self.connection.send_command("S")

    def _apply_feedback_correction(self, raw_value: Optional[Any], factor_key: str) -> Optional[float]:
        """Apply optional USB adapter feedback correction to a raw value."""
        if raw_value is None:
            return None
        try:
            effective = float(raw_value)
        except (TypeError, ValueError):
            return None

        if not self.config.get("feedbackCorrectionEnabled", False):
            return effective

        try:
            factor = float(self.config.get(factor_key, 1.0))
        except (TypeError, ValueError):
            factor = 1.0

        if factor <= 0:
            factor = 1.0
        return effective * factor

    def get_effective_raw_status(self) -> Optional[Dict[str, float]]:
        """Get current raw status with optional feedback correction applied."""
        status = self.connection.get_status()
        if not status:
            return None

        az_raw = self._apply_feedback_correction(status.get("azimuthRaw"), "azimuthFeedbackFactor")
        el_raw = self._apply_feedback_correction(status.get("elevationRaw"), "elevationFeedbackFactor")

        if az_raw is None and el_raw is None:
            return None
        return {"azimuth": az_raw, "elevation": el_raw}

    def _get_calibrated_status(self) -> Optional[Dict[str, float]]:
        """Get current status with calibration applied.
        
        Returns:
            Dictionary with calibrated 'azimuth' and 'elevation' or None.
        """
        effective_status = self.get_effective_raw_status()
        if not effective_status:
            return None
        
        az_raw = effective_status.get("azimuth")
        el_raw = effective_status.get("elevation")
        
        if az_raw is None or el_raw is None:
            return None

        try:
            az_scale = float(self.config.get("azimuthScaleFactor", 1.0))
        except (TypeError, ValueError):
            az_scale = 1.0
        try:
            el_scale = float(self.config.get("elevationScaleFactor", 1.0))
        except (TypeError, ValueError):
            el_scale = 1.0

        if az_scale <= 0:
            az_scale = 1.0
        if el_scale <= 0:
            el_scale = 1.0

        az_cal = (az_raw + self.config["azimuthOffset"]) / az_scale
        el_cal = (el_raw + self.config["elevationOffset"]) / el_scale
        
        return {"azimuth": az_cal, "elevation": el_cal}
    
    def _send_direct_target(self, az: Optional[float], el: Optional[float]) -> None:
        """Send direct target command (W or M) without ramping.
        
        Args:
            az: Target azimuth in calibrated degrees (from frontend).
            el: Target elevation in calibrated degrees (from frontend).
        """
        # Convert Target Degrees (Calibrated) -> Raw Command Values
        # Formula: calibrated = (raw + offset) / scale
        # Inverse: raw = (calibrated * scale) - offset
        
        vals = []
        if az is not None:
            raw_az = (az * self.config.get("azimuthScaleFactor", 1.0)) - self.config["azimuthOffset"]
            vals.append(f"{int(round(raw_az)):03d}")
        
        if el is not None:
            raw_el = (el * self.config.get("elevationScaleFactor", 1.0)) - self.config["elevationOffset"]
            if len(vals) == 0:
                # If only EL provided, we need current AZ for the W command
                effective_status = self.get_effective_raw_status()
                curr_az_raw = effective_status.get("azimuth", 0) if effective_status else 0
                curr_az_raw = clamp(curr_az_raw, 0, self.config.get("azimuthMode", 360))
                vals.append(f"{int(round(curr_az_raw)):03d}")
            
            vals.append(f"{int(round(raw_el)):03d}")

        if len(vals) == 1:
            self.connection.send_command(f"M{vals[0]}")
        elif len(vals) == 2:
            self.connection.send_command(f"W{vals[0]} {vals[1]}")
    
    def set_target_raw(self, az: Optional[float], el: Optional[float]) -> None:
        """Set a target position using raw hardware values (no calibration).
        
        Args:
            az: Target azimuth in raw degrees (hardware position, 0-360/450).
            el: Target elevation in raw degrees (hardware position, 0-90).
        """
        # Send raw values directly to motor without any calibration conversion
        vals = []
        if az is not None:
            # Clamp to valid range
            az_clamped = max(0, min(az, self.config.get("azimuthMode", 360)))
            vals.append(f"{int(round(az_clamped)):03d}")
        
        if el is not None:
            # Clamp to valid range
            el_clamped = max(0, min(el, 90))
            if len(vals) == 0:
                # If only EL provided, we need current AZ for the W command
                effective_status = self.get_effective_raw_status()
                curr_az_raw = effective_status.get("azimuth", 0) if effective_status else 0
                curr_az_raw = clamp(curr_az_raw, 0, self.config.get("azimuthMode", 360))
                vals.append(f"{int(round(curr_az_raw)):03d}")
            
            vals.append(f"{int(round(el_clamped)):03d}")

        if len(vals) == 1:
            self.connection.send_command(f"M{vals[0]}")
        elif len(vals) == 2:
            self.connection.send_command(f"W{vals[0]} {vals[1]}")

    def _control_loop(self) -> None:
        """Main control loop running in background thread."""
        while self.running:
            try:
                if not self.connection.is_connected():
                    time.sleep(1)
                    continue

                if not self.config["rampEnabled"]:
                    # If ramp disabled, direct commands were sent in methods
                    time.sleep(0.1)
                    continue
                
                # RAMP LOGIC
                status = self._get_calibrated_status()
                if not status:
                    time.sleep(0.1)
                    continue
                
                dt = self.config["rampSampleTimeMs"] / 1000.0
                current_az = status["azimuth"]
                current_el = status["elevation"]
                motion_state = self._get_motion_state_snapshot()
                
                # 1. Manual Move Ramp
                if motion_state["manual_direction"]:
                    self._handle_manual_ramp(current_az, current_el, dt, motion_state)
                
                # 2. Target Move Ramp (Goto)
                elif motion_state["target_az"] is not None or motion_state["target_el"] is not None:
                    self._handle_target_ramp(current_az, current_el, dt, motion_state)
                
                # 3. Soft Stop
                elif motion_state["stopping"]:
                    self._handle_soft_stop(motion_state)

                time.sleep(self.config["rampSampleTimeMs"] / 1000.0)

            except Exception as e:
                logger.error(f"Error in control loop: {e}")
                time.sleep(1)

    def _handle_manual_ramp(
        self,
        current_az: float,
        current_el: float,
        dt: float,
        motion_state: Dict[str, Any]
    ) -> None:
        """Handle ramped manual movement.
        
        Args:
            current_az: Current azimuth position.
            current_el: Current elevation position.
            dt: Time delta in seconds.
        """
        manual_direction = motion_state["manual_direction"]
        ramp_start_time = motion_state["ramp_start_time"]

        # Calculate speed factor based on time (soft start)
        elapsed = time.time() - ramp_start_time
        ramp_up_time = 2.0
        factor = 0.2 + (elapsed / ramp_up_time) * 0.8 if elapsed < ramp_up_time else 1.0
        
        is_az = manual_direction in ['R', 'L']
        direction_sign = 1 if manual_direction in ['R', 'U'] else -1
        
        if is_az:
            step_size = self.config["azimuthSpeedDegPerSec"] * dt * factor
            next_az = current_az + (step_size * direction_sign)
            
            # Check limits
            if next_az < self.config["azimuthMin"]:
                next_az = self.config["azimuthMin"]
            if next_az > self.config["azimuthMax"]:
                next_az = self.config["azimuthMax"]
                 
            with self.state_lock:
                state_unchanged = (
                    self.manual_direction == manual_direction
                    and self.ramp_start_time == ramp_start_time
                )
            if state_unchanged:
                self._send_direct_target(next_az, None)
        else:
            # Elevation
            step_size = self.config["elevationSpeedDegPerSec"] * dt * factor
            next_el = current_el + (step_size * direction_sign)
            next_el = clamp(next_el, self.config["elevationMin"], self.config["elevationMax"])
            with self.state_lock:
                state_unchanged = (
                    self.manual_direction == manual_direction
                    and self.ramp_start_time == ramp_start_time
                )
            if state_unchanged:
                self._send_direct_target(None, next_el)

    def _handle_target_ramp(
        self,
        current_az: float,
        current_el: float,
        dt: float,
        motion_state: Dict[str, Any]
    ) -> None:
        """Handle ramped target movement.
        
        Args:
            current_az: Current azimuth position.
            current_el: Current elevation position.
            dt: Time delta in seconds.
        """
        target_az = motion_state["target_az"]
        target_el = motion_state["target_el"]
        next_az_target = None
        next_el_target = None
        clear_az = False
        clear_el = False

        if target_az is not None:
            delta = shortest_angular_delta(target_az, current_az, self.config["azimuthMode"])
            if abs(delta) < 0.5:
                clear_az = True
            else:
                step_cap = self.config["azimuthSpeedDegPerSec"] * dt
                step = min(abs(delta), step_cap) * (1 if delta > 0 else -1)
                next_az_target = current_az + step
        
        if target_el is not None:
            delta = target_el - current_el
            if abs(delta) < 0.5:
                clear_el = True
            else:
                step_cap = self.config["elevationSpeedDegPerSec"] * dt
                step = min(abs(delta), step_cap) * (1 if delta > 0 else -1)
                next_el_target = current_el + step

        if clear_az or clear_el:
            with self.state_lock:
                if clear_az and self.target_az == target_az:
                    self.target_az = None
                if clear_el and self.target_el == target_el:
                    self.target_el = None
        
        if next_az_target is not None or next_el_target is not None:
            expected_target_az = None if clear_az else target_az
            expected_target_el = None if clear_el else target_el
            with self.state_lock:
                state_unchanged = (
                    self.target_az == expected_target_az
                    and self.target_el == expected_target_el
                    and self.manual_direction is None
                    and not self.stopping
                )
            if state_unchanged:
                az_to_send = next_az_target if next_az_target is not None else current_az
                el_to_send = next_el_target if next_el_target is not None else current_el
                self._send_direct_target(az_to_send, el_to_send)

    def _handle_soft_stop(self, motion_state: Dict[str, Any]) -> None:
        """Handle soft stop phase."""
        stop_phase_start = motion_state["stop_phase_start"]
        elapsed = time.time() - stop_phase_start
        ramp_down_time = 1.0
        if elapsed >= ramp_down_time:
            with self.state_lock:
                state_unchanged = self.stopping and self.stop_phase_start == stop_phase_start
                if state_unchanged:
                    self.stopping = False
                    self.stop_initial_pos = None
            if state_unchanged:
                self.connection.send_command("S")
