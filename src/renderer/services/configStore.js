const STORAGE_KEY = 'rotor-control-config-v1';

const defaultConfig = {
  baudRate: 9600,
  pollingIntervalMs: 1000,
  simulation: false,
  connectionMode: 'local', // 'local' or 'server'
  azimuthMode: 360,
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
  mapLatitude: null,
  mapLongitude: null,
  satelliteMapEnabled: false,
  coneAngle: 10, // Kegel-Winkel in Grad
  coneLength: 1000, // Kegel-Länge in Metern
  azimuthDisplayOffset: 0, // Azimut-Korrektur für Anzeige (Grad)
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
    sanitized.azimuthSpeedDegPerSec = this.sanitizeNumber(
      config.azimuthSpeedDegPerSec,
      0.5,
      20,
      defaultConfig.azimuthSpeedDegPerSec
    );
    sanitized.elevationSpeedDegPerSec = this.sanitizeNumber(
      config.elevationSpeedDegPerSec,
      0.5,
      20,
      defaultConfig.elevationSpeedDegPerSec
    );
    sanitized.rampKp = this.sanitizeNumber(config.rampKp, 0, 5, defaultConfig.rampKp);
    sanitized.rampKi = this.sanitizeNumber(config.rampKi, 0, 5, defaultConfig.rampKi);
    sanitized.rampSampleTimeMs = this.sanitizeNumber(
      config.rampSampleTimeMs,
      100,
      2000,
      defaultConfig.rampSampleTimeMs
    );
    sanitized.rampMaxStepDeg = this.sanitizeNumber(
      config.rampMaxStepDeg,
      0.1,
      45,
      defaultConfig.rampMaxStepDeg
    );
    sanitized.rampToleranceDeg = this.sanitizeNumber(
      config.rampToleranceDeg,
      0.1,
      10,
      defaultConfig.rampToleranceDeg
    );
    sanitized.rampEnabled = Boolean(config.rampEnabled);
    sanitized.coneAngle = this.sanitizeNumber(
      config.coneAngle,
      1,
      90,
      defaultConfig.coneAngle
    );
    sanitized.coneLength = this.sanitizeNumber(
      config.coneLength,
      0,
      100000,
      defaultConfig.coneLength
    );
    sanitized.azimuthDisplayOffset = this.sanitizeNumber(
      config.azimuthDisplayOffset,
      -180,
      180,
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
