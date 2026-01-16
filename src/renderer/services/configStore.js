/**
 * Configuration Store
 * Manages loading and saving configuration to the server.
 * All settings are stored server-side in web-settings.json for consistency across devices.
 */

const STORAGE_KEY = 'rotor-control-config-v1';

// Default configuration - used as fallback when server is unavailable
const defaultConfig = {
  // Connection
  baudRate: 9600,
  pollingIntervalMs: 1000,
  portPath: null,
  
  // Display/Mode
  azimuthMode: 360,
  
  // Cone visualization
  coneAngle: 10,
  coneLength: 1000,
  azimuthDisplayOffset: 0,
  coneAngleMin: 1,
  coneAngleMax: 90,
  coneLengthMin: 0,
  coneLengthMax: 100000,
  azimuthDisplayOffsetMin: -180,
  azimuthDisplayOffsetMax: 180,
  
  // Map
  mapLatitude: null,
  mapLongitude: null,
  satelliteMapEnabled: false,
  mapSource: 'arcgis', // 'arcgis', 'osm', 'google'
  mapType: 'satellite', // 'satellite', 'terrain', 'standard'
  mapZoomLevel: 15,
  mapZoomMin: 5,
  mapZoomMax: 25,
  
  // Speed
  azimuthSpeedDegPerSec: 4,
  elevationSpeedDegPerSec: 2,
  speedMinDegPerSec: 0.5,
  speedMaxDegPerSec: 20,
  azimuthLowSpeedStage: 3,
  azimuthHighSpeedStage: 4,
  elevationLowSpeedStage: 3,
  elevationHighSpeedStage: 4,
  azimuthSpeedAngleCode: 3,
  elevationSpeedAngleCode: 3,
  
  // Ramp (Soft Start/Stop)
  rampEnabled: false,
  rampKp: 0.4,
  rampKi: 0.05,
  rampSampleTimeMs: 400,
  rampMaxStepDeg: 8,
  rampToleranceDeg: 1.5,
  rampKpMin: 0,
  rampKpMax: 5,
  rampKiMin: 0,
  rampKiMax: 5,
  rampSampleTimeMsMin: 100,
  rampSampleTimeMsMax: 2000,
  rampMaxStepDegMin: 0.1,
  rampMaxStepDegMax: 45,
  rampToleranceDegMin: 0.1,
  rampToleranceDegMax: 10,
  
  // Limits
  azimuthMinLimit: 0,
  azimuthMaxLimit: 360,
  elevationMinLimit: 0,
  elevationMaxLimit: 90,

  // Presets
  parkPositionsEnabled: false,
  homeAzimuth: 0,
  homeElevation: 0,
  parkAzimuth: 0,
  parkElevation: 0,
  autoParkOnDisconnect: false,
  
  // Calibration
  azimuthOffset: 0,
  elevationOffset: 0,
  azimuthScaleFactor: 1.0,
  elevationScaleFactor: 1.0,
  azimuthScaleFactorMin: 0.1,
  azimuthScaleFactorMax: 2.0,
  elevationScaleFactorMin: 0.1,
  elevationScaleFactorMax: 2.0,
  
  // NOTE: Routes are now stored separately in routes.json on the server
  // and managed via the Route API endpoints. They are no longer part of
  // the configuration stored in web-settings.json.
};

class ConfigStore {
  constructor() {
    this.apiBase = window.location.origin;
    this.cache = null;
    this.saveTimeout = null;
  }

