"""Mathematical utility functions for rotor control.

Provides helper functions for angle calculations and value clamping.
"""

from typing import Optional


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

