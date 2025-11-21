const SIMULATED_PORT_ID = 'SIMULATED-ROTOR';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const portIds = new WeakMap();
let portCounter = 0;

function supportsWebSerial() {
  return typeof navigator !== 'undefined' && Boolean(navigator.serial);
}

function formatPortLabel(port, id) {
  if (!port?.getInfo) {
    return `WebSerial ${id}`;
  }
  const info = port.getInfo();
  const vendor =
    info?.usbVendorId != null ? `0x${info.usbVendorId.toString(16).padStart(4, '0').toUpperCase()}` : 'USB';
  const product =
    info?.usbProductId != null ? `0x${info.usbProductId.toString(16).padStart(4, '0').toUpperCase()}` : '';
  if (product) {
    return `Port ${vendor}:${product}`;
  }
  return `Port ${vendor}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrapAzimuth(value, range) {
  return ((value % range) + range) % range;
}

function generateAzimuthCandidates(value, min, max, range) {
  const candidates = [];
  const base = clamp(value, min, max);
  candidates.push(base);
  // Bei 450°-Modus: Erlaube auch Werte über 360°, wenn max >= 450
  const effectiveMax = range === 450 && max >= 450 ? 450 : max;
  const above = base + range;
  const below = base - range;
  if (above <= effectiveMax) {
    candidates.push(above);
  }
  if (below >= min) {
    candidates.push(below);
  }
  return candidates;
}

function shortestAngularDelta(target, current, range) {
  if (typeof target !== 'number' || typeof current !== 'number') {
    return 0;
  }
  if (!range || range <= 0) {
    return target - current;
  }
  let delta = target - current;
  while (delta > range / 2) {
    delta -= range;
  }
  while (delta < -range / 2) {
    delta += range;
  }
  return delta;
}

function computeAzimuthRoute({ current, target, range, min, max }) {
  const clampedCurrent = clamp(current, min, max);
  const clampedTarget = clamp(target, min, max);

  const targetCandidates = generateAzimuthCandidates(clampedTarget, min, max, range);
  const currentCandidates = generateAzimuthCandidates(clampedCurrent, min, max, range);

  let bestTarget = clampedTarget;
  let bestDelta = shortestAngularDelta(clampedTarget, clampedCurrent, range);
  let bestDistance = Math.abs(bestDelta);
  let bestWrap = Math.abs(bestDelta) !== Math.abs(clampedTarget - clampedCurrent) || clampedTarget >= 360;

  targetCandidates.forEach((candidate) => {
    currentCandidates.forEach((currentCandidate) => {
      const normalizedDelta = shortestAngularDelta(candidate, currentCandidate, range);
      const distance = Math.abs(normalizedDelta);
      const wrapUsed =
        Math.abs(normalizedDelta) !== Math.abs(candidate - currentCandidate) ||
        candidate >= 360 ||
        currentCandidate >= 360;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestTarget = candidate;
        bestDelta = normalizedDelta;
        bestWrap = wrapUsed;
      }
    });
  });

  return {
    target: bestTarget,
    delta: bestDelta,
    direction: bestDelta > 0 ? 'CW' : bestDelta < 0 ? 'CCW' : 'HOLD',
    usesWrap: bestWrap
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SerialConnection {
  constructor() {
    this.dataListeners = new Set();
    this.errorListeners = new Set();
  }

  onData(listener) {
    this.dataListeners.add(listener);
  }

  onError(listener) {
    this.errorListeners.add(listener);
  }

  emitData(data) {
    console.log('[RotorService][SerialConnection] Empfangene Daten', { data });
    this.dataListeners.forEach((listener) => listener(data));
  }

  emitError(error) {
    console.error('[RotorService][SerialConnection] Fehler', error);
    this.errorListeners.forEach((listener) => listener(error));
  }
}

class SimulationSerialConnection extends SerialConnection {
  constructor(options = {}) {
    super();
    this.isConnected = false;
    this.azimuthRaw = 0;
    this.elevationRaw = 0;
    this.azDirection = 0;
    this.elDirection = 0;
    this.azTargetRaw = null;
    this.elTargetRaw = null;
    this.modeMaxAz = options.modeMaxAz === 450 ? 450 : 360;
    this.azimuthOffset = 0;
    this.elevationOffset = 0;
    this.azimuthMin = 0;
    this.azimuthMax = this.modeMaxAz;
    this.elevationMin = 0;
    this.elevationMax = 90;
    this.azimuthSpeedDegPerSec = 4;
    this.elevationSpeedDegPerSec = 2;
    this.tickIntervalMs = 500;
    this.azimuthStep = this.calculateStepSize(this.azimuthSpeedDegPerSec);
    this.elevationStep = this.calculateStepSize(this.elevationSpeedDegPerSec);
    this.ticker = null;
  }

  async open(options = {}) {
    if (this.isConnected) {
      return;
    }
    this.isConnected = true;
    this.setMode(options.modeMaxAz ?? this.modeMaxAz);
    console.log('[RotorService][Simulation] Verbunden');
    this.startTicker();
    this.emitStatus();
  }

  setMode(mode) {
    const normalizedMode = mode === 450 ? 450 : 360;
    this.modeMaxAz = normalizedMode;

    const maxRange = normalizedMode === 450 ? 450 : 360;
    this.azimuthMin = clamp(this.azimuthMin, 0, maxRange);
    if (normalizedMode === 450 && this.azimuthMax < maxRange) {
      this.azimuthMax = maxRange;
    } else {
      this.azimuthMax = clamp(this.azimuthMax, this.azimuthMin, maxRange);
    }
    this.azimuthRaw = this.constrainRawAzimuth(this.azimuthRaw, this.azimuthRaw);
  }

  setSoftLimits(limits) {
    if (!limits) {
      return;
    }
    if (typeof limits.azimuthMin === 'number') {
      this.azimuthMin = limits.azimuthMin;
    }
    if (typeof limits.azimuthMax === 'number') {
      this.azimuthMax = limits.azimuthMax;
    }
    if (typeof limits.elevationMin === 'number') {
      this.elevationMin = limits.elevationMin;
    }
    if (typeof limits.elevationMax === 'number') {
      this.elevationMax = limits.elevationMax;
    }

    const maxRange = this.modeMaxAz === 450 ? 450 : 360;
    this.azimuthMin = clamp(this.azimuthMin, 0, maxRange);
    this.azimuthMax = clamp(this.azimuthMax, this.azimuthMin, maxRange);
    this.azimuthRaw = this.constrainRawAzimuth(this.azimuthRaw, this.azimuthRaw);
  }

  setSpeed(settings) {
    if (!settings) {
      return;
    }
    if (typeof settings.azimuthSpeedDegPerSec === 'number') {
      this.azimuthSpeedDegPerSec = clamp(settings.azimuthSpeedDegPerSec, 0.5, 20);
    }
    if (typeof settings.elevationSpeedDegPerSec === 'number') {
      this.elevationSpeedDegPerSec = clamp(settings.elevationSpeedDegPerSec, 0.5, 20);
    }
    this.azimuthStep = this.calculateStepSize(this.azimuthSpeedDegPerSec);
    this.elevationStep = this.calculateStepSize(this.elevationSpeedDegPerSec);
  }

  setCalibrationOffsets(offsets) {
    if (!offsets) {
      return;
    }
    if (typeof offsets.azimuthOffset === 'number') {
      this.azimuthOffset = offsets.azimuthOffset;
    }
    if (typeof offsets.elevationOffset === 'number') {
      this.elevationOffset = offsets.elevationOffset;
    }
  }

  async close() {
    if (this.ticker) {
      clearInterval(this.ticker);
    }
    this.ticker = null;
    this.isConnected = false;
    this.azDirection = 0;
    this.elDirection = 0;
    console.log('[RotorService][Simulation] Verbindung getrennt');
  }

  isOpen() {
    return this.isConnected;
  }

  async writeCommand(command) {
    const normalized = command.trim().toUpperCase();
    console.log('[RotorService][Simulation] Befehl empfangen', { command: normalized });

    if (normalized.startsWith('M')) {
      const value = Number(normalized.slice(1));
      if (!Number.isNaN(value)) {
        // M-Befehl setzt Azimut direkt (wie W, aber nur Azimut)
        this.azTargetRaw = this.planRawAzimuthTarget(value);
        const currentCalibrated = this.getCalibratedAzimuth();
        const targetCalibrated = this.getCalibratedAzimuthFromRaw(this.azTargetRaw);
        const delta = shortestAngularDelta(targetCalibrated, currentCalibrated, this.modeMaxAz);
        if (Math.abs(delta) < 0.1) {
          this.azimuthRaw = this.azTargetRaw;
          this.azTargetRaw = null;
        }
        // Richtung wird im Ticker basierend auf Ziel berechnet
        this.emitStatus();
      }
      return;
    }

    if (normalized.startsWith('W')) {
      const parts = normalized.slice(1).trim().split(/\s+/);
      const az = Number(parts[0]);
      const el = Number(parts[1]);
      // Setze Zielpositionen für graduelle Bewegung
      if (!Number.isNaN(az)) {
        this.azTargetRaw = this.planRawAzimuthTarget(az);
        // Berechne ob bereits am Ziel
        const currentCalibrated = this.getCalibratedAzimuth();
        const targetCalibrated = this.getCalibratedAzimuthFromRaw(this.azTargetRaw);
        const delta = shortestAngularDelta(targetCalibrated, currentCalibrated, this.modeMaxAz);
        if (Math.abs(delta) < 0.1) {
          // Bereits am Ziel, setze sofort
          this.azimuthRaw = this.azTargetRaw;
          this.azTargetRaw = null;
        }
        // Richtung wird im Ticker basierend auf Ziel berechnet
      }
      if (!Number.isNaN(el)) {
        this.elTargetRaw = this.constrainRawElevation(el);
        const delta = this.elTargetRaw - this.elevationRaw;
        if (Math.abs(delta) < 0.1) {
          // Bereits am Ziel, setze sofort
          this.elevationRaw = this.elTargetRaw;
          this.elTargetRaw = null;
        }
        // Richtung wird im Ticker basierend auf Ziel berechnet
      }
      this.emitStatus();
      return;
    }

    if (normalized.startsWith('S') && normalized.length > 1) {
      const value = Number(normalized.slice(1));
      if (!Number.isNaN(value)) {
        this.setSpeed({ azimuthSpeedDegPerSec: value });
      }
      return;
    }

    if (normalized.startsWith('B') && normalized.length > 1) {
      const value = Number(normalized.slice(1));
      if (!Number.isNaN(value)) {
        this.setSpeed({ elevationSpeedDegPerSec: value });
      }
      return;
    }

    switch (normalized) {
      case 'R':
        this.azDirection = 1;
        this.azTargetRaw = null; // Stoppe Zielbewegung bei manueller Steuerung
        break;
      case 'L':
        this.azDirection = -1;
        this.azTargetRaw = null; // Stoppe Zielbewegung bei manueller Steuerung
        break;
      case 'A':
        this.azDirection = 0;
        this.azTargetRaw = null; // Stoppe auch Zielbewegung
        break;
      case 'U':
        this.elDirection = 1;
        this.elTargetRaw = null; // Stoppe Zielbewegung bei manueller Steuerung
        break;
      case 'D':
        this.elDirection = -1;
        this.elTargetRaw = null; // Stoppe Zielbewegung bei manueller Steuerung
        break;
      case 'E':
        this.elDirection = 0;
        this.elTargetRaw = null; // Stoppe auch Zielbewegung
        break;
      case 'S':
        this.azDirection = 0;
        this.elDirection = 0;
        this.azTargetRaw = null; // Stoppe auch Zielbewegungen
        this.elTargetRaw = null;
        break;
      case 'C':
      case 'B':
      case 'C2':
        this.emitStatus();
        break;
      case 'P36':
        this.setMode(360);
        break;
      case 'P45':
        this.setMode(450);
        break;
      default:
        break;
    }
  }

  startTicker() {
    if (this.ticker) {
      clearInterval(this.ticker);
    }
    this.ticker = setInterval(() => {
      let positionChanged = false;
      
      // Bewegung zu Zielpositionen (W-Befehl)
      if (this.azTargetRaw !== null) {
        const currentCalibrated = this.getCalibratedAzimuth();
        const targetCalibrated = this.getCalibratedAzimuthFromRaw(this.azTargetRaw);
        const delta = shortestAngularDelta(targetCalibrated, currentCalibrated, this.modeMaxAz);
        const absDelta = Math.abs(delta);
        
        if (absDelta < 0.1) {
          // Ziel erreicht
          this.azimuthRaw = this.azTargetRaw;
          this.azTargetRaw = null;
          this.azDirection = 0;
          positionChanged = true;
        } else {
          // Bewege in Richtung Ziel
          const step = Math.min(absDelta, this.azimuthStep);
          const direction = delta > 0 ? 1 : -1;
          const candidate = this.azimuthRaw + direction * step;
          this.azimuthRaw = this.constrainRawAzimuth(candidate, this.azimuthRaw);
          positionChanged = true;
        }
      } else if (this.azDirection !== 0) {
        // Manuelle Richtungssteuerung (R/L-Befehle)
        const candidate = this.azimuthRaw + this.azDirection * this.azimuthStep;
        this.azimuthRaw = this.constrainRawAzimuth(candidate, this.azimuthRaw);
        positionChanged = true;
      }
      
      if (this.elTargetRaw !== null) {
        const delta = this.elTargetRaw - this.elevationRaw;
        const absDelta = Math.abs(delta);
        
        if (absDelta < 0.1) {
          // Ziel erreicht
          this.elevationRaw = this.elTargetRaw;
          this.elTargetRaw = null;
          this.elDirection = 0;
          positionChanged = true;
        } else {
          // Bewege in Richtung Ziel
          const step = Math.min(absDelta, this.elevationStep);
          const direction = delta > 0 ? 1 : -1;
          const candidate = this.elevationRaw + direction * step;
          this.elevationRaw = this.constrainRawElevation(candidate);
          positionChanged = true;
        }
      } else if (this.elDirection !== 0) {
        // Manuelle Richtungssteuerung (U/D-Befehle)
        const candidate = this.elevationRaw + this.elDirection * this.elevationStep;
        this.elevationRaw = this.constrainRawElevation(candidate);
        positionChanged = true;
      }
      
      if (positionChanged) {
        this.emitStatus();
      }
    }, this.tickIntervalMs);
  }

  calculateStepSize(degreesPerSecond) {
    return (degreesPerSecond * this.tickIntervalMs) / 1000;
  }

  emitStatus() {
    const az = Math.round(wrapAzimuth(this.azimuthRaw, this.modeMaxAz)).toString().padStart(3, '0');
    const el = Math.round(clamp(this.elevationRaw, 0, this.elevationMax)).toString().padStart(3, '0');
    this.emitData(`AZ=${az} EL=${el}`);
    console.log('[RotorService][Simulation] Status ausgegeben', {
      azimuthRaw: this.azimuthRaw,
      elevationRaw: this.elevationRaw,
      azimuthCalibrated: this.getCalibratedAzimuth(),
      elevationCalibrated: this.getCalibratedElevation(),
      mode: this.modeMaxAz
    });
  }

  getCalibratedAzimuth() {
    return clamp(this.azimuthRaw + this.azimuthOffset, this.azimuthMin, this.azimuthMax);
  }

  getCalibratedElevation() {
    return clamp(this.elevationRaw + this.elevationOffset, this.elevationMin, this.elevationMax);
  }

  getCalibratedAzimuthFromRaw(rawValue) {
    return clamp(rawValue + this.azimuthOffset, this.azimuthMin, this.azimuthMax);
  }

  planRawAzimuthTarget(rawTarget) {
    const currentCalibrated = this.getCalibratedAzimuth();
    const targetCalibrated = clamp(rawTarget + this.azimuthOffset, this.azimuthMin, this.azimuthMax);
    const targetCandidates = generateAzimuthCandidates(
      targetCalibrated,
      this.azimuthMin,
      this.azimuthMax,
      this.modeMaxAz
    );
    const currentCandidates = generateAzimuthCandidates(
      currentCalibrated,
      this.azimuthMin,
      this.azimuthMax,
      this.modeMaxAz
    );

    let bestTarget = targetCalibrated;
    let bestDistance = Number.POSITIVE_INFINITY;
    targetCandidates.forEach((candidate) => {
      currentCandidates.forEach((current) => {
        const distance = Math.abs(candidate - current);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestTarget = candidate;
        }
      });
    });

    const computedRawTarget = bestTarget - this.azimuthOffset;
    return this.constrainRawAzimuth(computedRawTarget, this.azimuthRaw);
  }

  constrainRawAzimuth(rawValue, reference) {
    const calibrated = clamp(rawValue + this.azimuthOffset, this.azimuthMin, this.azimuthMax);
    const unclampedRaw = calibrated - this.azimuthOffset;
    if (typeof reference === 'number') {
      const revolutions = Math.round((reference - unclampedRaw) / this.modeMaxAz);
      return unclampedRaw + revolutions * this.modeMaxAz;
    }
    return unclampedRaw;
  }

  constrainRawElevation(rawValue) {
    const calibrated = clamp(rawValue + this.elevationOffset, this.elevationMin, this.elevationMax);
    const raw = calibrated - this.elevationOffset;
    return clamp(raw, 0, Math.max(this.elevationMax, 90));
  }
}

class ServerConnection extends SerialConnection {
  constructor(apiBase) {
    super();
    this.apiBase = apiBase || (window.location.origin);
    this.isConnected = false;
    this.statusPollTimer = null;
  }

  async open(options) {
    const port = options?.port;
    const baudRate = options?.baudRate || 9600;
    
    if (!port) {
      throw new Error('Port ist erforderlich für Server-Verbindung');
    }

    try {
      const response = await fetch(`${this.apiBase}/api/rotor/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ port, baudRate })
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
          
          // Verbessere Fehlermeldungen für häufige Probleme
          if (errorMessage.includes('PermissionError') || errorMessage.includes('Zugriff verweigert')) {
            errorMessage = `Port kann nicht geöffnet werden: Zugriff verweigert.\n\n` +
                          `Mögliche Ursachen:\n` +
                          `- Port wird bereits von einem anderen Programm verwendet\n` +
                          `- Server hat keine Berechtigung für diesen Port\n` +
                          `- Port existiert nicht mehr\n\n` +
                          `Original-Fehler: ${error.error || errorMessage}`;
          } else if (errorMessage.includes('could not open port')) {
            errorMessage = `Port kann nicht geöffnet werden.\n\n` +
                          `Bitte prüfen Sie auf dem Server-PC:\n` +
                          `- Wird der Port von einem anderen Programm verwendet?\n` +
                          `- Existiert der Port noch?\n` +
                          `- Hat der Server die nötigen Berechtigungen?\n\n` +
                          `Original-Fehler: ${error.error || errorMessage}`;
          }
        } catch (parseError) {
          // Wenn JSON-Parsing fehlschlägt, verwende Status-Text
          try {
            const errorText = await response.text();
            errorMessage = errorText || errorMessage;
          } catch (textError) {
            // Ignoriere Text-Parsing-Fehler
          }
        }
        throw new Error(errorMessage);
      }

      this.isConnected = true;
      console.log('[RotorService][Server] Verbunden', { port, baudRate });
      
      // Starte Status-Polling
      this.startStatusPolling();
    } catch (error) {
      console.error('[RotorService][Server] Verbindungsfehler', error);
      throw error;
    }
  }

  async close() {
    this.isConnected = false;
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }

    try {
      const response = await fetch(`${this.apiBase}/api/rotor/disconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn('[RotorService][Server] Fehler beim Trennen', response.status);
      }
    } catch (error) {
      console.error('[RotorService][Server] Fehler beim Trennen', error);
    }

    console.log('[RotorService][Server] Verbindung getrennt');
  }

  isOpen() {
    return this.isConnected;
  }

  async writeCommand(command) {
    if (!this.isConnected) {
      throw new Error('Nicht mit Server verbunden');
    }

    try {
      const response = await fetch(`${this.apiBase}/api/rotor/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ command })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      console.log('[RotorService][Server] Befehl gesendet', { command });
    } catch (error) {
      console.error('[RotorService][Server] Fehler beim Senden', error);
      throw error;
    }
  }

  startStatusPolling() {
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
    }

    const pollStatus = async () => {
      if (!this.isConnected) {
        return;
      }

      try {
        const response = await fetch(`${this.apiBase}/api/rotor/status`, {
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          return;
        }

        const data = await response.json();
        if (data.connected && data.status) {
          this.emitData(data.status.raw || '');
        }
      } catch (error) {
        console.error('[RotorService][Server] Status-Polling-Fehler', error);
      }
    };

    // Sofort abfragen, dann alle 500ms
    pollStatus();
    this.statusPollTimer = setInterval(pollStatus, 500);
  }
}

