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
const gotoAzInput = document.getElementById('gotoAzInput');
const gotoElInput = document.getElementById('gotoElInput');
const compass = new Compass(document.getElementById('compassRoot'));
const elevation = new Elevation(document.getElementById('elevationRoot'));
const mapView = new MapView(document.getElementById('mapCanvas'));
const lastStatusValue = document.getElementById('lastStatusValue');
const mapCoordinatesInput = document.getElementById('mapCoordinatesInput');
const loadMapBtn = document.getElementById('loadMapBtn');
const satelliteMapToggle = document.getElementById('satelliteMapToggle');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const azLimitMinInput = document.getElementById('azLimitMinInput');
const azLimitMaxInput = document.getElementById('azLimitMaxInput');
const elLimitMinInput = document.getElementById('elLimitMinInput');
const elLimitMaxInput = document.getElementById('elLimitMaxInput');
const applyLimitsBtn = document.getElementById('applyLimitsBtn');
const setAzZeroBtn = document.getElementById('setAzZeroBtn');
const setAzFullBtn = document.getElementById('setAzFullBtn');
const resetOffsetsBtn = document.getElementById('resetOffsetsBtn');
const limitWarning = document.getElementById('limitWarning');
const rampEnabledToggle = document.getElementById('rampEnabledToggle');
const rampKpInput = document.getElementById('rampKpInput');
const rampKiInput = document.getElementById('rampKiInput');
const rampSampleInput = document.getElementById('rampSampleInput');
const rampMaxStepInput = document.getElementById('rampMaxStepInput');
const rampToleranceInput = document.getElementById('rampToleranceInput');

function logAction(message, details = {}) {
  console.log('[UI]', message, details);
}

function getSoftLimitConfigFromState() {
  return {
    azimuthMin: Number(config.azimuthMinLimit),
    azimuthMax: Number(config.azimuthMaxLimit),
    elevationMin: Number(config.elevationMinLimit),
    elevationMax: Number(config.elevationMaxLimit)
  };
}

function getOffsetConfigFromState() {
  return {
    azimuthOffset: Number(config.azimuthOffset || 0),
    elevationOffset: Number(config.elevationOffset || 0)
  };
}

function getSpeedConfigFromState() {
  return {
    azimuthSpeedDegPerSec: Number(config.azimuthSpeedDegPerSec || 0),
    elevationSpeedDegPerSec: Number(config.elevationSpeedDegPerSec || 0)
  };
}

function getRampConfigFromState() {
  return {
    rampEnabled: Boolean(config.rampEnabled),
    rampKp: Number(config.rampKp || 0),
    rampKi: Number(config.rampKi || 0),
    rampSampleTimeMs: Number(config.rampSampleTimeMs || 0),
    rampMaxStepDeg: Number(config.rampMaxStepDeg || 0),
    rampToleranceDeg: Number(config.rampToleranceDeg || 0)
  };
}

function updateLimitInputsFromConfig() {
  azLimitMinInput.value = config.azimuthMinLimit.toString();
  azLimitMaxInput.value = config.azimuthMaxLimit.toString();
  elLimitMinInput.value = config.elevationMinLimit.toString();
  elLimitMaxInput.value = config.elevationMaxLimit.toString();
  syncGotoInputBounds();
}

function updateSpeedInputsFromConfig() {
  controls.setSpeedValues({
    azimuthSpeedDegPerSec: config.azimuthSpeedDegPerSec,
    elevationSpeedDegPerSec: config.elevationSpeedDegPerSec
  });
}

function updateRampInputsFromConfig() {
  rampEnabledToggle.checked = Boolean(config.rampEnabled);
  rampKpInput.value = config.rampKp;
  rampKiInput.value = config.rampKi;
  rampSampleInput.value = config.rampSampleTimeMs;
  rampMaxStepInput.value = config.rampMaxStepDeg;
  rampToleranceInput.value = config.rampToleranceDeg;
}

function syncGotoInputBounds() {
  gotoAzInput.min = config.azimuthMinLimit;
  gotoAzInput.max = config.azimuthMaxLimit;
  gotoElInput.min = config.elevationMinLimit;
  gotoElInput.max = config.elevationMaxLimit;
}

function applyLimitsToRotor() {
  rotor.setSoftLimits(getSoftLimitConfigFromState());
}

