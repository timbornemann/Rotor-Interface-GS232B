// Force unregister legacy Service Workers (Vite PWA leftovers)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (const registration of registrations) {
      console.log('[Maintenance] Unregistering legacy Service Worker due to architecture change:', registration);
      registration.unregister();
    }
  });
}

// Alle Klassen werden über Script-Tags geladen
// SIMULATED_PORT_ID is defined in rotorService.js
// const SIMULATED_PORT_ID = 'SIMULATED-ROTOR'; // Removed to avoid syntax error

const rotor = createRotorService(); // createRotorService is global from rotorService.js
window.rotorService = rotor; // Make available globally for settings modal

const portSelect = document.getElementById('portSelect');
const refreshPortsBtn = document.getElementById('refreshPortsBtn');
const manualPortBtn = document.getElementById('manualPortBtn');
// Elements from settings modal may be null here, so we check them inside update functions or modal logic
const baudInput = document.getElementById('baudInput');
const pollingInput = document.getElementById('pollingInput');
// const simulationToggle = document.getElementById('simulationToggle'); // Removed
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const connectionStatus = document.getElementById('connectionStatus');
const modeStatus = document.getElementById('modeStatus');
const azValue = document.getElementById('azValue');
const elValue = document.getElementById('elValue');
const gotoAzInput = document.getElementById('gotoAzInput');
const gotoElInput = document.getElementById('gotoElInput');
const compass = new Compass(document.getElementById('compassRoot'));
const elevation = new Elevation(document.getElementById('elevationRoot'));
const mapView = new MapView(document.getElementById('mapCanvas'));

// Setup click handler for map
mapView.setOnClick(async (azimuth, elevation) => {
  if (!connected) {
    logAction('Klick auf Karte verworfen, nicht verbunden', { azimuth, elevation });
    return;
  }
  
  // Validiere gegen Limits
  if (!validateTargets({ az: azimuth, el: elevation })) {
    logAction('Klick auf Karte verworfen, Ziel außerhalb Limits', { azimuth, elevation });
    return;
  }
  
  logAction('Klick auf Karte - Rotor wird bewegt', { azimuth: azimuth.toFixed(1), elevation: elevation.toFixed(1) });
  try {
    // RotorService.setAzEl berücksichtigt bereits die kürzeste Richtung und Limits
    await rotor.setAzEl({ az: azimuth, el: elevation });
  } catch (error) {
    reportError(error);
  }
});

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
const azOffsetInput = document.getElementById('azOffsetInput');
const elOffsetInput = document.getElementById('elOffsetInput');
const azScaleFactorInput = document.getElementById('azScaleFactorInput');
const elScaleFactorInput = document.getElementById('elScaleFactorInput');
const applyScaleFactorsBtn = document.getElementById('applyScaleFactorsBtn');
const limitWarning = document.getElementById('limitWarning');
const speedWarning = document.getElementById('speedWarning');
const serialCommandInput = document.getElementById('serialCommandInput');
const sendSerialCommandBtn = document.getElementById('sendSerialCommandBtn');
const commandHistoryList = document.getElementById('commandHistoryList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

function logAction(message, details = {}) {
  console.log('[UI]', message, details);
}

const SPEED_MIN_DEFAULT = 0.5;
const SPEED_MAX_DEFAULT = 20;

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
  return sanitizeSpeedSettings(config).sanitized;
}

function getSpeedLimits() {
  const min = Number(config.speedMinDegPerSec ?? SPEED_MIN_DEFAULT);
  const max = Number(config.speedMaxDegPerSec ?? SPEED_MAX_DEFAULT);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    return { min: SPEED_MIN_DEFAULT, max: SPEED_MAX_DEFAULT };
  }
  return { min, max };
}

function getSpeedLimitText() {
  const { min, max } = getSpeedLimits();
  const format = (value) => Number(value).toFixed(1);
  return `${format(min)}-${format(max)}`;
}

