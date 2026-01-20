"""Mathematical utility functions for rotor control.

Provides helper functions for angle calculations and value clamping.
"""

from typing import Optional, List, Dict, Any


def clamp(value: float, min_val: float, max_val: float) -> float:
    """Clamp a value to a specified range.
    
    Args:
        value: The value to clamp.
        min_val: Minimum allowed value.
        max_val: Maximum allowed value.
        
    Returns:
        The clamped value.
    """
    return max(min_val, min(value, max_val))


def wrap_azimuth(value: float, range_val: float) -> float:
    """Wrap an azimuth value to stay within range.
    
    Args:
        value: The azimuth value to wrap.
        range_val: The range to wrap within (e.g., 360 or 450).
        
    Returns:
        The wrapped azimuth value.
    """
    return ((value % range_val) + range_val) % range_val


def shortest_angular_delta(
    target: Optional[float], 
    current: Optional[float], 
    range_val: float
) -> float:
    """Calculate the shortest angular distance between two angles.
    
    Args:
        target: Target angle in degrees.
        current: Current angle in degrees.
        range_val: The angular range (e.g., 360 or 450).
        
    Returns:
        The shortest angular delta (positive = clockwise, negative = counter-clockwise).
    """
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


def interpolate_calibration(
    raw_value: float, 
    calibration_points: List[Dict[str, Any]]
) -> Optional[float]:
    """Interpolate actual value from raw value using calibration points.
    
    Uses linear interpolation between calibration points. If the raw_value is
    outside the calibration range, extrapolates using the slope of the edge points.
    
    Args:
        raw_value: Raw value from hardware (COM port).
        calibration_points: List of calibration points with 'raw' and 'actual' keys.
                          Example: [{"raw": 2, "actual": 0}, {"raw": 47, "actual": 90}]
    
    Returns:
        Interpolated actual value, or None if insufficient calibration points (< 2).
    """
    if not calibration_points or len(calibration_points) < 2:
        return None
    
    # Sort points by raw value
    sorted_points = sorted(calibration_points, key=lambda p: p.get("raw", 0))
    
    # Extract raw and actual values
    raw_vals = [p.get("raw", 0) for p in sorted_points]
    actual_vals = [p.get("actual", 0) for p in sorted_points]
    
    # Handle edge cases: extrapolation
    if raw_value <= raw_vals[0]:
        # Extrapolate below first point using slope of first two points
        if len(raw_vals) >= 2:
            slope = (actual_vals[1] - actual_vals[0]) / (raw_vals[1] - raw_vals[0])
            return actual_vals[0] + slope * (raw_value - raw_vals[0])
        return actual_vals[0]
    
    if raw_value >= raw_vals[-1]:
        # Extrapolate above last point using slope of last two points
        if len(raw_vals) >= 2:
            slope = (actual_vals[-1] - actual_vals[-2]) / (raw_vals[-1] - raw_vals[-2])
            return actual_vals[-1] + slope * (raw_value - raw_vals[-1])
        return actual_vals[-1]
    
    # Find surrounding points for interpolation
    for i in range(len(raw_vals) - 1):
        if raw_vals[i] <= raw_value <= raw_vals[i + 1]:
            # Linear interpolation
            raw_a, raw_b = raw_vals[i], raw_vals[i + 1]
            actual_a, actual_b = actual_vals[i], actual_vals[i + 1]
            
            if raw_b == raw_a:  # Avoid division by zero
                return actual_a
            
            t = (raw_value - raw_a) / (raw_b - raw_a)
            return actual_a + t * (actual_b - actual_a)
    
    # Fallback (should not reach here)
    return None


def inverse_interpolate_calibration(
    actual_value: float,
    calibration_points: List[Dict[str, Any]]
) -> Optional[float]:
    """Inverse interpolation: convert actual value to raw value using calibration points.
    
    This is the inverse operation of interpolate_calibration, used when sending
    commands to hardware (converting desired actual position to raw command value).
    
    Args:
        actual_value: Desired actual position (calibrated degrees).
        calibration_points: List of calibration points with 'raw' and 'actual' keys.
    
    Returns:
        Interpolated raw value, or None if insufficient calibration points (< 2).
    """
    if not calibration_points or len(calibration_points) < 2:
        return None
    
    # Sort points by actual value (not raw, since we're doing inverse)
    sorted_points = sorted(calibration_points, key=lambda p: p.get("actual", 0))
    
    # Extract raw and actual values
    raw_vals = [p.get("raw", 0) for p in sorted_points]
    actual_vals = [p.get("actual", 0) for p in sorted_points]
    
    # Handle edge cases: extrapolation
    if actual_value <= actual_vals[0]:
        # Extrapolate below first point
        if len(actual_vals) >= 2:
            slope = (raw_vals[1] - raw_vals[0]) / (actual_vals[1] - actual_vals[0])
            return raw_vals[0] + slope * (actual_value - actual_vals[0])
        return raw_vals[0]
    
    if actual_value >= actual_vals[-1]:
        # Extrapolate above last point
        if len(actual_vals) >= 2:
            slope = (raw_vals[-1] - raw_vals[-2]) / (actual_vals[-1] - actual_vals[-2])
            return raw_vals[-1] + slope * (actual_value - actual_vals[-1])
        return raw_vals[-1]
    
    # Find surrounding points for interpolation
    for i in range(len(actual_vals) - 1):
        if actual_vals[i] <= actual_value <= actual_vals[i + 1]:
            # Linear interpolation
            actual_a, actual_b = actual_vals[i], actual_vals[i + 1]
            raw_a, raw_b = raw_vals[i], raw_vals[i + 1]
            
            if actual_b == actual_a:  # Avoid division by zero
                return raw_a
            
            t = (actual_value - actual_a) / (actual_b - actual_a)
            return raw_a + t * (raw_b - raw_a)
    
    # Fallback (should not reach here)
    return None

