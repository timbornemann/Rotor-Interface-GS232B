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
const rotor = createRotorService(); // createRotorService is global from rotorService.js
window.rotorService = rotor; // Make available globally for settings modal

// Initialize WebSocket service for real-time updates
const wsService = createWebSocketService(); // createWebSocketService is global from websocketService.js
window.wsService = wsService; // Make available globally

// Initialize Alert Modal
const alertModal = createAlertModal(); // createAlertModal is global from alertModal.js
window.alertModal = alertModal; // Make available globally

const portSelect = document.getElementById('portSelect');
const refreshPortsBtn = document.getElementById('refreshPortsBtn');
// Elements from settings modal may be null here, so we check them inside update functions or modal logic
const baudInput = document.getElementById('baudInput');
const pollingInput = document.getElementById('pollingInput');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const connectionStatus = document.getElementById('connectionStatus');
const modeStatus = document.getElementById('modeStatus');
const azValue = document.getElementById('azValue');
const elValue = document.getElementById('elValue');
const gotoAzInput = document.getElementById('gotoAzInput');
const gotoElInput = document.getElementById('gotoElInput');
const elevation = new Elevation(document.getElementById('elevationRoot'));
const mapView = new MapView(document.getElementById('mapCanvas'));

// Setup click handler for map
mapView.setOnClick(async (azimuth, elevation) => {
  if (!connected) {
    logAction('Klick auf Karte verworfen, nicht verbunden', { azimuth });
    return;
  }
  
  // Karten-Klick gibt kalibrierte Position zurück (was auf der Karte angezeigt wird)
  // Berechne die kürzeste Raw-Position, die dieser kalibrierten Position entspricht
  const scale = config.azimuthScaleFactor || 1.0;
  const offset = config.azimuthOffset || 0.0;
  
  // Mögliche Raw-Werte für die angeklickte kalibrierte Position:
  // raw = (calibrated * scale) - offset
  // Aber "calibrated" könnte auch calibrated - 360 oder calibrated + 360 sein
  const candidates = [
    (azimuth * scale) - offset,           // z.B. 350° → 410°
    ((azimuth - 360) * scale) - offset,   // z.B. -10° → 50°
    ((azimuth + 360) * scale) - offset    // z.B. 710° → 770°
  ];
  
  // Wähle den Kandidaten, der im gültigen Bereich liegt und am nächsten zur aktuellen Position ist
  const maxAz = config.azimuthMode === 450 ? 450 : 360;
  const currentRaw = rotor.currentStatus?.azimuthRaw || 0;
  
  // Filtere ungültige Kandidaten
  const validCandidates = candidates.filter(raw => raw >= 0 && raw <= maxAz);
  
  if (validCandidates.length === 0) {
    showLimitWarning(`Keine gültige Raw-Position für ${azimuth.toFixed(1)}° (kalibriert) gefunden.`);
    logAction('Klick auf Karte verworfen, keine gültige Raw-Position', { calibrated: azimuth, candidates });
    return;
  }
  
  // Wähle den nächstgelegenen Kandidaten zur aktuellen Position
  const rawAzimuth = validCandidates.reduce((closest, candidate) => {
    return Math.abs(candidate - currentRaw) < Math.abs(closest - currentRaw) ? candidate : closest;
  });
  
  logAction('Klick auf Karte - Rotor wird bewegt (nur Azimut)', { 
    calibrated: azimuth.toFixed(1), 
    raw: rawAzimuth.toFixed(1),
    currentRaw: currentRaw.toFixed(1),
    candidates: candidates.map(c => c.toFixed(1))
  });
  try {
    // Klick auf Karte bricht Route ab
    await rotor.stopRoute().catch(() => {}); // Ignore error if no route running
    // Sende Raw-Wert direkt an Motor
    await rotor.setAzimuthRaw(rawAzimuth);
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
  // Protocol-neutral command handler - uses abstract direction names
  onCommand: async (direction) => {
    if (!connected) {
      logAction('Steuerbefehl verworfen, nicht verbunden', { direction });
      return;
    }
    logAction('Steuerbefehl senden', { direction });
    try {
      // Abstract directions: 'left', 'right', 'up', 'down', 'stop', 'stop-azimuth', 'stop-elevation'
      if (['left', 'right', 'up', 'down'].includes(direction)) {
        // Manuelle Steuerung bricht Route ab
        await rotor.stopRoute().catch(() => {}); // Ignore error if no route running
        await rotor.manualMove(direction);
      } else if (direction === 'home') {
        // Home bricht Route ab
        await rotor.stopRoute().catch(() => {}); // Ignore error if no route running
        await rotor.home();
      } else if (direction === 'park') {
        // Park bricht Route ab
        await rotor.stopRoute().catch(() => {}); // Ignore error if no route running
        await rotor.park();
      } else if (['stop', 'stop-azimuth', 'stop-elevation'].includes(direction)) {
        // Alles Stopp bricht auch Route ab
        await rotor.stopRoute().catch(() => {}); // Ignore error if no route running
        await rotor.stopMotion();
      } else {
        console.warn(`Unknown direction: ${direction}`);
      }
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
    // Goto-Eingabe ist ein Raw-Wert (Hardware-Position), wird direkt an Motor gesendet
    // Validierung: Einfach gegen 0-360/450 für Azimut
    const maxAz = config.azimuthMode === 450 ? 450 : 360;
    if (azimuth < 0 || azimuth > maxAz) {
      showLimitWarning(`Ziel-Azimut ${azimuth}° (Raw) liegt außerhalb des gültigen Bereichs (0…${maxAz}°).`);
      logAction('Azimut-Befehl verworfen, Ziel ausserhalb Bereich', { raw: azimuth, max: maxAz });
      controls.showRouteHint(null);
      return;
    }
    
    logAction('Azimut-Befehl senden (Raw)', { raw: azimuth });
    try {
      // Goto Azimut bricht Route ab
      await rotor.stopRoute().catch(() => {}); // Ignore error if no route running
      // Sende Raw-Wert direkt an Motor, ohne Umrechnung
      await rotor.setAzimuthRaw(azimuth);
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
    // Goto-Eingabe ist ein Raw-Wert (Hardware-Position), wird direkt an Motor gesendet
    // Validierung: Einfach gegen 0-360/450 für Azimut und 0-90 für Elevation
    const maxAz = config.azimuthMode === 450 ? 450 : 360;
    let validationError = null;
    
    if (azimuth < 0 || azimuth > maxAz) {
      validationError = `Ziel-Azimut ${azimuth}° (Raw) liegt außerhalb des gültigen Bereichs (0…${maxAz}°).`;
    }
    if (elevation < 0 || elevation > 90) {
      if (validationError) {
        validationError += ` Ziel-Elevation ${elevation}° (Raw) liegt außerhalb des gültigen Bereichs (0…90°).`;
      } else {
        validationError = `Ziel-Elevation ${elevation}° (Raw) liegt außerhalb des gültigen Bereichs (0…90°).`;
      }
    }
    
    if (validationError) {
      showLimitWarning(validationError);
      logAction('Azimut/Elevation-Befehl verworfen, Ziel ausserhalb Bereich', { raw: { az: azimuth, el: elevation } });
      controls.showRouteHint(null);
      return;
    }
    
    logAction('Azimut/Elevation-Befehl senden (Raw)', { raw: { az: azimuth, el: elevation } });
    try {
      // Goto Az/El bricht Route ab
      await rotor.stopRoute().catch(() => {}); // Ignore error if no route running
      // Sende Raw-Werte direkt an Motor, ohne Umrechnung
      await rotor.setAzElRaw({ az: azimuth, el: elevation });
    } catch (error) {
      reportError(error);
    }
  },
  onSpeedChange: (speedSettings) => {
    handleSpeedChange(speedSettings).catch(reportError);
  }
});

// Initialize Route Manager (with server-side execution)
const routeManager = new RouteManager(document.getElementById('routeManagerRoot'), {
  onAddRoute: async (route) => {
    logAction('Route hinzufügen', route);
    try {
      await rotor.createRoute(route);
      // Routes will be updated via WebSocket broadcast
    } catch (error) {
      logAction('Fehler beim Hinzufügen der Route', { error: error.message });
      reportError(error);
    }
  },
  onEditRoute: async (route) => {
    logAction('Route speichern', route);
    try {
      await rotor.updateRoute(route.id, route);
      // Routes will be updated via WebSocket broadcast
    } catch (error) {
      logAction('Fehler beim Speichern der Route', { error: error.message });
      reportError(error);
    }
  },
  onDeleteRoute: async (routeId) => {
    logAction('Route löschen', { id: routeId });
    try {
      await rotor.deleteRoute(routeId);
      // Routes will be updated via WebSocket broadcast
    } catch (error) {
      logAction('Fehler beim Löschen der Route', { error: error.message });
      reportError(error);
    }
  },
  onPlayRoute: async (route) => {
    if (!connected) {
      logAction('Route-Befehl verworfen, nicht verbunden', { id: route.id, name: route.name });
      await window.alertModal.showAlert('Nicht verbunden. Bitte erst eine Verbindung herstellen.');
      return;
    }
    logAction('Route starten', { id: route.id, name: route.name, steps: route.steps.length });
    try {
      await rotor.startRoute(route.id);
      // Execution updates will come via WebSocket
    } catch (error) {
      logAction('Fehler bei Route-Ausführung', { error: error.message });
      reportError(error);
    }
  },
  onStopRoute: async () => {
    logAction('Route stoppen');
    try {
      await rotor.stopRoute();
    } catch (error) {
      logAction('Fehler beim Stoppen der Route', { error: error.message });
      reportError(error);
    }
  },
  onManualContinue: async () => {
    logAction('Manuelles Fortfahren');
    try {
      await rotor.continueRoute();
    } catch (error) {
      logAction('Fehler beim Fortfahren', { error: error.message });
      reportError(error);
    }
  }
});

// Route execution is now handled server-side via WebSocket events
// (WebSocket handlers will be set up in setupWebSocket() below)

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
    updateConeSettings(); // Ensure mapView has correct config after async load
  }
  
  // Load routes from server (not from config anymore)
  loadRoutesFromServer();
}).catch(err => {
  console.warn('[main] Could not load config', err);
});

