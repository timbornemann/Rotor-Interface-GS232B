"""Tests for route execution behavior with corrected feedback values."""

import sys
import time
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.control.rotor_logic import RotorLogic
from server.routes.route_executor import RouteExecutor


def test_wait_for_arrival_uses_feedback_corrected_raw_values():
    """Arrival detection should use corrected raw values, not adapter raw values."""
    connection = MagicMock()
    connection.is_connected.return_value = True
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
    reached = executor._wait_for_arrival(180, 90)
    elapsed = time.time() - started

    # Should return quickly because corrected values are exactly on target.
    assert reached is True
    assert elapsed < 0.2


def test_wait_for_arrival_raises_when_rotor_disconnects():
    """A lost rotor connection during route execution should fail the route."""
    rotor_logic = MagicMock()
    rotor_logic.get_effective_raw_status.return_value = None
    rotor_logic.connection.is_connected.return_value = False

    executor = RouteExecutor(
        route_manager=MagicMock(),
        rotor_logic=rotor_logic,
        websocket_manager=None
    )
    executor.position_check_interval = 0.01

    with pytest.raises(RuntimeError, match="Rotor disconnected"):
        executor._wait_for_arrival(180, 45)


def test_wait_for_arrival_raises_on_disconnect_even_with_cached_status():
    """A stale cached position must not mask a disconnected rotor."""
    rotor_logic = MagicMock()
    rotor_logic.get_effective_raw_status.return_value = {
        "azimuth": 180,
        "elevation": 45,
    }
    rotor_logic.connection.is_connected.return_value = False

    executor = RouteExecutor(
        route_manager=MagicMock(),
        rotor_logic=rotor_logic,
        websocket_manager=None
    )

    with pytest.raises(RuntimeError, match="Rotor disconnected"):
        executor._wait_for_arrival(180, 45)