function applyOffsetsToRotor() {
  rotor.setCalibrationOffsets(getOffsetConfigFromState());
}

function showLimitWarning(message) {
  if (!limitWarning) {
    return;
  }
  if (message) {
    limitWarning.textContent = message;
    limitWarning.classList.remove('hidden');
  } else {
    limitWarning.textContent = '';
    limitWarning.classList.add('hidden');
  }
}
const controls = new Controls(document.querySelector('.controls-card'), {
  onCommand: async (command) => {
    if (!connected) {
      logAction('Steuerbefehl verworfen, nicht verbunden', { command });
      return;
    }
    logAction('Steuerbefehl senden', { command });
    try {
      await rotor.control(command);
    } catch (error) {
      reportError(error);
    }
  },
  onGotoAzimuth: async (azimuth) => {
    if (!connected) {
      logAction('Azimut-Befehl verworfen, nicht verbunden', { azimuth });
      return;
    }
    if (!validateTargets({ az: azimuth })) {
      logAction('Azimut-Befehl verworfen, Ziel ausserhalb Limits', { azimuth });
      return;
    }
    logAction('Azimut-Befehl senden', { azimuth });
    try {
      await rotor.setAzimuth(azimuth);
    } catch (error) {
      reportError(error);
    }
  },
  onGotoAzimuthElevation: async (azimuth, elevation) => {
    if (!connected) {
      logAction('Azimut/Elevation-Befehl verworfen, nicht verbunden', { azimuth, elevation });
      return;
    }
    if (!validateTargets({ az: azimuth, el: elevation })) {
      logAction('Azimut/Elevation-Befehl verworfen, Ziel ausserhalb Limits', { azimuth, elevation });
      return;
    }
    logAction('Azimut/Elevation-Befehl senden', { azimuth, elevation });
    try {
      await rotor.setAzEl({ az: azimuth, el: elevation });
    } catch (error) {
      reportError(error);
    }
  },
  onSpeedChange: (speedSettings) => {
    handleSpeedChange(speedSettings).catch(reportError);
  }
});

const configStore = new ConfigStore();
let config = configStore.load();
let connected = false;
let unsubscribeStatus = null;
const unsubscribeError = rotor.onError((error) => reportError(error));

init().catch(reportError);

async function init() {
  logAction('Initialisierung gestartet');
  baudInput.value = config.baudRate.toString();
  pollingInput.value = config.pollingIntervalMs.toString();
  simulationToggle.checked = config.simulation;
  modeSelect.value = config.azimuthMode.toString();
  updateLimitInputsFromConfig();
  updateSpeedInputsFromConfig();
  updateRampInputsFromConfig();
  updateModeLabel();
  controls.setEnabled(false);
  disconnectBtn.disabled = true;

  // Karten-Einstellungen laden
  if (config.mapLatitude !== null && config.mapLatitude !== undefined &&
      config.mapLongitude !== null && config.mapLongitude !== undefined) {
    mapCoordinatesInput.value = `${config.mapLatitude}, ${config.mapLongitude}`;
  }
  satelliteMapToggle.checked = config.satelliteMapEnabled || false;
  
  if (config.mapLatitude !== null && config.mapLongitude !== null) {
    mapView.setCoordinates(config.mapLatitude, config.mapLongitude);
  }
  mapView.setSatelliteMapEnabled(config.satelliteMapEnabled || false);
  applyLimitsToRotor();
  applyOffsetsToRotor();
  rotor.setRampSettings(getRampConfigFromState());
  await rotor.setSpeed(getSpeedConfigFromState());

  if (!rotor.supportsWebSerial() && serialSupportNotice) {
    serialSupportNotice.classList.remove('hidden');
  }
  if (requestPortBtn) {
    requestPortBtn.disabled = !rotor.supportsWebSerial();
    requestPortBtn.addEventListener('click', () => void handleRequestPort());
  }

  await refreshPorts();
  subscribeToStatus();

  logAction('Initialisierung abgeschlossen', {
    baudRate: baudInput.value,
    pollingIntervalMs: pollingInput.value,
    simulation: simulationToggle.checked,
    azimuthMode: modeSelect.value
  });

  connectBtn.addEventListener('click', () => void handleConnect());
  disconnectBtn.addEventListener('click', () => void handleDisconnect());
  modeSelect.addEventListener('change', () => void handleModeChange());
  applyLimitsBtn.addEventListener('click', () => void handleApplyLimits());
  setAzZeroBtn.addEventListener('click', () => void handleSetAzReference(0));
  setAzFullBtn.addEventListener('click', () => void handleSetAzReference(360));
  resetOffsetsBtn.addEventListener('click', () => void handleResetOffsets());
  rampEnabledToggle.addEventListener('change', () => handleRampSettingsChange());
  [rampKpInput, rampKiInput, rampSampleInput, rampMaxStepInput, rampToleranceInput].forEach((input) => {
    input.addEventListener('change', () => handleRampSettingsChange());
  });

  // Karten-Event-Handler
  loadMapBtn.addEventListener('click', () => void handleLoadMap());
  satelliteMapToggle.addEventListener('change', () => void handleSatelliteMapToggle());
  zoomInBtn.addEventListener('click', () => mapView.setZoom(mapView.zoomLevel + 1));
  zoomOutBtn.addEventListener('click', () => mapView.setZoom(mapView.zoomLevel - 1));
  
  // Enter-Taste im Koordinatenfeld
  mapCoordinatesInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      void handleLoadMap();
    }
  });
  
  // Initialisiere Zoom-Anzeige
  mapView.updateZoomDisplay();
}

