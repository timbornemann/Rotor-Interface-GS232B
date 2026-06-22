"""Tests for route execution behavior with corrected feedback values."""

import sys
import time
from pathlib import Path
from unittest.mock import MagicMock

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.control.rotor_logic import RotorLogic
from server.routes.route_executor import RouteExecutor


def test_wait_for_arrival_uses_feedback_corrected_raw_values():
    """Arrival detection should use corrected raw values, not adapter raw values."""
    connection = MagicMock()
    connection.get_status.return_value = {
        "azimuthRaw": 90,
        "elevationRaw": 45
    }

    logic = RotorLogic(connection)
    logic.update_config({
        "feedbackCorrectionEnabled": True,
        "azimuthFeedbackFactor": 2.0,
        "elevationFeedbackFactor": 2.0,
        "azimuthMode": 450
    })

    executor = RouteExecutor(
        route_manager=MagicMock(),
        rotor_logic=logic,
        websocket_manager=None
    )
    executor.position_tolerance = 1.0
    executor.position_timeout = 0.5
    executor.position_check_interval = 0.01

    started = time.time()
    executor._wait_for_arrival(180, 90)
    elapsed = time.time() - started

    # Should return quickly because corrected values are exactly on target.
    assert elapsed < 0.2
