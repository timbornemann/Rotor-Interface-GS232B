"""Tests for route persistence behavior."""

import json
import sys
from pathlib import Path

import pytest

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import server.routes.route_manager as route_manager_module
from server.routes.route_manager import RouteManager


def test_save_routes_is_atomic_when_write_fails(tmp_path, monkeypatch):
    """A failed save must not corrupt the previous routes file."""
    routes_file = tmp_path / "routes.json"
    original_payload = {"routes": [{"id": "old", "name": "Old", "steps": []}]}
    routes_file.write_text(json.dumps(original_payload), encoding="utf-8")

    manager = RouteManager(routes_file=routes_file)
    manager._routes = [{"id": "new", "name": "New", "steps": []}]

    original_text = routes_file.read_text(encoding="utf-8")

    def failing_dump(obj, fp, *args, **kwargs):
        fp.write('{"routes": [')
        fp.flush()
        raise OSError("disk full")

    monkeypatch.setattr(route_manager_module.json, "dump", failing_dump)

    with pytest.raises(OSError):
        manager._save_routes()

    assert routes_file.read_text(encoding="utf-8") == original_text
    assert not any(path.suffix == ".tmp" for path in tmp_path.iterdir())
