import { SerialPort } from 'serialport';
import type { PortInfo } from '@serialport/bindings-interface';
import { SerialConnectionConfig } from '../common/types';

type DataListener = (data: string) => void;
type ErrorListener = (error: Error) => void;

export interface SerialManager {
  openPort(config: SerialConnectionConfig): Promise<void>;
  closePort(): Promise<void>;
  isOpen(): boolean;
  writeCommand(command: string): Promise<void>;
  onData(listener: DataListener): void;
  onError(listener: ErrorListener): void;
}

export type SerialPortInfo = PortInfo & { friendlyName?: string };

export const SIMULATED_PORT_PATH = 'SIMULATED-ROTOR';

export async function listSystemSerialPorts(): Promise<SerialPortInfo[]> {
  const ports = await SerialPort.list();
  return ports.map((port) => ({ ...port }));
}

abstract class BaseSerialManager implements SerialManager {
  protected dataBuffer = '';
  private dataListeners: DataListener[] = [];
  private errorListeners: ErrorListener[] = [];

  abstract openPort(config: SerialConnectionConfig): Promise<void>;
  abstract closePort(): Promise<void>;
  abstract isOpen(): boolean;
  abstract writeCommand(command: string): Promise<void>;

  onData(listener: DataListener): void {
    this.dataListeners.push(listener);
  }

  onError(listener: ErrorListener): void {
    this.errorListeners.push(listener);
  }

  protected emitData(data: string): void {
    this.dataListeners.forEach((listener) => listener(data));
  }

  protected emitError(error: Error): void {
    this.errorListeners.forEach((listener) => listener(error));
  }
}

class HardwareSerialManager extends BaseSerialManager {
  private port?: SerialPort;