// Load routes from server
async function loadRoutesFromServer() {
  try {
    const routes = await rotor.getRoutes();
    if (routeManager) {
      routeManager.setRoutes(routes);
    }
  } catch (err) {
    console.warn('[main] Could not load routes from server', err);
  }
}

// WebSocket setup for real-time synchronization
async function setupWebSocket() {
  // Set session ID from rotor service
  const sessionId = rotor.getSessionId();
  if (sessionId) {
    wsService.setSessionId(sessionId);
  }

  // Configure WebSocket port from server (supports custom ports)
  try {
    const resp = await fetch(`${rotor.apiBase}/api/server/settings`, {
      headers: rotor.getSessionHeaders()
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.webSocketPort) {
        wsService.setWebSocketPort(data.webSocketPort);
      }
    }
  } catch (e) {
    // Fallback to config cache (may still be default on first load)
    if (config && config.serverWebSocketPort) {
      wsService.setWebSocketPort(config.serverWebSocketPort);
    }
  }
  
  // Handle connection state broadcasts from server
  wsService.on('connection_state_changed', (state) => {
    logAction('WebSocket: Verbindungsstatus empfangen', state);
    
    // Update local connection state
    rotor.handleConnectionStateUpdate(state);
    
    // Update UI
    if (state.connected) {
      connected = true;
      setConnectionState(true);
      
      // Update port select to show connected port
      if (state.port) {
        const option = Array.from(portSelect.options).find(o => o.value === state.port);
        if (option) {
          portSelect.value = state.port;
        }
      }
    } else {
      connected = false;
      setConnectionState(false);
    }
  });
  
  // Handle client list updates
  wsService.on('client_list_updated', (data) => {
    logAction('WebSocket: Client-Liste aktualisiert', { count: data.clients?.length });
    // Settings modal will handle this event directly
  });
  
  // Handle settings updates from other clients
  wsService.on('settings_updated', (settings) => {
    if (settings && typeof settings === 'object') {
      logAction('WebSocket: Einstellungen von anderem Client aktualisiert');
      
      // Update configStore cache
      configStore.updateCache(settings);
      
      // Update local config variable
      config = { ...settings };
      
      // Update UI with new settings
      updateUIFromConfig();
      applyLimitsToRotor();
      applyOffsetsToRotor();
      applyScaleFactorsToRotor();
      rotor.setRampSettings(getRampConfigFromState());
      rotor.setSpeed(getSpeedConfigFromState()).catch(err => {
        console.error('[main] Error updating speed after settings sync:', err);
      });
      updateConeSettings();
    }
  });
  
  // Handle route list updates
  wsService.on('route_list_updated', (data) => {
    logAction('WebSocket: Routen-Liste aktualisiert');
    if (routeManager && data.routes) {
      routeManager.setRoutes(data.routes);
    }
  });
  
  // Handle route execution started
  wsService.on('route_execution_started', (data) => {
    logAction('WebSocket: Route gestartet', data);
    if (routeManager && data.routeId) {
      routeManager.setExecutionProgress(data.routeId, {
        type: 'route_started',
        routeName: data.routeName
      });
    }
  });
  
  // Handle route execution progress
  wsService.on('route_execution_progress', (data) => {
    if (routeManager) {
      // Extract route ID from current execution state
      // The server doesn't send routeId in every progress update, so we need to track it
      const executionState = routeManager.executingRouteId;
      if (executionState) {
        routeManager.setExecutionProgress(executionState, data);
      }
    }
    
    // Log significant progress events
    if (data.type === 'step_started' || data.type === 'loop_iteration') {
      logAction('Route-Fortschritt', data);
    }
  });
  
  // Handle route execution stopped
  wsService.on('route_execution_stopped', () => {
    logAction('WebSocket: Route gestoppt');
    if (routeManager) {
      routeManager.clearExecution();
    }
  });
  
  // Handle route execution completed
  wsService.on('route_execution_completed', (data) => {
    logAction('WebSocket: Route abgeschlossen', data);
    if (routeManager) {
      routeManager.clearExecution();
    }
    
    if (data.success) {
      logAction('Route erfolgreich abgeschlossen', { routeId: data.routeId });
    } else {
      logAction('Route mit Fehler beendet', { error: data.error });
      // Show error alert
      if (window.alertModal) {
        window.alertModal.showAlert(`Route-Fehler: ${data.error || 'Unbekannter Fehler'}`);
      }
    }
  });
  
  // Handle suspension
  wsService.on('client_suspended', (data) => {
    if (data.clientId === rotor.getSessionId()) {
      showSuspensionOverlay(data.message);
    }
  });
  
  // Connect to WebSocket server
  wsService.connect();
}