class WebSerialConnection extends SerialConnection {
  constructor(port) {
    super();
    this.port = port;
    this.reader = null;
    this.readLoopActive = false;
    this.buffer = '';
  }

  async open(options) {
    if (!this.port) {
      throw new Error('Kein Port-Objekt verfügbar. Bitte Port erneut auswählen.');
    }
    
    // Prüfe, ob Port bereits geöffnet ist
    if (this.port.readable || this.port.writable) {
      console.warn('[RotorService][WebSerial] Port scheint bereits geöffnet zu sein, versuche zu schließen');
      try {
        await this.port.close();
        // Kurze Wartezeit, damit der Port vollständig geschlossen wird
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.warn('[RotorService][WebSerial] Fehler beim Schließen des Ports:', error);
      }
    }
    
    const portOptions = {
      baudRate: options?.baudRate ?? 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      bufferSize: 255
    };
    
    try {
      console.log('[RotorService][WebSerial] Versuche Port zu öffnen', { 
        portOptions,
        portInfo: this.port.getInfo ? this.port.getInfo() : 'keine Info verfügbar'
      });
      await this.port.open(portOptions);
      this.readLoopActive = true;
      console.log('[RotorService][WebSerial] Port erfolgreich geöffnet', { portOptions });
      this.startReadLoop();
    } catch (error) {
      console.error('[RotorService][WebSerial] Fehler beim Öffnen des Ports', { 
        error: error.message,
        errorName: error.name,
        portOptions
      });
      
      // Verbessere Fehlermeldung
      let errorMessage = error.message || 'Unbekannter Fehler';
      if (errorMessage.includes('Failed to open serial port')) {
        errorMessage = `Port kann nicht geöffnet werden.\n\n` +
                      `Mögliche Ursachen:\n` +
                      `- Port wird bereits von einem anderen Programm verwendet\n` +
                      `- Port wurde entfernt oder existiert nicht mehr\n` +
                      `- Gerät ist nicht angeschlossen\n` +
                      `- Browser-Berechtigung wurde widerrufen\n\n` +
                      `Bitte versuchen Sie:\n` +
                      `- Port erneut auswählen (Port hinzufügen)\n` +
                      `- Andere Programme schließen, die den Port verwenden\n` +
                      `- Gerät neu anschließen\n\n` +
                      `Original-Fehler: ${error.message}`;
      }
      throw new Error(errorMessage);
    }
  }