  async openPort(config: SerialConnectionConfig): Promise<void> {
    await this.closePort();

    const { path, baudRate, dataBits = 8, stopBits = 1, parity = 'none' } = config;

    this.port = new SerialPort({
      path,
      baudRate,
      dataBits,
      stopBits,
      parity,
      autoOpen: false
    });

    return new Promise((resolve, reject) => {
      if (!this.port) {
        reject(new Error('Serial port not created.'));
        return;
      }

      const handleData = (chunk: Buffer) => {
        this.dataBuffer += chunk.toString('utf-8');
        let delimiterIndex = this.dataBuffer.search(/[\r\n]/);

        while (delimiterIndex >= 0) {
          const line = this.dataBuffer.slice(0, delimiterIndex).trim();
          this.dataBuffer = this.dataBuffer.slice(delimiterIndex + 1);
          if (line) {
            this.emitData(line);
          }
          delimiterIndex = this.dataBuffer.search(/[\r\n]/);
        }
      };

      const handleError = (error: Error) => {
        this.emitError(error);
      };

      this.port?.on('data', handleData);
      this.port?.on('error', handleError);

      this.port?.open((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async closePort(): Promise<void> {
    if (!this.port) {
      return;
    }

    const portToClose = this.port;
    this.port = undefined;

    await new Promise<void>((resolve) => {
      portToClose.removeAllListeners('data');
      portToClose.removeAllListeners('error');
      if (!portToClose.isOpen) {
        resolve();
        return;
      }

      portToClose.close(() => resolve());
    });
  }

  isOpen(): boolean {
    return Boolean(this.port?.isOpen);
  }

  async writeCommand(command: string): Promise<void> {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Serial port is not open.');
    }

    const cmdWithTerminator = command.endsWith('\r') ? command : `${command}\r`;
    await new Promise<void>((resolve, reject) => {
      this.port?.write(cmdWithTerminator, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

class SimulationSerialManager extends BaseSerialManager {
  private isConnected = false;
  private azimuth = 0;
  private elevation = 0;
  private azDirection: -1 | 0 | 1 = 0;
  private elDirection: -1 | 0 | 1 = 0;
  private modeMaxAz = 360;
  private ticker?: NodeJS.Timeout;

  async openPort(_config?: SerialConnectionConfig): Promise<void> {
    if (this.isConnected) {
      return;
    }
    this.isConnected = true;
    this.startTicker();
  }

  async closePort(): Promise<void> {
    if (this.ticker) {
      clearInterval(this.ticker);
    }
    this.ticker = undefined;
    this.isConnected = false;
    this.azDirection = 0;
    this.elDirection = 0;
  }

  isOpen(): boolean {
    return this.isConnected;
  }

  async writeCommand(command: string): Promise<void> {
    const normalized = command.trim().toUpperCase();

    if (normalized.startsWith('M')) {
      const value = Number(normalized.slice(1));
      if (!Number.isNaN(value)) {
        this.azimuth = this.normalizeAzimuth(value);
        this.emitStatus();
      }
      return;
    }

    if (normalized.startsWith('W')) {
      const parts = normalized.slice(1).trim().split(/\s+/);
      const az = Number(parts[0]);
      const el = Number(parts[1]);
      if (!Number.isNaN(az)) {
        this.azimuth = this.normalizeAzimuth(az);
      }
      if (!Number.isNaN(el)) {
        this.elevation = this.normalizeElevation(el);
      }
      this.emitStatus();
      return;
    }

    switch (normalized) {
      case 'R':
        this.azDirection = 1;
        break;
      case 'L':
        this.azDirection = -1;
        break;
      case 'A':
        this.azDirection = 0;
        break;
      case 'U':
        this.elDirection = 1;
        break;
      case 'D':
        this.elDirection = -1;
        break;
      case 'E':
        this.elDirection = 0;
        break;
      case 'S':
        this.azDirection = 0;
        this.elDirection = 0;
        break;
      case 'C':
      case 'B':
      case 'C2':
        this.emitStatus();
        break;
      case 'P36':
        this.modeMaxAz = 360;
        this.azimuth = this.normalizeAzimuth(this.azimuth);
        break;
      case 'P45':
        this.modeMaxAz = 450;
        this.azimuth = this.normalizeAzimuth(this.azimuth);
        break;
      default:
        break;
    }
  }

  onData(listener: DataListener): void {
    super.onData(listener);
    this.emitStatus();
  }

  private startTicker(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
    }

    this.ticker = setInterval(() => {
      if (this.azDirection !== 0) {
        this.azimuth = this.normalizeAzimuth(this.azimuth + this.azDirection * 2);
      }
      if (this.elDirection !== 0) {
        this.elevation = this.normalizeElevation(this.elevation + this.elDirection);
      }
      if (this.azDirection !== 0 || this.elDirection !== 0) {
        this.emitStatus();
      }
    }, 500);
  }

  private emitStatus(): void {
    const az = Math.round(this.azimuth).toString().padStart(3, '0');
    const el = Math.round(this.elevation).toString().padStart(3, '0');
    this.emitData(`AZ=${az} EL=${el}`);
  }

  private normalizeAzimuth(value: number): number {
    if (this.modeMaxAz === 360) {
      const result = ((value % 360) + 360) % 360;
      return result;
    }
    let normalized = value;
    while (normalized < 0) {
      normalized += this.modeMaxAz;
    }
    while (normalized >= this.modeMaxAz) {
      normalized -= this.modeMaxAz;
    }
    return normalized;
  }

  private normalizeElevation(value: number): number {
    return Math.min(90, Math.max(0, value));
  }
}

export function createSerialManager(options?: { simulation?: boolean }): SerialManager {
  if (options?.simulation) {
    return new SimulationSerialManager();
  }
  return new HardwareSerialManager();
}

export function simulationPortInfo(): SerialPortInfo {
  return {
    path: SIMULATED_PORT_PATH,
    manufacturer: 'Virtual',
    friendlyName: 'Simulierter Rotor'
  } as SerialPortInfo;
}
