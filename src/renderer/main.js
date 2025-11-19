// Alle Klassen werden über Script-Tags geladen

const rotor = createRotorService();

const portSelect = document.getElementById('portSelect');
const requestPortBtn = document.getElementById('requestPortBtn');
const baudInput = document.getElementById('baudInput');
const pollingInput = document.getElementById('pollingInput');
const simulationToggle = document.getElementById('simulationToggle');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const connectionStatus = document.getElementById('connectionStatus');
const serialSupportNotice = document.getElementById('serialSupportNotice');
const modeSelect = document.getElementById('modeSelect');
const modeStatus = document.getElementById('modeStatus');
const azValue = document.getElementById('azValue');
const elValue = document.getElementById('elValue');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const historyBody = document.getElementById('historyBody');

const compass = new Compass(document.getElementById('compassRoot'));
const mapView = new MapView(document.getElementById('mapCanvas'));
const historyLog = new HistoryLog(historyBody);
const mapLatInput = document.getElementById('mapLatInput');
const mapLonInput = document.getElementById('mapLonInput');
const loadMapBtn = document.getElementById('loadMapBtn');
const satelliteMapToggle = document.getElementById('satelliteMapToggle');
const controls = new Controls(document.querySelector('.controls-card'), {
  onCommand: async (command) => {
    if (!connected) {
      return;
    }
    try {
      await rotor.control(command);
    } catch (error) {
      reportError(error);
    }
  },
  onGotoAzimuth: async (azimuth) => {
    if (!connected) {
      return;
    }
    try {
      await rotor.setAzimuth(azimuth);
    } catch (error) {
      reportError(error);
    }
  },
  onGotoAzimuthElevation: async (azimuth, elevation) => {
    if (!connected) {
      return;
    }
    try {
      await rotor.setAzEl({ az: azimuth, el: elevation });
    } catch (error) {
      reportError(error);
    }
  }
});

const configStore = new ConfigStore();
let config = configStore.load();
let connected = false;
let unsubscribeStatus = null;
const unsubscribeError = rotor.onError((error) => reportError(error));

init().catch(reportError);

async function init() {
  baudInput.value = config.baudRate.toString();
  pollingInput.value = config.pollingIntervalMs.toString();
  simulationToggle.checked = config.simulation;
  modeSelect.value = config.azimuthMode.toString();
  updateModeLabel();
  controls.setEnabled(false);
  disconnectBtn.disabled = true;

  // Karten-Einstellungen laden
  if (config.mapLatitude !== null && config.mapLatitude !== undefined) {
    mapLatInput.value = config.mapLatitude.toString();
  }
  if (config.mapLongitude !== null && config.mapLongitude !== undefined) {
    mapLonInput.value = config.mapLongitude.toString();
  }
  satelliteMapToggle.checked = config.satelliteMapEnabled || false;
  
  if (config.mapLatitude !== null && config.mapLongitude !== null) {
    mapView.setCoordinates(config.mapLatitude, config.mapLongitude);
  }
  mapView.setSatelliteMapEnabled(config.satelliteMapEnabled || false);

  if (!rotor.supportsWebSerial() && serialSupportNotice) {
    serialSupportNotice.classList.remove('hidden');
  }
  if (requestPortBtn) {
    requestPortBtn.disabled = !rotor.supportsWebSerial();
    requestPortBtn.addEventListener('click', () => void handleRequestPort());
  }

  await refreshPorts();
  subscribeToStatus();

  connectBtn.addEventListener('click', () => void handleConnect());
  disconnectBtn.addEventListener('click', () => void handleDisconnect());
  modeSelect.addEventListener('change', () => void handleModeChange());
  clearHistoryBtn.addEventListener('click', () => historyLog.clear());
  exportCsvBtn.addEventListener('click', () => historyLog.exportCsv());
  
  // Karten-Event-Handler
  loadMapBtn.addEventListener('click', () => void handleLoadMap());
  satelliteMapToggle.addEventListener('change', () => void handleSatelliteMapToggle());
  
  // Enter-Taste in Koordinatenfeldern
  mapLatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      void handleLoadMap();
    }
  });
  mapLonInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      void handleLoadMap();
    }
  });
}

async function handleRequestPort() {
  try {
    await rotor.requestPortAccess();
    await refreshPorts();
  } catch (error) {
    reportError(error);
  }
}

async function refreshPorts() {
  try {
    const ports = await rotor.listPorts();
    portSelect.innerHTML = '';
    ports.forEach((port) => {
      const option = document.createElement('option');
      option.value = port.path;
      option.textContent = port.friendlyName || port.path;
      if (port.simulated || port.path === SIMULATED_PORT_ID) {
        option.dataset.simulated = 'true';
        option.textContent = 'Simulierter Rotor';
      }
      portSelect.appendChild(option);
    });

    if (config.portPath && Array.from(portSelect.options).some((opt) => opt.value === config.portPath)) {
      portSelect.value = config.portPath;
    } else {
      const simulatedOption = Array.from(portSelect.options).find((option) => option.dataset.simulated === 'true');
      if (simulatedOption) {
        portSelect.value = simulatedOption.value;
      }
    }
  } catch (error) {
    reportError(error);
  }
}

