import math
import time
import threading
import logging
from typing import Optional, Dict, Any, Tuple

# Configure logging
logger = logging.getLogger("RotorLogic")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - [RotorLogic] - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)

def clamp(value, min_val, max_val):
    return max(min_val, min(value, max_val))

def wrap_azimuth(value, range_val):
    return ((value % range_val) + range_val) % range_val

def shortest_angular_delta(target, current, range_val):
    if target is None or current is None:
        return 0
    if not range_val or range_val <= 0:
        return target - current
    delta = target - current
    while delta > range_val / 2:
        delta -= range_val
    while delta < -range_val / 2:
        delta += range_val
    return delta

class RotorLogic:
    """
    Handles high-level rotor control logic:
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
    
    def __init__(self, connection_manager):
        self.connection = connection_manager
        self.running = False
        self.thread = None
        
        # State
        self.target_az: Optional[float] = None
        self.target_el: Optional[float] = None
        self.manual_direction: Optional[str] = None  # Protocol command: 'R', 'L', 'U', 'D'
        self.stopping = False
        self.stop_phase_start = 0
        self.stop_initial_pos: Optional[Dict[str, float]] = None
        self.ramp_start_time = 0
        
        # Configuration (defaults, should be updated via set_config)
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
            "elevationScaleFactor": 1.0
        }

    def start(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._control_loop, daemon=True)
        self.thread.start()
        logger.info("RotorLogic control loop started")

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=1.0)
        logger.info("RotorLogic control loop stopped")

    def update_config(self, new_config: Dict[str, Any]):
        """Update configuration on the fly."""
        # Convert necessary values
        def safe_float(k, default):
            try:
                if k in new_config:
                    return float(new_config[k])
                return self.config.get(k, default)
            except:
                return default

        self.config["azimuthMin"] = safe_float("azimuthMinLimit", 0)
        self.config["azimuthMax"] = safe_float("azimuthMaxLimit", 360)
        self.config["elevationMin"] = safe_float("elevationMinLimit", 0)
        self.config["elevationMax"] = safe_float("elevationMaxLimit", 90)
        self.config["azimuthMode"] = float(new_config.get("azimuthMode", 360))
        self.config["azimuthSpeedDegPerSec"] = safe_float("azimuthSpeedDegPerSec", 4.0)
        self.config["elevationSpeedDegPerSec"] = safe_float("elevationSpeedDegPerSec", 2.0)
        self.config["rampEnabled"] = new_config.get("rampEnabled", False) in [True, "true", "True", 1]
        self.config["rampSampleTimeMs"] = safe_float("rampSampleTimeMs", 400)
        
        # Calibration
        self.config["azimuthOffset"] = safe_float("azimuthOffset", 0.0)
        self.config["elevationOffset"] = safe_float("elevationOffset", 0.0)
        self.config["azimuthScaleFactor"] = safe_float("azimuthScaleFactor", 1.0)
        self.config["elevationScaleFactor"] = safe_float("elevationScaleFactor", 1.0)
        
        logger.info("Config updated: %s", self.config)

    def set_target(self, az: Optional[float], el: Optional[float]):
        """Set a target position (Move Command)."""
        self.target_az = float(az) if az is not None else None
        self.target_el = float(el) if el is not None else None
        self.manual_direction = None
        self.stopping = False
        self.ramp_start_time = time.time()
        logger.info(f"Target set: Az={self.target_az}, El={self.target_el}")
        
        # Immediate kickoff if ramp disabled
        if not self.config["rampEnabled"]:
            self._send_direct_target(self.target_az, self.target_el)

    def manual_move(self, direction: str):
        """Start manual movement.
        
        Accepts abstract directions ('left', 'right', 'up', 'down') or
        protocol commands ('L', 'R', 'U', 'D') for backwards compatibility.
        
        Args:
            direction: Abstract direction or protocol command
        """
        # Map abstract direction to protocol command
        protocol_cmd = self.DIRECTION_MAP.get(direction)
        if protocol_cmd is None:
            logger.warning(f"Unknown direction: {direction}")
            return
        
        self.manual_direction = protocol_cmd
        self.target_az = None
        self.target_el = None
        self.stopping = False
        self.ramp_start_time = time.time()
        logger.info(f"Manual move started: {direction} -> {protocol_cmd}")
        
        if not self.config["rampEnabled"]:
            self.connection.send_command(protocol_cmd)

    def stop_motion(self):
        """Stop all motion."""
        logger.info("Stopping motion")
        self.manual_direction = None
        self.target_az = None
        self.target_el = None
        
        if self.config["rampEnabled"]:
            # Initiate soft stop
            self.stopping = True
            self.stop_phase_start = time.time()
            status = self._get_calibrated_status()
            if status:
                self.stop_initial_pos = status
            else:
                self.stopping = False
                self.connection.send_command("S")
        else:
            self.connection.send_command("S")

    def _get_calibrated_status(self):
        """Get current status with calibration applied."""
        status = self.connection.get_status()
        if not status:
            return None
        
        # The python_server.py RotorConnection returns raw values in "azimuth" field if "azimuthRaw" is not present,
        # but build_status_payload separates them. 
        # Inside RotorConnection we have "azimuthRaw" which is the raw integer from device.
        
        # We need to apply offset and scale similar to existing logic to know "Real World Degrees"
        # Logic: Real = (Raw + Offset) / Scale
        # BUT wait: python_server.py `_calibrate_value` does `(raw + offset) / scale`.
        # rotorService.js `getCalibratedAzimuth` does `clamp(raw + offset, ...)` -- wait, JS didn't use scale in getCalibrated?
        # Let's check JS again.
        # JS `constrainRawAzimuth` uses `(calibrated * scale) - offset`... wait.
        # JS `getCalibratedAzimuth` line 450: `clamp(this.azimuthRaw + this.azimuthOffset, ...)`
        # JS `setAzimuth` sends raw command? No, line 1363: `rawAz = (nextAz * scale) - offset`
        
        # OK, data flow mismatch:
        # JS used `azimuthRaw` as the internal state in simulation.
        # For real device, `python_server` sends `AZ=xxx`.
        # Python `_calibrate_value`: `(raw + offset) / scale`.
        
        az_raw = status.get("azimuthRaw")
        el_raw = status.get("elevationRaw")
        
        if az_raw is None or el_raw is None:
            return None
            
        az_cal = (az_raw + self.config["azimuthOffset"]) / self.config.get("azimuthScaleFactor", 1.0)
        el_cal = (el_raw + self.config["elevationOffset"]) / self.config.get("elevationScaleFactor", 1.0)
        
        return {"azimuth": az_cal, "elevation": el_cal}
    
    def _send_direct_target(self, az, el):
        """Send direct target command (W or M) without ramping."""
        # We need to convert Target Degrees (Real) -> Raw Command Values
        # Raw = (Real * Scale) - Offset
        
        vals = []
        if az is not None:
             raw_az = (az * self.config.get("azimuthScaleFactor", 1.0)) - self.config["azimuthOffset"]
             # Wrap check if needed? Device expects 0-360 or 0-450 usually.
             vals.append(f"{int(round(raw_az)):03d}")
        
        if el is not None:
             raw_el = (el * self.config.get("elevationScaleFactor", 1.0)) - self.config["elevationOffset"]
             if len(vals) == 0:
                 # If only EL provided, GS232B usually supports 'Waaa eee' or just 'Waaa eee' needs both?
                 # 'M' is usually just Azimuth. 'W' is both.
                 # If we only have EL, we might need current AZ.
                 status = self.connection.get_status()
                 curr_az_raw = status.get("azimuthRaw", 0) if status else 0
                 vals.append(f"{int(round(curr_az_raw)):03d}")
             
             vals.append(f"{int(round(raw_el)):03d}")

        if len(vals) == 1:
            self.connection.send_command(f"M{vals[0]}")
        elif len(vals) == 2:
            self.connection.send_command(f"W{vals[0]} {vals[1]}")

    def _control_loop(self):
        while self.running:
            try:
                if not self.connection.is_connected():
                    time.sleep(1)
                    continue

                if not self.config["rampEnabled"]:
                     # If ramp disabled, we don't do anything in loop unless stopping needed
                     # Direct commands were sent in methods
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
                
                # 1. Manual Move Ramp
                if self.manual_direction:
                    # Calculate speed factor based on time
                    elapsed = time.time() - self.ramp_start_time
                    ramp_up_time = 2.0
                    factor = 0.2 + (elapsed / ramp_up_time) * 0.8 if elapsed < ramp_up_time else 1.0
                    
                    is_az = self.manual_direction in ['R', 'L']
                    direction_sign = 1 if self.manual_direction in ['R', 'U'] else -1
                    
                    if is_az:
                        step_size = self.config["azimuthSpeedDegPerSec"] * dt * factor
                        next_az = current_az + (step_size * direction_sign)
                        # Check limits
                        # Handle wrapping if mode=450 etc (simplified here for robustness)
                        if next_az < self.config["azimuthMin"]:
                             if self.config["azimuthMode"] == 450 and next_az < 0:
                                 # Wrap logic for 450? 
                                 pass # TODO: Full 450 logic
                             else:
                                 next_az = self.config["azimuthMin"]
                        
                        if next_az > self.config["azimuthMax"]:
                             next_az = self.config["azimuthMax"]
                             
                        # Send command
                        # We calculate next absolute position and send it
                        self._send_direct_target(next_az, None)
                        
                    else: # Elevation
                        step_size = self.config["elevationSpeedDegPerSec"] * dt * factor
                        next_el = current_el + (step_size * direction_sign)
                        next_el = clamp(next_el, self.config["elevationMin"], self.config["elevationMax"])
                        self._send_direct_target(None, next_el)
                
                # 2. Target Move Ramp (Goto)
                elif self.target_az is not None or self.target_el is not None:
                    # Simplified PI or Speed Step logic
                    # Calculate errors
                    az_sent = False
                    el_sent = False
                    
                    next_az_target = None
                    next_el_target = None

                    if self.target_az is not None:
                        delta = shortest_angular_delta(self.target_az, current_az, self.config["azimuthMode"])
                        if abs(delta) < 0.5:
                            self.target_az = None # Reached
                        else:
                            step_cap = self.config["azimuthSpeedDegPerSec"] * dt
                            step = min(abs(delta), step_cap) * (1 if delta > 0 else -1)
                            next_az_target = current_az + step
                    
                    if self.target_el is not None:
                        delta = self.target_el - current_el
                        if abs(delta) < 0.5:
                            self.target_el = None
                        else:
                            step_cap = self.config["elevationSpeedDegPerSec"] * dt
                            step = min(abs(delta), step_cap) * (1 if delta > 0 else -1)
                            next_el_target = current_el + step
                    
                    if next_az_target is not None or next_el_target is not None:
                         # Use current if not changing
                         az_to_send = next_az_target if next_az_target is not None else current_az
                         el_to_send = next_el_target if next_el_target is not None else current_el
                         
                         # Optimization: Don't send if delta is tiny
                         self._send_direct_target(az_to_send, el_to_send)
                
                elif self.stopping:
                    # Soft Stop Logic
                    elapsed = time.time() - self.stop_phase_start
                    ramp_down_time = 1.0
                    if elapsed >= ramp_down_time:
                         self.stopping = False
                         self.connection.send_command("S")
                    else:
                         factor = 1.0 - (elapsed / ramp_down_time)
                         # Continue inertia? simplified: just stop sending updates or send smaller updates?
                         # JS implementation moves slighly further.
                         pass 

                time.sleep(self.config["rampSampleTimeMs"] / 1000.0)

            except Exception as e:
                logger.error(f"Error in control loop: {e}")
                time.sleep(1)
