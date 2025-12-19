"""Integration tests for the server module.

These tests verify the server can be started and accessed correctly.
"""

import json
import pytest
import sys
import threading
from pathlib import Path
from urllib.parse import urljoin
import urllib.request

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.core.server import create_test_server
from server.core.state import ServerState


class TestServerIntegration:
    """Integration tests for the server."""
    
    @pytest.fixture
    def server_setup(self, tmp_path):
        """Set up a test server."""
        ServerState.reset_instance()
        
        # Create a simple index.html for static file serving test
        (tmp_path / "index.html").write_text("<html><body>Test</body></html>")
        
        server, state, base_url = create_test_server(
            port=0,
            config_dir=tmp_path,
            server_root=tmp_path
        )
        
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        
        yield base_url, state, tmp_path
        
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()
        state.reset()
    
    def test_server_starts(self, server_setup):
        """Server should start and be accessible."""
        base_url, state, tmp_path = server_setup
        
        # Try to access the server
        with urllib.request.urlopen(base_url) as response:
            assert response.status == 200
    
    def test_static_file_serving(self, server_setup):
        """Server should serve static files."""
        base_url, state, tmp_path = server_setup
        
        with urllib.request.urlopen(urljoin(base_url, "/index.html")) as response:
            assert response.status == 200
            content = response.read().decode("utf-8")
            assert "Test" in content
    
    def test_api_endpoints_accessible(self, server_setup):
        """API endpoints should be accessible."""
        base_url, state, tmp_path = server_setup
        
        endpoints = [
            "/api/settings",
            "/api/rotor/ports",
            "/api/rotor/status"
        ]
        
        for endpoint in endpoints:
            with urllib.request.urlopen(urljoin(base_url, endpoint)) as response:
                assert response.status == 200
    
    def test_state_singleton(self, server_setup):
        """State singleton should be accessible."""
        base_url, state, tmp_path = server_setup
        
        # Get singleton instance
        singleton = ServerState.get_instance()
        
        # Should be the same instance
        assert singleton is state
        assert singleton.settings is not None
        assert singleton.rotor_connection is not None
        assert singleton.rotor_logic is not None
    
    def test_settings_persistence(self, server_setup):
        """Settings changes should be persisted."""
        base_url, state, tmp_path = server_setup
        
        # Update settings via API
        request = urllib.request.Request(
            urljoin(base_url, "/api/settings"),
            data=json.dumps({"testPersistence": True}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        
        with urllib.request.urlopen(request) as response:
            assert response.status == 200
        
        # Verify JSON file was created
        json_file = tmp_path / "web-settings.json"
        assert json_file.exists()
        
        with open(json_file) as f:
            saved = json.load(f)
        
        assert saved["testPersistence"] == True

