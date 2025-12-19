"""Tests for the API server module.

This file has been updated to work with the new modular server structure.
For comprehensive API tests, see test_api_routes.py.
"""

import json
import pytest
import sys
import threading
from pathlib import Path
from urllib.parse import urljoin
import urllib.request
import urllib.error

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.core.server import create_test_server
from server.core.state import ServerState


@pytest.fixture
def test_server(tmp_path):
    """Create a test server instance."""
    # Reset singleton for clean test
    ServerState.reset_instance()
    
    # Create server
    server, state, base_url = create_test_server(
        port=0,  # Auto-assign port
        config_dir=tmp_path,
        server_root=tmp_path
    )
    
    # Start server in background thread
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    
    yield base_url, state
    
    # Cleanup
    server.shutdown()
    thread.join(timeout=5)
    server.server_close()
    state.reset()


def test_status_without_connection(test_server):
    """GET /api/rotor/status without connection should return disconnected."""
    base_url, state = test_server
    
    with urllib.request.urlopen(urljoin(base_url, "/api/rotor/status")) as response:
        assert response.status == 200
        data = json.load(response)
    
    assert data["connected"] == False
    assert data["clientCount"] == 0


def test_settings_api_get(test_server):
    """GET /api/settings should return configuration."""
    base_url, state = test_server
    
    with urllib.request.urlopen(urljoin(base_url, "/api/settings")) as response:
        assert response.status == 200
        data = json.load(response)
    
    assert "baudRate" in data
    assert data["baudRate"] == 9600


def test_settings_api_post(test_server):
    """POST /api/settings should update configuration."""
    base_url, state = test_server
    
    request = urllib.request.Request(
        urljoin(base_url, "/api/settings"),
        data=json.dumps({"testSetting": "testValue"}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    
    with urllib.request.urlopen(request) as response:
        assert response.status == 200
        data = json.load(response)
    
    assert data["status"] == "ok"
    assert data["settings"]["testSetting"] == "testValue"


def test_ports_api(test_server):
    """GET /api/rotor/ports should return ports list."""
    base_url, state = test_server
    
    with urllib.request.urlopen(urljoin(base_url, "/api/rotor/ports")) as response:
        assert response.status == 200
        data = json.load(response)
    
    assert "ports" in data
    assert isinstance(data["ports"], list)


def test_connect_without_port(test_server):
    """POST /api/rotor/connect without port should return error."""
    base_url, state = test_server
    
    request = urllib.request.Request(
        urljoin(base_url, "/api/rotor/connect"),
        data=json.dumps({}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(request)
    
    assert exc_info.value.code == 400
    error_data = json.loads(exc_info.value.read().decode("utf-8"))
    assert "error" in error_data


def test_disconnect_when_not_connected(test_server):
    """POST /api/rotor/disconnect when not connected should succeed."""
    base_url, state = test_server
    
    request = urllib.request.Request(
        urljoin(base_url, "/api/rotor/disconnect"),
        data=json.dumps({}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    
    with urllib.request.urlopen(request) as response:
        assert response.status == 200
        data = json.load(response)
    
    assert data["status"] == "ok"