async function handleConnect() {
  const baudRate = Number(baudInput.value) || 9600;
  const pollingIntervalMs = Number(pollingInput.value) || 1000;
  const selectedOption = portSelect.selectedOptions[0];
  const simulation = simulationToggle.checked || selectedOption?.dataset.simulated === 'true';
  const path = simulation ? SIMULATED_PORT_ID : portSelect.value;
  const azimuthMode = Number(modeSelect.value) === 450 ? 450 : 360;

  if (!path) {
    reportError('Bitte zuerst einen Port auswaehlen.');
    return;
  }

  try {
    await rotor.connect({ path, baudRate, simulation });
    await rotor.setMode(azimuthMode);
    rotor.startPolling(pollingIntervalMs);
    connected = true;
    config = configStore.save({ baudRate, pollingIntervalMs, simulation, portPath: path, azimuthMode });
    setConnectionState(true);
  } catch (error) {
    reportError(error);
    setConnectionState(false);
  }
}

async function handleDisconnect() {
  try {
    rotor.stopPolling();
    await rotor.disconnect();
  } catch (error) {
    reportError(error);
  } finally {
    connected = false;
    setConnectionState(false);
  }
}

async function handleModeChange() {
  const mode = Number(modeSelect.value) === 450 ? 450 : 360;
  config = configStore.save({ azimuthMode: mode });
  updateModeLabel();
  if (!connected) {
    return;
  }
  try {
    await rotor.setMode(mode);
  } catch (error) {
    reportError(error);
  }
}

function setConnectionState(state) {
  connected = state;
  controls.setEnabled(state);
  connectBtn.disabled = state;
  disconnectBtn.disabled = !state;
  connectionStatus.textContent = state ? 'Verbunden' : 'Getrennt';
  connectionStatus.classList.toggle('connected', state);
  connectionStatus.classList.toggle('disconnected', !state);
}

function subscribeToStatus() {
  if (unsubscribeStatus) {
    unsubscribeStatus();
  }
  unsubscribeStatus = rotor.onStatusUpdate((status) => handleStatus(status));
}

function handleStatus(status) {
  if (!status) {
    return;
  }
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

function updateModeLabel() {
  modeStatus.textContent = `Modus: ${modeSelect.value}deg`;
}

async function handleLoadMap() {
  const lat = parseFloat(mapLatInput.value);
  const lon = parseFloat(mapLonInput.value);
  
  if (isNaN(lat) || lat < -90 || lat > 90) {
    reportError('Ungültiger Breitengrad. Bitte einen Wert zwischen -90 und 90 eingeben.');
    return;
  }
  
  if (isNaN(lon) || lon < -180 || lon > 180) {
    reportError('Ungültiger Längengrad. Bitte einen Wert zwischen -180 und 180 eingeben.');
    return;
  }
  
  try {
    mapView.setCoordinates(lat, lon);
    config = configStore.save({ mapLatitude: lat, mapLongitude: lon });
    
    if (satelliteMapToggle.checked) {
      loadMapBtn.disabled = true;
      loadMapBtn.textContent = 'Lädt...';
      await mapView.loadMap();
      loadMapBtn.disabled = false;
      loadMapBtn.textContent = 'Karte laden';
    }
  } catch (error) {
    reportError(error);
    loadMapBtn.disabled = false;
    loadMapBtn.textContent = 'Karte laden';
  }
}

async function handleSatelliteMapToggle() {
  const enabled = satelliteMapToggle.checked;
  mapView.setSatelliteMapEnabled(enabled);
  config = configStore.save({ satelliteMapEnabled: enabled });
  
  if (enabled && mapView.latitude !== null && mapView.longitude !== null) {
    try {
      loadMapBtn.disabled = true;
      loadMapBtn.textContent = 'Lädt...';
      await mapView.loadMap();
      loadMapBtn.disabled = false;
      loadMapBtn.textContent = 'Karte laden';
    } catch (error) {
      reportError(error);
      loadMapBtn.disabled = false;
      loadMapBtn.textContent = 'Karte laden';
    }
  }
}

function reportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  connectionStatus.textContent = `Fehler: ${message}`;
  connectionStatus.classList.remove('connected');
  connectionStatus.classList.add('disconnected');
}

window.addEventListener('beforeunload', () => {
  rotor.stopPolling();
  void rotor.disconnect();
  if (unsubscribeStatus) {
    unsubscribeStatus();
  }
  if (typeof unsubscribeError === 'function') {
    unsubscribeError();
  }
});
