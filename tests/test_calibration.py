"""Tests for multi-point calibration system.

Tests the interpolation and inverse interpolation functions with real-world
data from the user's motor/potentiometer setup.
"""

import unittest
from server.control.math_utils import interpolate_calibration, inverse_interpolate_calibration


class TestMultiPointCalibration(unittest.TestCase):
    """Test multi-point calibration with real user data."""

    def setUp(self):
        """Set up test calibration points from user's real data.
        
        User reported these actual readings:
        - Motor 0° → COM 2°
        - Motor 45° → COM 24°
        - Motor 60° → COM 31°
        - Motor 90° → COM 47°
        - Motor 180° → COM 92°
        - Motor 225° → COM 115°
        - Motor 270° → COM 138°
        - Motor 360° → COM 182°
        - Motor 420° → COM 211°
        - Motor 450° → COM 225°
        """
        self.calibration_points = [
            {"raw": 2, "actual": 0},
            {"raw": 24, "actual": 45},
            {"raw": 31, "actual": 60},
            {"raw": 47, "actual": 90},
            {"raw": 92, "actual": 180},
            {"raw": 115, "actual": 225},
            {"raw": 138, "actual": 270},
            {"raw": 182, "actual": 360},
            {"raw": 211, "actual": 420},
            {"raw": 225, "actual": 450}
        ]

    def test_interpolation_exact_points(self):
        """Test interpolation at exact calibration points."""
        # Test each calibration point
        for point in self.calibration_points:
            result = interpolate_calibration(point["raw"], self.calibration_points)
            self.assertIsNotNone(result)
            self.assertAlmostEqual(result, point["actual"], delta=0.1,
                                   msg=f"Failed for raw={point['raw']}, expected={point['actual']}, got={result}")

    def test_interpolation_between_points(self):
        """Test interpolation between calibration points."""
        # Test a point between 24° (actual 45°) and 31° (actual 60°)
        # At raw=27.5°, we expect approximately (45+60)/2 = 52.5°
        result = interpolate_calibration(27.5, self.calibration_points)
        self.assertIsNotNone(result)
        # Linear interpolation: 45 + (27.5-24)/(31-24) * (60-45) = 45 + 7.5
        expected = 45 + (27.5 - 24) / (31 - 24) * (60 - 45)
        self.assertAlmostEqual(result, expected, delta=0.1)

    def test_interpolation_extrapolation_below(self):
        """Test extrapolation below the lowest calibration point."""
        # Test raw value below 2° (the lowest calibration point)
        result = interpolate_calibration(0, self.calibration_points)
        self.assertIsNotNone(result)
        # Should extrapolate using slope of first two points
        # Slope = (45-0)/(24-2) = 45/22 ≈ 2.045
        # At raw=0: actual = 0 + (0-2) * 2.045 ≈ -4.09
        self.assertLess(result, 0)  # Should be negative

    def test_interpolation_extrapolation_above(self):
        """Test extrapolation above the highest calibration point."""
        # Test raw value above 225° (the highest calibration point)
        result = interpolate_calibration(230, self.calibration_points)
        self.assertIsNotNone(result)
        # Should extrapolate using slope of last two points
        # Slope = (450-420)/(225-211) = 30/14 ≈ 2.143
        # At raw=230: actual = 450 + (230-225) * 2.143 ≈ 460.7
        self.assertGreater(result, 450)

    def test_inverse_interpolation_exact_points(self):
        """Test inverse interpolation at exact calibration points."""
        # Test each calibration point
        for point in self.calibration_points:
            result = inverse_interpolate_calibration(point["actual"], self.calibration_points)
            self.assertIsNotNone(result)
            self.assertAlmostEqual(result, point["raw"], delta=0.1,
                                   msg=f"Failed for actual={point['actual']}, expected={point['raw']}, got={result}")

    def test_inverse_interpolation_between_points(self):
        """Test inverse interpolation between calibration points."""
        # Test actual position between 45° and 60°, e.g., 52.5°
        result = inverse_interpolate_calibration(52.5, self.calibration_points)
        self.assertIsNotNone(result)
        # Should interpolate between raw values 24 and 31
        # Linear: 24 + (52.5-45)/(60-45) * (31-24) = 24 + 3.5 = 27.5
        expected = 24 + (52.5 - 45) / (60 - 45) * (31 - 24)
        self.assertAlmostEqual(result, expected, delta=0.1)

    def test_round_trip_conversion(self):
        """Test that raw -> actual -> raw gives consistent results."""
        test_raw_values = [2, 24, 47, 92, 182, 225]
        
        for raw in test_raw_values:
            # Convert raw to actual
            actual = interpolate_calibration(raw, self.calibration_points)
            self.assertIsNotNone(actual)
            
            # Convert back to raw
            raw_back = inverse_interpolate_calibration(actual, self.calibration_points)
            self.assertIsNotNone(raw_back)
            
            # Should be very close to original
            self.assertAlmostEqual(raw_back, raw, delta=0.5,
                                   msg=f"Round trip failed: {raw} -> {actual} -> {raw_back}")

    def test_insufficient_calibration_points(self):
        """Test behavior with insufficient calibration points."""
        # Empty list
        result = interpolate_calibration(50, [])
        self.assertIsNone(result)
        
        # Single point
        result = interpolate_calibration(50, [{"raw": 24, "actual": 45}])
        self.assertIsNone(result)
        
        # Two points should work
        result = interpolate_calibration(50, [
            {"raw": 24, "actual": 45},
            {"raw": 92, "actual": 180}
        ])
        self.assertIsNotNone(result)

    def test_real_world_scenario(self):
        """Test a realistic scenario from the user's problem description."""
        # User reported that when motor is at 90°, COM port shows 47°
        # After calibration, when we read 47 from COM, we should get 90 actual
        result = interpolate_calibration(47, self.calibration_points)
        self.assertIsNotNone(result)
        self.assertAlmostEqual(result, 90, delta=0.5)
        
        # When we want to move to 90°, we should send command for 47°
        raw_command = inverse_interpolate_calibration(90, self.calibration_points)
        self.assertIsNotNone(raw_command)
        self.assertAlmostEqual(raw_command, 47, delta=0.5)

    def test_comparison_with_linear_calibration(self):
        """Compare multi-point calibration with simple linear calibration.
        
        The user mentioned that simple linear calibration (scale factor ~0.5)
        doesn't work perfectly because the relationship is not exactly 2:1.
        This test demonstrates the improvement.
        """
        # Simple linear calibration: actual ≈ raw * 2
        # This is approximately what the user had before
        
        test_cases = [
            (24, 45),   # Linear would give 48, actual is 45 (-3° error)
            (47, 90),   # Linear would give 94, actual is 90 (-4° error)
            (92, 180),  # Linear would give 184, actual is 180 (-4° error)
            (182, 360), # Linear would give 364, actual is 360 (-4° error)
        ]
        
        for raw, actual_expected in test_cases:
            # Multi-point calibration
            multi_point_result = interpolate_calibration(raw, self.calibration_points)
            self.assertIsNotNone(multi_point_result)
            
            # Linear calibration
            linear_result = raw * 2
            
            # Multi-point should be more accurate
            multi_point_error = abs(multi_point_result - actual_expected)
            linear_error = abs(linear_result - actual_expected)
            
            self.assertLessEqual(multi_point_error, 0.5,
                                msg=f"Multi-point error too large at raw={raw}")
            self.assertGreater(linear_error, multi_point_error,
                              msg=f"Multi-point should be better than linear at raw={raw}")

    def test_all_user_reported_values(self):
        """Verify all user-reported values are correctly interpolated."""
        user_data = [
            (2, 0),
            (24, 45),
            (31, 60),
            (47, 90),
            (92, 180),
            (115, 225),
            (138, 270),
            (182, 360),
            (211, 420),
            (225, 450)
        ]
        
        for raw, expected_actual in user_data:
            result = interpolate_calibration(raw, self.calibration_points)
            self.assertIsNotNone(result, f"Interpolation failed for raw={raw}")
            self.assertAlmostEqual(result, expected_actual, delta=0.5,
                                   msg=f"Wrong result for raw={raw}: expected={expected_actual}, got={result}")


if __name__ == '__main__':
    unittest.main()