function sanitizeSpeedSettings(speedSettings = {}) {
  const { min, max } = getSpeedLimits();
  const clampToRange = (value) => Math.min(max, Math.max(min, value));
  const clampStageValue = (value) => Math.min(4, Math.max(1, Math.round(value)));
  const clampAngleCode = (value) => Math.min(3, Math.max(0, Math.round(value)));
  const sanitized = {
    azimuthSpeedDegPerSec: clampToRange(Number(config.azimuthSpeedDegPerSec) || min),
    elevationSpeedDegPerSec: clampToRange(Number(config.elevationSpeedDegPerSec) || min),
    azimuthLowSpeedStage: clampStageValue(Number(config.azimuthLowSpeedStage ?? 3)),
    azimuthHighSpeedStage: clampStageValue(Number(config.azimuthHighSpeedStage ?? 4)),
    elevationLowSpeedStage: clampStageValue(Number(config.elevationLowSpeedStage ?? 3)),
    elevationHighSpeedStage: clampStageValue(Number(config.elevationHighSpeedStage ?? 4)),
    azimuthSpeedAngleCode: clampAngleCode(Number(config.azimuthSpeedAngleCode ?? 3)),
    elevationSpeedAngleCode: clampAngleCode(Number(config.elevationSpeedAngleCode ?? 3))
  };
  const corrections = [];

  const apply = (value, key, label) => {
    if (value === undefined || value === null) {
      return;
    }
    let numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      corrections.push(`${label} auf ${sanitized[key].toFixed(1)}°/s gesetzt (ungueltiger Wert)`);
      return;
    }

    const clamped = clampToRange(numeric);
    if (clamped !== numeric) {
      corrections.push(`${label} auf ${clamped.toFixed(1)}°/s begrenzt`);
    }
    sanitized[key] = Number(clamped.toFixed(2));
  };

  apply(speedSettings.azimuthSpeedDegPerSec, 'azimuthSpeedDegPerSec', 'Azimut-Geschwindigkeit');
  apply(speedSettings.elevationSpeedDegPerSec, 'elevationSpeedDegPerSec', 'Elevation-Geschwindigkeit');

  return { sanitized, corrections };
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
    if(azLimitMinInput) azLimitMinInput.value = config.azimuthMinLimit.toString();
    if(azLimitMaxInput) azLimitMaxInput.value = config.azimuthMaxLimit.toString();
    if(elLimitMinInput) elLimitMinInput.value = config.elevationMinLimit.toString();
    if(elLimitMaxInput) elLimitMaxInput.value = config.elevationMaxLimit.toString();
    syncGotoInputBounds();
}

function updateSpeedInputsFromConfig() {
  const { sanitized } = sanitizeSpeedSettings(config);
  config = { ...config, ...sanitized };

  controls.setSpeedValues({
    azimuthSpeedDegPerSec: sanitized.azimuthSpeedDegPerSec,
    elevationSpeedDegPerSec: sanitized.elevationSpeedDegPerSec
  });
  
  // Ensure configStore is updated if we sanitized values?
  // We'll leave it for next save or explicit update
}

function updateRampInputsFromConfig() {
    // Only updates if elements exist (e.g. in settings modal but handled by modal logic usually)
}

function syncGotoInputBounds() {
  if (gotoAzInput) {
      gotoAzInput.min = config.azimuthMinLimit;
      gotoAzInput.max = config.azimuthMaxLimit;
  }
  if (gotoElInput) {
      gotoElInput.min = config.elevationMinLimit;
      gotoElInput.max = config.elevationMaxLimit;
  }
}

function applyLimitsToRotor() {
  rotor.setSoftLimits(getSoftLimitConfigFromState());
}

function applyOffsetsToRotor() {
  rotor.setCalibrationOffsets(getOffsetConfigFromState());
}