async function handleRequestPort() {
  try {
    logAction('Port-Anforderung gestartet');
    await rotor.requestPortAccess();
    await refreshPorts();
    logAction('Port-Anforderung abgeschlossen');
  } catch (error) {
    reportError(error);
  }
}

async function refreshPorts() {
  try {
    logAction('Portliste wird aktualisiert');
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
    logAction('Portliste aktualisiert', { selected: portSelect.value, options: ports });
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
    logAction('Verbindungsversuch ohne Port');
    reportError('Bitte zuerst einen Port auswaehlen.');
    return;
  }

  try {
    logAction('Verbindung wird aufgebaut', { path, baudRate, pollingIntervalMs, simulation, azimuthMode });
    applyLimitsToRotor();
    applyOffsetsToRotor();
    await rotor.connect({ path, baudRate, simulation });
    await rotor.setMode(azimuthMode);
    rotor.startPolling(pollingIntervalMs);
    connected = true;
    config = configStore.save({ baudRate, pollingIntervalMs, simulation, portPath: path, azimuthMode });
    setConnectionState(true);
    logAction('Verbindung hergestellt', { path, baudRate, pollingIntervalMs, simulation, azimuthMode });
  } catch (error) {
    reportError(error);
    setConnectionState(false);
  }
}

async function handleDisconnect() {
  try {
    logAction('Verbindung wird getrennt');
    rotor.stopPolling();
    await rotor.disconnect();
    logAction('Verbindung getrennt');
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
  logAction('Azimutmodus geändert', { mode });
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

function readLimitInputs() {
  return {
    azimuthMinLimit: Number(azLimitMinInput.value),
    azimuthMaxLimit: Number(azLimitMaxInput.value),
    elevationMinLimit: Number(elLimitMinInput.value),
    elevationMaxLimit: Number(elLimitMaxInput.value)
  };
}

function limitsAreValid(limits) {
  return limits.azimuthMaxLimit > limits.azimuthMinLimit && limits.elevationMaxLimit > limits.elevationMinLimit;
}

function isWithinAzLimit(value) {
  return value >= config.azimuthMinLimit && value <= config.azimuthMaxLimit;
}

function isWithinElLimit(value) {
  return value >= config.elevationMinLimit && value <= config.elevationMaxLimit;
}

function validateTargets({ az, el }) {
  if (typeof az === 'number' && !Number.isNaN(az) && !isWithinAzLimit(az)) {
    showLimitWarning(`Ziel-Azimut ${az}° liegt ausserhalb der Limits (${config.azimuthMinLimit}…${config.azimuthMaxLimit}°).`);
    return false;
  }
  if (typeof el === 'number' && !Number.isNaN(el) && !isWithinElLimit(el)) {
    showLimitWarning(
      `Ziel-Elevation ${el}° liegt ausserhalb der Limits (${config.elevationMinLimit}…${config.elevationMaxLimit}°).`
    );
    return false;
  }
  showLimitWarning('');
  return true;
}

function handleApplyLimits() {
  const limits = readLimitInputs();
  if (Object.values(limits).some((value) => Number.isNaN(value))) {
    reportError('Bitte gueltige numerische Limits angeben.');
    return;
  }
  if (!limitsAreValid(limits)) {
    reportError('Limits ungueltig: Minimum muss kleiner als Maximum sein.');
    return;
  }
  config = configStore.save(limits);
  applyLimitsToRotor();
  updateLimitInputsFromConfig();
  showLimitWarning('Limits wurden aktualisiert.');
  logAction('Soft-Limits aktualisiert', limits);
}

function handleSetAzReference(targetAzimuth) {
  const status = rotor.getCurrentStatus();
  if (!status || typeof status.azimuthRaw !== 'number') {
    reportError('Keine aktuelle Positionsrueckmeldung fuer die Referenz vorhanden.');
    return;
  }
  const newAzOffset = targetAzimuth - status.azimuthRaw;
  config = configStore.save({ azimuthOffset: newAzOffset });
  applyOffsetsToRotor();
  showLimitWarning(`Referenz gesetzt: aktueller Azimut wird als ${targetAzimuth}° verwendet.`);
  logAction('Azimut-Referenz gesetzt', { targetAzimuth, newAzOffset });
}

function handleResetOffsets() {
  config = configStore.save({ azimuthOffset: 0, elevationOffset: 0 });
  applyOffsetsToRotor();
  showLimitWarning('Offsets wurden auf 0° zurueckgesetzt.');
  logAction('Offsets zurueckgesetzt');
}

async function handleSpeedChange(speedSettings) {
  config = configStore.save(speedSettings);
  updateSpeedInputsFromConfig();
  logAction('Geschwindigkeit angepasst', getSpeedConfigFromState());
  await rotor.setSpeed(getSpeedConfigFromState());
}

function readRampInputs() {
  return {
    rampEnabled: rampEnabledToggle.checked,
    rampKp: Number(rampKpInput.value),
    rampKi: Number(rampKiInput.value),
    rampSampleTimeMs: Number(rampSampleInput.value),
    rampMaxStepDeg: Number(rampMaxStepInput.value),
    rampToleranceDeg: Number(rampToleranceInput.value)
  };
}

function handleRampSettingsChange() {
  const rampSettings = readRampInputs();
  config = configStore.save(rampSettings);
  updateRampInputsFromConfig();
  rotor.setRampSettings(getRampConfigFromState());
  logAction('Rampen-PI-Regler aktualisiert', getRampConfigFromState());
}

let lastStatusReceivedTime = null;
let statusCheckInterval = null;

function setConnectionState(state) {
  connected = state;
  logAction('Verbindungsstatus gesetzt', { connected: state });
  controls.setEnabled(state);
  connectBtn.disabled = state;
  disconnectBtn.disabled = !state;
  
  if (state) {
    // Prüfe, ob es eine echte Verbindung oder Simulation ist
    const isSimulation = simulationToggle.checked || portSelect.value === SIMULATED_PORT_ID;
    const portInfo = portSelect.selectedOptions[0]?.textContent || '';
    connectionStatus.textContent = isSimulation ? 'Verbunden (Simulation)' : `Verbunden (${portInfo})`;
    
    // Starte Überwachung, ob Status-Updates empfangen werden
    lastStatusReceivedTime = Date.now();
    if (statusCheckInterval) {
      clearInterval(statusCheckInterval);
    }
    statusCheckInterval = setInterval(() => {
      if (connected) {
        const timeSinceLastStatus = Date.now() - lastStatusReceivedTime;
        const isSimulation = simulationToggle.checked || portSelect.value === SIMULATED_PORT_ID;
        const portInfo = portSelect.selectedOptions[0]?.textContent || '';
        
        if (timeSinceLastStatus > 5000 && !isSimulation) {
          // Keine Status-Updates seit 5 Sekunden - möglicherweise Problem
          connectionStatus.textContent = `Verbunden (${portInfo}) - Keine Daten`;
          connectionStatus.classList.remove('connected');
          connectionStatus.classList.add('disconnected');
        } else {
          connectionStatus.textContent = isSimulation ? 'Verbunden (Simulation)' : `Verbunden (${portInfo})`;
          connectionStatus.classList.add('connected');
          connectionStatus.classList.remove('disconnected');
        }
      }
    }, 2000);
  } else {
    connectionStatus.textContent = 'Getrennt';
    if (statusCheckInterval) {
      clearInterval(statusCheckInterval);
      statusCheckInterval = null;
    }
  }
  
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
  
  // Aktualisiere Zeitstempel für Verbindungsüberwachung
  lastStatusReceivedTime = Date.now();
  
  if (typeof status.azimuth === 'number') {
    azValue.textContent = `${status.azimuth.toFixed(0)}deg`;
  }
  if (typeof status.elevation === 'number') {
    elValue.textContent = `${status.elevation.toFixed(0)}deg`;
  }
  compass.update(status.azimuth);
  elevation.update(status.elevation);
  mapView.update(status.azimuth, status.elevation);
  
  // Zeige letzten Status an
  const time = new Date(status.timestamp).toLocaleTimeString();
  const az = typeof status.azimuth === 'number' ? status.azimuth.toFixed(0) : '--';
  const el = typeof status.elevation === 'number' ? status.elevation.toFixed(0) : '--';
  lastStatusValue.textContent = `${time} | Az: ${az}° | El: ${el}°`;
  logAction('Status aktualisiert', { status, display: lastStatusValue.textContent });
  
  // Aktualisiere Verbindungsstatus-Anzeige, wenn Daten empfangen werden
  if (connected) {
    const isSimulation = simulationToggle.checked || portSelect.value === SIMULATED_PORT_ID;
    const portInfo = portSelect.selectedOptions[0]?.textContent || '';
    connectionStatus.textContent = isSimulation ? 'Verbunden (Simulation)' : `Verbunden (${portInfo})`;
    connectionStatus.classList.add('connected');
    connectionStatus.classList.remove('disconnected');
  }
}

function updateModeLabel() {
  modeStatus.textContent = `Modus: ${modeSelect.value}deg`;
  logAction('Modus-Label aktualisiert', { label: modeStatus.textContent });
}

async function handleLoadMap() {
  const inputValue = mapCoordinatesInput.value.trim();
  
  // Parse das Format "lat, lon" oder "lat,lon"
  const parts = inputValue.split(',').map(part => part.trim());
  
  if (parts.length !== 2) {
    reportError('Ungültiges Format. Bitte im Format "Latitude, Longitude" eingeben, z.B. "51.85911538185561, 11.422282899767954"');
    return;
  }
  
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  
  if (isNaN(lat) || lat < -90 || lat > 90) {
    reportError('Ungültiger Breitengrad. Bitte einen Wert zwischen -90 und 90 eingeben.');
    return;
  }
  
  if (isNaN(lon) || lon < -180 || lon > 180) {
    reportError('Ungültiger Längengrad. Bitte einen Wert zwischen -180 und 180 eingeben.');
    return;
  }

  try {
    logAction('Kartenkoordinaten werden gesetzt', { lat, lon });
    mapView.setCoordinates(lat, lon);
    config = configStore.save({ mapLatitude: lat, mapLongitude: lon });

    if (satelliteMapToggle.checked) {
      loadMapBtn.disabled = true;
      loadMapBtn.textContent = 'Lädt...';
      logAction('Satellitenkarte wird geladen');
      await mapView.loadMap();
      loadMapBtn.disabled = false;
      loadMapBtn.textContent = 'Karte laden';
      logAction('Satellitenkarte geladen');
    }
  } catch (error) {
    reportError(error);
    loadMapBtn.disabled = false;
    loadMapBtn.textContent = 'Karte laden';
  }
}

async function handleSatelliteMapToggle() {
  const enabled = satelliteMapToggle.checked;
  logAction('Satellitenansicht umgeschaltet', { enabled });
  mapView.setSatelliteMapEnabled(enabled);
  config = configStore.save({ satelliteMapEnabled: enabled });

  if (enabled && mapView.latitude !== null && mapView.longitude !== null) {
    try {
      loadMapBtn.disabled = true;
      loadMapBtn.textContent = 'Lädt...';
      logAction('Satellitenkarte wird nach Umschalten geladen');
      await mapView.loadMap();
      loadMapBtn.disabled = false;
      loadMapBtn.textContent = 'Karte laden';
      logAction('Satellitenkarte nach Umschalten geladen');
    } catch (error) {
      reportError(error);
      loadMapBtn.disabled = false;
      loadMapBtn.textContent = 'Karte laden';
    }
  }
}

function reportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[UI] Fehler', error);
  logAction('Fehler gemeldet', { message });
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
