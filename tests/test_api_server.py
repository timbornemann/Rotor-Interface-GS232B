import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urljoin

import json
import urllib.error
import urllib.request

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import python_server as srv


@pytest.fixture
def test_server(tmp_path):
    # Reset globals to a clean slate for every test run
    srv.COMMAND_LOG.clear()
    srv.CALIBRATION_SETTINGS = srv.CALIBRATION_DEFAULTS.copy()
    srv.CALIBRATION_MTIME = None
    srv.ROTOR_CONNECTION = None
    srv.ROTOR_STATUS = None
    srv.ROTOR_CLIENT_COUNT = 0

    # Point configuration to a temporary directory to avoid modifying repo files
    srv.CONFIG_DIR = tmp_path
    srv.INI_FILE = tmp_path / "rotor-config.ini"
    if srv.INI_FILE.exists():
        srv.INI_FILE.unlink()

    server = ThreadingHTTPServer(("localhost", 0), srv.RotorHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    base_url = f"http://{server.server_address[0]}:{server.server_address[1]}"

    yield base_url

    server.shutdown()
    thread.join(timeout=5)
    server.server_close()


def test_command_logging_roundtrip(test_server):
    request = urllib.request.Request(
        urljoin(test_server, "/api/commands"),
        data=json.dumps({"command": "AZ180", "meta": {"user": "tester"}}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        assert response.status == 201
        payload = json.load(response)
    assert payload["status"] == "ok"
    assert payload["entry"]["command"] == "AZ180"
    assert payload["entry"]["meta"]["user"] == "tester"

    with urllib.request.urlopen(urljoin(test_server, "/api/commands")) as log_response:
        assert log_response.status == 200
        log_payload = json.load(log_response)
    assert len(log_payload["commands"]) == 1
    assert log_payload["commands"][0]["command"] == "AZ180"


def test_config_ini_default_generation(test_server, tmp_path):
    with urllib.request.urlopen(urljoin(test_server, "/api/config/ini")) as response:
        assert response.status == 200
        payload = json.load(response)
    assert "[Calibration]" in payload["content"]

    ini_file = srv.INI_FILE
    assert ini_file.exists()
    assert payload["content"] == ini_file.read_text(encoding="utf-8")

    # Second call should return the existing file content
    with urllib.request.urlopen(urljoin(test_server, "/api/config/ini")) as second:
        assert second.status == 200
        assert json.load(second)["content"] == payload["content"]


def test_status_and_position_without_connection(test_server):
    with urllib.request.urlopen(urljoin(test_server, "/api/rotor/status")) as status_response:
        assert status_response.status == 200
        status_payload = json.load(status_response)
    assert status_payload == {"connected": False, "clientCount": 0}

    with urllib.request.urlopen(urljoin(test_server, "/api/rotor/position")) as position_response:
        assert position_response.status == 200
        assert json.load(position_response) == {"connected": False}


def test_reject_invalid_rotor_command_when_disconnected(test_server):
    request = urllib.request.Request(
        urljoin(test_server, "/api/rotor/command"),
        data=json.dumps({"command": "AZ100"}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(request)

    assert exc_info.value.code == 400
    error_payload = json.loads(exc_info.value.read().decode("utf-8"))
    assert error_payload["error"] == "not connected"

