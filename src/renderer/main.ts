import { Compass } from './ui/compass';
import { MapView } from './ui/mapView';
import { HistoryLog } from './ui/historyLog';
import { Controls } from './ui/controls';
import { ConfigStore, AppConfig } from './services/configStore';
import { RotorStatus } from '../common/types';

const SIMULATED_PORT = 'SIMULATED-ROTOR';

const portSelect = document.getElementById('portSelect') as HTMLSelectElement;
const baudInput = document.getElementById('baudInput') as HTMLInputElement;
const pollingInput = document.getElementById('pollingInput') as HTMLInputElement;
const simulationToggle = document.getElementById('simulationToggle') as HTMLInputElement;
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnectBtn') as HTMLButtonElement;
const connectionStatus = document.getElementById('connectionStatus') as HTMLSpanElement;
const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
const modeStatus = document.getElementById('modeStatus') as HTMLSpanElement;
const azValue = document.getElementById('azValue') as HTMLElement;
const elValue = document.getElementById('elValue') as HTMLElement;
const clearHistoryBtn = document.getElementById('clearHistoryBtn') as HTMLButtonElement;
const exportCsvBtn = document.getElementById('exportCsvBtn') as HTMLButtonElement;
const historyBody = document.getElementById('historyBody') as HTMLElement;

const compass = new Compass(document.getElementById('compassRoot') as HTMLElement);
const mapView = new MapView(document.getElementById('mapCanvas') as HTMLCanvasElement);
const historyLog = new HistoryLog(historyBody);
const controls = new Controls(document.querySelector('.controls-card') as HTMLElement, {
  onCommand: async (command) => {
    if (!connected) return;
    try {
      await window.rotor.control(command);
    } catch (error) {
      reportError(error);
    }
  },
  onGotoAzimuth: async (azimuth) => {
    if (!connected) return;
    try {
      await window.rotor.setAzimuth(azimuth);
    } catch (error) {
      reportError(error);
    }
  },
  onGotoAzimuthElevation: async (azimuth, elevation) => {
    if (!connected) return;
    try {
      await window.rotor.setAzEl({ az: azimuth, el: elevation });
    } catch (error) {
      reportError(error);
    }
  }
});

const configStore = new ConfigStore();
let config: AppConfig = configStore.load();
let connected = false;
let unsubscribeStatus: (() => void) | null = null;

init().catch(reportError);

async function init(): Promise<void> {
  baudInput.value = config.baudRate.toString();
  pollingInput.value = config.pollingIntervalMs.toString();
  simulationToggle.checked = config.simulation;
  modeSelect.value = config.azimuthMode.toString();
  updateModeLabel();
  controls.setEnabled(false);

  await refreshPorts();
  subscribeToStatus();

  connectBtn.addEventListener('click', () => void handleConnect());
  disconnectBtn.addEventListener('click', () => void handleDisconnect());
  modeSelect.addEventListener('change', () => void handleModeChange());
  clearHistoryBtn.addEventListener('click', () => historyLog.clear());
  exportCsvBtn.addEventListener('click', () => historyLog.exportCsv());
}

async function refreshPorts(): Promise<void> {
  try {
    const ports = await window.rotor.listPorts();
    portSelect.innerHTML = '';
    ports.forEach((port) => {
      const option = document.createElement('option');
      option.value = port.path;
      option.textContent = port.friendlyName || port.manufacturer || port.path;
      if (port.simulated || port.path === SIMULATED_PORT) {
        option.dataset.simulated = 'true';
        option.textContent = 'Simulierter Rotor';
      }
      portSelect.appendChild(option);
    });

    if (config.portPath) {
      portSelect.value = config.portPath;
    } else if (config.simulation) {
      const simulatedOption = Array.from(portSelect.options).find((option) => option.dataset.simulated === 'true');
      if (simulatedOption) {
        portSelect.value = simulatedOption.value;
      }
    }
  } catch (error) {
    reportError(error);
  }
}

async function handleConnect(): Promise<void> {
  const baudRate = Number(baudInput.value) || 9600;
  const pollingIntervalMs = Number(pollingInput.value) || 1000;
  const selectedOption = portSelect.selectedOptions[0];
  const simulation = simulationToggle.checked || selectedOption?.dataset.simulated === 'true';
  const path = simulation ? SIMULATED_PORT : portSelect.value;
  const azimuthMode = Number(modeSelect.value) as 360 | 450;

  if (!path) {
    reportError('Bitte zuerst einen Port auswaehlen.');
    return;
  }

  try {
    await window.rotor.connect({ path, baudRate, simulation });
    await window.rotor.startPolling(pollingIntervalMs);
    await window.rotor.setMode(azimuthMode);
    connected = true;
    config = configStore.save({ baudRate, pollingIntervalMs, simulation, portPath: path, azimuthMode });
    setConnectionState(true);
  } catch (error) {
    reportError(error);
    setConnectionState(false);
  }
}

async function handleDisconnect(): Promise<void> {
  try {
    await window.rotor.stopPolling();
    await window.rotor.disconnect();
  } catch (error) {
    reportError(error);
  } finally {
    connected = false;
    setConnectionState(false);
  }
}

async function handleModeChange(): Promise<void> {
  const mode = Number(modeSelect.value) as 360 | 450;
  config = configStore.save({ azimuthMode: mode });
  updateModeLabel();
  if (!connected) return;
  try {
    await window.rotor.setMode(mode);
  } catch (error) {
    reportError(error);
  }
}

function setConnectionState(state: boolean): void {
  connected = state;
  controls.setEnabled(state);
  connectBtn.disabled = state;
  disconnectBtn.disabled = !state;
  connectionStatus.textContent = state ? 'Verbunden' : 'Getrennt';
  connectionStatus.classList.toggle('connected', state);
  connectionStatus.classList.toggle('disconnected', !state);
}

function subscribeToStatus(): void {
  if (unsubscribeStatus) {
    unsubscribeStatus();
  }
  unsubscribeStatus = window.rotor.onStatusUpdate((status) => handleStatus(status));
}

function handleStatus(status: RotorStatus): void {
  if (!status) return;
  if (typeof status.azimuth === 'number') {
    azValue.textContent = `${status.azimuth.toFixed(0)}deg`;
  }
  if (typeof status.elevation === 'number') {
    elValue.textContent = `${status.elevation.toFixed(0)}deg`;
  }
  compass.update(status.azimuth);
  mapView.update(status.azimuth, status.elevation);
  historyLog.addEntry(status);
}

function updateModeLabel(): void {
  modeStatus.textContent = `Modus: ${modeSelect.value}deg`;
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  connectionStatus.textContent = `Fehler: ${message}`;
  connectionStatus.classList.remove('connected');
  connectionStatus.classList.add('disconnected');
}
