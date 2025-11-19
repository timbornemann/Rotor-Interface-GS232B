import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipcHandlers';

const isMac = process.platform === 'darwin';

async function createWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#111824',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged
    }
  });

  registerIpcHandlers(mainWindow);

  const indexHtml = path.join(__dirname, '../renderer/index.html');
  await mainWindow.loadFile(indexHtml);
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  void createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});
