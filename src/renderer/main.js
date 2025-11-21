// Alle Klassen werden über Script-Tags geladen

const rotor = createRotorService();
window.rotorService = rotor; // Make available globally for settings modal

const portSelect = document.getElementById('portSelect');
const requestPortBtn = document.getElementById('requestPortBtn');
const refreshPortsBtn = document.getElementById('refreshPortsBtn');
// These elements are now in the settings modal, so they may be null
const baudInput = document.getElementById('baudInput');
const pollingInput = document.getElementById('pollingInput');
const simulationToggle = document.getElementById('simulationToggle');
const connectionModeSelect = document.getElementById('connectionModeSelect');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const connectionStatus = document.getElementById('connectionStatus');
const serialSupportNotice = document.getElementById('serialSupportNotice');
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
const serialCommandInput = document.getElementById('serialCommandInput');
const sendSerialCommandBtn = document.getElementById('sendSerialCommandBtn');
const commandHistoryList = document.getElementById('commandHistoryList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

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
  // Ramp inputs are now in settings modal, so this function is kept for compatibility
  // but doesn't need to do anything
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
let config = configStore.loadSync(); // Start with sync load, then async update
let connected = false;
let unsubscribeStatus = null;
const unsubscribeError = rotor.onError((error) => reportError(error));
let settingsModal = null;

// Initialize settings modal after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    settingsModal = new SettingsModal();
  });
} else {
  settingsModal = new SettingsModal();
}

// Load config asynchronously from INI file
configStore.load().then(loadedConfig => {
  if (loadedConfig) {
    config = loadedConfig;
    // Update UI with loaded config
    updateUIFromConfig();
  }
}).catch(err => {
  console.warn('[main] Could not load config from INI, using localStorage', err);
});

init().catch(reportError);

function updateUIFromConfig() {
  // These elements are now in the settings modal, so only update if they exist
  if (baudInput) baudInput.value = config.baudRate.toString();
  if (pollingInput) pollingInput.value = config.pollingIntervalMs.toString();
  if (simulationToggle) simulationToggle.checked = config.simulation;
  if (connectionModeSelect) connectionModeSelect.value = config.connectionMode || 'local';
  updateLimitInputsFromConfig();
  updateSpeedInputsFromConfig();
  updateRampInputsFromConfig();
  updateModeLabel();
  updateConnectionModeUI();
  updateConeSettings();
  
  // Map settings
  if (mapCoordinatesInput && config.mapLatitude !== null && config.mapLatitude !== undefined &&
      config.mapLongitude !== null && config.mapLongitude !== undefined) {
    mapCoordinatesInput.value = `${config.mapLatitude}, ${config.mapLongitude}`;
  }
  if (satelliteMapToggle) satelliteMapToggle.checked = config.satelliteMapEnabled || false;
  
  if (config.mapLatitude !== null && config.mapLongitude !== null) {
    mapView.setCoordinates(config.mapLatitude, config.mapLongitude);
  }
  mapView.setSatelliteMapEnabled(config.satelliteMapEnabled || false);
}