  /**
   * Sanitize a numeric value to be within bounds.
   */
  sanitizeNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, num));
  }

  /**
   * Sanitize configuration values.
   */
  sanitizeConfig(config) {
    const sanitized = { ...config };
    
    // Ensure speed limits are valid
    sanitized.speedMinDegPerSec = this.sanitizeNumber(
      config.speedMinDegPerSec, 0.1, 100, defaultConfig.speedMinDegPerSec
    );
    sanitized.speedMaxDegPerSec = this.sanitizeNumber(
      config.speedMaxDegPerSec, sanitized.speedMinDegPerSec, 200, defaultConfig.speedMaxDegPerSec
    );
    
    // Ensure zoom limits are valid
    if (sanitized.mapZoomMin > sanitized.mapZoomMax) {
      const temp = sanitized.mapZoomMin;
      sanitized.mapZoomMin = sanitized.mapZoomMax;
      sanitized.mapZoomMax = temp;
    }
    
    // Ensure limit values are valid
    if (sanitized.azimuthMinLimit > sanitized.azimuthMaxLimit) {
      sanitized.azimuthMaxLimit = sanitized.azimuthMinLimit;
    }
    if (sanitized.elevationMinLimit > sanitized.elevationMaxLimit) {
      sanitized.elevationMaxLimit = sanitized.elevationMinLimit;
    }
    
    return sanitized;
  }

  /**
   * Load configuration from server.
   * Falls back to defaults if server is unavailable.
   */
  async load() {
    try {
      console.log('[ConfigStore] Fetching settings from server...');
      const resp = await fetch(`${this.apiBase}/api/settings`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      
      if (resp.ok) {
        const serverConfig = await resp.json();
        this.cache = this.sanitizeConfig({ ...defaultConfig, ...serverConfig });
        console.log('[ConfigStore] Settings loaded successfully');
        return this.cache;
      } else {
        console.warn('[ConfigStore] Server returned error:', resp.status);
      }
    } catch (e) {
      console.warn('[ConfigStore] Failed to load settings from server:', e.message);
    }
    
    // Fallback to defaults
    this.cache = { ...defaultConfig };
    return this.cache;
  }

  /**
   * Synchronous load - returns cached values or defaults.
   * UI will update when async load completes.
   */
  loadSync() {
    if (this.cache) {
      return { ...this.cache };
    }
    return { ...defaultConfig };
  }

  /**
   * Save configuration to server.
   * Returns the merged config from server response.
   */
  async save(partial) {
    const toSend = this.sanitizeConfig({ ...partial });
    
    try {
      console.log('[ConfigStore] Saving settings to server...', Object.keys(toSend).length, 'keys');
      const resp = await fetch(`${this.apiBase}/api/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(toSend),
      });
      
      if (resp.ok) {
        const result = await resp.json();
        if (result.settings) {
          this.cache = { ...defaultConfig, ...result.settings };
          console.log('[ConfigStore] Settings saved successfully');
          return this.cache;
        }
      } else {
        console.error('[ConfigStore] Server returned error:', resp.status);
      }
    } catch (e) {
      console.error('[ConfigStore] Save failed:', e.message);
    }
    
    // Optimistic update on failure
    this.cache = { ...defaultConfig, ...partial };
    return this.cache;
  }

  /**
   * Fire-and-forget save with debouncing.
   * Useful for frequent updates like slider changes.
   */
  saveDebounced(partial, delay = 500) {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    
    // Update cache immediately for UI responsiveness
    this.cache = { ...this.cache, ...partial };
    
    this.saveTimeout = setTimeout(() => {
      this.save(partial).catch(err => console.error('[ConfigStore] Debounced save failed:', err));
    }, delay);
    
    return { ...this.cache };
  }

  /**
   * Synchronous save - fire and forget.
   */
  saveSync(partial) {
    this.save(partial).catch(err => console.error('[ConfigStore] Sync save failed:', err));
    this.cache = { ...this.cache, ...partial };
    return { ...this.cache };
  }

  /**
   * Get a specific setting value.
   */
  get(key) {
    if (this.cache && key in this.cache) {
      return this.cache[key];
    }
    return defaultConfig[key];
  }

  /**
   * Get all current settings.
   */
  getAll() {
    return this.cache ? { ...this.cache } : { ...defaultConfig };
  }

  /**
   * Update cache from external source (e.g., WebSocket broadcast).
   * @param {object} settings - Settings object to update cache with
   */
  updateCache(settings) {
    if (settings && typeof settings === 'object') {
      this.cache = this.sanitizeConfig({ ...defaultConfig, ...settings });
      console.log('[ConfigStore] Cache updated from external source');
    }
  }

  /**
   * Reset all settings to default values.
   * @returns {Promise<object>} The reset configuration
   */
  async resetToDefaults() {
    console.log('[ConfigStore] Resetting all settings to defaults...');
    return await this.save({ ...defaultConfig });
  }

  /**
   * Get the default configuration (for comparison or reset preview).
   * @returns {object} The default configuration
   */
  getDefaults() {
    return { ...defaultConfig };
  }
}
