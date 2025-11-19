export type AzimuthMode = 360 | 450;

export interface AppConfig {
  portPath?: string;
  baudRate: number;
  pollingIntervalMs: number;
  simulation: boolean;
  azimuthMode: AzimuthMode;
}

const STORAGE_KEY = 'rotor-control-config-v1';

const defaultConfig: AppConfig = {
  baudRate: 9600,
  pollingIntervalMs: 1000,
  simulation: true,
  azimuthMode: 360
};

export class ConfigStore {
  load(): AppConfig {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { ...defaultConfig };
      }
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      return { ...defaultConfig, ...parsed };
    } catch (error) {
      console.warn('Konnte Konfiguration nicht laden', error);
      return { ...defaultConfig };
    }
  }

  save(partial: Partial<AppConfig>): AppConfig {
    const merged = { ...this.load(), ...partial } as AppConfig;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  }
}
