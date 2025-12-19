"""Settings manager for Rotor Control.

Handles loading/saving configuration from a single JSON file.
All settings are stored in web-settings.json for consistency across devices.
"""

import json
import threading
from pathlib import Path
from typing import Dict, Any

from server.utils.logging import log
from server.config.defaults import DEFAULT_CONFIG


class SettingsManager:
    """Manages application settings from a JSON file.
    
    Settings are loaded in order of priority (lowest to highest):
    1. DEFAULT_CONFIG (hardcoded defaults)
    2. JSON file (user settings)
    """
    
    def __init__(self, config_dir: Path):
        """Initialize the settings manager.
        
        Args:
            config_dir: Directory containing configuration files.
        """
        self.config_dir = Path(config_dir)
        self.json_file = self.config_dir / "web-settings.json"
        self.lock = threading.Lock()
        self.cache: Dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        """Load all settings into cache."""
        with self.lock:
            # Start with defaults
            self.cache = DEFAULT_CONFIG.copy()
            
            # Load JSON (User Settings)
            if self.json_file.exists():
                try:
                    with open(self.json_file, 'r', encoding='utf-8') as f:
                        json_config = json.load(f)
                    
                    # Filter out invalid/corrupted values and lowercase duplicates
                    cleaned_config = self._clean_config(json_config)
                    self.cache.update(cleaned_config)
                    log(f"[Settings] Loaded settings from {self.json_file}")
                except Exception as e:
                    log(f"[Settings] Error loading JSON: {e}")
            else:
                # Create initial JSON file with defaults
                self._save_to_file()
                log(f"[Settings] Created default settings file: {self.json_file}")

    def _clean_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Clean configuration by removing invalid entries.
        
        Removes lowercase duplicate keys and string values that should be
        boolean/numeric (from old INI parsing issues).
        
        Args:
            config: The raw configuration dictionary.
            
        Returns:
            Cleaned configuration dictionary.
        """
        cleaned = {}
        valid_keys = set(DEFAULT_CONFIG.keys())
        
        for key, value in config.items():
            # Skip lowercase duplicates (from old INI parsing)
            if key.lower() != key or key in valid_keys:
                # Fix string values that should be other types
                if isinstance(value, str):
                    # Handle "true ; alternatives..." format from old INI
                    if value.startswith('true') or value.startswith('false'):
                        cleaned[key] = value.lower().startswith('true')
                    elif value.startswith('null'):
                        cleaned[key] = None
                    else:
                        # Try to parse as number
                        try:
                            if '.' in value:
                                cleaned[key] = float(value.split()[0])
                            else:
                                cleaned[key] = int(value.split()[0])
                        except (ValueError, IndexError):
                            cleaned[key] = value
                else:
                    cleaned[key] = value
        
        return cleaned

    def _save_to_file(self) -> None:
        """Save current cache to JSON file."""
        try:
            with open(self.json_file, 'w', encoding='utf-8') as f:
                json.dump(self.cache, f, indent=2)
        except Exception as e:
            log(f"[Settings] Error saving JSON: {e}")

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
            self._save_to_file()

    def reload(self) -> None:
        """Reload settings from files."""
        self._load()
