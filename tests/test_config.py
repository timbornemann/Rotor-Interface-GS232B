"""Tests for the configuration management module."""

import json
import pytest
import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.config.defaults import DEFAULT_CONFIG
from server.config.settings import SettingsManager


class TestDefaults:
    """Tests for default configuration values."""
    
    def test_default_config_has_baud_rate(self):
        """Default config should have baudRate."""
        assert "baudRate" in DEFAULT_CONFIG
        assert DEFAULT_CONFIG["baudRate"] == 9600
    
    def test_default_config_has_calibration(self):
        """Default config should have calibration settings."""
        assert "azimuthOffset" in DEFAULT_CONFIG
        assert "elevationOffset" in DEFAULT_CONFIG
        assert "azimuthScaleFactor" in DEFAULT_CONFIG
        assert "elevationScaleFactor" in DEFAULT_CONFIG
        assert "feedbackCorrectionEnabled" in DEFAULT_CONFIG
        assert "azimuthFeedbackFactor" in DEFAULT_CONFIG
        assert "elevationFeedbackFactor" in DEFAULT_CONFIG
    
    def test_default_config_has_limits(self):
        """Default config should have limit settings."""
        assert "azimuthMinLimit" in DEFAULT_CONFIG
        assert "azimuthMaxLimit" in DEFAULT_CONFIG
        assert "elevationMinLimit" in DEFAULT_CONFIG
        assert "elevationMaxLimit" in DEFAULT_CONFIG

    def test_default_config_has_overlay_settings(self):
        """Default config should include map overlay settings."""
        assert DEFAULT_CONFIG["mapOverlayEnabled"] is True
        assert DEFAULT_CONFIG["mapOverlayLabelMode"] == "both"
        assert DEFAULT_CONFIG["mapOverlayAutoContrast"] is True
        assert DEFAULT_CONFIG["mapOverlayRingRadiiMeters"] == [1000, 5000, 10000, 20000]

    def test_default_config_has_map_source_settings(self):
        """Default config should include persistent map source settings."""
        assert DEFAULT_CONFIG["mapSource"] == "arcgis"
        assert DEFAULT_CONFIG["mapType"] == "satellite"
    
class TestSettingsManager:
    """Tests for the SettingsManager class."""
    
    @pytest.fixture
    def settings_dir(self, tmp_path):
        """Create a temporary settings directory."""
        return tmp_path
    
    @pytest.fixture
    def settings(self, settings_dir):
        """Create a SettingsManager instance."""
        return SettingsManager(settings_dir)
    
    def test_creates_default_json_if_missing(self, settings_dir, settings):
        """Should create default JSON file if missing."""
        json_file = settings_dir / "web-settings.json"
        assert json_file.exists()
    
    def test_get_all_returns_defaults(self, settings):
        """get_all should return default values."""
        config = settings.get_all()
        assert config["baudRate"] == DEFAULT_CONFIG["baudRate"]
    
    def test_get_specific_value(self, settings):
        """get should return specific value."""
        assert settings.get("baudRate") == 9600
    
    def test_get_missing_with_default(self, settings):
        """get with missing key should return default."""
        assert settings.get("nonexistent", "default") == "default"
    
    def test_update_saves_to_json(self, settings_dir, settings):
        """update should save changes to JSON file."""
        settings.update({"baudRate": 19200})
        
        json_file = settings_dir / "web-settings.json"
        assert json_file.exists()
        
        with open(json_file) as f:
            saved = json.load(f)
        assert saved["baudRate"] == 19200
    
    def test_update_reflects_valid_settings_in_get_all(self, settings):
        """Valid updates should reflect in subsequent get_all calls."""
        settings.update({"mapSource": "google", "mapType": "terrain"})
        config = settings.get_all()
        assert config["mapSource"] == "google"
        assert config["mapType"] == "terrain"
    
    def test_reload_updates_cache(self, settings_dir, settings):
        """reload should update cache from files."""
        # Initial state
        assert settings.get("baudRate") == 9600
        
        # Manually modify JSON file
        json_content = {"baudRate": 38400}
        (settings_dir / "web-settings.json").write_text(json.dumps(json_content))
        
        # Reload and verify
        settings.reload()
        assert settings.get("baudRate") == 38400

    def test_update_sanitizes_overlay_rings(self, settings):
        """Overlay ring list should be deduplicated, sorted and sanitized."""
        settings.update({
            "mapOverlayRingRadiiMeters": [5000, 1000, 5000, -1, "10000"],
            "mapOverlayLabelMode": "hours",
            "mapOverlayEnabled": "false",
            "mapOverlayAutoContrast": "true",
        })
        config = settings.get_all()
        assert config["mapOverlayRingRadiiMeters"] == [1000, 5000, 10000]
        assert config["mapOverlayLabelMode"] == "hours"
        assert config["mapOverlayEnabled"] is False
        assert config["mapOverlayAutoContrast"] is True

    def test_update_falls_back_for_invalid_overlay_rings(self, settings):
        """Invalid ring lists should fall back to defaults."""
        settings.update({"mapOverlayRingRadiiMeters": ["abc", 0, -5]})
        config = settings.get_all()
        assert config["mapOverlayRingRadiiMeters"] == [1000, 5000, 10000, 20000]

    def test_update_ignores_unknown_keys(self, settings):
        """Unknown keys should be ignored during cleaning."""
        settings.update({
            "customSetting": "customValue",
            "mapsource": "osm",
            "mapSource": "google",
        })
        config = settings.get_all()
        assert "customSetting" not in config
        assert "mapsource" not in config
        assert config["mapSource"] == "google"