function applyScaleFactorsToRotor() {
  rotor.setScaleFactors({
    azimuthScaleFactor: config.azimuthScaleFactor ?? 1.0,
    elevationScaleFactor: config.elevationScaleFactor ?? 1.0
  });
}

function showLimitWarning(message) {
  if (!limitWarning) return;
  if (message) {
    limitWarning.textContent = message;
    limitWarning.classList.remove('hidden');
  } else {
    limitWarning.textContent = '';
    limitWarning.classList.add('hidden');
  }
}

function showSpeedWarning(message) {
  if (!speedWarning) return;
  if (message) {
    speedWarning.textContent = message;
    speedWarning.classList.remove('hidden');
  } else {
    speedWarning.textContent = '';
    speedWarning.classList.add('hidden');
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
      controls.showRouteHint(null);
      return;
    }
    if (!validateTargets({ az: azimuth })) {
      logAction('Azimut-Befehl verworfen, Ziel ausserhalb Limits', { azimuth });
      controls.showRouteHint(null);
      return;
    }
    logAction('Azimut-Befehl senden', { azimuth });
    try {
      const plan = await rotor.planAzimuthTarget(azimuth);
      controls.showRouteHint(plan);
      await rotor.setAzimuth(azimuth);
    } catch (error) {
      reportError(error);
    }
  },
  onGotoAzimuthElevation: async (azimuth, elevation) => {
    if (!connected) {
      logAction('Azimut/Elevation-Befehl verworfen, nicht verbunden', { azimuth, elevation });
      controls.showRouteHint(null);
      return;
    }
    if (!validateTargets({ az: azimuth, el: elevation })) {
      logAction('Azimut/Elevation-Befehl verworfen, Ziel ausserhalb Limits', { azimuth, elevation });
      controls.showRouteHint(null);
      return;
    }
    logAction('Azimut/Elevation-Befehl senden', { azimuth, elevation });
    try {
      const plan = await rotor.planAzimuthTarget(azimuth);
      controls.showRouteHint(plan);
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
let config = configStore.loadSync();
let connected = false;
let unsubscribeStatus = null;
const unsubscribeError = rotor.onError((error) => reportError(error));
let settingsModal = null;

// Initialize settings modal
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { settingsModal = new SettingsModal(); });
} else {
  settingsModal = new SettingsModal();
}

// Load config asynchronously
configStore.load().then(loadedConfig => {
  if (loadedConfig) {
    config = loadedConfig;
    updateUIFromConfig();
  }
}).catch(err => {
  console.warn('[main] Could not load config', err);
});

init().catch(reportError);

function updateScaleFactorInputsFromConfig() {
  if (azScaleFactorInput) azScaleFactorInput.value = config.azimuthScaleFactor ?? 1.0;
  if (elScaleFactorInput) elScaleFactorInput.value = config.elevationScaleFactor ?? 1.0;
}

function updateOffsetInputsFromConfig() {
  if (azOffsetInput) azOffsetInput.value = config.azimuthOffset ?? 0;
  if (elOffsetInput) elOffsetInput.value = config.elevationOffset ?? 0;
}

function updateUIFromConfig() {
  if (baudInput) baudInput.value = config.baudRate.toString();
  if (pollingInput) pollingInput.value = config.pollingIntervalMs.toString();
  // if (simulationToggle) simulationToggle.checked = config.simulation; // Removed
  updateLimitInputsFromConfig();
  updateSpeedInputsFromConfig();
  updateRampInputsFromConfig();
  updateModeLabel();
  updateConeSettings();
  
  if (elevation) elevation.setDisplayEnabled(config.elevationDisplayEnabled !== false);
  
  if (mapCoordinatesInput && config.mapLatitude !== null && config.mapLongitude !== null) {
    mapCoordinatesInput.value = `${config.mapLatitude}, ${config.mapLongitude}`;
  }
  if (satelliteMapToggle) satelliteMapToggle.checked = config.satelliteMapEnabled || false;

  mapView.setZoomLimits(config.mapZoomMin, config.mapZoomMax, config.mapZoomLevel);
  if (config.mapLatitude !== null && config.mapLongitude !== null) {
    mapView.setCoordinates(config.mapLatitude, config.mapLongitude);
  }
  mapView.setSatelliteMapEnabled(config.satelliteMapEnabled || false);
  updateOffsetInputsFromConfig();
  updateScaleFactorInputsFromConfig();
}

