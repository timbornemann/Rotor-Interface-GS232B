const STORAGE_KEY = 'rotor-control-config-v1';

const defaultConfig = {
  baudRate: 9600,
  pollingIntervalMs: 1000,
  simulation: true,
  azimuthMode: 360,
  azimuthMinLimit: 0,
  azimuthMaxLimit: 360,
  elevationMinLimit: 0,
  elevationMaxLimit: 90,
  azimuthOffset: 0,
  elevationOffset: 0,
  azimuthSpeedDegPerSec: 4,
  elevationSpeedDegPerSec: 2,
  mapLatitude: null,
  mapLongitude: null,
  satelliteMapEnabled: false
};

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
    return sanitized;
  }

  load() {
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

  save(partial) {
    const merged = { ...this.load(), ...partial };
    const sanitized = this.sanitizeConfig(merged);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    return sanitized;
  }
}