async function init() {
  logAction('Initialisierung gestartet');
  updateUIFromConfig();
  controls.setEnabled(false);
  disconnectBtn.disabled = true;

  applyLimitsToRotor();
  applyOffsetsToRotor();
  rotor.setRampSettings(getRampConfigFromState());
  await rotor.setSpeed(getSpeedConfigFromState());

  updateSerialSupportNotice();
  
  // Warnung aktualisieren wenn Modus wechselt
  if (connectionModeSelect) {
    connectionModeSelect.addEventListener('change', () => {
      updateSerialSupportNotice();
    });
  }
  if (requestPortBtn) {
    requestPortBtn.addEventListener('click', () => void handleRequestPort());
  }
  if (refreshPortsBtn) {
    refreshPortsBtn.addEventListener('click', () => void refreshPorts());
  }
  
  updatePortButtons();
  
  // Aktualisiere Port-Button Status wenn Modus wechselt
  if (connectionModeSelect) {
    connectionModeSelect.addEventListener('change', () => {
      updatePortButtons();
    });
  }
  
  // Aktualisiere Port-Liste wenn Simulation umgeschaltet wird
  if (simulationToggle) {
    simulationToggle.addEventListener('change', () => {
      refreshPorts().catch(reportError);
    });
  }

  await refreshPorts();
  subscribeToStatus();

  logAction('Initialisierung abgeschlossen', {
    baudRate: config.baudRate,
    pollingIntervalMs: config.pollingIntervalMs,
    simulation: config.simulation,
    azimuthMode: config.azimuthMode
  });

  if (connectBtn) {
    connectBtn.addEventListener('click', () => void handleConnect());
  }
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => void handleDisconnect());
  }
  if (connectionModeSelect) {
    connectionModeSelect.addEventListener('change', () => void handleConnectionModeChange());
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
  
  // Enter-Taste im Koordinatenfeld
  if (mapCoordinatesInput) {
    mapCoordinatesInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        void handleLoadMap();
      }
    });
  }
  
  // Initialisiere Zoom-Anzeige
  mapView.updateZoomDisplay();
  
  // Settings Modal
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
      // Ensure settings modal is initialized
      if (!settingsModal) {
        settingsModal = new SettingsModal();
      }
      // Refresh ports before opening modal
      await refreshPorts();
      if (settingsModal) {
        settingsModal.open(config, async (newConfig) => {
        // Save new config
        config = await configStore.save(newConfig);
        updateUIFromConfig();
        applyLimitsToRotor();
        applyOffsetsToRotor();
        rotor.setRampSettings(getRampConfigFromState());
        await rotor.setSpeed(getSpeedConfigFromState());
        updateConeSettings();
        
        // Update mode if changed
        const newMode = Number(newConfig.azimuthMode) === 450 ? 450 : 360;
        if (connected) {
          try {
            await rotor.setMode(newMode);
          } catch (error) {
            reportError(error);
          }
        }
        
        logAction('Einstellungen gespeichert', newConfig);
        });
      }
    });
  }

  // Serielles Tool Event-Handler
  if (sendSerialCommandBtn) {
    sendSerialCommandBtn.addEventListener('click', () => void handleSendSerialCommand());
  }
  if (serialCommandInput) {
    serialCommandInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        void handleSendSerialCommand();
      }
    });
  }
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => clearCommandHistory());
  }
  
  // Quick-Command Buttons
  const quickCmdButtons = document.querySelectorAll('.quick-cmd-btn');
  if (quickCmdButtons && quickCmdButtons.length > 0) {
    quickCmdButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        if (serialCommandInput) {
          serialCommandInput.value = cmd;
        }
        void handleSendSerialCommand(cmd);
      });
    });
  }
}

function updateSerialSupportNotice() {
  if (!serialSupportNotice) return;
  const isLocalMode = (connectionModeSelect ? connectionModeSelect.value : config.connectionMode) === 'local';
  const supportsWebSerial = rotor.supportsWebSerial();
  
  if (!supportsWebSerial && isLocalMode) {
    serialSupportNotice.classList.remove('hidden');
  } else {
    serialSupportNotice.classList.add('hidden');
  }
}

