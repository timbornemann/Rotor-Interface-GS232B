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

