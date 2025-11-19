const STORAGE_KEY = 'rotor-control-config-v1';

const defaultConfig = {
  baudRate: 9600,
  pollingIntervalMs: 1000,
  simulation: true,
  azimuthMode: 360
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
