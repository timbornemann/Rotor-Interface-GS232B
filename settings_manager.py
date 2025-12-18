import json
import configparser
import threading
from pathlib import Path
from typing import Dict, Any

class SettingsManager:
    def __init__(self, config_dir: Path):
        self.config_dir = config_dir
        self.ini_file = config_dir / "rotor-config.ini"
        self.json_file = config_dir / "web-settings.json"
        self.lock = threading.Lock()
        self.cache: Dict[str, Any] = {}
        self._load()

    def _load(self):
        """Load all settings into cache."""
        with self.lock:
            # 1. Load INI (Base Hardware Config)
            ini_config = {}
            parser = configparser.ConfigParser()
            try:
                parser.read(self.ini_file, encoding="utf-8")
                for section in parser.sections():
                    for key, value in parser.items(section):
                        # Attempt typed conversion
                        try:
                             if value.lower() == 'true': val = True
                             elif value.lower() == 'false': val = False
                             elif value.lower() == 'null': val = None
                             elif '.' in value: val = float(value)
                             else: val = int(value)
                        except:
                             val = value
                        ini_config[key] = val
            except Exception as e:
                print(f"[Settings] Error loading INI: {e}")

            # 2. Load JSON (Web/User Overrides)
            json_config = {}
            if self.json_file.exists():
                try:
                    with open(self.json_file, 'r', encoding='utf-8') as f:
                        json_config = json.load(f)
                except Exception as e:
                    print(f"[Settings] Error loading JSON: {e}")

            # Merge: INI is base, JSON overrides? Or JSON supplements?
            # User wants "settings the user makes in settings ... saved so all have same".
            # The JS settings modal outputs a flat config object.
            # I will store the *merged* result in cache.
            # When saving, I'll update JSON.
            
            self.cache = {**ini_config, **json_config}

    def get_all(self) -> Dict[str, Any]:
        with self.lock:
            return self.cache.copy()

    def update(self, new_settings: Dict[str, Any]):
        """Update settings and save to JSON."""
        with self.lock:
            self.cache.update(new_settings)
            
            # Save relevant parts to JSON
            # We save EVERYTHING to JSON to ensure persistence of user changes
            try:
                with open(self.json_file, 'w', encoding='utf-8') as f:
                    json.dump(self.cache, f, indent=2)
            except Exception as e:
                print(f"[Settings] Error saving JSON: {e}")
                
            # If we wanted to update INI, we would need to map back to sections.
            # For now, we leave INI as "factory defaults" or "hardware config" 
            # and JSON as "application state".
