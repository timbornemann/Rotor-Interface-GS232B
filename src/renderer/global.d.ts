import type { RotorStatus, SerialConnectionConfig, RotorControlCommand } from '../common/types';

interface RotorBridge {
  listPorts(): Promise<Array<{ path: string; manufacturer?: string; friendlyName?: string; simulated?: boolean }>>;
  connect(config: SerialConnectionConfig): Promise<{ connected: boolean }>;
  disconnect(): Promise<{ disconnected: boolean }>;
  sendCommand(command: string): Promise<{ sent: boolean }>;
  control(command: RotorControlCommand): Promise<{ sent: boolean }>;
  setAzimuth(azimuth: number): Promise<{ sent: boolean }>;
  setAzEl(payload: { az: number; el: number }): Promise<{ sent: boolean }>;
  startPolling(intervalMs: number): Promise<{ polling: boolean }>;
  stopPolling(): Promise<{ polling: boolean }>;
  getCurrentStatus(): Promise<RotorStatus | null>;
  setMode(mode: 360 | 450): Promise<{ mode: 360 | 450 }>;
  onStatusUpdate(callback: (status: RotorStatus) => void): () => void;
}

declare global {
  interface Window {
    rotor: RotorBridge;
  }
}

export {};