  async close() {
    this.readLoopActive = false;
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch (error) {
        this.emitError(error);
      }
      try {
        this.reader.releaseLock();
      } catch (error) {
        this.emitError(error);
      }
      this.reader = null;
    }
    if (this.port?.readable) {
      try {
        await this.port.close();
      } catch (error) {
        this.emitError(error);
      }
    }
  }

  isOpen() {
    return Boolean(this.port) && this.readLoopActive;
  }

  async writeCommand(command) {
    if (!this.port?.writable) {
      throw new Error('Serial-Port ist nicht geoeffnet.');
    }
    const commandWithCr = command.endsWith('\r') ? command : `${command}\r`;
    const payload = encoder.encode(commandWithCr);
    console.log('[RotorService][WebSerial] Sende Befehl', { 
      command, 
      commandWithCr, 
      payloadLength: payload.length,
      payloadBytes: Array.from(payload).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' ')
    });
    const writer = this.port.writable.getWriter();
    try {
      await writer.ready;
      await writer.write(payload);
      await writer.ready;
      console.log('[RotorService][WebSerial] Befehl erfolgreich gesendet');
    } catch (error) {
      console.error('[RotorService][WebSerial] Fehler beim Senden', error);
      throw error;
    } finally {
      writer.releaseLock();
    }
  }

  async startReadLoop() {
    while (this.readLoopActive && this.port?.readable) {
      this.reader = this.port.readable.getReader();
      try {
        while (this.readLoopActive) {
          const { value, done } = await this.reader.read();
          if (done) {
            break;
          }
          if (value) {
            this.pushChunk(value);
          }
        }
      } catch (error) {
        this.emitError(error);
      } finally {
        if (this.reader) {
          try {
            this.reader.releaseLock();
          } catch (error) {
            this.emitError(error);
          }
          this.reader = null;
        }
      }
    }
  }

  pushChunk(value) {
    this.buffer += decoder.decode(value, { stream: true });
    let delimiterIndex = this.buffer.search(/[\r\n]/);
    while (delimiterIndex >= 0) {
      const line = this.buffer.slice(0, delimiterIndex).trim();
      this.buffer = this.buffer.slice(delimiterIndex + 1);
      if (line) {
        this.emitData(line);
      }
      delimiterIndex = this.buffer.search(/[\r\n]/);
    }
  }
}

