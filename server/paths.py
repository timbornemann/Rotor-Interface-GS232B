"""Project path constants and legacy config migration."""

from __future__ import annotations

import shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
DEFAULT_CONFIG_DIR = DATA_DIR
DEFAULT_SERVER_ROOT = PROJECT_ROOT / "src" / "renderer"

_LEGACY_CONFIG_FILES = ("web-settings.json", "routes.json")


def ensure_data_dir(config_dir: Path | None = None) -> Path:
    """Ensure the data directory exists and migrate legacy root config files."""
    target_dir = Path(config_dir) if config_dir else DEFAULT_CONFIG_DIR
    target_dir.mkdir(parents=True, exist_ok=True)

    for name in _LEGACY_CONFIG_FILES:
        legacy = PROJECT_ROOT / name
        target = target_dir / name
        if legacy.exists() and not target.exists():
            shutil.move(str(legacy), str(target))

    return target_dir
