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
  const above = base + range;
  const below = base - range;
  if (above <= max) {
    candidates.push(above);
  }
  if (below >= min) {
    candidates.push(below);
  }
  return candidates;
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
  constructor() {
    super();
    this.isConnected = false;
    this.azimuthRaw = 0;
    this.elevationRaw = 0;
    this.azDirection = 0;
    this.elDirection = 0;
    this.modeMaxAz = 360;
    this.azimuthOffset = 0;
    this.elevationOffset = 0;
    this.azimuthMin = 0;
    this.azimuthMax = 360;
    this.elevationMin = 0;
    this.elevationMax = 90;
    this.ticker = null;
  }

  async open() {
    if (this.isConnected) {
      return;
    }
    this.isConnected = true;
    console.log('[RotorService][Simulation] Verbunden');
    this.startTicker();
    this.emitStatus();
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
        this.azimuthRaw = this.planRawAzimuthTarget(value);
        this.emitStatus();
      }
      return;
    }

    if (normalized.startsWith('W')) {
      const parts = normalized.slice(1).trim().split(/\s+/);
      const az = Number(parts[0]);
      const el = Number(parts[1]);
      if (!Number.isNaN(az)) {
        this.azimuthRaw = this.planRawAzimuthTarget(az);
      }
      if (!Number.isNaN(el)) {
        this.elevationRaw = this.constrainRawElevation(el);
      }
      this.emitStatus();
      return;
    }

    switch (normalized) {
      case 'R':
        this.azDirection = 1;
        break;
      case 'L':
        this.azDirection = -1;
        break;
      case 'A':
        this.azDirection = 0;
        break;
      case 'U':
        this.elDirection = 1;
        break;
      case 'D':
        this.elDirection = -1;
        break;
      case 'E':
        this.elDirection = 0;
        break;
      case 'S':
        this.azDirection = 0;
        this.elDirection = 0;
        break;
      case 'C':
      case 'B':
      case 'C2':
        this.emitStatus();
        break;
      case 'P36':
        this.modeMaxAz = 360;
        this.azimuthRaw = this.constrainRawAzimuth(this.azimuthRaw, this.azimuthRaw);
        break;
      case 'P45':
        this.modeMaxAz = 450;
        this.azimuthRaw = this.constrainRawAzimuth(this.azimuthRaw, this.azimuthRaw);
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
      if (this.azDirection !== 0) {
        const candidate = this.azimuthRaw + this.azDirection * 2;
        this.azimuthRaw = this.constrainRawAzimuth(candidate, this.azimuthRaw);
      }
      if (this.elDirection !== 0) {
        const candidate = this.elevationRaw + this.elDirection;
        this.elevationRaw = this.constrainRawElevation(candidate);
      }
      if (this.azDirection !== 0 || this.elDirection !== 0) {
        this.emitStatus();
      }
    }, 500);
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

    const rawTarget = bestTarget - this.azimuthOffset;
    return this.constrainRawAzimuth(rawTarget, this.azimuthRaw);
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

class WebSerialConnection extends SerialConnection {
  constructor(port) {
    super();
    this.port = port;
    this.reader = null;
    this.readLoopActive = false;
    this.buffer = '';
  }

