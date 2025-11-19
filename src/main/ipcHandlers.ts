import { BrowserWindow, IpcMainInvokeEvent, ipcMain } from 'electron';
import { RotorStatus, SerialConnectionConfig } from '../common/types';
import { rotorController } from './rotorController';

let handlersRegistered = false;
let statusListener: ((status: RotorStatus) => void) | null = null;

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  if (statusListener) {
    rotorController.removeStatusListener(statusListener);
  }

  statusListener = (status: RotorStatus) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rotor:statusUpdate', status);
    }
  };

  rotorController.addStatusListener(statusListener);

  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;

  ipcMain.handle('rotor:listPorts', async () => {
    return rotorController.listPorts();
  });

  ipcMain.handle('rotor:connect', async (_event: IpcMainInvokeEvent, config: SerialConnectionConfig) => {
    await rotorController.connect(config);
    return { connected: true };
  });

  ipcMain.handle('rotor:disconnect', async () => {
    await rotorController.disconnect();
    return { disconnected: true };
  });

  ipcMain.handle('rotor:sendCommand', async (_event, command: string) => {
    await rotorController.sendRawCommand(command);
    return { sent: true };
  });

  ipcMain.handle('rotor:setAzimuth', async (_event, azimuth: number) => {
    await rotorController.setAzimuth(azimuth);
    return { sent: true };
  });

  ipcMain.handle('rotor:setAzEl', async (_event, payload: { az: number; el: number }) => {
    await rotorController.setAzimuthElevation(payload.az, payload.el);
    return { sent: true };
  });

  ipcMain.handle('rotor:control', async (_event, command: 'R' | 'L' | 'A' | 'U' | 'D' | 'E' | 'S') => {
    await rotorController.controlAxis(command);
    return { sent: true };
  });

  ipcMain.handle('rotor:startPolling', async (_event, intervalMs: number) => {
    rotorController.startPolling(intervalMs ?? 1000);
    return { polling: true };
  });

  ipcMain.handle('rotor:stopPolling', async () => {
    rotorController.stopPolling();
    return { polling: false };
  });

  ipcMain.handle('rotor:getCurrentStatus', async () => {
    return rotorController.getCurrentStatus();
  });

  ipcMain.handle('rotor:setMode', async (_event, mode: 360 | 450) => {
    await rotorController.setAzimuthMode(mode);
    return { mode };
  });
}