async function init() {
  logAction('Initialisierung gestartet');
  updateUIFromConfig();
  controls.setEnabled(false);
  disconnectBtn.disabled = true;

  applyLimitsToRotor();
  applyOffsetsToRotor();
  applyScaleFactorsToRotor();
  rotor.setRampSettings(getRampConfigFromState());
  await rotor.setSpeed(getSpeedConfigFromState());

  if (refreshPortsBtn) {
    refreshPortsBtn.addEventListener('click', () => void refreshPorts());
  }
  if (manualPortBtn) {
    manualPortBtn.addEventListener('click', () => handleManualPort());
  }

  if (connectBtn) {
    connectBtn.addEventListener('click', () => void handleConnect());
  }
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => void handleDisconnect());
  }
  
  if (applyLimitsBtn) {
    applyLimitsBtn.addEventListener('click', () => void handleApplyLimits());
  }
  if (setAzZeroBtn) {
    setAzZeroBtn.addEventListener('click', () => void handleSetAzReference(0));
  }
  if (setAzFullBtn) {
    setAzFullBtn.addEventListener('click', () => void handleSetAzReference(360));
  }
  if (resetOffsetsBtn) {
    resetOffsetsBtn.addEventListener('click', () => void handleResetOffsets());
  }

  // Karten-Event-Handler
  if (loadMapBtn) {
    loadMapBtn.addEventListener('click', () => void handleLoadMap());
  }
  if (satelliteMapToggle) {
    satelliteMapToggle.addEventListener('change', () => void handleSatelliteMapToggle());
  }
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => mapView.setZoom(mapView.zoomLevel + 1));
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => mapView.setZoom(mapView.zoomLevel - 1));
  }
  if (mapCoordinatesInput) {
    mapCoordinatesInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') void handleLoadMap();
    });
  }
  mapView.updateZoomDisplay();
  
  // Settings Modal
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
      if (!settingsModal) settingsModal = new SettingsModal();
      await refreshPorts();
      if (settingsModal) {
        settingsModal.open(config, async (newConfig) => {
          const { sanitized, corrections } = sanitizeSpeedSettings(newConfig);
          newConfig = { ...newConfig, ...sanitized };
          if (corrections.length) {
            showSpeedWarning(`Begrenzt: ${corrections.join('; ')}`);
          } else {
            showSpeedWarning('');
          }
          config = await configStore.save(newConfig);
          updateUIFromConfig();
          applyLimitsToRotor();
          applyOffsetsToRotor();
          applyScaleFactorsToRotor();
          rotor.setRampSettings(getRampConfigFromState());
          await rotor.setSpeed(getSpeedConfigFromState());
          updateConeSettings();

          const newMode = Number(newConfig.azimuthMode) === 450 ? 450 : 360;
          if (connected) {
              // Mode update on server handled by config save
              // But explicit setMode call might be useful for immediate feedback or legacy
              await rotor.setMode(newMode);
          }
          logAction('Einstellungen gespeichert', newConfig);
        });
      }
    });
  }

  // Serial Tool
  if (sendSerialCommandBtn) {
    sendSerialCommandBtn.addEventListener('click', () => void handleSendSerialCommand());
  }
  if (serialCommandInput) {
    serialCommandInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') void handleSendSerialCommand();
    });
  }
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => clearCommandHistory());
  }
  const quickCmdButtons = document.querySelectorAll('.quick-cmd-btn');
  if (quickCmdButtons) {
    quickCmdButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        if (serialCommandInput) serialCommandInput.value = cmd;
        void handleSendSerialCommand(cmd);
      });
    });
  }

  await refreshPorts();
  subscribeToStatus();

  logAction('Initialisierung abgeschlossen');
}

