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
  mapLatitude: null,
  mapLongitude: null,
  satelliteMapEnabled: false
};

class ConfigStore {
  load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { ...defaultConfig };
      }
      const parsed = JSON.parse(raw);
      return { ...defaultConfig, ...parsed };
    } catch (error) {
      console.warn('Konnte Konfiguration nicht laden', error);
      return { ...defaultConfig };
    }
  }

  save(partial) {
    const merged = { ...this.load(), ...partial };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  }
}