  async open(options) {
    await this.port.open({ baudRate: options?.baudRate ?? 9600 });
    this.readLoopActive = true;
    console.log('[RotorService][WebSerial] Port geöffnet', { options });
    this.startReadLoop();
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
    console.log('[RotorService][WebSerial] Sende Befehl', { command });
    const writer = this.port.writable.getWriter();
    const payload = encoder.encode(command.endsWith('\r') ? command : `${command}\r`);
    try {
      await writer.write(payload);
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
    this.maxAzimuthRange = 360;
    this.azimuthOffset = 0;
    this.elevationOffset = 0;
    this.softLimits = {
      azimuthMin: 0,
      azimuthMax: 360,
      elevationMin: 0,
      elevationMax: 90
    };
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
    if (supportsWebSerial()) {
      const grantedPorts = await navigator.serial.getPorts();
      grantedPorts.forEach((port) => {
        const id = this.ensurePortId(port);
        this.portRegistry.set(id, port);
        ports.push({
          path: id,
          friendlyName: formatPortLabel(port, id),
          simulated: false
        });
      });
    }
    console.log('[RotorService] Gefundene Ports', { ports: ports.map((port) => ({ ...port })) });
    ports.push({
      path: SIMULATED_PORT_ID,
      friendlyName: 'Simulierter Rotor',
      simulated: true
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
    const useSimulation =
      Boolean(config.simulation) || config.path === SIMULATED_PORT_ID || !supportsWebSerial();

    console.log('[RotorService] Verbindungsaufbau gestartet', { config, useSimulation });
    await this.disconnect();
    this.maxAzimuthRange = 360;
    this.currentStatus = null;

    if (useSimulation) {
      this.simulationMode = true;
      this.serial = new SimulationSerialConnection();
    } else {
      const port = this.portRegistry.get(config.path);
      if (!port) {
        throw new Error('Der ausgewaehlte Port ist nicht mehr verfügbar. Bitte Zugriff erneut erlauben.');
      }
      this.simulationMode = false;
      this.serial = new WebSerialConnection(port);
    }

    this.serial.onData((line) => this.handleSerialLine(line));
    this.serial.onError((error) => this.emitError(error));

    await this.serial.open({ baudRate: config.baudRate });
    this.applySoftLimitConfig();
    this.applyCalibrationOffsets();
    console.log('[RotorService] Verbindung hergestellt', { mode: this.simulationMode ? 'Simulation' : 'WebSerial' });
  }

  async disconnect() {
    this.stopPolling();
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
    await this.serial.writeCommand(command.trim().toUpperCase());
  }

  async setAzimuth(target) {
    const plan = this.planAzimuthTarget(target);
    const value = Math.round(plan.commandValue).toString().padStart(3, '0');
    console.log('[RotorService] Azimut setzen', { target, plan, value });
    await this.sendRawCommand(`M${value}`);
  }

  async setAzEl({ az, el }) {
    const azPlan = this.planAzimuthTarget(az);
    const elPlan = this.planElevationTarget(el);
    const azValue = Math.round(azPlan.commandValue).toString().padStart(3, '0');
    const elValue = Math.round(elPlan.commandValue).toString().padStart(3, '0');
    console.log('[RotorService] Azimut/Elevation setzen', { az, el, azPlan, elPlan, azValue, elValue });
    await this.sendRawCommand(`W${azValue} ${elValue}`);
  }

  async setMode(mode) {
    this.maxAzimuthRange = mode === 450 ? 450 : 360;
    console.log('[RotorService] Modus setzen', { mode: this.maxAzimuthRange });
    await this.sendRawCommand(mode === 450 ? 'P45' : 'P36');
    this.applySoftLimitConfig();
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

  normalizeAzimuth(value) {
    return clamp(value + this.azimuthOffset, this.softLimits.azimuthMin, this.softLimits.azimuthMax);
  }

  normalizeElevation(value) {
    return clamp(value + this.elevationOffset, this.softLimits.elevationMin, this.softLimits.elevationMax);
  }

  planAzimuthTarget(target) {
    const range = this.maxAzimuthRange;
    const clampedTarget = clamp(target, this.softLimits.azimuthMin, this.softLimits.azimuthMax);
    const current = typeof this.currentStatus?.azimuth === 'number' ? this.currentStatus.azimuth : clampedTarget;

    const targetCandidates = generateAzimuthCandidates(
      clampedTarget,
      this.softLimits.azimuthMin,
      this.softLimits.azimuthMax,
      range
    );
    const currentCandidates = generateAzimuthCandidates(
      current,
      this.softLimits.azimuthMin,
      this.softLimits.azimuthMax,
      range
    );

    let bestTarget = clampedTarget;
    let bestDistance = Number.POSITIVE_INFINITY;
    targetCandidates.forEach((candidate) => {
      currentCandidates.forEach((currentCandidate) => {
        const distance = Math.abs(candidate - currentCandidate);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestTarget = candidate;
        }
      });
    });

    const rawCommand = bestTarget - this.azimuthOffset;
    return {
      calibrated: bestTarget,
      commandValue: wrapAzimuth(rawCommand, range)
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
