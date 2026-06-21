"""High-level rotor control logic.

Handles path planning, ramp generation, speed control, and soft limits.
Translates abstract direction commands to GS-232B protocol commands.
"""

import time
import threading
import logging
import re
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
        self.config_lock = threading.RLock()  # Protects self.config from concurrent read/write

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
            "softLimitsEnabled": False,
            "azimuthMode": 360,
            "azimuthSpeedDegPerSec": 4.0,
            "elevationSpeedDegPerSec": 2.0,
            "rampEnabled": False,
            "rampKp": 0.4,
            "rampSampleTimeMs": 400,
            "azimuthDisplayOffset": 0.0,
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

        with self.config_lock:
            self.config["azimuthMode"] = 450 if safe_int("azimuthMode", 360) == 450 else 360
            az_mode = self.config["azimuthMode"]
            az_min = clamp(safe_float("azimuthMinLimit", 0), 0, az_mode)
            az_max = clamp(safe_float("azimuthMaxLimit", az_mode), 0, az_mode)
            if az_max < az_min:
                az_max = az_min
            el_min = clamp(safe_float("elevationMinLimit", 0), 0, 90)
            el_max = clamp(safe_float("elevationMaxLimit", 90), 0, 90)
            if el_max < el_min:
                el_max = el_min
            self.config["azimuthMin"] = az_min
            self.config["azimuthMax"] = az_max
            self.config["elevationMin"] = el_min
            self.config["elevationMax"] = el_max
            self.config["softLimitsEnabled"] = new_config.get("softLimitsEnabled", False) in [True, "true", "True", 1]
            self.config["azimuthSpeedDegPerSec"] = safe_float("azimuthSpeedDegPerSec", 4.0)
            self.config["elevationSpeedDegPerSec"] = safe_float("elevationSpeedDegPerSec", 2.0)
            self.config["rampEnabled"] = new_config.get("rampEnabled", False) in [True, "true", "True", 1]
            self.config["rampSampleTimeMs"] = safe_float("rampSampleTimeMs", 400)

            # Calibration
            self.config["azimuthDisplayOffset"] = safe_float("azimuthDisplayOffset", 0.0)
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
        clamped_target = self._clamp_active_motion_targets()
        if clamped_target and not self.config["rampEnabled"] and self.connection.is_connected():
            self._send_direct_target(clamped_target["azimuth"], clamped_target["elevation"])

    def _get_limit_config(self) -> Dict[str, Any]:
        """Return sanitized hardware and optional software limit settings."""
        with self.config_lock:
            az_mode = 450 if self.config.get("azimuthMode", 360) == 450 else 360
            az_min = clamp(float(self.config.get("azimuthMin", 0)), 0, az_mode)
            az_max = clamp(float(self.config.get("azimuthMax", az_mode)), 0, az_mode)
            el_min = clamp(float(self.config.get("elevationMin", 0)), 0, 90)
            el_max = clamp(float(self.config.get("elevationMax", 90)), 0, 90)
            enabled = bool(self.config.get("softLimitsEnabled", False))

        if az_max < az_min:
            az_max = az_min
        if el_max < el_min:
            el_max = el_min
        return {
            "enabled": enabled,
            "azimuthMode": az_mode,
            "azimuthMin": az_min,
            "azimuthMax": az_max,
            "elevationMin": el_min,
            "elevationMax": el_max,
        }

    def _get_feedback_factor(self, axis: str) -> float:
        """Return the effective feedback factor for azimuth or elevation commands."""
        with self.config_lock:
            feedback_enabled = self.config.get("feedbackCorrectionEnabled", False)
            factor_raw = self.config.get(f"{axis}FeedbackFactor", 1.0)
        if not feedback_enabled:
            return 1.0
        try:
            factor = float(factor_raw)
        except (TypeError, ValueError):
            factor = 1.0
        return factor if factor > 0 else 1.0

    def _get_axis_scale_offset(self, axis: str) -> tuple[float, float]:
        """Return sanitized scale and offset for one axis."""
        with self.config_lock:
            scale_raw = self.config.get(f"{axis}ScaleFactor", 1.0)
            offset_raw = self.config.get(f"{axis}Offset", 0.0)
        try:
            scale = float(scale_raw)
        except (TypeError, ValueError):
            scale = 1.0
        if scale <= 0:
            scale = 1.0
        try:
            offset = float(offset_raw)
        except (TypeError, ValueError):
            offset = 0.0
        return scale, offset

    def _raw_to_calibrated(self, raw_value: float, axis: str) -> float:
        """Convert a hardware raw command value into calibrated degrees."""
        scale, offset = self._get_axis_scale_offset(axis)
        feedback = self._get_feedback_factor(axis)
        return ((float(raw_value) * feedback) + offset) / scale

    def _calibrated_to_raw(self, calibrated_value: float, axis: str) -> float:
        """Convert calibrated degrees into a hardware raw command value."""
        scale, offset = self._get_axis_scale_offset(axis)
        feedback = self._get_feedback_factor(axis)
        return ((float(calibrated_value) * scale) - offset) / feedback

    def _current_calibrated_azimuth(self) -> Optional[float]:
        """Return the current calibrated azimuth if status is available."""
        status = self._get_calibrated_status()
        if not status:
            return None
        value = status.get("azimuth")
        return float(value) if value is not None else None

    def _azimuth_candidates(self, az: float, az_mode: float) -> list[float]:
        """Return possible linear positions for one 0-360 style azimuth request."""
        candidates: list[float] = []
        for candidate in (float(az), float(az) + 360.0, float(az) - 360.0):
            if 0 <= candidate <= az_mode and not any(abs(candidate - seen) < 1e-9 for seen in candidates):
                candidates.append(candidate)
        return candidates or [float(az)]

    def _select_azimuth_candidate(self, az: float, choose_equivalent: bool) -> float:
        """Resolve a possibly ambiguous 450-degree azimuth before clamping."""
        limits = self._get_limit_config()
        az_mode = limits["azimuthMode"]
        if not choose_equivalent or az_mode <= 360:
            return float(az)

        candidates = self._azimuth_candidates(float(az), az_mode)
        current_az = self._current_calibrated_azimuth()
        if current_az is None:
            return candidates[0]
        selected = min(candidates, key=lambda candidate: abs(candidate - current_az))
        logger.info(
            "Smart Azimuth candidate: input=%s current=%s candidates=%s selected=%s",
            az,
            current_az,
            candidates,
            selected,
        )
        return selected

    def _clamp_calibrated_target(
        self,
        az: Optional[float],
        el: Optional[float],
        *,
        choose_equivalent_azimuth: bool = True,
    ) -> Dict[str, Optional[float]]:
        """Apply hardware bounds and optional software limits to calibrated target values."""
        limits = self._get_limit_config()
        az_result = None
        el_result = None

        if az is not None:
            selected_az = self._select_azimuth_candidate(float(az), choose_equivalent_azimuth)
            az_low = limits["azimuthMin"] if limits["enabled"] else 0
            az_high = limits["azimuthMax"] if limits["enabled"] else limits["azimuthMode"]
            az_result = clamp(selected_az, az_low, az_high)

        if el is not None:
            el_low = limits["elevationMin"] if limits["enabled"] else 0
            el_high = limits["elevationMax"] if limits["enabled"] else 90
            el_result = clamp(float(el), el_low, el_high)

        return {"azimuth": az_result, "elevation": el_result}

    def _plan_raw_target(
        self,
        az: Optional[float],
        el: Optional[float],
        *,
        choose_equivalent_azimuth: bool = False,
    ) -> Dict[str, Optional[float]]:
        """Return raw hardware values after calibration, soft limits, and hardware bounds."""
        limits = self._get_limit_config()
        planned_az = None
        planned_el = None

        if az is not None:
            raw_az = float(az)
            if limits["enabled"]:
                calibrated_az = self._raw_to_calibrated(raw_az, "azimuth")
                clamped = self._clamp_calibrated_target(
                    calibrated_az,
                    None,
                    choose_equivalent_azimuth=choose_equivalent_azimuth,
                )
                raw_az = self._calibrated_to_raw(clamped["azimuth"], "azimuth")
            az_raw_max = limits["azimuthMode"] / self._get_feedback_factor("azimuth")
            planned_az = clamp(raw_az, 0, az_raw_max)

        if el is not None:
            raw_el = float(el)
            if limits["enabled"]:
                calibrated_el = self._raw_to_calibrated(raw_el, "elevation")
                clamped = self._clamp_calibrated_target(None, calibrated_el)
                raw_el = self._calibrated_to_raw(clamped["elevation"], "elevation")
            planned_el = clamp(raw_el, 0, 90 / self._get_feedback_factor("elevation"))

        return {"azimuth": planned_az, "elevation": planned_el}

    def plan_raw_target(
        self,
        az: Optional[float],
        el: Optional[float],
    ) -> Dict[str, Optional[float]]:
        """Public helper for callers that need the applied raw target before waiting."""
        return self._plan_raw_target(az, el)

    def _clamp_active_motion_targets(self) -> Optional[Dict[str, Optional[float]]]:
        """Keep already queued target movement inside newly updated limits."""
        with self.state_lock:
            target_az = self.target_az
            target_el = self.target_el
        if target_az is None and target_el is None:
            return None

        clamped = self._clamp_calibrated_target(
            target_az,
            target_el,
            choose_equivalent_azimuth=False,
        )
        changed = False
        with self.state_lock:
            if target_az is not None:
                self.target_az = clamped["azimuth"]
                changed = changed or clamped["azimuth"] != target_az
            if target_el is not None:
                self.target_el = clamped["elevation"]
                changed = changed or clamped["elevation"] != target_el
        return clamped if changed else None

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

    def set_target(self, az: Optional[float], el: Optional[float]) -> Dict[str, Optional[float]]:
        """Set a target position (Move Command).
        
        Args:
            az: Target azimuth in degrees (or None to keep current).
            el: Target elevation in degrees (or None to keep current).
        """
        clamped = self._clamp_calibrated_target(az, el, choose_equivalent_azimuth=True)
        target_az = clamped["azimuth"]
        target_el = clamped["elevation"]
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
        return {"azimuth": target_az, "elevation": target_el}

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
            if self._get_limit_config()["enabled"]:
                self._send_manual_limit_target(protocol_cmd)
                return
            self.connection.send_command(protocol_cmd)

    def _send_manual_limit_target(self, protocol_cmd: str) -> None:
        """Convert a continuous manual command into a bounded target command."""
        limits = self._get_limit_config()
        target_az = None
        target_el = None
        if protocol_cmd == "R":
            target_az = limits["azimuthMax"]
        elif protocol_cmd == "L":
            target_az = limits["azimuthMin"]
        elif protocol_cmd == "U":
            target_el = limits["elevationMax"]
        elif protocol_cmd == "D":
            target_el = limits["elevationMin"]

        with self.state_lock:
            self.manual_direction = None
            self.target_az = target_az
            self.target_el = target_el

        if target_az is not None or target_el is not None:
            self._send_direct_target(target_az, target_el)

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

        with self.config_lock:
            feedback_enabled = self.config.get("feedbackCorrectionEnabled", False)
            factor_raw = self.config.get(factor_key, 1.0)

        if not feedback_enabled:
            return effective

        try:
            factor = float(factor_raw)
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

        with self.config_lock:
            az_scale_raw = self.config.get("azimuthScaleFactor", 1.0)
            el_scale_raw = self.config.get("elevationScaleFactor", 1.0)
            az_offset = self.config.get("azimuthOffset", 0.0)
            el_offset = self.config.get("elevationOffset", 0.0)

        try:
            az_scale = float(az_scale_raw)
        except (TypeError, ValueError):
            az_scale = 1.0
        try:
            el_scale = float(el_scale_raw)
        except (TypeError, ValueError):
            el_scale = 1.0

        if az_scale <= 0:
            az_scale = 1.0
        if el_scale <= 0:
            el_scale = 1.0

        az_cal = (az_raw + az_offset) / az_scale
        el_cal = (el_raw + el_offset) / el_scale
        
        return {"azimuth": az_cal, "elevation": el_cal}
    
    def _send_direct_target(self, az: Optional[float], el: Optional[float]) -> None:
        """Send direct target command (W or M) without ramping.
        
        Args:
            az: Target azimuth in calibrated degrees (from frontend).
            el: Target elevation in calibrated degrees (from frontend).
        """
        clamped = self._clamp_calibrated_target(
            az,
            el,
            choose_equivalent_azimuth=False,
        )
        az = clamped["azimuth"]
        el = clamped["elevation"]
        limits = self._get_limit_config()

        vals = []
        if az is not None:
            raw_az = self._calibrated_to_raw(az, "azimuth")
            raw_az_max = limits["azimuthMode"] / self._get_feedback_factor("azimuth")
            raw_az_int = int(round(clamp(raw_az, 0, raw_az_max)))
            vals.append(f"{raw_az_int:03d}")

        if el is not None:
            raw_el = self._calibrated_to_raw(el, "elevation")
            raw_el_max = 90 / self._get_feedback_factor("elevation")
            raw_el_int = int(round(clamp(raw_el, 0, raw_el_max)))
            if len(vals) == 0:
                # If only EL provided, we need current hardware AZ for the W command
                raw_status = self.connection.get_status()
                curr_az_hw = float(raw_status.get("azimuthRaw", 0)) if raw_status else 0.0
                curr_az_hw = clamp(curr_az_hw, 0, limits["azimuthMode"])
                if limits["enabled"]:
                    planned_current = self._plan_raw_target(curr_az_hw, None)
                    if planned_current["azimuth"] is not None:
                        curr_az_hw = planned_current["azimuth"]
                vals.append(f"{int(round(curr_az_hw)):03d}")

            vals.append(f"{raw_el_int:03d}")

        if len(vals) == 1:
            self.connection.send_command(f"M{vals[0]}")
        elif len(vals) == 2:
            self.connection.send_command(f"W{vals[0]} {vals[1]}")
    
    def set_target_raw(self, az: Optional[float], el: Optional[float]) -> Dict[str, Optional[float]]:
        """Set a target position using raw hardware values (no calibration).
        
        Args:
            az: Target azimuth in raw degrees (hardware position, 0-360/450).
            el: Target elevation in raw degrees (hardware position, 0-90).
        """
        planned = self._plan_raw_target(az, el)
        limits = self._get_limit_config()

        vals = []
        if planned["azimuth"] is not None:
            vals.append(f"{int(round(planned['azimuth'])):03d}")

        if planned["elevation"] is not None:
            if len(vals) == 0:
                # If only EL provided, we need current hardware AZ for the W command
                raw_status = self.connection.get_status()
                curr_az_hw = float(raw_status.get("azimuthRaw", 0)) if raw_status else 0.0
                curr_az_hw = clamp(curr_az_hw, 0, limits["azimuthMode"])
                if limits["enabled"]:
                    planned_current = self._plan_raw_target(curr_az_hw, None)
                    if planned_current["azimuth"] is not None:
                        curr_az_hw = planned_current["azimuth"]
                vals.append(f"{int(round(curr_az_hw)):03d}")
            
            vals.append(f"{int(round(planned['elevation'])):03d}")

        if len(vals) == 1:
            self.connection.send_command(f"M{vals[0]}")
        elif len(vals) == 2:
            self.connection.send_command(f"W{vals[0]} {vals[1]}")
        return planned

    def sanitize_direct_command(self, command: str) -> str:
        """Clamp movement-bearing GS-232B commands while preserving other commands."""
        cleaned = command.strip()
        limits = self._get_limit_config()

        manual_match = re.fullmatch(r"[RrLlUuDd]", cleaned)
        if manual_match and limits["enabled"]:
            direction = cleaned.upper()
            if direction in ("R", "L"):
                target_az = limits["azimuthMax"] if direction == "R" else limits["azimuthMin"]
                raw_az = self._calibrated_to_raw(target_az, "azimuth")
                raw_az_max = limits["azimuthMode"] / self._get_feedback_factor("azimuth")
                return f"M{int(round(clamp(raw_az, 0, raw_az_max))):03d}"

            target_el = limits["elevationMax"] if direction == "U" else limits["elevationMin"]
            raw_el = self._calibrated_to_raw(target_el, "elevation")
            raw_el_max = 90 / self._get_feedback_factor("elevation")
            raw_status = self.connection.get_status()
            curr_az_hw = float(raw_status.get("azimuthRaw", 0)) if raw_status else 0.0
            curr_az_hw = clamp(curr_az_hw, 0, limits["azimuthMode"])
            planned_current = self._plan_raw_target(curr_az_hw, None)
            if planned_current["azimuth"] is not None:
                curr_az_hw = planned_current["azimuth"]
            return f"W{int(round(curr_az_hw)):03d} {int(round(clamp(raw_el, 0, raw_el_max))):03d}"

        az_match = re.fullmatch(r"[Mm]\s*(\d{1,3})", cleaned)
        if az_match:
            planned = self._plan_raw_target(float(az_match.group(1)), None)
            if planned["azimuth"] is None:
                return command
            return f"M{int(round(planned['azimuth'])):03d}"

        az_el_match = re.fullmatch(r"[Ww]\s*(\d{1,3})\s+(\d{1,3})", cleaned)
        if az_el_match:
            planned = self._plan_raw_target(
                float(az_el_match.group(1)),
                float(az_el_match.group(2)),
            )
            if planned["azimuth"] is None or planned["elevation"] is None:
                return command
            return f"W{int(round(planned['azimuth'])):03d} {int(round(planned['elevation'])):03d}"

        return command

    def _control_loop(self) -> None:
        """Main control loop running in background thread."""
        while self.running:
            try:
                if not self.connection.is_connected():
                    time.sleep(1)
                    continue

                with self.config_lock:
                    ramp_enabled = self.config["rampEnabled"]
                    ramp_sample_ms = self.config["rampSampleTimeMs"]

                if not ramp_enabled:
                    # If ramp disabled, direct commands were sent in methods
                    time.sleep(0.1)
                    continue

                # RAMP LOGIC
                status = self._get_calibrated_status()
                if not status:
                    time.sleep(0.1)
                    continue

                dt = ramp_sample_ms / 1000.0
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

                time.sleep(ramp_sample_ms / 1000.0)

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

        with self.config_lock:
            az_speed = self.config["azimuthSpeedDegPerSec"]
            el_speed = self.config["elevationSpeedDegPerSec"]
        limits = self._get_limit_config()
        az_min = limits["azimuthMin"] if limits["enabled"] else 0
        az_max = limits["azimuthMax"] if limits["enabled"] else limits["azimuthMode"]
        el_min = limits["elevationMin"] if limits["enabled"] else 0
        el_max = limits["elevationMax"] if limits["enabled"] else 90

        # Calculate speed factor based on time (soft start)
        elapsed = time.time() - ramp_start_time
        ramp_up_time = 2.0
        factor = 0.2 + (elapsed / ramp_up_time) * 0.8 if elapsed < ramp_up_time else 1.0

        is_az = manual_direction in ['R', 'L']
        direction_sign = 1 if manual_direction in ['R', 'U'] else -1

        if is_az:
            step_size = az_speed * dt * factor
            next_az = current_az + (step_size * direction_sign)

            # Check limits
            if next_az < az_min:
                next_az = az_min
            if next_az > az_max:
                next_az = az_max

            with self.state_lock:
                state_unchanged = (
                    self.manual_direction == manual_direction
                    and self.ramp_start_time == ramp_start_time
                )
            if state_unchanged:
                self._send_direct_target(next_az, None)
        else:
            # Elevation
            step_size = el_speed * dt * factor
            next_el = current_el + (step_size * direction_sign)
            next_el = clamp(next_el, el_min, el_max)
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

        with self.config_lock:
            az_mode = self.config["azimuthMode"]
            az_speed = self.config["azimuthSpeedDegPerSec"]
            el_speed = self.config["elevationSpeedDegPerSec"]

        if target_az is not None:
            delta = target_az - current_az if az_mode > 360 else shortest_angular_delta(target_az, current_az, az_mode)
            if abs(delta) < 0.5:
                clear_az = True
            else:
                step_cap = az_speed * dt
                step = min(abs(delta), step_cap) * (1 if delta > 0 else -1)
                next_az_target = current_az + step

        if target_el is not None:
            delta = target_el - current_el
            if abs(delta) < 0.5:
                clear_el = True
            else:
                step_cap = el_speed * dt
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