// Suspension overlay handling
function setupSuspensionOverlay() {
  const overlay = document.getElementById('suspensionOverlay');
  const reloadBtn = document.getElementById('suspensionReloadBtn');
  
  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      window.location.reload();
    });
  }
}

function showSuspensionOverlay(message) {
  const overlay = document.getElementById('suspensionOverlay');
  const messageEl = document.getElementById('suspensionMessage');
  
  if (overlay) {
    if (messageEl && message) {
      messageEl.textContent = message;
    }
    overlay.classList.remove('hidden');
    
    // Disable all controls
    controls.setEnabled(false);
    connectBtn.disabled = true;
    disconnectBtn.disabled = true;
    
    logAction('Session suspendiert', { message });
  }
}

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
  updateLimitInputsFromConfig();
  updateSpeedInputsFromConfig();
  updateRampInputsFromConfig();
  updateModeLabel();
  updateConeSettings();
  controls.setPresetControlsVisible(Boolean(config.parkPositionsEnabled));
  
  
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

  // Initialize session with server
  await rotor.initSession();
  
  // Set up WebSocket service
  await setupWebSocket();
  
  // Set up suspension overlay
  setupSuspensionOverlay();

  applyLimitsToRotor();
  applyOffsetsToRotor();
  applyScaleFactorsToRotor();
  rotor.setRampSettings(getRampConfigFromState());
  await rotor.setSpeed(getSpeedConfigFromState());

  if (refreshPortsBtn) {
    refreshPortsBtn.addEventListener('click', () => void refreshPorts());
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
          
          // Separate server settings from regular settings
          const serverSettingsKeys = [
            'serverHttpPort', 'serverWebSocketPort', 'serverPollingIntervalMs',
            'serverSessionTimeoutS', 'serverMaxClients', 'serverLoggingLevel'
          ];
          const serverSettings = {};
          const regularSettings = {};
          
          // Only include server settings that actually changed
          for (const key in newConfig) {
            if (serverSettingsKeys.includes(key)) {
              // Only include if value actually changed
              if (newConfig[key] !== config[key]) {
                serverSettings[key] = newConfig[key];
              }
            } else {
              regularSettings[key] = newConfig[key];
            }
          }
          
          // Save regular settings
          config = await configStore.save(regularSettings);
          
          // Save server settings separately if any were changed
          if (Object.keys(serverSettings).length > 0) {
            try {
              const resp = await fetch(`${rotor.apiBase}/api/server/settings`, {
                method: 'POST',
                headers: rotor.getSessionHeaders(),
                body: JSON.stringify(serverSettings)
              });
              if (resp.ok) {
                const result = await resp.json();
                logAction('Server-Einstellungen gespeichert', serverSettings);
                if (result.restartRequired) {
                  showLimitWarning('Server muss neu gestartet werden, damit Port-Änderungen wirksam werden.');
                }
              } else {
                const error = await resp.json();
                reportError(new Error(`Fehler beim Speichern der Server-Einstellungen: ${error.error || resp.statusText}`));
              }
            } catch (error) {
              reportError(new Error(`Fehler beim Speichern der Server-Einstellungen: ${error.message}`));
            }
          }
          
          // Merge server settings back into config for local cache
          config = { ...config, ...serverSettings };
          
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

  await refreshPorts();
  subscribeToStatus();

  logAction('Initialisierung abgeschlossen');
}

