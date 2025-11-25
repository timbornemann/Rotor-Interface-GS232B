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
        // Verwende shortestAngularDelta für korrekte Berechnung der kürzesten Distanz
        const delta = shortestAngularDelta(candidate, current, this.modeMaxAz);
        const distance = Math.abs(delta);
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
    this.clientCount = 0; // Anzahl der verbundenen Clients
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
        
        // Speichere Client-Anzahl
        if (typeof data.clientCount === 'number') {
          this.clientCount = data.clientCount;
        }
        
        if (data.connected && data.status) {
          const status = data.status;
          // Konvertiere neue API-Struktur in das erwartete Format
          // Die neue API hat: rawLine, rph, calibrated, calibration
          // handleSerialLine erwartet eine Zeile im Format "AZ=xxx EL=xxx" mit RPH-Werten (roh)
          // handleSerialLine wird dann normalizeAzimuth/normalizeElevation aufrufen,
          // die die Kalibrierung (Offset + ScaleFactor) anwenden
          
          // Verwende RPH-Werte (roh) für die Zeile, damit handleSerialLine die Kalibrierung korrekt anwenden kann
          const azimuthRaw = status.rph?.azimuth ?? null;
          const elevationRaw = status.rph?.elevation ?? null;
          
          console.log('[RotorService][Server] Status-Daten empfangen', {
            rawLine: status.rawLine,
            azimuthRaw,
            elevationRaw,
            status
          });
          
          // Erstelle Zeile mit RPH-Werten (roh)
          // Normalisiere rawLine: entferne doppelte Leerzeichen und trim
          let lineToEmit = (status.rawLine || '').trim().replace(/\s+/g, ' ');
          
          // Wenn rawLine leer ist oder kein gültiges Format hat, erstelle aus RPH-Werten
          if (!lineToEmit || (!lineToEmit.match(/AZ\s*=\s*\d+/i) && azimuthRaw !== null && elevationRaw !== null)) {
            if (azimuthRaw !== null && elevationRaw !== null) {
              // Erstelle Zeile mit RPH-Werten im Standard-Format
              lineToEmit = `AZ=${Math.round(azimuthRaw)} EL=${String(Math.round(elevationRaw)).padStart(3, '0')}`;
              console.log('[RotorService][Server] Erstellte Zeile aus RPH-Werten', { lineToEmit });
            }
          } else {
            console.log('[RotorService][Server] Verwende rawLine', { lineToEmit });
          }
          
          // Emit als rohe Zeile, handleSerialLine wird sie parsen und normalisieren
          // (normalizeAzimuth/normalizeElevation wenden die Kalibrierung an)
          if (lineToEmit) {
            console.log('[RotorService][Server] Emit Daten', { lineToEmit });
            this.emitData(lineToEmit);
          } else {
            console.warn('[RotorService][Server] Keine Daten zum Emit', {
              rawLine: status.rawLine,
              azimuthRaw,
              elevationRaw
            });
          }
        } else {
          console.log('[RotorService][Server] Kein Status verfügbar', {
            connected: data.connected,
            hasStatus: !!data.status
          });
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
    this.azimuthScaleFactor = 1.0; // Skalierungsfaktor für Azimut (z.B. 0.5 wenn Motor doppelt so weit dreht)
    this.elevationScaleFactor = 1.0; // Skalierungsfaktor für Elevation
    this.softLimits = {
      azimuthMin: 0,
      azimuthMax: 360,
      elevationMin: 0,
      elevationMax: 90
    };
    this.speedSettings = {
      azimuthSpeedDegPerSec: 4,
      elevationSpeedDegPerSec: 2,
      azimuthLowSpeedStage: 3,
      azimuthHighSpeedStage: 4,
      elevationLowSpeedStage: 3,
      elevationHighSpeedStage: 4,
      azimuthSpeedAngleCode: 3,
      elevationSpeedAngleCode: 3
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
    this.activeManualRamp = null; // Für manuelle Steuerung (R/L/U/D)
    this.manualStopPosition = null; // Position beim Stoppen für Rückkehr
    this.manualDirection = null; // Aktuelle Bewegungsrichtung ('R', 'L', 'U', 'D')
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
    this.cancelActiveManualRamp();
    if (this.serial) {
      try {
        await this.serial.close();
      } catch (error) {
        this.emitError(error);
      }
    }
    console.log('[RotorService] Verbindung geschlossen');
    this.serial = null;
    this.manualStopPosition = null;
    this.manualDirection = null;
  }

  async control(command) {
    console.log('[RotorService] Steuerbefehl', { command });
    const normalized = command.trim().toUpperCase();
    const rampSettings = this.getRampSettings();
    
    // Wenn Softstart/Softstop aktiviert ist, verwende Ramp-Funktionen
    if (rampSettings.rampEnabled) {
      // Start-Befehle: R, L, U, D
      if (normalized === 'R' || normalized === 'L' || normalized === 'U' || normalized === 'D') {
        await this.executeManualRamp(normalized);
        return;
      }
      // Stopp-Befehle: A, E, S
      if (normalized === 'A' || normalized === 'E' || normalized === 'S') {
        await this.executeManualStop(normalized);
        return;
      }
    }
    
    // Für alle anderen Befehle oder wenn Softstart/Softstop deaktiviert ist
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
    // Verzögerung basierend auf Befehlstyp:
    // - ERC-DUO API-Befehle (sSL1, sSH1, etc.): 100ms (benötigen mehr Zeit)
    // - Positionsbefehle (M, W): 100ms (wichtig für Hardware)
    // - Andere Befehle: 20ms (Standard)
    const isERCAPICommand = /^s[A-Z]{2}\d/.test(upperCased); // sSL1, sSH1, etc.
    const isSpeedCommand = /^[SB]\d+/.test(upperCased);
    const isPositionCommand = /^[MW]/.test(upperCased);
    const delayMs = isERCAPICommand ? 100 : (isSpeedCommand || isPositionCommand ? 100 : 20);
    await delay(delayMs);
  }

  async setAzimuth(target) {
    const rampSettings = this.getRampSettings();
    if (rampSettings.rampEnabled) {
      await this.executeRamp({ az: target });
      return;
    }
    // ERC-DUO: Geschwindigkeitseinstellungen werden nicht vor jeder Bewegung neu gesetzt
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
    // ERC-DUO: Geschwindigkeitseinstellungen werden nicht vor jeder Bewegung neu gesetzt
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

    // ERC-DUO: Softstart/Softstop ist bereits eingebaut!
    // ERC-DUO startet bei Low-Speed, wechselt nach Speed-Angle (z.B. 30°) zu High-Speed,
    // und 30° vor dem Ziel zurück zu Low-Speed
    // Zusätzlich gibt es einen Delay before move (sDM1, sDM2) für Softstart
    // 
    // Wenn Softstart/Softstop aktiviert ist, senden wir einfach das Ziel und ERC-DUO
    // macht den Rest automatisch. Wir müssen keine Positionsschritte simulieren.
    
    if (rampSettings.rampEnabled) {
      // ERC-DUO macht Softstart/Softstop automatisch
      // Sende einfach das Ziel und ERC-DUO übernimmt die sanfte Bewegung
      await this.sendPlannedTarget(targets.az, targets.el);
      return;
    }
    
    // Wenn Softstart/Softstop deaktiviert ist, sende direkt das Ziel
    await this.sendPlannedTarget(targets.az, targets.el);
  }

  cancelActiveRamp() {
    if (this.activeRamp) {
      this.activeRamp.cancelled = true;
      this.activeRamp = null;
    }
  }

  cancelActiveManualRamp() {
    if (this.activeManualRamp) {
      this.activeManualRamp.cancelled = true;
      this.activeManualRamp = null;
    }
  }

  async executeManualRamp(direction) {
    // direction: 'R' (rechts), 'L' (links), 'U' (hoch), 'D' (runter)
    if (!this.serial || !this.serial.isOpen()) {
      throw new Error('Rotor ist nicht verbunden.');
    }
    const rampSettings = this.getRampSettings();
    if (!rampSettings.rampEnabled) {
      // Wenn Softstart/Softstop deaktiviert, direkten Befehl senden
      await this.sendRawCommand(direction);
      return;
    }

    // ERC-DUO: Für manuelle Steuerung (R/L/U/D) können wir die eingebauten
    // Softstart/Softstop-Features nicht direkt nutzen, da diese nur für
    // Positionsbefehle (M, W) gelten. Für manuelle Steuerung verwenden wir
    // weiterhin Positionsschritte, aber ERC-DUO's Delay (sDM1, sDM2) hilft
    // beim Softstart.

    // Speichere nur die Richtung beim Start, Position wird beim Stoppen gespeichert
    this.manualDirection = direction; // Speichere aktuelle Richtung

    this.cancelActiveManualRamp();
    const rampContext = { cancelled: false };
    this.activeManualRamp = rampContext;

    const isAzimuth = direction === 'R' || direction === 'L';
    const isElevation = direction === 'U' || direction === 'D';
    const stepDirection = direction === 'R' || direction === 'U' ? 1 : -1;

    let speedFactor = 0.2; // Start mit 20% Geschwindigkeit
    let timeSinceStart = 0;
    const rampUpTimeMs = 2000; // 2 Sekunden zum Aufbauen auf volle Geschwindigkeit
    const dtSeconds = rampSettings.rampSampleTimeMs / 1000;

    while (!rampContext.cancelled) {
      const status = this.currentStatus;
      if (!status) {
        await this.sendRawCommand(direction);
        break;
      }

      // Berechne Geschwindigkeitsfaktor basierend auf Zeit seit Start
      if (timeSinceStart < rampUpTimeMs) {
        // Linearer Anstieg von 0.2 auf 1.0 über rampUpTimeMs
        speedFactor = 0.2 + (timeSinceStart / rampUpTimeMs) * 0.8;
      } else {
        speedFactor = 1.0; // Volle Geschwindigkeit
      }

      // Berechne Schritt basierend auf Geschwindigkeitsfaktor
      const baseStep = isAzimuth 
        ? this.speedSettings.azimuthSpeedDegPerSec * dtSeconds
        : this.speedSettings.elevationSpeedDegPerSec * dtSeconds;
      const step = baseStep * speedFactor * stepDirection;

      // Berechne neue Position
      let nextAz = status.azimuth;
      let nextEl = status.elevation;

      if (isAzimuth && typeof status.azimuth === 'number') {
        // Berechne neue Position direkt, ohne planAzimuthTarget zu verwenden
        // um die Richtung beizubehalten
        nextAz = status.azimuth + step;
        
        // Prüfe Limits und handle Wrap-around korrekt
        if (nextAz < this.softLimits.azimuthMin) {
          if (this.maxAzimuthRange === 450 && nextAz < 0) {
            // Bei 450°-Modus: Wrap-around erlauben
            // Für Links-Bewegung: wenn wir unter 0 gehen, addiere 450
            if (stepDirection < 0) {
              nextAz = nextAz + this.maxAzimuthRange;
            } else {
              // Nach rechts, aber unter Minimum -> Limit erreicht
              break;
            }
            // Prüfe ob innerhalb der Limits nach Wrap-around
            if (nextAz < this.softLimits.azimuthMin || nextAz > this.softLimits.azimuthMax) {
              break;
            }
          } else {
            // Limit erreicht, stoppe
            break;
          }
        } else if (nextAz > this.softLimits.azimuthMax) {
          if (this.maxAzimuthRange === 450 && nextAz > 450) {
            // Bei 450°-Modus: Wrap-around erlauben
            // Für Rechts-Bewegung: wenn wir über 450 gehen, subtrahiere 450
            if (stepDirection > 0) {
              nextAz = nextAz - this.maxAzimuthRange;
            } else {
              // Nach links, aber über Maximum -> Limit erreicht
              break;
            }
            // Prüfe ob innerhalb der Limits nach Wrap-around
            if (nextAz < this.softLimits.azimuthMin || nextAz > this.softLimits.azimuthMax) {
              break;
            }
          } else {
            // Limit erreicht, stoppe
            break;
          }
        }
        // Stelle sicher, dass wir innerhalb der Limits sind (ohne clamp, da wir Wrap-around bereits behandelt haben)
        if (nextAz < this.softLimits.azimuthMin || nextAz > this.softLimits.azimuthMax) {
          break;
        }
      } else if (isElevation && typeof status.elevation === 'number') {
        nextEl = status.elevation + step;
        // Prüfe Limits
        if (nextEl < this.softLimits.elevationMin || nextEl > this.softLimits.elevationMax) {
          // Limit erreicht, stoppe
          break;
        }
        nextEl = clamp(nextEl, this.softLimits.elevationMin, this.softLimits.elevationMax);
      }

      // Sende Position direkt, wobei wir die Richtung durch die Schritt-Richtung erzwingen
      // Berechne Raw-Position direkt mit korrekter Berücksichtigung der Richtung
      if (isAzimuth) {
        // Konvertiere nextAz (kalibriert) zu Raw: raw = (displayed * scaleFactor) - offset
        let rawAz = (nextAz * this.azimuthScaleFactor) - this.azimuthOffset;
        
        // Hole aktuelle Raw-Position
        const currentRawAz = typeof status.azimuthRaw === 'number' 
          ? status.azimuthRaw 
          : ((status.azimuth * this.azimuthScaleFactor) - this.azimuthOffset);
        
        // Berechne Delta in Raw-Koordinaten
        let rawDelta = rawAz - currentRawAz;
        
        // Normalisiere Delta auf -range/2 bis +range/2
        while (rawDelta > this.maxAzimuthRange / 2) {
          rawDelta -= this.maxAzimuthRange;
        }
        while (rawDelta < -this.maxAzimuthRange / 2) {
          rawDelta += this.maxAzimuthRange;
        }
        
        // Stelle sicher, dass die Richtung mit der gewünschten Richtung übereinstimmt
        // Wenn nicht, passe die Position an, um die gewünschte Richtung zu erzwingen
        if ((stepDirection > 0 && rawDelta < 0) || (stepDirection < 0 && rawDelta > 0)) {
          // Richtung stimmt nicht überein, passe Position an
          if (stepDirection > 0) {
            // Nach rechts, aber Delta ist negativ -> addiere range
            rawDelta += this.maxAzimuthRange;
          } else {
            // Nach links, aber Delta ist positiv -> subtrahiere range
            rawDelta -= this.maxAzimuthRange;
          }
        }
        
        // Berechne finale Raw-Position
        rawAz = currentRawAz + rawDelta;
        
        // Wende Wrap-around an
        const wrappedRawAz = wrapAzimuth(rawAz, this.maxAzimuthRange);
        const azValue = Math.round(wrappedRawAz).toString().padStart(3, '0');
        
        // Prüfe ob Schritt groß genug ist (mindestens 0,5° für ERC-DUO)
        const currentAz = typeof status.azimuth === 'number' ? status.azimuth : nextAz;
        const azDelta = Math.abs(shortestAngularDelta(nextAz, currentAz, this.maxAzimuthRange));
        if (azDelta >= 0.5) {
          await this.sendRawCommand(`M${azValue}`);
        }
      } else {
        const elPlan = this.planElevationTarget(nextEl);
        // Für Elevation verwenden wir die normale Planung
        const currentAzRaw = typeof this.currentStatus?.azimuthRaw === 'number'
          ? Math.round(this.currentStatus.azimuthRaw).toString().padStart(3, '0')
          : '000';
        const elValue = Math.round(elPlan.commandValue).toString().padStart(3, '0');
        
        // Prüfe ob Schritt groß genug ist (mindestens 0,5° für ERC-DUO)
        const currentEl = typeof status.elevation === 'number' ? status.elevation : nextEl;
        const elDelta = Math.abs(nextEl - currentEl);
        if (elDelta >= 0.5) {
          await this.sendRawCommand(`W${currentAzRaw} ${elValue}`);
        }
      }

      // ERC-DUO: Geschwindigkeitseinstellungen werden nicht regelmäßig neu gesendet
      // Soft-Rampen wird durch Positionsschritte simuliert
      // Erhöhe Verzögerung für bessere Kompatibilität mit ERC-DUO

      timeSinceStart += rampSettings.rampSampleTimeMs;
      await delay(Math.max(rampSettings.rampSampleTimeMs, 200));
    }

    if (this.activeManualRamp === rampContext) {
      this.activeManualRamp = null;
    }
  }

  async executeManualStop(stopCommand) {
    // stopCommand: 'A' (Azimut stoppen), 'E' (Elevation stoppen), 'S' (alles stoppen)
    if (!this.serial || !this.serial.isOpen()) {
      throw new Error('Rotor ist nicht verbunden.');
    }
    const rampSettings = this.getRampSettings();
    
    // Stoppe alle aktiven Bewegungen (sowohl manuelle als auch Positions-basierte)
    this.cancelActiveManualRamp();
    this.cancelActiveRamp();

    // Speichere aktuelle Position als Stopp-Position BEIM STOPPEN
    const stopPosition = this.currentStatus ? {
      az: this.currentStatus.azimuth,
      el: this.currentStatus.elevation
    } : null;

    if (!rampSettings.rampEnabled) {
      // Wenn Softstart/Softstop deaktiviert, direkten Stopp-Befehl senden
      await this.sendRawCommand(stopCommand);
      this.manualDirection = null;
      this.manualStopPosition = null;
      return;
    }

    // Wenn keine manuelle Richtung gesetzt ist (z.B. bei Klicksteuerung), direkter Stopp
    if (!this.manualDirection) {
      // Sende sofort Stopp-Befehl an Hardware
      await this.sendRawCommand(stopCommand);
      this.manualDirection = null;
      this.manualStopPosition = null;
      return;
    }

    if (!stopPosition) {
      // Keine Position verfügbar, direkter Stopp
      await this.sendRawCommand(stopCommand);
      this.manualDirection = null;
      this.manualStopPosition = null;
      return;
    }

    // Phase 1: Sanftes Stoppen mit reduzierter Geschwindigkeit und Nachlaufen
    let speedFactor = 1.0;
    const rampDownTimeMs = 1000; // 1 Sekunde zum Abbremsen
    let timeSinceStop = 0;
    const dtSeconds = rampSettings.rampSampleTimeMs / 1000;
    const maxOvershootDeg = 2.0; // Maximales Nachlaufen in Grad

    while (timeSinceStop < rampDownTimeMs) {
      const status = this.currentStatus;
      if (!status) break;

      // Reduziere Geschwindigkeit linear
      speedFactor = 1.0 - (timeSinceStop / rampDownTimeMs);

      // Berechne Schritt basierend auf reduzierter Geschwindigkeit
      const baseAzStep = this.speedSettings.azimuthSpeedDegPerSec * dtSeconds * speedFactor;
      const baseElStep = this.speedSettings.elevationSpeedDegPerSec * dtSeconds * speedFactor;

      // Bewege weiter in aktuelle Richtung mit reduzierter Geschwindigkeit (Nachlaufen)
      let nextAz = status.azimuth;
      let nextEl = status.elevation;

      if (stopCommand === 'A' || stopCommand === 'S') {
        // Azimut stoppen - bewege noch etwas weiter in aktuelle Richtung
        if (this.manualDirection === 'R' || this.manualDirection === 'L') {
          const stepDirection = this.manualDirection === 'R' ? 1 : -1;
          const step = Math.min(baseAzStep, maxOvershootDeg);
          nextAz = status.azimuth + stepDirection * step;
          // Prüfe Limits
          if (nextAz < this.softLimits.azimuthMin || nextAz > this.softLimits.azimuthMax) {
            // Limit erreicht, stoppe Nachlaufen
            break;
          }
        }
      }

      if (stopCommand === 'E' || stopCommand === 'S') {
        // Elevation stoppen - bewege noch etwas weiter in aktuelle Richtung
        if (this.manualDirection === 'U' || this.manualDirection === 'D') {
          const stepDirection = this.manualDirection === 'U' ? 1 : -1;
          const step = Math.min(baseElStep, maxOvershootDeg);
          nextEl = status.elevation + stepDirection * step;
          // Prüfe Limits
          if (nextEl < this.softLimits.elevationMin || nextEl > this.softLimits.elevationMax) {
            // Limit erreicht, stoppe Nachlaufen
            break;
          }
        }
      }

      await this.sendPlannedTarget(nextAz, nextEl);
      timeSinceStop += rampSettings.rampSampleTimeMs;
      await delay(rampSettings.rampSampleTimeMs);
    }

    // Phase 2: Warte auf Schwingungen (500ms)
    await delay(500);

    // Phase 3: Zurück zur ursprünglichen Stopp-Position
    if (this.currentStatus) {
      const currentAz = this.currentStatus.azimuth;
      const currentEl = this.currentStatus.elevation;
      const azError = stopCommand === 'A' || stopCommand === 'S' 
        ? shortestAngularDelta(stopPosition.az, currentAz, this.maxAzimuthRange)
        : 0;
      const elError = stopCommand === 'E' || stopCommand === 'S'
        ? stopPosition.el - currentEl
        : 0;

      if (Math.abs(azError) > 0.5 || Math.abs(elError) > 0.5) {
        // Verwende executeRamp für sanfte Rückkehr
        await this.executeRamp({
          az: stopCommand === 'A' || stopCommand === 'S' ? stopPosition.az : null,
          el: stopCommand === 'E' || stopCommand === 'S' ? stopPosition.el : null
        });
      }
    }

    // Sende finalen Stopp-Befehl
    await this.sendRawCommand(stopCommand);
    this.manualDirection = null;
    this.manualStopPosition = null;
  }

  async sendPlannedTarget(azimuth, elevation) {
    const azPlan = typeof azimuth === 'number' && !Number.isNaN(azimuth) ? this.planAzimuthTarget(azimuth) : null;
    const elPlan =
      typeof elevation === 'number' && !Number.isNaN(elevation) ? this.planElevationTarget(elevation) : null;

    // Prüfe ob Schritte groß genug sind (mindestens 0,5° für ERC-DUO)
    // Zu kleine Schritte werden möglicherweise ignoriert
    const minStepDeg = 0.5;
    let shouldSend = false;

    if (azPlan && elPlan) {
      const currentAz = typeof this.currentStatus?.azimuth === 'number' ? this.currentStatus.azimuth : azimuth;
      const currentEl = typeof this.currentStatus?.elevation === 'number' ? this.currentStatus.elevation : elevation;
      const azDelta = Math.abs(shortestAngularDelta(azimuth, currentAz, this.maxAzimuthRange));
      const elDelta = Math.abs(elevation - currentEl);
      
      if (azDelta >= minStepDeg || elDelta >= minStepDeg) {
        shouldSend = true;
        const azValue = Math.round(azPlan.commandValue).toString().padStart(3, '0');
        const elValue = Math.round(elPlan.commandValue).toString().padStart(3, '0');
        console.log('[RotorService] PI-Rampe Schritt (Az+El)', { 
          azimuth, elevation, azPlan, elPlan, azValue, elValue,
          azDelta: azDelta.toFixed(2), elDelta: elDelta.toFixed(2)
        });
        await this.sendRawCommand(`W${azValue} ${elValue}`);
      }
      return;
    }

    if (azPlan) {
      const currentAz = typeof this.currentStatus?.azimuth === 'number' ? this.currentStatus.azimuth : azimuth;
      const azDelta = Math.abs(shortestAngularDelta(azimuth, currentAz, this.maxAzimuthRange));
      
      if (azDelta >= minStepDeg) {
        shouldSend = true;
        const azValue = Math.round(azPlan.commandValue).toString().padStart(3, '0');
        console.log('[RotorService] PI-Rampe Schritt (Az)', { 
          azimuth, azPlan, azValue, azDelta: azDelta.toFixed(2)
        });
        await this.sendRawCommand(`M${azValue}`);
      }
      return;
    }

    if (elPlan) {
      const currentEl = typeof this.currentStatus?.elevation === 'number' ? this.currentStatus.elevation : elevation;
      const elDelta = Math.abs(elevation - currentEl);
      
      if (elDelta >= minStepDeg) {
        shouldSend = true;
        const currentAzRaw = typeof this.currentStatus?.azimuthRaw === 'number'
          ? Math.round(this.currentStatus.azimuthRaw).toString().padStart(3, '0')
          : '000';
        const elValue = Math.round(elPlan.commandValue).toString().padStart(3, '0');
        console.log('[RotorService] PI-Rampe Schritt (El)', { 
          elevation, elPlan, elValue, currentAzRaw, elDelta: elDelta.toFixed(2)
        });
        await this.sendRawCommand(`W${currentAzRaw} ${elValue}`);
      }
    }
    
    if (!shouldSend) {
      console.log('[RotorService] Schritt zu klein, überspringe Befehl', { azimuth, elevation });
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
    const clampStage = (value) => {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return null;
      }
      return clamp(Math.round(value), 1, 4);
    };
    const clampAngle = (value) => {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return null;
      }
      return clamp(Math.round(value), 0, 3);
    };
    if (typeof settings.azimuthSpeedDegPerSec === 'number' && !Number.isNaN(settings.azimuthSpeedDegPerSec)) {
      nextSettings.azimuthSpeedDegPerSec = clamp(settings.azimuthSpeedDegPerSec, 0.5, 20);
    }
    if (typeof settings.elevationSpeedDegPerSec === 'number' && !Number.isNaN(settings.elevationSpeedDegPerSec)) {
      nextSettings.elevationSpeedDegPerSec = clamp(settings.elevationSpeedDegPerSec, 0.5, 20);
    }
    const azLowStage = clampStage(settings.azimuthLowSpeedStage);
    if (azLowStage !== null) {
      nextSettings.azimuthLowSpeedStage = azLowStage;
    }
    const azHighStage = clampStage(settings.azimuthHighSpeedStage);
    if (azHighStage !== null) {
      nextSettings.azimuthHighSpeedStage = azHighStage;
    }
    const elLowStage = clampStage(settings.elevationLowSpeedStage);
    if (elLowStage !== null) {
      nextSettings.elevationLowSpeedStage = elLowStage;
    }
    const elHighStage = clampStage(settings.elevationHighSpeedStage);
    if (elHighStage !== null) {
      nextSettings.elevationHighSpeedStage = elHighStage;
    }
    const azSpeedAngle = clampAngle(settings.azimuthSpeedAngleCode);
    if (azSpeedAngle !== null) {
      nextSettings.azimuthSpeedAngleCode = azSpeedAngle;
    }
    const elSpeedAngle = clampAngle(settings.elevationSpeedAngleCode);
    if (elSpeedAngle !== null) {
      nextSettings.elevationSpeedAngleCode = elSpeedAngle;
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

  setScaleFactors(factors) {
    if (!factors) {
      return;
    }
    if (typeof factors.azimuthScaleFactor === 'number') {
      this.azimuthScaleFactor = clamp(factors.azimuthScaleFactor, 0.1, 2.0);
    }
    if (typeof factors.elevationScaleFactor === 'number') {
      this.elevationScaleFactor = clamp(factors.elevationScaleFactor, 0.1, 2.0);
    }
    console.log('[RotorService] Skalierungsfaktoren gesetzt', {
      azimuthScaleFactor: this.azimuthScaleFactor,
      elevationScaleFactor: this.elevationScaleFactor
    });
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

  getClientCount() {
    // Gibt die Anzahl der verbundenen Clients zurück (nur im Server-Modus)
    if (this.serial instanceof ServerConnection) {
      return this.serial.clientCount || 0;
    }
    return null; // Nicht im Server-Modus
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
      console.warn('[RotorService] applySpeedSettings: Serial nicht verbunden');
      return;
    }
    if (this.serial instanceof SimulationSerialConnection) {
      this.serial.setSpeed(this.speedSettings);
      return;
    }

    // ERC-DUO verwendet API-Befehle für Geschwindigkeitseinstellungen, nicht GS-232B Sxxx/Bxxx
    // Format: s + 3-Letter-Code + 4-stelliger Wert + <cr>
    // sSL1xxxx = Low-Speed Azimuth (xxxx = 4-stelliger Wert, 1-4 Stufen)
    // sSH1xxxx = High-Speed Azimuth (1-4 Stufen)
    // sSA1xxxx = Speed-Angle Azimuth (Umschaltposition in Grad)
    // Analog für Elevation: ...2 statt ...1
    
    // ERC-DUO Speed-Einstellungen: Basierend auf der Dokumentation
    // ERC-DUO hat nur 4 Geschwindigkeitsstufen: 1 (langsamste) bis 4 (schnellste)
    // Konvertiere 0,5-20 °/s auf 1-4 Stufen
    const convertSpeedToERCStage = (speedDegPerSec) => {
      const clamped = Math.max(0.5, Math.min(20, speedDegPerSec));
      // Lineare Konvertierung: 0,5-20 → 1-4 Stufen
      // Stufe 1: 0,5-5,5 °/s (langsamste)
      // Stufe 2: 5,5-10,5 °/s
      // Stufe 3: 10,5-15,5 °/s
      // Stufe 4: 15,5-20 °/s (schnellste)
      const stage = Math.round(1 + ((clamped - 0.5) / 19.5) * 3);
      return Math.max(1, Math.min(4, stage));
    };

    const resolveSpeedStage = (stageValue, fallbackSpeed) => {
      if (typeof stageValue === 'number' && !Number.isNaN(stageValue)) {
        return clamp(Math.round(stageValue), 1, 4);
      }
      if (typeof fallbackSpeed === 'number' && !Number.isNaN(fallbackSpeed)) {
        return convertSpeedToERCStage(fallbackSpeed);
      }
      return null;
    };

    const resolveSpeedAngleCode = (angleValue) => {
      if (typeof angleValue === 'number' && !Number.isNaN(angleValue)) {
        return clamp(Math.round(angleValue), 0, 3);
      }
      return 3; // Default 30°
    };
    
    const commands = [];
    
    const azimuthLowStage = resolveSpeedStage(
      this.speedSettings.azimuthLowSpeedStage,
      this.speedSettings.azimuthSpeedDegPerSec
    );
    const azimuthHighStage = resolveSpeedStage(
      this.speedSettings.azimuthHighSpeedStage,
      this.speedSettings.azimuthSpeedDegPerSec
    );
    const azimuthSpeedAngleCode = resolveSpeedAngleCode(this.speedSettings.azimuthSpeedAngleCode);

    console.log('[RotorService] ERC-DUO Azimut-Geschwindigkeit', {
      lowStage: azimuthLowStage,
      highStage: azimuthHighStage,
      speedAngleCode: azimuthSpeedAngleCode,
      fallbackSpeedDegPerSec: this.speedSettings.azimuthSpeedDegPerSec
    });

    if (azimuthLowStage !== null) {
      commands.push(`sSL1${azimuthLowStage.toString().padStart(4, '0')}`);
    }
    if (azimuthHighStage !== null) {
      commands.push(`sSH1${azimuthHighStage.toString().padStart(4, '0')}`);
    }
    commands.push(`sSA1${azimuthSpeedAngleCode.toString().padStart(4, '0')}`);

    const elevationLowStage = resolveSpeedStage(
      this.speedSettings.elevationLowSpeedStage,
      this.speedSettings.elevationSpeedDegPerSec
    );
    const elevationHighStage = resolveSpeedStage(
      this.speedSettings.elevationHighSpeedStage,
      this.speedSettings.elevationSpeedDegPerSec
    );
    const elevationSpeedAngleCode = resolveSpeedAngleCode(this.speedSettings.elevationSpeedAngleCode);

    console.log('[RotorService] ERC-DUO Elevations-Geschwindigkeit', {
      lowStage: elevationLowStage,
      highStage: elevationHighStage,
      speedAngleCode: elevationSpeedAngleCode,
      fallbackSpeedDegPerSec: this.speedSettings.elevationSpeedDegPerSec
    });

    if (elevationLowStage !== null) {
      commands.push(`sSL2${elevationLowStage.toString().padStart(4, '0')}`);
    }
    if (elevationHighStage !== null) {
      commands.push(`sSH2${elevationHighStage.toString().padStart(4, '0')}`);
    }
    commands.push(`sSA2${elevationSpeedAngleCode.toString().padStart(4, '0')}`);
    
    // ERC-DUO Softstart/Softstop: Delay before move (sDM1, sDM2)
    // Range: 0-5000 ms, Default: 1000 ms
    // Dies ist die Verzögerung bevor der Rotor sich zu bewegen beginnt
    const rampSettings = this.getRampSettings();
    if (rampSettings.rampEnabled) {
      // Konvertiere rampSampleTimeMs (100-2000) auf Delay (0-5000)
      // Verwende einen sinnvollen Wert basierend auf den Ramp-Einstellungen
      const delayMs = Math.min(5000, Math.max(0, rampSettings.rampSampleTimeMs * 2));
      const delayValue = Math.round(delayMs).toString().padStart(4, '0');
      commands.push(`sDM1${delayValue}`); // Delay before move Azimuth
      commands.push(`sDM2${delayValue}`); // Delay before move Elevation
      
      console.log('[RotorService] Softstart/Softstop Delay konfigurieren', {
        delayMs,
        delayValue,
        commands: [`sDM1${delayValue}`, `sDM2${delayValue}`]
      });
    }

    if (commands.length === 0) {
      console.warn('[RotorService] Keine Geschwindigkeitsbefehle zu senden');
      return;
    }

    console.log('[RotorService] Sende Geschwindigkeitsbefehle an ERC-DUO', { commands, count: commands.length });

    // Sende ERC-DUO API-Befehle mit Verzögerung
    // Wichtig: Diese Befehle haben keine Antwort, müssen aber trotzdem korrekt verarbeitet werden
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      console.log(`[RotorService] Sende Geschwindigkeitsbefehl ${i + 1}/${commands.length}:`, command);
      await this.sendRawCommand(command);
      // ERC-DUO benötigt Zeit zum Verarbeiten von API-Befehlen
      if (i < commands.length - 1) {
        await delay(50);
      }
    }
    
    console.log('[RotorService] Alle Geschwindigkeitsbefehle gesendet');
  }

  async ensureSpeedSettings() {
    // ERC-DUO: Geschwindigkeitseinstellungen können nicht dynamisch geändert werden
    // Die Geschwindigkeit wird über API-Befehle (sSL1, sSH1, etc.) konfiguriert
    // und bleibt dann fest, bis sie erneut geändert wird.
    // Daher müssen wir die Geschwindigkeit nicht vor jeder Bewegung neu setzen.
    // Nur beim Verbinden oder wenn sich die Einstellungen ändern.
    if (this.serial instanceof SimulationSerialConnection) {
      return; // Simulation verwaltet Geschwindigkeit intern
    }
    // Für ERC-DUO: Geschwindigkeit wird nur einmal beim Verbinden gesetzt
    // oder wenn sich die Einstellungen ändern - nicht vor jeder Bewegung
    // await this.applySpeedSettings(); // Deaktiviert, da nicht nötig
  }

  normalizeAzimuth(value) {
    // Konvertiere Raw-Wert zu Anzeige-Wert: (raw + offset) / scaleFactor
    // Wenn Motor doppelt so weit dreht wie gemeldet (Faktor 0.5), dann:
    // Raw 45° → Anzeige 45° / 0.5 = 90° (tatsächliche Position)
    const calibrated = (value + this.azimuthOffset) / this.azimuthScaleFactor;
    return clamp(calibrated, this.softLimits.azimuthMin, this.softLimits.azimuthMax);
  }

  normalizeElevation(value) {
    // Konvertiere Raw-Wert zu Anzeige-Wert: (raw + offset) / scaleFactor
    // Wenn Motor doppelt so weit dreht wie gemeldet (Faktor 0.5), dann:
    // Raw 45° → Anzeige 45° / 0.5 = 90° (tatsächliche Position)
    const calibrated = (value + this.elevationOffset) / this.elevationScaleFactor;
    return clamp(calibrated, this.softLimits.elevationMin, this.softLimits.elevationMax);
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

    // Berechne den Raw-Wert basierend auf der aktuellen Raw-Position und dem Delta
    // Dies stellt sicher, dass der kürzeste Weg gewählt wird
    // WICHTIG: current ist bereits ein Anzeige-Wert (nach normalizeAzimuth)
    // Um zu Raw zu konvertieren: raw = (displayed * scaleFactor) - offset
    // Wenn wir 90° wollen und Faktor 0.5: Raw = 90 * 0.5 = 45° (Motor meldet 45°, dreht aber 90°)
    const currentRaw = typeof this.currentStatus?.azimuthRaw === 'number' 
      ? this.currentStatus.azimuthRaw 
      : ((current * this.azimuthScaleFactor) - this.azimuthOffset);
    
    // Berechne das Delta in Raw-Koordinaten
    // route.target ist der Anzeige-Zielwert, route.delta ist die kürzeste Änderung in Anzeige-Koordinaten
    // Um zu Raw-Delta zu konvertieren: rawDelta = displayedDelta * scaleFactor
    // Wenn wir 90° drehen wollen und Faktor 0.5: RawDelta = 90 * 0.5 = 45°
    const rawDelta = route.delta * this.azimuthScaleFactor;
    
    // Berechne den Ziel-Raw-Wert durch Addition des Deltas zur aktuellen Raw-Position
    // Dies stellt sicher, dass wir den kürzesten Weg nehmen
    const rawCommand = currentRaw + rawDelta;
    
    // Wende Wrap-around an, um sicherzustellen, dass der Wert im gültigen Bereich liegt
    let wrappedRawCommand = wrapAzimuth(rawCommand, range);
    
    // Verifiziere, dass der gewrapte Wert tatsächlich den kürzesten Weg nimmt
    // Wenn nicht, korrigiere ihn durch Anpassung der "Revolution"
    const actualDelta = shortestAngularDelta(wrappedRawCommand, currentRaw, range);
    if (Math.abs(actualDelta - rawDelta) > 0.1) {
      // Der gewrapte Wert würde nicht den kürzesten Weg nehmen
      // Korrigiere durch Anpassung der Revolution: wenn rawDelta negativ war, 
      // aber wrappedRawCommand > currentRaw, dann müssen wir eine Revolution subtrahieren
      if (rawDelta < 0 && wrappedRawCommand > currentRaw) {
        // Wir wollten gegen den Uhrzeigersinn gehen, aber der gewrapte Wert ist größer
        // Subtrahiere eine volle Umdrehung
        wrappedRawCommand = wrapAzimuth(wrappedRawCommand - range, range);
      } else if (rawDelta > 0 && wrappedRawCommand < currentRaw) {
        // Wir wollten im Uhrzeigersinn gehen, aber der gewrapte Wert ist kleiner
        // Addiere eine volle Umdrehung
        wrappedRawCommand = wrapAzimuth(wrappedRawCommand + range, range);
      }
    }
    
    return {
      calibrated: route.target,
      commandValue: wrappedRawCommand,
      direction: route.direction,
      usesWrap: route.usesWrap
    };
  }

  planElevationTarget(target) {
    const calibrated = clamp(target, this.softLimits.elevationMin, this.softLimits.elevationMax);
    // Konvertiere Anzeige-Wert zu Raw-Wert: raw = (displayed * scaleFactor) - offset
    // Wenn wir 90° wollen und Faktor 0.5: Raw = 90 * 0.5 = 45° (Motor meldet 45°, dreht aber 90°)
    const rawCommand = clamp((calibrated * this.elevationScaleFactor) - this.elevationOffset, 0, Math.max(this.softLimits.elevationMax, 90));
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
