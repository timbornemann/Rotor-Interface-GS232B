"""Tests for the rotor logic module."""

import pytest
import sys
import time
from pathlib import Path
from unittest.mock import Mock, MagicMock

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.control.rotor_logic import RotorLogic


class TestRotorLogicDirectionMapping:
    """Tests for direction mapping."""
    
    def test_direction_map_contains_abstract_directions(self):
        """DIRECTION_MAP should contain abstract directions."""
        assert 'left' in RotorLogic.DIRECTION_MAP
        assert 'right' in RotorLogic.DIRECTION_MAP
        assert 'up' in RotorLogic.DIRECTION_MAP
        assert 'down' in RotorLogic.DIRECTION_MAP
    
    def test_direction_map_contains_protocol_commands(self):
        """DIRECTION_MAP should contain protocol commands."""
        assert 'L' in RotorLogic.DIRECTION_MAP
        assert 'R' in RotorLogic.DIRECTION_MAP
        assert 'U' in RotorLogic.DIRECTION_MAP
        assert 'D' in RotorLogic.DIRECTION_MAP
    
    def test_abstract_to_protocol_mapping(self):
        """Abstract directions should map to correct protocol commands."""
        assert RotorLogic.DIRECTION_MAP['left'] == 'L'
        assert RotorLogic.DIRECTION_MAP['right'] == 'R'
        assert RotorLogic.DIRECTION_MAP['up'] == 'U'
        assert RotorLogic.DIRECTION_MAP['down'] == 'D'


class TestRotorLogic:
    """Tests for the RotorLogic class."""
    
    @pytest.fixture
    def mock_connection(self):
        """Create a mock connection."""
        connection = MagicMock()
        connection.is_connected.return_value = True
        connection.get_status.return_value = {
            "azimuthRaw": 180,
            "elevationRaw": 45,
            "timestamp": int(time.time() * 1000)
        }
        return connection
    
    @pytest.fixture
    def logic(self, mock_connection):
        """Create a RotorLogic instance with mock connection."""
        return RotorLogic(mock_connection)
    
    def test_initial_state(self, logic):
        """Initial state should have no targets."""
        assert logic.target_az is None
        assert logic.target_el is None
        assert logic.manual_direction is None
        assert not logic.running
    
    def test_set_target_updates_state(self, logic):
        """set_target should update target values."""
        logic.set_target(90, 30)
        assert logic.target_az == 90
        assert logic.target_el == 30
        assert logic.manual_direction is None
    
    def test_set_target_clears_manual(self, logic):
        """set_target should clear manual direction."""
        logic.manual_direction = 'R'
        logic.set_target(90, 30)
        assert logic.manual_direction is None
    
    def test_set_target_az_only(self, logic):
        """set_target with only az should leave el as None."""
        logic.set_target(90, None)
        assert logic.target_az == 90
        assert logic.target_el is None
    
    def test_manual_move_abstract_direction(self, logic):
        """manual_move should accept abstract directions."""
        logic.manual_move('left')
        assert logic.manual_direction == 'L'
        assert logic.target_az is None
    
    def test_manual_move_protocol_command(self, logic):
        """manual_move should accept protocol commands."""
        logic.manual_move('R')
        assert logic.manual_direction == 'R'
    
    def test_manual_move_unknown_direction(self, logic):
        """manual_move with unknown direction should not set state."""
        logic.manual_move('unknown')
        assert logic.manual_direction is None
    
    def test_stop_motion_clears_state(self, logic, mock_connection):
        """stop_motion should clear all motion state."""
        logic.target_az = 90
        logic.target_el = 45
        logic.manual_direction = 'R'
        
        logic.stop_motion()
        
        assert logic.target_az is None
        assert logic.target_el is None
        assert logic.manual_direction is None
    
    def test_stop_motion_sends_stop_command(self, logic, mock_connection):
        """stop_motion should send S command when ramp disabled."""
        logic.config["rampEnabled"] = False
        logic.stop_motion()
        mock_connection.send_command.assert_called_with("S")
    
    def test_update_config(self, logic):
        """update_config should update configuration values."""
        logic.update_config({
            "azimuthMinLimit": 10,
            "azimuthMaxLimit": 350,
            "azimuthMode": 450,
            "rampEnabled": True
        })
        
        assert logic.config["azimuthMin"] == 10
        assert logic.config["azimuthMax"] == 350
        assert logic.config["azimuthMode"] == 450
        assert logic.config["rampEnabled"] == True

    def test_update_config_normalizes_azimuth_mode_to_int(self, logic):
        """Azimuth mode should be stored as an integer mode selector."""
        logic.update_config({"azimuthMode": "450.0"})

        assert logic.config["azimuthMode"] == 450
        assert isinstance(logic.config["azimuthMode"], int)
    
    def test_update_config_calibration(self, logic):
        """update_config should update calibration values."""
        logic.update_config({
            "azimuthOffset": 5.0,
            "elevationOffset": -2.0,
            "azimuthScaleFactor": 1.1,
            "elevationScaleFactor": 0.9
        })
        
        assert logic.config["azimuthOffset"] == 5.0
        assert logic.config["elevationOffset"] == -2.0
        assert logic.config["azimuthScaleFactor"] == 1.1
        assert logic.config["elevationScaleFactor"] == 0.9

    def test_update_config_feedback_correction(self, logic):
        """update_config should update feedback correction settings."""
        logic.update_config({
            "feedbackCorrectionEnabled": True,
            "azimuthFeedbackFactor": 2.0,
            "elevationFeedbackFactor": 1.5
        })

        assert logic.config["feedbackCorrectionEnabled"] is True
        assert logic.config["azimuthFeedbackFactor"] == 2.0
        assert logic.config["elevationFeedbackFactor"] == 1.5

    def test_send_direct_target_el_only_uses_hardware_raw_azimuth(self, logic, mock_connection):
        """Elevation-only W command should use hardware raw azimuth (not feedback-corrected)."""
        logic.update_config({
            "feedbackCorrectionEnabled": True,
            "azimuthFeedbackFactor": 2.0,
            "elevationFeedbackFactor": 2.0,
            "azimuthMode": 450
        })
        mock_connection.get_status.return_value = {
            "azimuthRaw": 90,
            "elevationRaw": 30
        }

        logic._send_direct_target(None, 30)

        # AZ: hardware raw = 90 (unchanged, not multiplied by feedback)
        # EL: calibrated=30, hardware_raw = ((30*1)-0)/2 = 15
        mock_connection.send_command.assert_called_with("W090 015")

    def test_handle_target_ramp_does_not_clear_newer_target(self, logic):
        """Stale control-loop snapshots must not clear a newer target."""
        with logic.state_lock:
            logic.target_az = 90.0
            logic.target_el = None

        motion_state = logic._get_motion_state_snapshot()

        with logic.state_lock:
            logic.target_az = 180.0

        logic._handle_target_ramp(current_az=90.0, current_el=45.0, dt=0.1, motion_state=motion_state)

        assert logic.target_az == 180.0

    def test_handle_manual_ramp_skips_stale_direction(self, logic):
        """Stale manual snapshots must not send commands after direction changes."""
        logic._send_direct_target = Mock()

        with logic.state_lock:
            logic.manual_direction = 'R'
            logic.ramp_start_time = time.time() - 0.5

        motion_state = logic._get_motion_state_snapshot()

        with logic.state_lock:
            logic.manual_direction = 'L'

        logic._handle_manual_ramp(current_az=10.0, current_el=20.0, dt=0.2, motion_state=motion_state)

        logic._send_direct_target.assert_not_called()


