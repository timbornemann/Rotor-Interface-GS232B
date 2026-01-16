#!/usr/bin/env python3
"""Migration script to move savedRoutes from web-settings.json to routes.json.

This script:
1. Reads web-settings.json
2. Extracts savedRoutes if present
3. Writes them to routes.json
4. Removes savedRoutes from web-settings.json

Run this once after upgrading to the server-side route execution system.
"""

import json
from pathlib import Path


def migrate_routes():
    """Migrate routes from web-settings.json to routes.json."""
    
    # File paths
    web_settings_file = Path("web-settings.json")
    routes_file = Path("routes.json")
    
    print("[Migration] Starting route migration...")
    
    # Check if web-settings.json exists
    if not web_settings_file.exists():
        print(f"[Migration] {web_settings_file} does not exist. Nothing to migrate.")
        return
    
    # Load web-settings.json
    try:
        with open(web_settings_file, 'r', encoding='utf-8') as f:
            web_settings = json.load(f)
    except Exception as e:
        print(f"[Migration] Error reading {web_settings_file}: {e}")
        return
    
    # Extract savedRoutes
    saved_routes = web_settings.get("savedRoutes", [])
    
    if not saved_routes:
        print("[Migration] No routes found in web-settings.json")
        return
    
    print(f"[Migration] Found {len(saved_routes)} route(s) to migrate")
    
    # Check if routes.json already exists
    if routes_file.exists():
        print(f"[Migration] {routes_file} already exists. Loading existing routes...")
        try:
            with open(routes_file, 'r', encoding='utf-8') as f:
                routes_data = json.load(f)
                existing_routes = routes_data.get("routes", [])
        except Exception as e:
            print(f"[Migration] Error reading {routes_file}: {e}")
            existing_routes = []
    else:
        existing_routes = []
    
    # Merge routes (avoid duplicates by ID)
    existing_ids = {r.get("id") for r in existing_routes if r.get("id")}
    new_routes = [r for r in saved_routes if r.get("id") not in existing_ids]
    
    if new_routes:
        print(f"[Migration] Adding {len(new_routes)} new route(s) to {routes_file}")
        all_routes = existing_routes + new_routes
    else:
        print("[Migration] All routes from web-settings.json already exist in routes.json")
        all_routes = existing_routes
    
    # Write to routes.json
    try:
        with open(routes_file, 'w', encoding='utf-8') as f:
            json.dump({"routes": all_routes}, f, indent=2, ensure_ascii=False)
        print(f"[Migration] Successfully wrote {len(all_routes)} route(s) to {routes_file}")
    except Exception as e:
        print(f"[Migration] Error writing {routes_file}: {e}")
        return
    
    # Remove savedRoutes from web-settings.json
    if "savedRoutes" in web_settings:
        del web_settings["savedRoutes"]
        
        # Create backup
        backup_file = web_settings_file.with_suffix('.json.backup')
        try:
            with open(backup_file, 'w', encoding='utf-8') as f:
                json.dump(web_settings, f, indent=2, ensure_ascii=False)
            print(f"[Migration] Created backup: {backup_file}")
        except Exception as e:
            print(f"[Migration] Warning: Could not create backup: {e}")
        
        # Write updated web-settings.json
        try:
            with open(web_settings_file, 'w', encoding='utf-8') as f:
                json.dump(web_settings, f, indent=2, ensure_ascii=False)
            print(f"[Migration] Removed savedRoutes from {web_settings_file}")
        except Exception as e:
            print(f"[Migration] Error updating {web_settings_file}: {e}")
            return
    
    print("[Migration] Migration completed successfully!")
    print(f"[Migration] Routes are now stored in {routes_file}")
    print(f"[Migration] You can delete web-settings.json.backup if everything works correctly")


if __name__ == "__main__":
    migrate_routes()