async function refreshPorts() {
  // Prevent multiple simultaneous requests
  if (refreshPortsBtn.disabled) {
    return;
  }

  // Disable button and show loading state
  refreshPortsBtn.disabled = true;
  refreshPortsBtn.classList.add('refreshing');
  
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
    
    // Clear any previous error messages on success
    if (connectionStatus.textContent.startsWith('Fehler:')) {
      connectionStatus.textContent = 'Getrennt';
      connectionStatus.classList.remove('connected');
      connectionStatus.classList.add('disconnected');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logAction('Fehler beim Aktualisieren der Portliste', { error: errorMessage });
    
    // Show user-friendly error message
    if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
      connectionStatus.textContent = 'Fehler: Server nicht erreichbar';
    } else if (errorMessage.includes('Server Error')) {
      connectionStatus.textContent = `Fehler: Server-Fehler (${errorMessage})`;
    } else {
      connectionStatus.textContent = `Fehler: ${errorMessage}`;
    }
    connectionStatus.classList.remove('connected');
    connectionStatus.classList.add('disconnected');
    
    // Also log to console for debugging
    console.error('[refreshPorts] Error:', error);
  } finally {
    // Re-enable button and remove loading state
    refreshPortsBtn.disabled = false;
    refreshPortsBtn.classList.remove('refreshing');
  }
}

