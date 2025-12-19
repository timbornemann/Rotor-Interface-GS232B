"""Settings manager for Rotor Control.

Handles loading/saving configuration from INI and JSON files.
INI serves as factory defaults, JSON stores user overrides.
"""

import json
import configparser
import threading
from pathlib import Path
from typing import Dict, Any

from server.utils.logging import log
from server.config.defaults import DEFAULT_CONFIG, DEFAULT_INI_TEMPLATE


class SettingsManager:
    """Manages application settings from INI and JSON files.
    
    Settings are loaded in order of priority (lowest to highest):
    1. DEFAULT_CONFIG (hardcoded defaults)
    2. INI file (base hardware config)
    3. JSON file (user overrides)
    """
    
    def __init__(self, config_dir: Path):
        """Initialize the settings manager.
        
        Args:
            config_dir: Directory containing configuration files.
        """
        self.config_dir = Path(config_dir)
        self.ini_file = self.config_dir / "rotor-config.ini"
        self.json_file = self.config_dir / "web-settings.json"
        self.lock = threading.Lock()
        self.cache: Dict[str, Any] = {}
        self._load()

    def _generate_default_ini(self) -> None:
        """Generate default INI file with all required values."""
        try:
            with open(self.ini_file, 'w', encoding='utf-8') as f:
                f.write(DEFAULT_INI_TEMPLATE)
            log(f"[Settings] Generated default INI: {self.ini_file}")
        except Exception as e:
            log(f"[Settings] Error generating default INI: {e}")

    def _parse_ini_value(self, value: str) -> Any:
        """Parse an INI value string to the appropriate Python type.
        
        Args:
            value: The string value from the INI file.
            
        Returns:
            The parsed value (bool, None, float, int, or string).
        """
        lower_value = value.lower()
        if lower_value == 'true':
            return True
        elif lower_value == 'false':
            return False
        elif lower_value == 'null':
            return None
        
        # Try numeric conversion
        try:
            if '.' in value:
                return float(value)
            else:
                return int(value)
        except ValueError:
            return value

    def _load(self) -> None:
        """Load all settings into cache."""
        with self.lock:
            # Start with defaults
            self.cache = DEFAULT_CONFIG.copy()
            
            # 1. Generate INI if missing
            if not self.ini_file.exists():
                log("[Settings] INI file not found, generating defaults...")
                self._generate_default_ini()
            
            # 2. Load INI (Base Hardware Config)
            ini_config = {}
            parser = configparser.ConfigParser()
            try:
                parser.read(self.ini_file, encoding="utf-8")
                for section in parser.sections():
                    for key, value in parser.items(section):
                        ini_config[key] = self._parse_ini_value(value)
            except Exception as e:
                log(f"[Settings] Error loading INI: {e}")

            # 3. Load JSON (Web/User Overrides)
            json_config = {}
            if self.json_file.exists():
                try:
                    with open(self.json_file, 'r', encoding='utf-8') as f:
                        json_config = json.load(f)
                except Exception as e:
                    log(f"[Settings] Error loading JSON: {e}")

            # Merge: defaults -> INI -> JSON (JSON has highest priority)
            self.cache.update(ini_config)
            self.cache.update(json_config)

    def get_all(self) -> Dict[str, Any]:
        """Get all settings as a dictionary.
        
        Returns:
            A copy of all current settings.
        """
        with self.lock:
            return self.cache.copy()

    def get(self, key: str, default: Any = None) -> Any:
        """Get a specific setting value.
        
        Args:
            key: The setting key to retrieve.
            default: Default value if key not found.
            
        Returns:
            The setting value or default.
        """
        with self.lock:
            return self.cache.get(key, default)

    def update(self, new_settings: Dict[str, Any]) -> None:
        """Update settings and save to JSON.
        
        Args:
            new_settings: Dictionary of settings to update.
        """
        with self.lock:
            self.cache.update(new_settings)
            
            # Save to JSON for persistence
            try:
                with open(self.json_file, 'w', encoding='utf-8') as f:
                    json.dump(self.cache, f, indent=2)
            except Exception as e:
                log(f"[Settings] Error saving JSON: {e}")

    def reload(self) -> None:
        """Reload settings from files."""
        self._load()

