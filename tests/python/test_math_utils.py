"""Tests for the math utilities module."""

import pytest
import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.control.math_utils import clamp, wrap_azimuth, shortest_angular_delta


class TestClamp:
    """Tests for the clamp function."""
    
    def test_clamp_within_range(self):
        """Value within range should be unchanged."""
        assert clamp(50, 0, 100) == 50
    
    def test_clamp_at_minimum(self):
        """Value at minimum should be unchanged."""
        assert clamp(0, 0, 100) == 0
    
    def test_clamp_at_maximum(self):
        """Value at maximum should be unchanged."""
        assert clamp(100, 0, 100) == 100
    
    def test_clamp_below_minimum(self):
        """Value below minimum should be clamped."""
        assert clamp(-10, 0, 100) == 0
    
    def test_clamp_above_maximum(self):
        """Value above maximum should be clamped."""
        assert clamp(150, 0, 100) == 100
    
    def test_clamp_float_values(self):
        """Should work with float values."""
        assert clamp(1.5, 0.0, 1.0) == 1.0
        assert clamp(-0.5, 0.0, 1.0) == 0.0


class TestWrapAzimuth:
    """Tests for the wrap_azimuth function."""
    
    def test_wrap_within_range(self):
        """Value within range should be unchanged."""
        assert wrap_azimuth(180, 360) == 180
    
    def test_wrap_at_zero(self):
        """Zero should remain zero."""
        assert wrap_azimuth(0, 360) == 0
    
    def test_wrap_at_range(self):
        """Value at range should wrap to zero."""
        assert wrap_azimuth(360, 360) == 0
    
    def test_wrap_above_range(self):
        """Value above range should wrap."""
        assert wrap_azimuth(400, 360) == 40
    
    def test_wrap_negative(self):
        """Negative value should wrap to positive."""
        assert wrap_azimuth(-10, 360) == 350
    
    def test_wrap_450_mode(self):
        """Should work with 450 degree mode."""
        assert wrap_azimuth(500, 450) == 50


class TestShortestAngularDelta:
    """Tests for the shortest_angular_delta function."""
    
    def test_same_angle(self):
        """Same angle should have zero delta."""
        assert shortest_angular_delta(180, 180, 360) == 0
    
    def test_forward_short(self):
        """Forward direction shorter should be positive."""
        assert shortest_angular_delta(90, 0, 360) == 90
    
    def test_backward_short(self):
        """Backward direction shorter should be negative."""
        assert shortest_angular_delta(0, 90, 360) == -90
    
    def test_wrap_around_forward(self):
        """Should wrap around when forward is shorter."""
        assert shortest_angular_delta(10, 350, 360) == 20
    
    def test_wrap_around_backward(self):
        """Should wrap around when backward is shorter."""
        assert shortest_angular_delta(350, 10, 360) == -20
    
    def test_none_target(self):
        """None target should return 0."""
        assert shortest_angular_delta(None, 180, 360) == 0
    
    def test_none_current(self):
        """None current should return 0."""
        assert shortest_angular_delta(180, None, 360) == 0
    
    def test_zero_range(self):
        """Zero range should return simple difference."""
        assert shortest_angular_delta(100, 50, 0) == 50
    
    def test_negative_range(self):
        """Negative range should return simple difference."""
        assert shortest_angular_delta(100, 50, -10) == 50

