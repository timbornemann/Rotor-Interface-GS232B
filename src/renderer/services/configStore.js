const STORAGE_KEY = 'rotor-control-config-v1';

const defaultConfig = {
  baudRate: 9600,
  pollingIntervalMs: 1000,
  simulation: false,
  connectionMode: 'local', // 'local' or 'server'
  // Speed limits
  speedMinDegPerSec: 0.5,
  speedMaxDegPerSec: 20,
  azimuthMode: 360,
  simulationAzimuthMode: 360,
  azimuthMinLimit: 0,
  azimuthMaxLimit: 360,
  elevationMinLimit: 0,
  elevationMaxLimit: 90,
  azimuthOffset: 0,
  elevationOffset: 0,
  azimuthSpeedDegPerSec: 4,
  elevationSpeedDegPerSec: 2,
  rampEnabled: false,
  rampKp: 0.4,
  rampKi: 0.05,
  rampSampleTimeMs: 400,
  rampMaxStepDeg: 8,
  rampToleranceDeg: 1.5,
  rampProfile: 'linear',
  // Ramp limits
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
  mapLatitude: null,
  mapLongitude: null,
  satelliteMapEnabled: false,
  mapZoomLevel: 15,
  mapZoomMin: 0,
  mapZoomMax: 20,
  coneAngle: 10, // Kegel-Winkel in Grad
  coneLength: 1000, // Kegel-Länge in Metern
  azimuthDisplayOffset: 0, // Azimut-Korrektur für Anzeige (Grad)
  azimuthDisplayOffsetMin: -180,
  azimuthDisplayOffsetMax: 180,
  coneAngleMin: 1,
  coneAngleMax: 90,
  coneLengthMin: 0,
  coneLengthMax: 100000,
  elevationDisplayEnabled: true // Elevation-Anzeige aktiviert/deaktiviert
};

// IniHandler will be loaded separately
let iniHandler = null;

