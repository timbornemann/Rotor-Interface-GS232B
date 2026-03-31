"""Tests for session manager broadcasting behavior."""

import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.core.session_manager import SessionManager


def test_new_session_broadcasts_serialized_snapshot(monkeypatch):
    """New sessions should broadcast a concrete client snapshot."""
    manager = SessionManager()
    broadcast_calls = []

    def capture_snapshot(clients=None):
        broadcast_calls.append(clients)

    monkeypatch.setattr(manager, "_broadcast_client_list", capture_snapshot)

    session = manager.get_or_create_session(None, "127.0.0.1", "UnitTest/1.0")

    assert session is not None
    assert len(broadcast_calls) == 1
    assert isinstance(broadcast_calls[0], list)
    assert broadcast_calls[0][0]["id"] == session.id


def test_suspend_session_returns_false_when_missing():
    """Suspending an unknown session should report failure."""
    manager = SessionManager()

    assert manager.suspend_session("missing-session") is False


def test_resume_session_returns_false_when_missing():
    """Resuming an unknown session should report failure."""
    manager = SessionManager()

    assert manager.resume_session("missing-session") is False
