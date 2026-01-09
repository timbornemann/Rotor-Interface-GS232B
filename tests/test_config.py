"""Tests for the configuration management module."""

import json
import pytest
import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.config.defaults import DEFAULT_CONFIG, DEFAULT_INI_TEMPLATE
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
    
    def test_default_config_has_limits(self):
        """Default config should have limit settings."""
        assert "azimuthMinLimit" in DEFAULT_CONFIG
        assert "azimuthMaxLimit" in DEFAULT_CONFIG
        assert "elevationMinLimit" in DEFAULT_CONFIG
        assert "elevationMaxLimit" in DEFAULT_CONFIG
    
    def test_default_ini_template_is_string(self):
        """Default INI template should be a string."""
        assert isinstance(DEFAULT_INI_TEMPLATE, str)
    
    def test_default_ini_template_has_sections(self):
        """Default INI template should have expected sections."""
        assert "[Connection]" in DEFAULT_INI_TEMPLATE
        assert "[Calibration]" in DEFAULT_INI_TEMPLATE
        assert "[Limits]" in DEFAULT_INI_TEMPLATE


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
    
    def test_update_reflects_in_get_all(self, settings):
        """update should reflect in subsequent get_all calls."""
        settings.update({"customSetting": "customValue"})
        config = settings.get_all()
        assert config["customSetting"] == "customValue"
    
    def test_json_overrides_ini(self, settings_dir):
        """JSON settings should override INI settings."""
        # Create INI with default baudRate=9600
        ini_content = "[Connection]\nbaudRate=9600\n"
        (settings_dir / "rotor-config.ini").write_text(ini_content)
        
        # Create JSON with different baudRate
        json_content = {"baudRate": 19200}
        (settings_dir / "web-settings.json").write_text(json.dumps(json_content))
        
        # Load settings
        settings = SettingsManager(settings_dir)
        assert settings.get("baudRate") == 19200
    
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