async function handleConnect() {
  const baudRate = Number(config.baudRate) || 9600;
  const pollingIntervalMs = Number(config.pollingIntervalMs) || 1000;
  const selectedOption = portSelect.selectedOptions[0];
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
    updateConeSettings(); // Ensure mapView has latest config
    
    config = await configStore.save({
      baudRate,
      pollingIntervalMs,
      portPath: path,
      azimuthMode
    });

    await rotor.connect({ path, baudRate, azimuthMode });
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
  updateConeSettings(); // Ensure mapView has latest config
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
  updateConeSettings(); // Ensure mapView has latest config
  showLimitWarning(`Azimut auf ${value}° referenziert (Offset: ${offset.toFixed(1)}).`);
  logAction('Azimut referenziert', { value, offset });
}

async function handleResetOffsets() {
  config = await configStore.save({ azimuthOffset: 0, elevationOffset: 0 });
  applyOffsetsToRotor();
  updateOffsetInputsFromConfig();
  updateConeSettings(); // Ensure mapView has latest config
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
  const portInfo = portSelect.selectedOptions[0]?.textContent || '';
  let statusText = `Verbunden (${portInfo})`;
  connectionStatus.textContent = statusText;
}

function setConnectionState(state) {
  connected = state;
  logAction('Verbindungsstatus gesetzt', { connected: state });
  controls.setEnabled(state);
  if (routeManager) {
    routeManager.setEnabled(state);
  }
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
  
  // Ensure mapView has current config values before updating
  // This prevents issues where config changes but mapView hasn't been updated yet
  const currentDisplayOffset = Number(config.azimuthDisplayOffset || 0);
  const mapViewDisplayOffset = Number(mapView.azimuthDisplayOffset || 0);
  if (mapViewDisplayOffset !== currentDisplayOffset) {
    updateConeSettings();
  }
  
  if (typeof status.azimuthRaw === 'number') {
    azValue.textContent = `${status.azimuthRaw.toFixed(0)}deg`;
  }
  if (typeof status.elevationRaw === 'number') {
    elValue.textContent = `${status.elevationRaw.toFixed(0)}deg`;
  }
  elevation.update(status.elevation);
  mapView.update(status.azimuth, status.elevation);
  
  const time = new Date(status.timestamp).toLocaleTimeString();
  // "Letzter Status:" zeigt immer die exakten Raw-Werte der Hardware (ohne Offset/Scale)
  const az = typeof status.azimuthRaw === 'number' ? status.azimuthRaw.toFixed(0) : '--';
  const el = typeof status.elevationRaw === 'number' ? status.elevationRaw.toFixed(0) : '--';
  lastStatusValue.textContent = `${time} | Az: ${az}° | El: ${el}°`;
  logAction('Status aktualisiert', { status, display: lastStatusValue.textContent });
  
  if (connected) {
    updateConnectionStatusText();
    connectionStatus.classList.add('connected');
    connectionStatus.classList.remove('disconnected');
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
    updateConeSettings(); // Ensure mapView has latest config

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
  updateConeSettings(); // Ensure mapView has latest config

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

window.addEventListener('beforeunload', () => {
  // Stop polling for this client
  rotor.stopPolling();
  
  // Don't disconnect the COM port - it's shared across all clients
  // The server will handle disconnection when no clients are connected
  
  // Clean up event listeners
  if (unsubscribeStatus) unsubscribeStatus();
  if (typeof unsubscribeError === 'function') unsubscribeError();
  
  // Disconnect WebSocket for this client
  if (wsService) wsService.disconnect();
});
