import { EventEmitter } from 'events';
import { RotorStatus, SerialConnectionConfig } from '../common/types';
import {
  SerialManager,
  createSerialManager,
  listSystemSerialPorts,
  simulationPortInfo,
  SIMULATED_PORT_PATH,
  SerialPortInfo
} from './serialManager';

interface PollingState {
  intervalMs: number;
  timer?: NodeJS.Timeout;
}

type StatusListener = (status: RotorStatus) => void;

type ErrorListener = (error: Error) => void;

export class RotorController extends EventEmitter {
  private serialManager: SerialManager;
  private simulationMode = false;
  private currentStatus: RotorStatus | null = null;
  private polling: PollingState = { intervalMs: 1000 };
  private maxAzimuthRange: 360 | 450 = 360;
  private dataListener = (line: string) => this.handleSerialLine(line);
  private errorListener = (error: Error) => this.emit('error', error);

  constructor() {
    super();
    this.serialManager = createSerialManager();
    this.serialManager.onData(this.dataListener);
    this.serialManager.onError(this.errorListener);
  }

  async listPorts(): Promise<(SerialPortInfo & { simulated?: boolean })[]> {
    const ports = await listSystemSerialPorts();
    return [...ports, { ...simulationPortInfo(), simulated: true }];
  }

  async connect(config: SerialConnectionConfig): Promise<void> {
    const useSimulation = Boolean(config.simulation || config.path === SIMULATED_PORT_PATH);
    if (useSimulation !== this.simulationMode) {
      await this.serialManager.closePort().catch(() => undefined);
      this.serialManager = createSerialManager({ simulation: useSimulation });
      this.simulationMode = useSimulation;
      this.serialManager.onData(this.dataListener);
      this.serialManager.onError(this.errorListener);
    } else if (this.serialManager.isOpen()) {
      await this.serialManager.closePort();
    }

    this.maxAzimuthRange = 360;
    await this.serialManager.openPort(config);
    this.emit('connected', config);
  }

  async disconnect(): Promise<void> {
    await this.serialManager.closePort();
    this.stopPolling();
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this.serialManager.isOpen();
  }

  async sendRawCommand(command: string): Promise<void> {
    if (!this.serialManager.isOpen()) {
      throw new Error('Rotor ist nicht verbunden.');
    }
    await this.serialManager.writeCommand(command.trim().toUpperCase());
  }

  async setAzimuth(target: number): Promise<void> {
    const normalized = this.normalizeAzimuth(target);
    const value = Math.round(normalized).toString().padStart(3, '0');
    await this.sendRawCommand(`M${value}`);
  }

  async setAzimuthElevation(azimuth: number, elevation: number): Promise<void> {
    const az = Math.round(this.normalizeAzimuth(azimuth)).toString().padStart(3, '0');
    const el = Math.round(this.normalizeElevation(elevation)).toString().padStart(3, '0');
    await this.sendRawCommand(`W${az} ${el}`);
  }

  async setAzimuthMode(mode: 360 | 450): Promise<void> {
    this.maxAzimuthRange = mode;
    await this.sendRawCommand(mode === 360 ? 'P36' : 'P45');
  }

  async controlAxis(command: 'R' | 'L' | 'A' | 'U' | 'D' | 'E' | 'S'): Promise<void> {
    await this.sendRawCommand(command);
  }

  getCurrentStatus(): RotorStatus | null {
    return this.currentStatus;
  }

  startPolling(intervalMs = 1000): void {
    this.polling.intervalMs = intervalMs;
    this.stopPolling();

    if (!this.serialManager.isOpen()) {
      return;
    }

    this.polling.timer = setInterval(() => {
      this.sendRawCommand('C2').catch((err) => this.emit('error', err));
    }, intervalMs);

    void this.sendRawCommand('C2');
  }

  stopPolling(): void {
    if (this.polling.timer) {
      clearInterval(this.polling.timer);
      this.polling.timer = undefined;
    }
  }

  addStatusListener(listener: StatusListener): void {
    this.on('status', listener);
  }

  removeStatusListener(listener: StatusListener): void {
    this.off('status', listener);
  }

  addErrorListener(listener: ErrorListener): void {
    this.on('error', listener);
  }

  removeErrorListener(listener: ErrorListener): void {
    this.off('error', listener);
  }

  private handleSerialLine(line: string): void {
    const status = this.parseStatus(line);
    this.currentStatus = status;
    this.emit('status', status);
  }

  private parseStatus(line: string): RotorStatus {
    const status: RotorStatus = {
      raw: line,
      timestamp: Date.now()
    };

    const azMatch = line.match(/AZ\s*=\s*(\d+)/i);
    if (azMatch) {
      status.azimuth = Number(azMatch[1]);
    }

    const elMatch = line.match(/EL\s*=\s*(\d+)/i);
    if (elMatch) {
      status.elevation = Number(elMatch[1]);
    }

    return status;
  }

  private normalizeAzimuth(value: number): number {
    const range = this.maxAzimuthRange;
    const normalized = ((value % range) + range) % range;
    return normalized;
  }

  private normalizeElevation(value: number): number {
    return Math.min(90, Math.max(0, value));
  }
}

export const rotorController = new RotorController();
