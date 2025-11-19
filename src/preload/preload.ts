import { contextBridge, ipcRenderer } from 'electron';
import { RotorStatus, SerialConnectionConfig } from '../common/types';

type StatusCallback = (status: RotorStatus) => void;

declare global {
  interface Window {
    rotor: typeof rotorApi;
  }
}

const rotorApi = {
  listPorts: () => ipcRenderer.invoke('rotor:listPorts'),
  connect: (config: SerialConnectionConfig) => ipcRenderer.invoke('rotor:connect', config),
  disconnect: () => ipcRenderer.invoke('rotor:disconnect'),
  sendCommand: (command: string) => ipcRenderer.invoke('rotor:sendCommand', command),
  control: (command: 'R' | 'L' | 'A' | 'U' | 'D' | 'E' | 'S') => ipcRenderer.invoke('rotor:control', command),
  setAzimuth: (azimuth: number) => ipcRenderer.invoke('rotor:setAzimuth', azimuth),
  setAzEl: (payload: { az: number; el: number }) => ipcRenderer.invoke('rotor:setAzEl', payload),
  startPolling: (intervalMs: number) => ipcRenderer.invoke('rotor:startPolling', intervalMs),
  stopPolling: () => ipcRenderer.invoke('rotor:stopPolling'),
  getCurrentStatus: () => ipcRenderer.invoke('rotor:getCurrentStatus'),
  setMode: (mode: 360 | 450) => ipcRenderer.invoke('rotor:setMode', mode),
  onStatusUpdate: (callback: StatusCallback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: RotorStatus) => callback(status);
    ipcRenderer.on('rotor:statusUpdate', listener);
    return () => ipcRenderer.removeListener('rotor:statusUpdate', listener);
  }
};

contextBridge.exposeInMainWorld('rotor', rotorApi);