function updatePortButtons() {
  const isServerMode = (connectionModeSelect ? connectionModeSelect.value : config.connectionMode) === 'server';
  const supportsWebSerial = rotor.supportsWebSerial();
  
  if (requestPortBtn) {
    requestPortBtn.disabled = isServerMode || !supportsWebSerial;
    requestPortBtn.style.display = isServerMode ? 'none' : '';
  }
  if (refreshPortsBtn) {
    refreshPortsBtn.style.display = isServerMode ? '' : 'none';
  }
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
    const connectionMode = connectionModeSelect ? connectionModeSelect.value : config.connectionMode;
    const ports = await rotor.listPorts();
    portSelect.innerHTML = '';
    
    console.log('[refreshPorts] Alle Ports vom Service:', ports);
    console.log('[refreshPorts] Aktueller Verbindungsmodus:', connectionMode);
    
    let hasRelevantPorts = false;
    let serverPortCount = 0;
    let localPortCount = 0;
    let simulatedPortCount = 0;
    
    ports.forEach((port) => {
      console.log('[refreshPorts] Prüfe Port:', { 
        path: port.path, 
        serverPort: port.serverPort, 
        simulated: port.simulated,
        friendlyName: port.friendlyName 
      });
      
      // Filtere Ports basierend auf Verbindungsmodus
      if (port.simulated || port.path === SIMULATED_PORT_ID) {
        // Simulation immer anzeigen
        const option = document.createElement('option');
        option.value = port.path;
        option.textContent = 'Simulierter Rotor';
        option.dataset.simulated = 'true';
        portSelect.appendChild(option);
        hasRelevantPorts = true;
        simulatedPortCount++;
        console.log('[refreshPorts] Simulation hinzugefügt');
      } else if (connectionMode === 'server' && port.serverPort) {
        // Server-Modus: nur Server-Ports anzeigen
        const option = document.createElement('option');
        option.value = port.path;
        option.textContent = `[Server] ${port.friendlyName || port.path}`;
        option.dataset.serverPort = 'true';
        portSelect.appendChild(option);
        hasRelevantPorts = true;
        serverPortCount++;
        console.log('[refreshPorts] Server-Port hinzugefügt:', port.path);
      } else if (connectionMode === 'local' && !port.serverPort) {
        // Lokaler Modus: nur lokale Web Serial Ports anzeigen
        const option = document.createElement('option');
        option.value = port.path;
        option.textContent = port.friendlyName || port.path;
        portSelect.appendChild(option);
        hasRelevantPorts = true;
        localPortCount++;
        console.log('[refreshPorts] Lokaler Port hinzugefügt:', port.path);
      } else {
        console.log('[refreshPorts] Port übersprungen:', { 
          connectionMode, 
          serverPort: port.serverPort,
          reason: connectionMode === 'server' ? 'nicht serverPort' : 'serverPort im lokalen Modus'
        });
      }
    });

    console.log('[refreshPorts] Port-Zusammenfassung:', { 
      serverPortCount, 
      localPortCount, 
      simulatedPortCount,
      hasRelevantPorts,
      totalOptions: portSelect.options.length
    });

    // Warnung anzeigen wenn keine Ports gefunden wurden
    if (!hasRelevantPorts && connectionMode === 'server') {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Keine Ports verfügbar - Server erreichbar?';
      option.disabled = true;
      portSelect.appendChild(option);
      logAction('Keine Server-Ports gefunden - möglicherweise Server nicht erreichbar');
      console.warn('[refreshPorts] Keine Server-Ports gefunden!');
    }

    if (config.portPath && Array.from(portSelect.options).some((opt) => opt.value === config.portPath)) {
      portSelect.value = config.portPath;
    } else {
      // Im Server-Modus: Wähle ersten Server-Port, sonst Simulation
      if (connectionMode === 'server') {
        const serverOption = Array.from(portSelect.options).find((option) => option.dataset.serverPort === 'true');
        if (serverOption) {
          portSelect.value = serverOption.value;
        } else {
          const simulatedOption = Array.from(portSelect.options).find((option) => option.dataset.simulated === 'true');
          if (simulatedOption) {
            portSelect.value = simulatedOption.value;
          }
        }
      } else {
        const simulatedOption = Array.from(portSelect.options).find((option) => option.dataset.simulated === 'true');
        if (simulatedOption) {
          portSelect.value = simulatedOption.value;
        }
      }
    }
    logAction('Portliste aktualisiert', { 
      selected: portSelect.value, 
      connectionMode, 
      serverPortCount,
      localPortCount,
      totalPorts: ports.length
    });
  } catch (error) {
    console.error('[refreshPorts] Fehler beim Aktualisieren der Portliste', error);
    reportError(error);
    // Zeige Fehlermeldung in der Port-Liste
    portSelect.innerHTML = '';
    const errorOption = document.createElement('option');
    errorOption.value = '';
    errorOption.textContent = `Fehler: ${error.message || 'Portliste konnte nicht geladen werden'}`;
    errorOption.disabled = true;
    portSelect.appendChild(errorOption);
  }
}