class TestRotorLogicCalibration:
    """Tests for calibration calculations."""
    
    @pytest.fixture
    def mock_connection(self):
        """Create a mock connection with status."""
        connection = MagicMock()
        connection.is_connected.return_value = True
        connection.get_status.return_value = {
            "azimuthRaw": 180,
            "elevationRaw": 45
        }
        return connection
    
    @pytest.fixture
    def logic(self, mock_connection):
        """Create a RotorLogic instance."""
        return RotorLogic(mock_connection)
    
    def test_calibrated_status_no_offset(self, logic):
        """Calibrated status with no offset should match raw."""
        status = logic._get_calibrated_status()
        assert status["azimuth"] == 180
        assert status["elevation"] == 45
    
    def test_calibrated_status_with_offset(self, logic):
        """Calibrated status should apply offset."""
        logic.config["azimuthOffset"] = 10
        logic.config["elevationOffset"] = 5
        
        status = logic._get_calibrated_status()
        # (raw + offset) / scale = (180 + 10) / 1 = 190
        assert status["azimuth"] == 190
        assert status["elevation"] == 50
    
    def test_calibrated_status_with_scale(self, logic):
        """Calibrated status should apply scale factor."""
        logic.config["azimuthScaleFactor"] = 2.0
        logic.config["elevationScaleFactor"] = 2.0
        
        status = logic._get_calibrated_status()
        # (raw + offset) / scale = (180 + 0) / 2 = 90
        assert status["azimuth"] == 90
        assert status["elevation"] == 22.5

    def test_calibrated_status_with_zero_scale_falls_back_to_unscaled(self, logic):
        """Zero scale factors must not raise and should fall back to 1.0."""
        logic.config["azimuthScaleFactor"] = 0
        logic.config["elevationScaleFactor"] = 0

        status = logic._get_calibrated_status()

        assert status["azimuth"] == 180
        assert status["elevation"] == 45

    def test_calibrated_status_feedback_correction_disabled(self, logic):
        """Feedback correction disabled should keep adapter raw values unchanged."""
        logic.config["feedbackCorrectionEnabled"] = False
        logic.config["azimuthFeedbackFactor"] = 2.0
        logic.config["elevationFeedbackFactor"] = 3.0

        status = logic.get_effective_raw_status()
        assert status["azimuth"] == 180
        assert status["elevation"] == 45

    def test_calibrated_status_feedback_correction_enabled(self, logic):
        """Feedback correction enabled should multiply adapter raw values by factors."""
        logic.config["feedbackCorrectionEnabled"] = True
        logic.config["azimuthFeedbackFactor"] = 2.0
        logic.config["elevationFeedbackFactor"] = 2.0

        status = logic.get_effective_raw_status()
        assert status["azimuth"] == 360
        assert status["elevation"] == 90