class RotorService {
  constructor() {
    this.serial = null;
    this.simulationMode = true;
    this.connectionMode = 'local'; // 'local', 'server', 'simulation'
    this.apiBase = window.location.origin;
    this.maxAzimuthRange = 360;
    this.azimuthOffset = 0;
    this.elevationOffset = 0;
    this.softLimits = {
      azimuthMin: 0,
      azimuthMax: 360,
      elevationMin: 0,
      elevationMax: 90
    };
    this.speedSettings = {
      azimuthSpeedDegPerSec: 4,
      elevationSpeedDegPerSec: 2
    };
    this.rampSettings = {
      rampEnabled: false,
      rampKp: 0.4,
      rampKi: 0.05,
      rampSampleTimeMs: 400,
      rampMaxStepDeg: 8,
      rampToleranceDeg: 1.5,
      rampIntegralLimit: 50
    };
    this.activeRamp = null;
    this.pollingTimer = null;
    this.currentStatus = null;
    this.statusListeners = new Set();
    this.errorListeners = new Set();
    this.portRegistry = new Map();
  }

  supportsWebSerial() {
    return supportsWebSerial();
  }

  async listPorts() {
    const ports = [];
    
    // Server-Ports nur abrufen, wenn nicht im file:// Protokoll (also http/https)
    // Im file:// Protokoll funktioniert fetch nicht und wir sind im lokalen Modus
    const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';
    
    if (!isFileProtocol) {
      // Server-Ports abrufen (nur wenn über http/https)
      console.log('[RotorService] Starte Server-Ports Abfrage', { 
        apiBase: this.apiBase, 
        url: `${this.apiBase}/api/rotor/ports`,
        protocol: window.location.protocol
      });
      
      try {
      const response = await fetch(`${this.apiBase}/api/rotor/ports`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
        
        console.log('[RotorService] Server-Antwort erhalten', { 
          status: response.status, 
          statusText: response.statusText,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries())
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('[RotorService] Server-Antwort Daten:', data);
          
          if (data.ports && Array.isArray(data.ports)) {
            console.log('[RotorService] Verarbeite Server-Ports', { count: data.ports.length, ports: data.ports });
            data.ports.forEach((port) => {
              const portEntry = {
                path: port.path,
                friendlyName: port.friendlyName || port.path,
                simulated: false,
                serverPort: true
              };
              console.log('[RotorService] Füge Server-Port hinzu:', portEntry);
              ports.push(portEntry);
            });
            console.log('[RotorService] Server-Ports erfolgreich abgerufen', { count: data.ports.length, totalPorts: ports.length });
          } else {
            console.warn('[RotorService] Keine Ports in Antwort oder falsches Format', { data });
          }
        } else {
          const errorText = await response.text();
          console.error('[RotorService] Server-Ports Anfrage fehlgeschlagen', { 
            status: response.status, 
            statusText: response.statusText,
            error: errorText 
          });
        }
      } catch (error) {
        // Nur warnen, nicht als Fehler behandeln - im lokalen Modus ist das normal
        console.warn('[RotorService] Konnte Server-Ports nicht abrufen (normal im lokalen Modus)', { 
          error: error.message,
          apiBase: this.apiBase,
          protocol: window.location.protocol
        });
      }
    } else {
      console.log('[RotorService] Überspringe Server-Ports Abfrage (file:// Protokoll - lokaler Modus)');
    }
    
    // Web Serial Ports (nur wenn verfügbar)
    if (supportsWebSerial()) {
      const grantedPorts = await navigator.serial.getPorts();
      grantedPorts.forEach((port) => {
        const id = this.ensurePortId(port);
        this.portRegistry.set(id, port);
        ports.push({
          path: id,
          friendlyName: formatPortLabel(port, id),
          simulated: false,
          serverPort: false
        });
      });
    }
    
    console.log('[RotorService] Gefundene Ports', { ports: ports.map((port) => ({ ...port })) });
    ports.push({
      path: SIMULATED_PORT_ID,
      friendlyName: 'Simulierter Rotor',
      simulated: true,
      serverPort: false
    });
    return ports;
  }

  async requestPortAccess() {
    if (!supportsWebSerial()) {
      throw new Error(
        'Web Serial wird von diesem Browser oder Kontext nicht unterstützt. Verwende eine aktuelle Chromium-Variante über HTTPS oder localhost.'
      );
    }
    const port = await navigator.serial.requestPort();
    const id = this.ensurePortId(port);
    this.portRegistry.set(id, port);
    console.log('[RotorService] Zugriff auf neuen Port gewährt', { id });
    return { path: id, friendlyName: formatPortLabel(port, id) };
  }

  async connect(config) {
    const requestedMode = Number(config.azimuthMode) === 450 ? 450 : 360;
    const useSimulation =
      Boolean(config.simulation) || config.path === SIMULATED_PORT_ID;
    const useServer = Boolean(config.useServer) || (config.path && !useSimulation && !supportsWebSerial());

    console.log('[RotorService] Verbindungsaufbau gestartet', { config, useSimulation, useServer });
    await this.disconnect();
    this.maxAzimuthRange = requestedMode;
    this.currentStatus = null;

    if (useSimulation) {
      this.simulationMode = true;
      this.connectionMode = 'simulation';
      this.serial = new SimulationSerialConnection({ modeMaxAz: requestedMode });
    } else if (useServer) {
      this.simulationMode = false;
      this.connectionMode = 'server';
      this.serial = new ServerConnection(this.apiBase);
    } else {
      const port = this.portRegistry.get(config.path);
      if (!port) {
        console.error('[RotorService] Port nicht im Registry gefunden', { 
          path: config.path,
          registryKeys: Array.from(this.portRegistry.keys())
        });
        throw new Error('Der ausgewaehlte Port ist nicht mehr verfügbar.\n\n' +
                       'Bitte:\n' +
                       '1. Klicken Sie auf "Port hinzufügen"\n' +
                       '2. Wählen Sie den Port erneut aus\n' +
                       '3. Versuchen Sie erneut zu verbinden');
      }
      console.log('[RotorService] Verwende Web Serial Port', { 
        path: config.path,
        portInfo: port.getInfo ? port.getInfo() : 'keine Info verfügbar'
      });
      this.simulationMode = false;
      this.connectionMode = 'local';
      this.serial = new WebSerialConnection(port);
    }

    this.serial.onData((line) => this.handleSerialLine(line));
    this.serial.onError((error) => this.emitError(error));

    if (useServer) {
      await this.serial.open({ port: config.path, baudRate: config.baudRate });
    } else {
      await this.serial.open({ baudRate: config.baudRate, modeMaxAz: requestedMode });
    }
    
    this.applySoftLimitConfig();
    this.applyCalibrationOffsets();
    await this.applySpeedSettings();
    console.log('[RotorService] Verbindung hergestellt', { mode: this.connectionMode });
  }

  async disconnect() {
    this.stopPolling();
    this.cancelActiveRamp();
    if (this.serial) {
      try {
        await this.serial.close();
      } catch (error) {
        this.emitError(error);
      }
    }
    console.log('[RotorService] Verbindung geschlossen');
    this.serial = null;
  }

  async control(command) {
    console.log('[RotorService] Steuerbefehl', { command });
    await this.sendRawCommand(command);
  }

  async sendRawCommand(command) {
    if (!this.serial || !this.serial.isOpen()) {
      throw new Error('Rotor ist nicht verbunden.');
    }
    console.log('[RotorService] Rohbefehl senden', { command });
    // Für Befehle mit Leerzeichen (wie "W123 045") trim nur am Anfang/Ende, nicht in der Mitte
    const trimmed = command.trim();
    const upperCased = trimmed.toUpperCase();
    // GS-232B-Protokoll erfordert ein abschließendes Carriage Return
    const commandWithCr = upperCased.endsWith('\r') ? upperCased : `${upperCased}\r`;
    await this.serial.writeCommand(commandWithCr);
    // Kleine Verzögerung, damit der Controller Zeit hat, den Befehl zu verarbeiten
    await delay(10);
  }

  async setAzimuth(target) {
    const rampSettings = this.getRampSettings();
    if (rampSettings.rampEnabled) {
      await this.executeRamp({ az: target });
      return;
    }
    const plan = this.planAzimuthTarget(target);
    const value = Math.round(plan.commandValue).toString().padStart(3, '0');
    console.log('[RotorService] Azimut setzen', { target, plan, value });
    await this.sendRawCommand(`M${value}`);
  }

  async setAzEl({ az, el }) {
    const rampSettings = this.getRampSettings();
    if (rampSettings.rampEnabled) {
      await this.executeRamp({ az, el });
      return;
    }
    const azPlan = this.planAzimuthTarget(az);
    const elPlan = this.planElevationTarget(el);
    const azValue = Math.round(azPlan.commandValue).toString().padStart(3, '0');
    const elValue = Math.round(elPlan.commandValue).toString().padStart(3, '0');
    console.log('[RotorService] Azimut/Elevation setzen', { az, el, azPlan, elPlan, azValue, elValue });
    await this.sendRawCommand(`W${azValue} ${elValue}`);
  }

  async executeRamp(targets) {
    if (!this.serial || !this.serial.isOpen()) {
      throw new Error('Rotor ist nicht verbunden.');
    }
    const rampSettings = this.getRampSettings();
    const hasAz = typeof targets.az === 'number' && !Number.isNaN(targets.az);
    const hasEl = typeof targets.el === 'number' && !Number.isNaN(targets.el);
    if (!hasAz && !hasEl) {
      return;
    }

    // Warte auf ersten Status-Update, falls noch keiner vorhanden ist
    // (maximal 2 Sekunden, dann verwende direkten Befehl als Fallback)
    if (!this.currentStatus) {
      let waited = 0;
      const maxWaitMs = 2000;
      const checkInterval = 50;
      while (!this.currentStatus && waited < maxWaitMs) {
        await delay(checkInterval);
        waited += checkInterval;
      }
      // Wenn nach Wartezeit immer noch kein Status vorhanden, direkten Befehl senden
      if (!this.currentStatus) {
        await this.sendPlannedTarget(targets.az, targets.el);
        return;
      }
    }

    this.cancelActiveRamp();
    const rampContext = { cancelled: false };
    this.activeRamp = rampContext;

    const azGoal = hasAz ? this.planAzimuthTarget(targets.az).calibrated : null;
    const elGoal = hasEl ? this.planElevationTarget(targets.el).calibrated : null;
    let azIntegral = 0;
    let elIntegral = 0;
    const dtSeconds = rampSettings.rampSampleTimeMs / 1000;

    const computeEasedStep = (error, integral) => {
      const nextIntegral = clamp(
        integral + error * dtSeconds,
        -rampSettings.rampIntegralLimit,
        rampSettings.rampIntegralLimit
      );
      const rawOutput = rampSettings.rampKp * error + rampSettings.rampKi * nextIntegral;
      const limitedOutput = clamp(rawOutput, -rampSettings.rampMaxStepDeg, rampSettings.rampMaxStepDeg);

      // Reduce step size when starting or approaching the goal for a softer motion
      const envelope = Math.min(1, Math.abs(error) / (rampSettings.rampMaxStepDeg * 2));
      const easedOutput = limitedOutput * Math.max(0.15, envelope);

      return { step: easedOutput, nextIntegral };
    };

    while (!rampContext.cancelled) {
      const status = this.currentStatus;
      if (!status) {
        await this.sendPlannedTarget(targets.az, targets.el);
        break;
      }

      const azError = hasAz && typeof status.azimuth === 'number'
        ? shortestAngularDelta(azGoal, status.azimuth, this.maxAzimuthRange)
        : 0;
      const elError = hasEl && typeof status.elevation === 'number' ? elGoal - status.elevation : 0;

      const azDone = !hasAz || Math.abs(azError) <= rampSettings.rampToleranceDeg;
      const elDone = !hasEl || Math.abs(elError) <= rampSettings.rampToleranceDeg;

      if (azDone && elDone) {
        await this.sendPlannedTarget(targets.az, targets.el);
        break;
      }

      let nextAz = hasAz ? status.azimuth : null;
      if (!azDone && hasAz && typeof status.azimuth === 'number') {
        const { step, nextIntegral } = computeEasedStep(azError, azIntegral);
        azIntegral = nextIntegral;
        nextAz = clamp(status.azimuth + step, this.softLimits.azimuthMin, this.softLimits.azimuthMax);
      }

      let nextEl = hasEl ? status.elevation : null;
      if (!elDone && hasEl && typeof status.elevation === 'number') {
        const { step, nextIntegral } = computeEasedStep(elError, elIntegral);
        elIntegral = nextIntegral;
        nextEl = clamp(status.elevation + step, this.softLimits.elevationMin, this.softLimits.elevationMax);
      }

      await this.sendPlannedTarget(nextAz, nextEl);
      await delay(rampSettings.rampSampleTimeMs);
    }

    if (this.activeRamp === rampContext) {
      this.activeRamp = null;
    }
  }

  cancelActiveRamp() {
    if (this.activeRamp) {
      this.activeRamp.cancelled = true;
      this.activeRamp = null;
    }
  }

  async sendPlannedTarget(azimuth, elevation) {
    const azPlan = typeof azimuth === 'number' && !Number.isNaN(azimuth) ? this.planAzimuthTarget(azimuth) : null;
    const elPlan =
      typeof elevation === 'number' && !Number.isNaN(elevation) ? this.planElevationTarget(elevation) : null;

    if (azPlan && elPlan) {
      const azValue = Math.round(azPlan.commandValue).toString().padStart(3, '0');
      const elValue = Math.round(elPlan.commandValue).toString().padStart(3, '0');
      console.log('[RotorService] PI-Rampe Schritt (Az+El)', { azimuth, elevation, azPlan, elPlan, azValue, elValue });
      await this.sendRawCommand(`W${azValue} ${elValue}`);
      return;
    }

    if (azPlan) {
      const azValue = Math.round(azPlan.commandValue).toString().padStart(3, '0');
      console.log('[RotorService] PI-Rampe Schritt (Az)', { azimuth, azPlan, azValue });
      await this.sendRawCommand(`M${azValue}`);
      return;
    }

    if (elPlan) {
      const currentAzRaw = typeof this.currentStatus?.azimuthRaw === 'number'
        ? Math.round(this.currentStatus.azimuthRaw).toString().padStart(3, '0')
        : '000';
      const elValue = Math.round(elPlan.commandValue).toString().padStart(3, '0');
      console.log('[RotorService] PI-Rampe Schritt (El)', { elevation, elPlan, elValue, currentAzRaw });
      await this.sendRawCommand(`W${currentAzRaw} ${elValue}`);
    }
  }

  async setMode(mode) {
    this.maxAzimuthRange = mode === 450 ? 450 : 360;
    console.log('[RotorService] Modus setzen', { mode: this.maxAzimuthRange });
    await this.sendRawCommand(mode === 450 ? 'P45' : 'P36');
    
    // Bei 450°-Modus: Erweitere Soft-Limits automatisch auf 0-450, wenn sie noch auf 0-360 stehen
    if (mode === 450 && this.softLimits.azimuthMax <= 360) {
      this.softLimits.azimuthMax = 450;
      console.log('[RotorService] Soft-Limits automatisch auf 0-450 erweitert');
    }
    // Bei 360°-Modus: Begrenze Soft-Limits auf 0-360, wenn sie darüber liegen
    else if (mode === 360 && this.softLimits.azimuthMax > 360) {
      this.softLimits.azimuthMax = 360;
      console.log('[RotorService] Soft-Limits automatisch auf 0-360 begrenzt');
    }
    
    this.applySoftLimitConfig();
  }

  async setSpeed(settings) {
    if (!settings) {
      return;
    }
    const nextSettings = { ...this.speedSettings };
    if (typeof settings.azimuthSpeedDegPerSec === 'number' && !Number.isNaN(settings.azimuthSpeedDegPerSec)) {
      nextSettings.azimuthSpeedDegPerSec = clamp(settings.azimuthSpeedDegPerSec, 0.5, 20);
    }
    if (typeof settings.elevationSpeedDegPerSec === 'number' && !Number.isNaN(settings.elevationSpeedDegPerSec)) {
      nextSettings.elevationSpeedDegPerSec = clamp(settings.elevationSpeedDegPerSec, 0.5, 20);
    }
    this.speedSettings = nextSettings;
    await this.applySpeedSettings();
  }

  setRampSettings(settings) {
    if (!settings) {
      return;
    }
    const sanitized = this.getRampSettings(settings);
    this.rampSettings = sanitized;
  }

  setSoftLimits(limits) {
    if (!limits) {
      return;
    }
    const nextLimits = { ...this.softLimits };
    if (typeof limits.azimuthMin === 'number') {
      nextLimits.azimuthMin = limits.azimuthMin;
    }
    if (typeof limits.azimuthMax === 'number') {
      nextLimits.azimuthMax = limits.azimuthMax;
    }
    if (typeof limits.elevationMin === 'number') {
      nextLimits.elevationMin = limits.elevationMin;
    }
    if (typeof limits.elevationMax === 'number') {
      nextLimits.elevationMax = limits.elevationMax;
    }
    if (nextLimits.azimuthMax < nextLimits.azimuthMin) {
      throw new Error('Azimut-Maximum muss groesser als Minimum sein.');
    }
    if (nextLimits.elevationMax < nextLimits.elevationMin) {
      throw new Error('Elevation-Maximum muss groesser als Minimum sein.');
    }
    this.softLimits = nextLimits;
    this.applySoftLimitConfig();
  }

  setCalibrationOffsets(offsets) {
    if (!offsets) {
      return;
    }
    if (typeof offsets.azimuthOffset === 'number') {
      this.azimuthOffset = offsets.azimuthOffset;
    }
    if (typeof offsets.elevationOffset === 'number') {
      this.elevationOffset = offsets.elevationOffset;
    }
    this.applyCalibrationOffsets();
  }

  startPolling(intervalMs = 1000) {
    this.stopPolling();
    if (!this.serial || !this.serial.isOpen()) {
      return;
    }
    console.log('[RotorService] Starte Polling', { intervalMs });
    this.pollingTimer = setInterval(() => {
      this.sendRawCommand('C2').catch((error) => this.emitError(error));
    }, intervalMs);
    this.sendRawCommand('C2').catch((error) => this.emitError(error));
  }

  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
      console.log('[RotorService] Polling gestoppt');
    }
  }

  onStatusUpdate(listener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onError(listener) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  getCurrentStatus() {
    return this.currentStatus;
  }

  handleSerialLine(line) {
    console.log('[RotorService] Zeile vom Rotor empfangen', { line });
    const status = {
      raw: line,
      timestamp: Date.now()
    };
    const azMatch = line.match(/AZ\s*=\s*(\d+)/i);
    if (azMatch) {
      status.azimuthRaw = Number(azMatch[1]);
      status.azimuth = this.normalizeAzimuth(status.azimuthRaw);
    }
    const elMatch = line.match(/EL\s*=\s*(\d+)/i);
    if (elMatch) {
      status.elevationRaw = Number(elMatch[1]);
      status.elevation = this.normalizeElevation(status.elevationRaw);
    }
    console.log('[RotorService] Verarbeiteter Status', status);
    this.currentStatus = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  emitError(error) {
    if (!error) {
      return;
    }
    console.error('[RotorService] Weitergeleiteter Fehler', error);
    this.errorListeners.forEach((listener) => listener(error));
  }

  applySoftLimitConfig() {
    if (this.serial instanceof SimulationSerialConnection) {
      this.serial.setSoftLimits(this.softLimits);
    }
  }

  applyCalibrationOffsets() {
    if (this.serial instanceof SimulationSerialConnection) {
      this.serial.setCalibrationOffsets({
        azimuthOffset: this.azimuthOffset,
        elevationOffset: this.elevationOffset
      });
    }
  }

  async applySpeedSettings() {
    if (!this.serial || !this.serial.isOpen()) {
      return;
    }
    if (this.serial instanceof SimulationSerialConnection) {
      this.serial.setSpeed(this.speedSettings);
      return;
    }

    const commands = [];
    if (typeof this.speedSettings.azimuthSpeedDegPerSec === 'number') {
      const value = Math.round(this.speedSettings.azimuthSpeedDegPerSec).toString().padStart(3, '0');
      commands.push(`S${value}`);
    }
    if (typeof this.speedSettings.elevationSpeedDegPerSec === 'number') {
      const value = Math.round(this.speedSettings.elevationSpeedDegPerSec).toString().padStart(3, '0');
      commands.push(`B${value}`);
    }

    for (const command of commands) {
      await this.sendRawCommand(command);
    }
  }

  normalizeAzimuth(value) {
    return clamp(value + this.azimuthOffset, this.softLimits.azimuthMin, this.softLimits.azimuthMax);
  }

  normalizeElevation(value) {
    return clamp(value + this.elevationOffset, this.softLimits.elevationMin, this.softLimits.elevationMax);
  }

  planAzimuthTarget(target) {
    const range = this.maxAzimuthRange;
    // Bei 450°-Modus: Erlaube Werte über 360°, wenn sie innerhalb des Bereichs liegen
    const effectiveMax = range === 450 ? Math.max(this.softLimits.azimuthMax, 450) : this.softLimits.azimuthMax;
    const clampedTarget = clamp(target, this.softLimits.azimuthMin, effectiveMax);
    const current = typeof this.currentStatus?.azimuth === 'number' ? this.currentStatus.azimuth : clampedTarget;

    const route = computeAzimuthRoute({
      current,
      target: clampedTarget,
      range,
      min: this.softLimits.azimuthMin,
      max: effectiveMax
    });

    const rawCommand = route.target - this.azimuthOffset;
    return {
      calibrated: route.target,
      commandValue: wrapAzimuth(rawCommand, range),
      direction: route.direction,
      usesWrap: route.usesWrap
    };
  }

  planElevationTarget(target) {
    const calibrated = clamp(target, this.softLimits.elevationMin, this.softLimits.elevationMax);
    const rawCommand = clamp(calibrated - this.elevationOffset, 0, Math.max(this.softLimits.elevationMax, 90));
    return {
      calibrated,
      commandValue: rawCommand
    };
  }

  getRampSettings(overrides = {}) {
    const next = { ...this.rampSettings, ...overrides };
    const clampNumber = (value, min, max, fallback) => {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return fallback;
      }
      return clamp(value, min, max);
    };
    return {
      rampEnabled: Boolean(next.rampEnabled),
      rampKp: clampNumber(next.rampKp, 0, 5, this.rampSettings.rampKp),
      rampKi: clampNumber(next.rampKi, 0, 5, this.rampSettings.rampKi),
      rampSampleTimeMs: clampNumber(next.rampSampleTimeMs, 100, 2000, this.rampSettings.rampSampleTimeMs),
      rampMaxStepDeg: clampNumber(next.rampMaxStepDeg, 0.1, 45, this.rampSettings.rampMaxStepDeg),
      rampToleranceDeg: clampNumber(next.rampToleranceDeg, 0.1, 10, this.rampSettings.rampToleranceDeg),
      rampIntegralLimit: clampNumber(next.rampIntegralLimit, 1, 200, this.rampSettings.rampIntegralLimit)
    };
  }

  ensurePortId(port) {
    let id = portIds.get(port);
    if (!id) {
      portCounter += 1;
      id = `web-${portCounter}`;
      portIds.set(port, id);
    }
    return id;
  }
}

function createRotorService() {
  return new RotorService();
}

// Export for tests (ignored in browser context)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SimulationSerialConnection,
    RotorService,
    shortestAngularDelta,
    wrapAzimuth,
    clamp,
    generateAzimuthCandidates,
    computeAzimuthRoute
  };
}