async function handleConnect() {
  const baudRate = Number(config.baudRate) || 9600;
  const pollingIntervalMs = Number(config.pollingIntervalMs) || 1000;
  const selectedOption = portSelect.selectedOptions[0];
  const simulation = config.simulation || selectedOption?.dataset.simulated === 'true';
  const path = simulation ? SIMULATED_PORT_ID : portSelect.value;
  const azimuthMode = Number(config.azimuthMode) === 450 ? 450 : 360;
  const connectionMode = config.connectionMode || 'local';

  if (!path) {
    logAction('Verbindungsversuch ohne Port');
    reportError('Bitte zuerst einen Port auswaehlen.');
    return;
  }

  // Verwende manuelle Modus-Auswahl statt automatischer Erkennung
  const useServer = connectionMode === 'server' && !simulation;

  try {
    logAction('Verbindung wird aufgebaut', { path, baudRate, pollingIntervalMs, simulation, azimuthMode, connectionMode, useServer });
    applyLimitsToRotor();
    applyOffsetsToRotor();
    await rotor.connect({ path, baudRate, simulation, useServer });
    await rotor.setMode(azimuthMode);
    rotor.startPolling(pollingIntervalMs);
    connected = true;
    config = await configStore.save({ baudRate, pollingIntervalMs, simulation, portPath: path, azimuthMode, connectionMode });
    setConnectionState(true);
    logAction('Verbindung hergestellt', { path, baudRate, pollingIntervalMs, simulation, azimuthMode, connectionMode, useServer });
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
    reportError('Limits ungueltig: Minimum muss kleiner als Maximum sein.');
    return;
  }
  config = await configStore.save(limits);
  applyLimitsToRotor();
  updateLimitInputsFromConfig();
  showLimitWarning('Limits wurden aktualisiert.');
  logAction('Soft-Limits aktualisiert', limits);
}

async function handleSetAzReference(targetAzimuth) {
  const status = rotor.getCurrentStatus();
  if (!status || typeof status.azimuthRaw !== 'number') {
    reportError('Keine aktuelle Positionsrueckmeldung fuer die Referenz vorhanden.');
    return;
  }
  const newAzOffset = targetAzimuth - status.azimuthRaw;
  config = await configStore.save({ azimuthOffset: newAzOffset });
  applyOffsetsToRotor();
  showLimitWarning(`Referenz gesetzt: aktueller Azimut wird als ${targetAzimuth}° verwendet.`);
  logAction('Azimut-Referenz gesetzt', { targetAzimuth, newAzOffset });
}

async function handleResetOffsets() {
  config = await configStore.save({ azimuthOffset: 0, elevationOffset: 0 });
  applyOffsetsToRotor();
  showLimitWarning('Offsets wurden auf 0° zurueckgesetzt.');
  logAction('Offsets zurueckgesetzt');
}

async function handleSpeedChange(speedSettings) {
  config = await configStore.save(speedSettings);
  updateSpeedInputsFromConfig();
  logAction('Geschwindigkeit angepasst', getSpeedConfigFromState());
  await rotor.setSpeed(getSpeedConfigFromState());
}

function readRampInputs() {
  // Read from config instead of UI inputs (which are now in settings modal)
  return {
    rampEnabled: Boolean(config.rampEnabled),
    rampKp: Number(config.rampKp || 0.4),
    rampKi: Number(config.rampKi || 0.05),
    rampSampleTimeMs: Number(config.rampSampleTimeMs || 400),
    rampMaxStepDeg: Number(config.rampMaxStepDeg || 8),
    rampToleranceDeg: Number(config.rampToleranceDeg || 1.5)
  };
}