class ConfigStore {
  sanitizeNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, num));
  }

  sanitizeConfig(config) {
    const sanitized = { ...config };

    // Ranges for speeds
    sanitized.speedMinDegPerSec = this.sanitizeNumber(
      config.speedMinDegPerSec,
      0.1,
      100,
      defaultConfig.speedMinDegPerSec
    );
    sanitized.speedMaxDegPerSec = this.sanitizeNumber(
      config.speedMaxDegPerSec,
      sanitized.speedMinDegPerSec,
      200,
      defaultConfig.speedMaxDegPerSec
    );
    if (sanitized.speedMaxDegPerSec < sanitized.speedMinDegPerSec) {
      sanitized.speedMaxDegPerSec = sanitized.speedMinDegPerSec;
    }

    // Ranges for ramp settings
    sanitized.rampKpMin = this.sanitizeNumber(config.rampKpMin, 0, 10, defaultConfig.rampKpMin);
    sanitized.rampKpMax = this.sanitizeNumber(
      config.rampKpMax,
      sanitized.rampKpMin,
      10,
      defaultConfig.rampKpMax
    );
    sanitized.rampKiMin = this.sanitizeNumber(config.rampKiMin, 0, 10, defaultConfig.rampKiMin);
    sanitized.rampKiMax = this.sanitizeNumber(
      config.rampKiMax,
      sanitized.rampKiMin,
      10,
      defaultConfig.rampKiMax
    );
    sanitized.rampSampleTimeMsMin = this.sanitizeNumber(
      config.rampSampleTimeMsMin,
      50,
      10000,
      defaultConfig.rampSampleTimeMsMin
    );
    sanitized.rampSampleTimeMsMax = this.sanitizeNumber(
      config.rampSampleTimeMsMax,
      sanitized.rampSampleTimeMsMin,
      10000,
      defaultConfig.rampSampleTimeMsMax
    );
    sanitized.rampMaxStepDegMin = this.sanitizeNumber(
      config.rampMaxStepDegMin,
      0.01,
      90,
      defaultConfig.rampMaxStepDegMin
    );
    sanitized.rampMaxStepDegMax = this.sanitizeNumber(
      config.rampMaxStepDegMax,
      sanitized.rampMaxStepDegMin,
      90,
      defaultConfig.rampMaxStepDegMax
    );
    sanitized.rampToleranceDegMin = this.sanitizeNumber(
      config.rampToleranceDegMin,
      0.01,
      90,
      defaultConfig.rampToleranceDegMin
    );
    sanitized.rampToleranceDegMax = this.sanitizeNumber(
      config.rampToleranceDegMax,
      sanitized.rampToleranceDegMin,
      90,
      defaultConfig.rampToleranceDegMax
    );

    // Map zoom limits (allow up to 25 for higher detail maps)
    sanitized.mapZoomMin = this.sanitizeNumber(config.mapZoomMin, 0, 25, defaultConfig.mapZoomMin);
    sanitized.mapZoomMax = this.sanitizeNumber(
      config.mapZoomMax,
      sanitized.mapZoomMin,
      25,
      defaultConfig.mapZoomMax
    );
    sanitized.mapZoomLevel = this.sanitizeNumber(
      config.mapZoomLevel,
      sanitized.mapZoomMin,
      sanitized.mapZoomMax,
      defaultConfig.mapZoomLevel
    );

    // Cone and display limits
    sanitized.coneAngleMin = this.sanitizeNumber(config.coneAngleMin, 0.1, 179, defaultConfig.coneAngleMin);
    sanitized.coneAngleMax = this.sanitizeNumber(
      config.coneAngleMax,
      sanitized.coneAngleMin,
      179,
      defaultConfig.coneAngleMax
    );
    sanitized.coneLengthMin = this.sanitizeNumber(
      config.coneLengthMin,
      0,
      Number.MAX_SAFE_INTEGER,
      defaultConfig.coneLengthMin
    );
    sanitized.coneLengthMax = this.sanitizeNumber(
      config.coneLengthMax,
      sanitized.coneLengthMin,
      Number.MAX_SAFE_INTEGER,
      defaultConfig.coneLengthMax
    );
    sanitized.azimuthDisplayOffsetMin = this.sanitizeNumber(
      config.azimuthDisplayOffsetMin,
      -360,
      0,
      defaultConfig.azimuthDisplayOffsetMin
    );
    sanitized.azimuthDisplayOffsetMax = this.sanitizeNumber(
      config.azimuthDisplayOffsetMax,
      0,
      360,
      defaultConfig.azimuthDisplayOffsetMax
    );

    // Apply limits to configurable values
    sanitized.azimuthSpeedDegPerSec = this.sanitizeNumber(
      config.azimuthSpeedDegPerSec,
      sanitized.speedMinDegPerSec,
      sanitized.speedMaxDegPerSec,
      defaultConfig.azimuthSpeedDegPerSec
    );
    sanitized.elevationSpeedDegPerSec = this.sanitizeNumber(
      config.elevationSpeedDegPerSec,
      sanitized.speedMinDegPerSec,
      sanitized.speedMaxDegPerSec,
      defaultConfig.elevationSpeedDegPerSec
    );
    sanitized.rampKp = this.sanitizeNumber(
      config.rampKp,
      sanitized.rampKpMin,
      sanitized.rampKpMax,
      defaultConfig.rampKp
    );
    sanitized.rampKi = this.sanitizeNumber(
      config.rampKi,
      sanitized.rampKiMin,
      sanitized.rampKiMax,
      defaultConfig.rampKi
    );
    sanitized.rampSampleTimeMs = this.sanitizeNumber(
      config.rampSampleTimeMs,
      sanitized.rampSampleTimeMsMin,
      sanitized.rampSampleTimeMsMax,
      defaultConfig.rampSampleTimeMs
    );
    sanitized.rampMaxStepDeg = this.sanitizeNumber(
      config.rampMaxStepDeg,
      sanitized.rampMaxStepDegMin,
      sanitized.rampMaxStepDegMax,
      defaultConfig.rampMaxStepDeg
    );
    sanitized.rampToleranceDeg = this.sanitizeNumber(
      config.rampToleranceDeg,
      sanitized.rampToleranceDegMin,
      sanitized.rampToleranceDegMax,
      defaultConfig.rampToleranceDeg
    );
    sanitized.rampProfile = config.rampProfile === 's-curve' ? 's-curve' : 'linear';
    sanitized.azimuthMode = Number(config.azimuthMode) === 450 ? 450 : 360;
    sanitized.simulationAzimuthMode =
      Number(config.simulationAzimuthMode) === 450 ? 450 : defaultConfig.simulationAzimuthMode;
    sanitized.rampEnabled = Boolean(config.rampEnabled);
    sanitized.coneAngle = this.sanitizeNumber(
      config.coneAngle,
      sanitized.coneAngleMin,
      sanitized.coneAngleMax,
      defaultConfig.coneAngle
    );
    sanitized.coneLength = this.sanitizeNumber(
      config.coneLength,
      sanitized.coneLengthMin,
      sanitized.coneLengthMax,
      defaultConfig.coneLength
    );
    sanitized.azimuthDisplayOffset = this.sanitizeNumber(
      config.azimuthDisplayOffset,
      sanitized.azimuthDisplayOffsetMin,
      sanitized.azimuthDisplayOffsetMax,
      defaultConfig.azimuthDisplayOffset
    );

    return sanitized;
  }

  async load() {
    try {
      // Try to load from INI file first
      if (typeof IniHandler !== 'undefined') {
        if (!iniHandler) {
          iniHandler = new IniHandler();
        }
        const iniConfig = await iniHandler.load();
        if (iniConfig) {
          const flattened = iniHandler.iniToConfig(iniConfig);
          console.log('[ConfigStore] Loaded from INI file', flattened);
          return this.sanitizeConfig({ ...defaultConfig, ...flattened });
        }
      }
    } catch (error) {
      console.warn('[ConfigStore] Could not load from INI file, falling back to localStorage', error);
    }

    // Fallback to localStorage
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { ...defaultConfig };
      }
      const parsed = JSON.parse(raw);
      return this.sanitizeConfig({ ...defaultConfig, ...parsed });
    } catch (error) {
      console.warn('Konnte Konfiguration nicht laden', error);
      return { ...defaultConfig };
    }
  }

  loadSync() {
    // Synchronous version for backwards compatibility
    // Only loads from localStorage (INI is loaded asynchronously)
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { ...defaultConfig };
      }
      const parsed = JSON.parse(raw);
      return this.sanitizeConfig({ ...defaultConfig, ...parsed });
    } catch (error) {
      console.warn('Konnte Konfiguration nicht laden', error);
      return { ...defaultConfig };
    }
  }

  async save(partial) {
    const current = this.loadSync();
    const merged = { ...current, ...partial };
    const sanitized = this.sanitizeConfig(merged);
    
    // Save to localStorage only
    // INI file is read-only and should be edited manually
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    console.log('[ConfigStore] Saved to localStorage (INI file is read-only)');
    
    return sanitized;
  }

  saveSync(partial) {
    // Synchronous version for backwards compatibility
    const current = this.loadSync();
    const merged = { ...current, ...partial };
    const sanitized = this.sanitizeConfig(merged);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    return sanitized;
  }
}