function handleManualPort() {
  const port = prompt('Port-Pfad eingeben (z.B. COM3 oder /dev/ttyUSB0):');
  if (port && port.trim()) {
    const trimmed = port.trim();
    const option = document.createElement('option');
    option.value = trimmed;
    option.textContent = `${trimmed} (Manuell)`;
    portSelect.appendChild(option);
    portSelect.value = trimmed;
    logAction('Manueller Port hinzugefügt', { port: trimmed });
    logAction('Manueller Port hinzugefügt', { port: trimmed });
  }
}

async function refreshPorts() {
  try {
    logAction('Portliste wird aktualisiert');
    const ports = await rotor.listPorts();
    portSelect.innerHTML = '';
    
    let hasRelevantPorts = false;
    ports.forEach((port) => {
        const option = document.createElement('option');
        option.value = port.path;
        option.textContent = port.friendlyName || port.path;
        // if(port.simulated) option.dataset.simulated = 'true'; // Removed
        portSelect.appendChild(option);
        hasRelevantPorts = true;
    });

    if (!hasRelevantPorts) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Keine Ports verfügbar';
      option.disabled = true;
      portSelect.appendChild(option);
    } else if (config.portPath) {
        if (Array.from(portSelect.options).some(o => o.value === config.portPath)) {
            portSelect.value = config.portPath;
        }
    }
  } catch (error) {
    reportError(error);
  }
}