async function handleRampSettingsChange() {
  // This function is kept for compatibility but ramp settings are now managed via settings modal
  const rampSettings = readRampInputs();
  config = await configStore.save(rampSettings);
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
    const isSimulation = (simulationToggle ? simulationToggle.checked : config.simulation) || portSelect.value === SIMULATED_PORT_ID;
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
        const isSimulation = (simulationToggle ? simulationToggle.checked : config.simulation) || portSelect.value === SIMULATED_PORT_ID;
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
    const isSimulation = (simulationToggle ? simulationToggle.checked : config.simulation) || portSelect.value === SIMULATED_PORT_ID;
    const portInfo = portSelect.selectedOptions[0]?.textContent || '';
    connectionStatus.textContent = isSimulation ? 'Verbunden (Simulation)' : `Verbunden (${portInfo})`;
    connectionStatus.classList.add('connected');
    connectionStatus.classList.remove('disconnected');
  }
  
  // Status-Updates auch in der Historie anzeigen
  if (status && status.raw) {
    addCommandToHistory(`← ${status.raw}`, 'received');
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

function updateConnectionModeUI() {
  const connectionMode = connectionModeSelect ? connectionModeSelect.value : config.connectionMode;
  const supportsWebSerial = rotor.supportsWebSerial();
  
  // Deaktiviere lokalen Modus wenn Web Serial nicht verfügbar ist
  if (connectionModeSelect) {
    const localOption = connectionModeSelect.querySelector('option[value="local"]');
    if (localOption) {
      if (!supportsWebSerial && connectionMode === 'local') {
        // Wechsle automatisch zu Server-Modus wenn Web Serial nicht verfügbar ist
        connectionModeSelect.value = 'server';
        config = configStore.saveSync({ connectionMode: 'server' });
        logAction('Automatisch zu Server-Modus gewechselt (Web Serial nicht verfügbar)');
      }
      localOption.disabled = !supportsWebSerial;
    }
  }
  
  // Aktualisiere Button-Status
  updatePortButtons();
  
  // Aktualisiere Web Serial Warnung
  updateSerialSupportNotice();
  
  // Aktualisiere Port-Liste basierend auf Modus
  refreshPorts().catch(reportError);
}

async function handleConnectionModeChange() {
  const connectionMode = connectionModeSelect.value;
  config = await configStore.save({ connectionMode });
  logAction('Verbindungsmodus geändert', { connectionMode });
  updateConnectionModeUI();
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
    config = await configStore.save({ mapLatitude: lat, mapLongitude: lon });

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
  config = await configStore.save({ satelliteMapEnabled: enabled });

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

// Serielles Tool Funktionen
let commandHistory = [];

async function handleSendSerialCommand(cmdOverride = null) {
  if (!connected) {
    reportError('Nicht verbunden. Bitte zuerst eine Verbindung herstellen.');
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
    
    // Eingabefeld leeren
    if (serialCommandInput && !cmdOverride) {
      serialCommandInput.value = '';
    }
  } catch (error) {
    reportError(error);
    addCommandToHistory(`FEHLER: ${error.message}`, 'error');
  }
}

function addCommandToHistory(command, type = 'sent') {
  const time = new Date().toLocaleTimeString();
  const item = {
    time,
    command,
    type
  };
  commandHistory.unshift(item);
  
  // Maximal 100 Einträge behalten
  if (commandHistory.length > 100) {
    commandHistory = commandHistory.slice(0, 100);
  }
  
  updateCommandHistoryDisplay();
}

function updateCommandHistoryDisplay() {
  if (!commandHistoryList) {
    return;
  }
  
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
  if (unsubscribeStatus) {
    unsubscribeStatus();
  }
  if (typeof unsubscribeError === 'function') {
    unsubscribeError();
  }
});