async function handleConnect() {
  const baudRate = Number(config.baudRate) || 9600;
  const pollingIntervalMs = Number(config.pollingIntervalMs) || 1000;
  const selectedOption = portSelect.selectedOptions[0];
  
  // No simulation support
  const simulation = false;
  const path = portSelect.value;
  const azimuthMode = Number(config.azimuthMode) === 450 ? 450 : 360;

  if (!path) {
    logAction('Verbindungsversuch ohne Port');
    reportError('Bitte zuerst einen Port auswaehlen.');
    return;
  }

  try {
    logAction('Verbindung wird aufgebaut', { path });
    applyLimitsToRotor();
    applyOffsetsToRotor();
    applyScaleFactorsToRotor();
    
    // We update config first so connection uses latest settings
    config = await configStore.save({
      baudRate,
      pollingIntervalMs,
      simulation: false, // Ensure this is false
      portPath: path,
      azimuthMode,
      connectionMode: 'server'
    });

    await rotor.connect({ path, baudRate, simulation: false, azimuthMode });
    await rotor.setMode(azimuthMode);
    rotor.startPolling();
    connected = true;
    
    setConnectionState(true);
    logAction('Verbindung hergestellt');
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

async function handleApplyLimits() {
  const limits = readLimitInputs();
  if (Object.values(limits).some((value) => Number.isNaN(value))) {
    reportError('Bitte gueltige numerische Limits angeben.');
    return;
  }
  if (!limitsAreValid(limits)) {
    reportError('Max-Limits müssen größer als Min-Limits sein.');
    return;
  }
  config = await configStore.save(limits);
  applyLimitsToRotor();
  showLimitWarning('Limits wurden angewendet.');
  logAction('Software-Limits aktualisiert', limits);
}

async function handleSetAzReference(value) {
  config = await configStore.save({ azimuthOffset: 0 }); // Reset first
  const currentStat = rotor.currentStatus;
  const rawAz = currentStat && typeof currentStat.azimuthRaw === 'number' ? currentStat.azimuthRaw : 0;
  // Calculate offset so that (raw + offset) / scale = value
  // offset = (value * scale) - raw
  const scale = config.azimuthScaleFactor || 1.0;
  const offset = (value * scale) - rawAz;
  
  config = await configStore.save({ azimuthOffset: offset });
  applyOffsetsToRotor();
  updateOffsetInputsFromConfig();
  showLimitWarning(`Azimut auf ${value}° referenziert (Offset: ${offset.toFixed(1)}).`);
  logAction('Azimut referenziert', { value, offset });
}

async function handleResetOffsets() {
  config = await configStore.save({ azimuthOffset: 0, elevationOffset: 0 });
  applyOffsetsToRotor();
  updateOffsetInputsFromConfig();
  showLimitWarning('Offsets wurden auf 0° zurueckgesetzt.');
  logAction('Offsets zurueckgesetzt');
}

async function handleSpeedChange(speedSettings) {
  const { sanitized, corrections } = sanitizeSpeedSettings(speedSettings);
  if (corrections.length) {
    showSpeedWarning(`Geschwindigkeiten wurden auf ${getSpeedLimitText()}°/s begrenzt (${corrections.join('; ')}).`);
  } else {
    showSpeedWarning('');
  }
  config = await configStore.save(sanitized);
  updateSpeedInputsFromConfig();
  logAction('Geschwindigkeit angepasst', sanitized);
  await rotor.setSpeed(sanitized);
}

function readRampInputs() {
  // Not directly used by UI anymore (managed in modal), but kept for legacy calls?
  // We can return from config
  return getRampConfigFromState();
}

async function handleRampSettingsChange() {
  const rampSettings = readRampInputs();
  config = await configStore.save(rampSettings);
  rotor.setRampSettings(getRampConfigFromState());
  logAction('Rampen-PI-Regler aktualisiert', getRampConfigFromState());
}

let lastStatusReceivedTime = null;
let statusCheckInterval = null;

function updateConnectionStatusText() {
  if (!connected) {
    connectionStatus.textContent = 'Getrennt';
    return;
  }
  // const isSimulation = config.simulation || portSelect.value === SIMULATED_PORT_ID;
  const portInfo = portSelect.selectedOptions[0]?.textContent || '';
  let statusText = `Verbunden (${portInfo})`;
  connectionStatus.textContent = statusText;
}

function setConnectionState(state) {
  connected = state;
  logAction('Verbindungsstatus gesetzt', { connected: state });
  controls.setEnabled(state);
  if (!state) {
    controls.showRouteHint(null);
  }
  connectBtn.disabled = state;
  disconnectBtn.disabled = !state;
  
  if (state) {
    updateConnectionStatusText();
    lastStatusReceivedTime = Date.now();
    if (statusCheckInterval) clearInterval(statusCheckInterval);
    statusCheckInterval = setInterval(() => {
      if (connected) {
        const timeSinceLastStatus = Date.now() - lastStatusReceivedTime;
        // Simple check
        if (timeSinceLastStatus > 5000) {
           connectionStatus.classList.remove('connected');
           connectionStatus.classList.add('disconnected');
        } else {
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
  if (unsubscribeStatus) unsubscribeStatus();
  unsubscribeStatus = rotor.onStatus((status) => handleStatus(status));
}

function handleStatus(status) {
  if (!status) return;
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
  
  const time = new Date(status.timestamp).toLocaleTimeString();
  const az = typeof status.azimuth === 'number' ? status.azimuth.toFixed(0) : '--';
  const el = typeof status.elevation === 'number' ? status.elevation.toFixed(0) : '--';
  lastStatusValue.textContent = `${time} | Az: ${az}° | El: ${el}°`;
  logAction('Status aktualisiert', { status, display: lastStatusValue.textContent });
  
  if (connected) {
    updateConnectionStatusText();
    connectionStatus.classList.add('connected');
    connectionStatus.classList.remove('disconnected');
  }
  
  if (status.rawLine) {
    addCommandToHistory(`← ${status.rawLine}`, 'received');
  }
}

function updateModeLabel() {
  const mode = config.azimuthMode || 360;
  modeStatus.textContent = `Modus: ${mode}deg`;
  logAction('Modus-Label aktualisiert', { label: modeStatus.textContent });
}

function updateConeSettings() {
  const coneAngle = config.coneAngle || 10;
  const coneLength = config.coneLength || 1000;
  const azimuthDisplayOffset = config.azimuthDisplayOffset || 0;
  mapView.setConeSettings(coneAngle, coneLength, azimuthDisplayOffset);
}

async function handleLoadMap() {
  const inputValue = mapCoordinatesInput.value.trim();
  const parts = inputValue.split(',').map(part => part.trim());
  
  if (parts.length !== 2) {
    reportError('Ungültiges Format. Bitte "Latitude, Longitude"');
    return;
  }
  
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (isNaN(lat)) { reportError('Ungültiger Breitengrad'); return; }
  if (isNaN(lon)) { reportError('Ungültiger Längengrad'); return; }

  try {
    logAction('Kartenkoordinaten werden gesetzt', { lat, lon });
    mapView.setCoordinates(lat, lon);
    config = await configStore.save({ mapLatitude: lat, mapLongitude: lon });

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
  logAction('Satellitenansicht zweck', { enabled });
  mapView.setSatelliteMapEnabled(enabled);
  config = await configStore.save({ satelliteMapEnabled: enabled });

  if (enabled && mapView.latitude !== null) {
      // Refresh map
      try {
           await mapView.loadMap();
      } catch(e) { reportError(e); }
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

let commandHistory = [];

async function handleSendSerialCommand(cmdOverride = null) {
  if (!connected) {
    reportError('Nicht verbunden.');
    return;
  }
  const command = cmdOverride || (serialCommandInput ? serialCommandInput.value.trim() : '');
  if (!command) {
    reportError('Bitte einen Befehl eingeben.');
    return;
  }

  try {
    logAction('Serieller Befehl senden', { command });
    addCommandToHistory(command, 'sent');
    await rotor.sendRawCommand(command);
    
    if (serialCommandInput && !cmdOverride) serialCommandInput.value = '';
  } catch (error) {
    reportError(error);
    addCommandToHistory(`FEHLER: ${error.message}`, 'error');
  }
}

function addCommandToHistory(command, type = 'sent') {
  const time = new Date().toLocaleTimeString();
  const item = { time, command, type };
  commandHistory.unshift(item);
  if (commandHistory.length > 100) commandHistory = commandHistory.slice(0, 100);
  updateCommandHistoryDisplay();
}

function updateCommandHistoryDisplay() {
  if (!commandHistoryList) return;
  commandHistoryList.innerHTML = '';
  
  if (commandHistory.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'command-history-item';
    emptyMsg.textContent = 'Keine Befehle gesendet';
    emptyMsg.style.color = 'var(--muted)';
    emptyMsg.style.fontStyle = 'italic';
    commandHistoryList.appendChild(emptyMsg);
    return;
  }
  
  commandHistory.forEach((item) => {
    const div = document.createElement('div');
    div.className = `command-history-item ${item.type}`;
    const timeSpan = document.createElement('span');
    timeSpan.className = 'command-history-time';
    timeSpan.textContent = item.time;
    const cmdSpan = document.createElement('span');
    cmdSpan.className = 'command-history-command';
    cmdSpan.textContent = item.command;
    div.appendChild(timeSpan);
    div.appendChild(cmdSpan);
    commandHistoryList.appendChild(div);
  });
}

function clearCommandHistory() {
  commandHistory = [];
  updateCommandHistoryDisplay();
  logAction('Befehls-Historie gelöscht');
}

window.addEventListener('beforeunload', () => {
  rotor.stopPolling();
  void rotor.disconnect();
  if (unsubscribeStatus) unsubscribeStatus();
  if (typeof unsubscribeError === 'function') unsubscribeError();
});
